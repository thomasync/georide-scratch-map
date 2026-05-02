import {
	afterNextRender,
	Component,
	computed,
	DestroyRef,
	effect,
	HostListener,
	inject,
	isDevMode,
	signal,
	untracked,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import maplibregl from 'maplibre-gl';
import { catchError, forkJoin, of, switchMap } from 'rxjs';
import { Trip } from '../../core/models/trip';
import { GeorideApiService } from '../../core/services/georide-api';
import { H3Data, H3Resolution, H3Service, resolutionForZoom } from '../../core/services/h3';
import { LoggerService } from '../../core/services/logger';
import { PolylineService } from '../../core/services/polyline';
import { MAP_STYLES, ThemeService } from '../../core/services/theme';
import { ScreenshotService } from '../../core/services/screenshot';
import { DemoService, DemoData } from '../../core/services/demo';
import { Router } from '@angular/router';

const DEPT_MODE_ZOOM_THRESHOLD = 7.5;
const DEPT_FOCUS_EXIT_DELTA = 0.5;
const DEPT_RESOLUTION: H3Resolution = 6;
const POLYLINE_MODE_ZOOM_THRESHOLD = 13;

type Mode = 'hex' | 'dept' | 'polyline';
type TripWithCoords = Trip & { coords: [number, number][] };
type DateFilterPreset =
	| 'all'
	| 'today'
	| 'yesterday'
	| 'day-before'
	| 'this-week'
	| 'this-month'
	| 'last-month'
	| '3-months'
	| '6-months'
	| 'this-year'
	| 'last-year'
	| '3-years'
	| 'custom';

const DATE_FILTER_LABELS: Record<DateFilterPreset, string> = {
	all: 'Tout',
	today: "Aujourd'hui",
	yesterday: 'Hier',
	'day-before': 'Avant-hier',
	'this-week': 'Cette semaine',
	'this-month': 'Ce mois-ci',
	'last-month': 'Le mois dernier',
	'3-months': '3 mois',
	'6-months': '6 mois',
	'this-year': 'Cette année',
	'last-year': "L'an dernier",
	'3-years': '3 ans',
	custom: 'Choisir…',
};

const DATE_FILTER_PRESETS: DateFilterPreset[] = [
	'all',
	'today',
	'yesterday',
	'day-before',
	'this-week',
	'this-month',
	'last-month',
	'3-months',
	'6-months',
	'this-year',
	'last-year',
	'3-years',
	'custom',
];

@Component({
	selector: 'app-map',
	imports: [],
	templateUrl: './map.html',
	styleUrl: './map.scss',
})
export class Map {
	private api = inject(GeorideApiService);
	private http = inject(HttpClient);
	private polyline = inject(PolylineService);
	private h3 = inject(H3Service);
	private logger = inject(LoggerService);
	private destroyRef = inject(DestroyRef);
	theme = inject(ThemeService);
	private screenshot = inject(ScreenshotService);
	private demo = inject(DemoService);
	private router = inject(Router);

	private get isDemo(): boolean {
		return this.router.url.startsWith('/demo');
	}

	loading = signal(true);
	loadingHiding = signal(false);
	tripCount = signal(0);
	totalKm = signal(0);
	hexagonCount = signal(0);
	error = signal('');
	zoom = signal(0);
	isDevMode = isDevMode();
	focusStats = signal<{ trips: number; km: number; hex: number; pct: number; name?: string } | null>(null);
	dateFilter = signal<DateFilterPreset>('all');
	customFrom = signal('');
	customTo = signal('');
	readonly dateFilterLabels = DATE_FILTER_LABELS;
	dateFilterPresets = signal<DateFilterPreset[]>(DATE_FILTER_PRESETS);

	private map: maplibregl.Map | null = null;
	private cellsByResolution: Partial<Record<H3Resolution, H3Data>> = {};
	private currentResolution: H3Resolution | null = null;
	private currentMode: Mode | null = null;
	private allTripsWithCoords: TripWithCoords[] = [];
	private tripsWithCoords: TripWithCoords[] = [];
	private departments: GeoJSON.FeatureCollection | null = null;
	private enrichedDepts: GeoJSON.FeatureCollection | null = null;
	private popup: maplibregl.Popup | null = null;
	private selectedTripCoords: [number, number][] | null = null;
	private keepTripLineOnClose = false;
	private focusedDeptFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null = null;
	private focusDragHandler: (() => void) | null = null;
	private deptFillClickHandler:
		| ((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void)
		| null = null;
	private hoveredDeptId: string | null = null;
	private restoringStyle = false;
	private isFittingDept = false;
	private focusEntryZoom: number | null = null;
	private hexTapTimer: ReturnType<typeof setTimeout> | null = null;
	private deptTapTimer: ReturnType<typeof setTimeout> | null = null;
	private lastCanvasTouchStart = 0;
	private justClosedTrip = false;
	private openPopupCell: string | null = null;

	totalKmFormatted = computed(() => this.formatKm(this.totalKm()));

	selectFilter(filter: DateFilterPreset): void {
		this.dateFilter.set(filter);
		if (filter === 'custom') {
			const yyyy = new Date().getFullYear();
			if (!this.customFrom()) {
				this.customFrom.set(`${yyyy}-01-01`);
			}
			if (!this.customTo()) {
				this.customTo.set(`${yyyy}-12-31`);
			}
			this.applyDateFilter();
			return;
		}
		this.applyDateFilter();
	}

	updateCustomDate(type: 'from' | 'to', value: string): void {
		if (type === 'from') this.customFrom.set(value);
		else this.customTo.set(value);
		this.applyDateFilter();
	}

	private computeOldestTripDate(): Date | null {
		if (!this.allTripsWithCoords.length) return null;
		return this.allTripsWithCoords.reduce<Date>((oldest, t) => {
			const d = new Date(t.startTime);
			return d < oldest ? d : oldest;
		}, new Date(this.allTripsWithCoords[0].startTime));
	}

	private updateAvailablePresets(): void {
		const oldest = this.computeOldestTripDate();
		if (!oldest) {
			this.dateFilterPresets.set(DATE_FILTER_PRESETS);
			return;
		}
		const available = DATE_FILTER_PRESETS.filter((preset) => {
			if (preset === 'all' || preset === 'custom') return true;

			// Sur mobile, on retire certains filtres pour éviter d'avoir trop de chips
			if (
				this.isMobile &&
				['day-before', 'last-month', '3-months', '6-months', 'last-year', '3-years'].includes(preset)
			) {
				return false;
			}

			const range = this.getDateRange(preset);
			if (!range) return false;
			const now = new Date();
			const dataSpan = now.getTime() - oldest.getTime();
			const presetSpan = now.getTime() - range.from.getTime();
			const maxSpan = Math.max(dataSpan * 2, 183 * 86400000); // Au moins 6 mois, ou 2x l'ancienneté

			// 1. Le filtre ne doit pas proposer une période beaucoup trop grande par rapport aux données
			if (presetSpan > maxSpan) {
				return false;
			}

			// 2. N'afficher le preset que s'il y a au moins un trajet dans cette plage de temps
			return this.allTripsWithCoords.some((t) => {
				const d = new Date(t.startTime);
				return d >= range.from && d <= range.to;
			});
		});
		this.dateFilterPresets.set(available);
	}

	private getDateRange(filter: DateFilterPreset): { from: Date; to: Date } | null {
		if (filter === 'all') return null;

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		if (filter === 'custom') {
			let from: Date;
			if (this.customFrom()) {
				from = new Date(this.customFrom());
			} else {
				from = new Date(now.getFullYear(), 0, 1);
			}

			let to: Date;
			if (this.customTo()) {
				to = new Date(this.customTo());
			} else {
				to = new Date(now.getFullYear(), 11, 31);
			}
			to.setHours(23, 59, 59, 999);
			return { from, to };
		}
		switch (filter) {
			case 'today': {
				const to = new Date(today);
				to.setHours(23, 59, 59, 999);
				return { from: today, to };
			}
			case 'yesterday': {
				const from = new Date(today);
				from.setDate(from.getDate() - 1);
				const to = new Date(from);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			case 'day-before': {
				const from = new Date(today);
				from.setDate(from.getDate() - 2);
				const to = new Date(from);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			case 'this-week': {
				const from = new Date(today);
				const dow = today.getDay();
				from.setDate(from.getDate() - (dow === 0 ? 6 : dow - 1));
				const to = new Date(today);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			case 'this-month': {
				const from = new Date(today.getFullYear(), today.getMonth(), 1);
				const to = new Date(today);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			case 'last-month': {
				const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
				const to = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
				return { from, to };
			}
			case '3-months': {
				const from = new Date(today);
				from.setMonth(from.getMonth() - 3);
				const to = new Date(today);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			case '6-months': {
				const from = new Date(today);
				from.setMonth(from.getMonth() - 6);
				const to = new Date(today);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			case 'this-year': {
				const from = new Date(today.getFullYear(), 0, 1);
				const to = new Date(today);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			case 'last-year': {
				const from = new Date(today.getFullYear() - 1, 0, 1);
				const to = new Date(today.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
				return { from, to };
			}
			case '3-years': {
				const from = new Date(today);
				from.setFullYear(from.getFullYear() - 3);
				const to = new Date(today);
				to.setHours(23, 59, 59, 999);
				return { from, to };
			}
			default:
				return null;
		}
	}

	private lockDeptFocus = false;

	private applyDateFilter(): void {
		this.lockDeptFocus = true;
		const range = this.getDateRange(this.dateFilter());
		this.tripsWithCoords = range
			? this.allTripsWithCoords.filter((t) => {
					const d = new Date(t.startTime);
					return d >= range.from && d <= range.to;
				})
			: this.allTripsWithCoords;

		this.tripCount.set(this.tripsWithCoords.length);
		this.totalKm.set(Math.round(this.tripsWithCoords.reduce((s, t) => s + t.distance, 0) / 1000));

		const tripData = this.tripsWithCoords.map((t) => ({
			coords: t.coords,
			date: t.startTime.substring(0, 10),
		}));
		this.cellsByResolution = { 6: this.h3.computeResolution(tripData, 6) };
		this.hexagonCount.set(Object.keys(this.cellsByResolution[6]!.counts).length);

		this.enrichedDepts = null;

		if (!this.map?.getLayer('overlay-fill')) {
			this.lockDeptFocus = false;
			return;
		}

		if (this.map.getSource('all-trips')) {
			(this.map.getSource('all-trips') as maplibregl.GeoJSONSource).setData(this.buildAllTripsGeoJSON());
		}

		// Force la mise à jour des couches de départements avec les nouvelles données
		this.ensureDeptLayers();

		if (this.focusedDeptFeature) {
			// On met à jour les stats du département focus avec les nouveaux trajets
			const code = this.focusedDeptFeature.properties?.['code'];
			const depts = this.enrichedDepts as GeoJSON.FeatureCollection | null;
			const enriched = depts?.features.find((f) => f.properties?.['code'] === code);
			this.setDeptStats(
				(enriched || this.focusedDeptFeature) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
			);
		} else {
			this.focusStats.set(null);
		}

		// Préserve le focus du département lors du re-rendu dans updateView
		const wasFitting = this.isFittingDept;
		this.isFittingDept = true;

		this.currentMode = null;
		this.currentResolution = null;
		this.updateView();

		this.isFittingDept = wasFitting;

		// On relâche le verrou après un cycle asynchrone (au cas où une frame d'animation de la map lancerait une vérification)
		setTimeout(() => {
			this.lockDeptFocus = false;
		}, 100);

		if (!this.focusedDeptFeature && this.tripsWithCoords.length > 0) {
			this.fitToVisited(this.tripsWithCoords.map((t) => t.coords));
		}
	}

	async takeScreenshot(): Promise<void> {
		if (!this.map) return;
		const fs = this.focusStats();
		const items = fs
			? [
					{ value: String(fs.trips), label: 'trajets' },
					{ value: this.focusKmFormatted(), label: 'km' },
					{ value: String(fs.hex), label: 'hex.' },
					{ value: `${fs.pct}%`, label: 'exploré' },
				]
			: [
					{ value: String(this.tripCount()), label: 'trajets' },
					{ value: this.totalKmFormatted(), label: 'km' },
					{ value: String(this.hexagonCount()), label: 'hex.' },
				];

		const maskVisible = this.map.getLayoutProperty('dept-focus-mask', 'visibility') === 'visible';
		if (maskVisible) {
			this.map.setPaintProperty('dept-focus-mask', 'fill-opacity-transition', { duration: 0, delay: 0 });
			this.map.setPaintProperty('dept-focus-mask', 'fill-opacity', 0.07);
		}
		await this.screenshot.capture(this.map, { items: this.loading() || this.error() ? [] : items });
		if (maskVisible) {
			this.map.setPaintProperty('dept-focus-mask', 'fill-opacity', 0.2);
			this.map.setPaintProperty('dept-focus-mask', 'fill-opacity-transition', { duration: 300, delay: 0 });
		}
	}

	resetView(): void {
		if (!this.map) return;
		const targetZoom = this.isMobile ? 5 : 6;
		if (this.map.getZoom() <= targetZoom + 0.1) {
			this.fitToVisited(this.tripsWithCoords.map((t) => t.coords));
		} else {
			this.map.flyTo({ center: [2.3, 46.2], zoom: targetZoom });
		}
	}
	focusKmFormatted = computed(() => this.formatKm(this.focusStats()?.km ?? 0));

	@HostListener('window:resize')
	onResize(): void {
		this.updateAvailablePresets();
	}

	constructor() {
		afterNextRender(() => this.initMap());

		effect(() => {
			const style = MAP_STYLES[this.theme.theme()];
			if (this.map && !untracked(() => this.loading())) {
				this.logger.log(
					'Map',
					`[THEME] switching style, focusedDept=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'} dragHandler=${this.focusDragHandler ? 'set' : 'null'}`,
				);
				if (this.focusDragHandler) {
					this.logger.log('Map', '[THEME] removing dragend handler before setStyle');
					this.map.off('dragend', this.focusDragHandler);
					this.focusDragHandler = null;
				}
				this.map.setStyle(style);
				this.map.once('style.load', () => {
					this.logger.log(
						'Map',
						`[THEME style.load] focusedDept=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'} zoom=${this.map!.getZoom().toFixed(2)}`,
					);
					this.currentResolution = null;
					this.currentMode = null;
					this.restoringStyle = true;
					this.addLayers();
					this.restoringStyle = false;
					this.logger.log(
						'Map',
						`[THEME style.load done] maskVisible=${this.map!.getLayoutProperty('dept-focus-mask', 'visibility')} focusedDept=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'}`,
					);
				});
			}
		});
	}

	private get isMobile(): boolean {
		return window.innerWidth < 768;
	}

	private get deptThreshold(): number {
		return this.isMobile ? 6.8 : DEPT_MODE_ZOOM_THRESHOLD;
	}

	private initMap(): void {
		this.logger.log('Map', 'initMap called');

		this.map = new maplibregl.Map({
			container: 'map',
			style: MAP_STYLES[this.theme.theme()],
			center: [2.3, 46.2],
			zoom: 8,
			minZoom: this.isMobile ? 5 : 6,
			maxBounds: [
				[-20, 30],
				[35, 60],
			],
			attributionControl: false,
		});

		this.map.once('style.load', () => {
			this.logger.log('Map', 'style.load fired, loading data');
			this.loadData();
		});

		this.map.on('zoomend', () => this.updateView());
		this.map.on('move', () => this.zoom.set(parseFloat(this.map!.getZoom().toFixed(2))));
		if (this.isMobile) {
			this.map.getCanvas().addEventListener(
				'touchstart',
				() => {
					const now = Date.now();
					if (now - this.lastCanvasTouchStart < 350) {
						if (this.hexTapTimer) {
							clearTimeout(this.hexTapTimer);
							this.hexTapTimer = null;
						}
						if (this.deptTapTimer) {
							clearTimeout(this.deptTapTimer);
							this.deptTapTimer = null;
						}
					}
					this.lastCanvasTouchStart = now;
				},
				{ passive: true },
			);
		}
		this.map.on('click', () => {
			if (this.selectedTripCoords) {
				this.justClosedTrip = true;
				this.clearTripLine();
			}
		});

		this.map.on('error', (e) => {
			this.logger.error('Map', 'MapLibre error', e);
		});

		this.destroyRef.onDestroy(() => {
			this.logger.log('Map', 'destroying map');
			this.map?.remove();
		});
	}

	private applyDemoData({
		departments,
		tripsWithCoords,
		cellsByResolution,
		tripCount,
		totalKm,
		hexagonCount,
	}: DemoData): void {
		this.departments = departments;
		this.allTripsWithCoords = tripsWithCoords as TripWithCoords[];
		this.tripsWithCoords = this.allTripsWithCoords;
		this.updateAvailablePresets();
		this.cellsByResolution = cellsByResolution;
		this.tripCount.set(tripCount);
		this.totalKm.set(totalKm);
		this.hexagonCount.set(hexagonCount);
		this.addLayers();
		this.initViewAfterLoad(this.tripsWithCoords.map((t) => t.coords));
	}

	private loadData(): void {
		this.logger.log('Map', 'loadData called');

		if (this.isDemo) {
			this.demo.load().subscribe({
				next: (data) => this.applyDemoData(data),
				error: () => {
					this.error.set('Impossible de charger les départements');
					this.loading.set(false);
				},
			});
			return;
		}

		forkJoin({
			trackers: this.api.getTrackers(),
			departments: this.http.get<GeoJSON.FeatureCollection>('/departements.geojson').pipe(
				catchError(() => {
					this.logger.warn('Map', 'departments.geojson not found, dept mode disabled');
					return of(null);
				}),
			),
		})
			.pipe(
				switchMap(({ trackers, departments }) => {
					this.departments = departments;
					this.logger.log('Map', `got ${trackers.length} tracker(s), fetching trips`);
					const to = new Date();
					to.setHours(23, 59, 59, 999);
					return forkJoin(
						trackers.map((t) => this.api.getTrips(t.trackerId, new Date(t.activationDate), to)),
					);
				}),
			)
			.subscribe({
				next: (tripArrays) => {
					const allTrips = tripArrays.flat();
					this.logger.log('Map', `total trips: ${allTrips.length}`);
					this.tripCount.set(allTrips.length);
					this.totalKm.set(Math.round(allTrips.reduce((sum, t) => sum + t.distance, 0) / 1000));

					this.allTripsWithCoords = allTrips
						.map((trip) => ({
							...trip,
							coords: this.polyline.extractFromStaticImage(trip.staticImage),
						}))
						.filter((t) => t.coords.length > 0) as TripWithCoords[];
					this.tripsWithCoords = this.allTripsWithCoords;
					this.updateAvailablePresets();

					this.logger.log('Map', `computing H3 cells for resolution 6`);
					const tripData = this.tripsWithCoords.map((t) => ({
						coords: t.coords,
						date: t.startTime.substring(0, 10),
					}));
					this.cellsByResolution[6] = this.h3.computeResolution(tripData, 6);
					this.logger.log(
						'Map',
						`resolution 6: ${Object.keys(this.cellsByResolution[6].counts).length} cells`,
					);

					this.hexagonCount.set(Object.keys(this.cellsByResolution[DEPT_RESOLUTION]?.counts ?? {}).length);

					this.addLayers();
					this.initViewAfterLoad(this.tripsWithCoords.map((t) => t.coords));
				},
				error: (err) => {
					this.logger.error('Map', 'API error', err);
					this.error.set(`Erreur API : ${err?.status ?? err?.message ?? 'inconnue'}`);
					this.loading.set(false);
				},
			});
	}

	private hideCityLabels(): void {
		for (const layer of this.map!.getStyle().layers) {
			if (layer.type !== 'symbol') continue;
			this.map!.setPaintProperty(layer.id, 'text-opacity', ['interpolate', ['linear'], ['zoom'], 6.5, 0, 7, 1]);
		}
	}

	private addLayers(): void {
		if (!this.map || !Object.keys(this.cellsByResolution).length) return;

		this.hideCityLabels();

		if (this.theme.isDark()) {
			this.map.setPaintProperty('background', 'background-color', '#1c1c1e');
		}

		// --- H3 overlay (scratch map) ---
		if (!this.map.getSource('overlay')) {
			this.map.addSource('overlay', {
				type: 'geojson',
				data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
			});
			this.map.addLayer({
				id: 'overlay-fill',
				type: 'fill',
				source: 'overlay',
				paint: {
					'fill-color': '#fdb300',
					'fill-opacity': 0.55,
				},
			});
		}

		// --- Dept focus mask (darkens everything outside the focused dept) ---
		if (!this.map.getSource('dept-focus-mask')) {
			this.map.addSource('dept-focus-mask', {
				type: 'geojson',
				data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
			});
			this.map.addLayer({
				id: 'dept-focus-mask',
				type: 'fill',
				source: 'dept-focus-mask',
				paint: { 'fill-color': '#000000', 'fill-opacity': 0.2 },
				layout: { visibility: 'none' },
			});
			this.map.on('click', 'dept-focus-mask', (e) => {
				const { lng, lat } = e.lngLat;
				this.logger.log(
					'Map',
					`[MASK CLICK] lngLat=${lng.toFixed(4)},${lat.toFixed(4)} focusedDept=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'}`,
				);
				const visitedDept = this.enrichedDepts?.features.find(
					(f) => (f.properties?.['pct'] ?? 0) > 0 && this.pointInFeature(lng, lat, f),
				);
				this.logger.log(
					'Map',
					`[MASK CLICK] visitedDept found: ${visitedDept?.properties?.['code'] ?? 'none'}`,
				);
				if (visitedDept) {
					this.onDeptClick(
						Object.assign(e, {
							features: [visitedDept as unknown as maplibregl.MapGeoJSONFeature],
						}),
					);
				} else {
					this.logger.log('Map', '[MASK CLICK] → clearDeptFocus + updateView');
					this.clearDeptFocus();
					this.currentMode = null;
					this.currentResolution = null;
					this.updateView();
				}
			});
			this.map.on('mouseenter', 'dept-focus-mask', () => {
				this.map!.getCanvas().style.cursor = 'pointer';
			});
			this.map.on('mouseleave', 'dept-focus-mask', () => {
				this.map!.getCanvas().style.cursor = '';
			});
		}

		// --- Dept outlines (visible in hex mode only) ---
		if (this.departments && !this.map.getSource('depts-outline')) {
			this.map.addSource('depts-outline', { type: 'geojson', data: this.departments });
			this.map.addLayer({
				id: 'depts-line',
				type: 'line',
				source: 'depts-outline',
				paint: { 'line-color': 'rgba(253,179,0,0.5)', 'line-width': 1 },
			});
		}

		// --- Heatmap (transparent hexagons for click detection) ---
		if (!this.map.getSource('heatmap')) {
			this.map.addSource('heatmap', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'heatmap-fill',
				type: 'fill',
				source: 'heatmap',
				paint: {
					'fill-color': '#fdb300',
					'fill-opacity': ['interpolate', ['linear'], ['get', 'count'], 1, 0.3, 3, 0],
				},
			});
			this.map.on('click', 'heatmap-fill', (e) => this.onHexClick(e));
			this.map.on('mouseenter', 'heatmap-fill', () => {
				this.map!.getCanvas().style.cursor = 'pointer';
			});
			this.map.on('mouseleave', 'heatmap-fill', () => {
				this.map!.getCanvas().style.cursor = '';
			});
		}

		// --- All trips polylines (polyline mode) ---
		if (!this.map.getSource('all-trips')) {
			this.map.addSource('all-trips', { type: 'geojson', data: this.buildAllTripsGeoJSON() });
			this.map.addLayer({
				id: 'all-trips-line',
				type: 'line',
				source: 'all-trips',
				paint: { 'line-color': '#fdb300', 'line-width': 2, 'line-opacity': 0.75 },
				layout: { visibility: 'none' },
			});
		}

		// --- Selected trip polyline ---
		if (!this.map.getSource('trip-line')) {
			this.map.addSource('trip-line', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'trip-line',
				type: 'line',
				source: 'trip-line',
				paint: {
					'line-color': '#fdb300',
					'line-width': 3,
					'line-opacity': 0.9,
				},
			});
			// Restore after theme change
			if (this.selectedTripCoords) {
				(this.map.getSource('trip-line') as maplibregl.GeoJSONSource).setData({
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							geometry: { type: 'LineString', coordinates: this.selectedTripCoords },
							properties: {},
						},
					],
				});
			}
		}

		this.updateView();

		this.logger.log(
			'Map',
			`[ADDLAYERS end] focusedDeptFeature=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'}`,
		);
		if (this.focusedDeptFeature) {
			this.logger.log('Map', '[ADDLAYERS] restoring mask + registering dragend');
			(this.map.getSource('dept-focus-mask') as maplibregl.GeoJSONSource).setData(
				this.deptToWorldMask(this.focusedDeptFeature.geometry),
			);
			this.map.setLayoutProperty('dept-focus-mask', 'visibility', 'visible');
			const handler = () => {
				this.logger.log('Map', '[DRAGEND handler] fired → clearDeptFocus');
				this.clearDeptFocus();
				this.currentMode = null;
				this.currentResolution = null;
				this.updateView();
			};
			if (!this.isMobile) {
				this.focusDragHandler = handler;
				this.map.once('dragend', handler);
			}
		}
	}

	private updateView(): void {
		if (!this.map || !Object.keys(this.cellsByResolution).length) return;
		if (!this.map.getLayer('overlay-fill')) return;

		const zoom = this.map.getZoom();
		const resolution = resolutionForZoom(zoom);
		this.logger.log(
			'Map',
			`[UPDATEVIEW] zoom=${zoom.toFixed(2)} res=${resolution} focusedDept=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'} restoringStyle=${this.restoringStyle} currentMode=${this.currentMode}`,
		);
		if (
			this.focusedDeptFeature &&
			this.focusEntryZoom !== null &&
			this.focusEntryZoom - zoom > DEPT_FOCUS_EXIT_DELTA &&
			!this.restoringStyle &&
			!this.isFittingDept
		) {
			this.logger.log(
				'Map',
				`[UPDATEVIEW] delta ${(this.focusEntryZoom - zoom).toFixed(2)} > ${DEPT_FOCUS_EXIT_DELTA} → clearDeptFocus`,
			);
			this.clearDeptFocus();
			this.currentMode = null;
			this.currentResolution = null;
		}
		const polylineThreshold = this.isMobile ? 12 : POLYLINE_MODE_ZOOM_THRESHOLD;
		const mode: Mode =
			zoom <= this.deptThreshold
				? 'dept'
				: zoom >= polylineThreshold && !this.selectedTripCoords
					? 'polyline'
					: 'hex';

		const modeChanged = mode !== this.currentMode;
		const resolutionChanged = resolution !== this.currentResolution;

		if (!modeChanged && !resolutionChanged) return;

		this.currentMode = mode;
		this.currentResolution = resolution;
		this.logger.log('Map', `zoom ${zoom.toFixed(1)} → mode=${mode} res=${resolution}`);

		if (modeChanged) {
			if (mode === 'dept') {
				this.ensureDeptLayers();
				if (this.focusedDeptFeature && !this.isFittingDept) this.clearDeptFocus();
			}

			const hexVisible: 'visible' | 'none' = mode === 'hex' || mode === 'polyline' ? 'visible' : 'none';
			const deptVisible: 'visible' | 'none' = mode === 'dept' ? 'visible' : 'none';
			const polylineVisible: 'visible' | 'none' = mode === 'polyline' ? 'visible' : 'none';

			if (mode === 'dept') this.clearTripLine(true);

			for (const id of ['overlay-fill', 'heatmap-fill', 'depts-line']) {
				if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', hexVisible);
			}
			for (const id of ['depts-overlay-fill', 'depts-fill', 'depts-hover', 'depts-labels']) {
				if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', deptVisible);
			}
			if (this.map.getLayer('all-trips-line')) {
				this.map.setLayoutProperty('all-trips-line', 'visibility', polylineVisible);
			}

			this.popup?.remove();
		}

		if ((mode === 'hex' || mode === 'polyline') && (modeChanged || resolutionChanged)) {
			if (!this.cellsByResolution[resolution]) {
				this.logger.log('Map', `lazy-computing resolution ${resolution}`);
				const tripData = this.tripsWithCoords.map((t) => ({
					coords: t.coords,
					date: t.startTime.substring(0, 10),
				}));
				this.cellsByResolution[resolution] = this.h3.computeResolution(tripData, resolution);
			}
			const data = this.cellsByResolution[resolution];
			if (!data) return;

			let cells: string[];
			let displayCounts: Record<string, number>;
			if (this.focusedDeptFeature) {
				const deptCells = this.h3.getDepartmentCells(this.focusedDeptFeature, resolution);
				displayCounts = {};
				for (const c of deptCells) {
					if (data.counts[c] !== undefined) displayCounts[c] = data.counts[c];
				}
				cells = Object.keys(displayCounts);
			} else {
				cells = Object.keys(data.counts);
				displayCounts = data.counts;
			}

			(this.map.getSource('overlay') as maplibregl.GeoJSONSource).setData(this.h3.cellsToOverlayGeoJSON(cells));
			(this.map.getSource('heatmap') as maplibregl.GeoJSONSource).setData(
				this.h3.cellsToHeatmapGeoJSON(displayCounts),
			);
		}
	}

	private ensureDeptLayers(): void {
		if (!this.map || !this.departments) return;

		if (!this.enrichedDepts) {
			const data = this.cellsByResolution[DEPT_RESOLUTION];
			if (!data) return;
			this.enrichedDepts = this.h3.enrichDepartmentsWithCoverage(
				this.departments,
				data.counts,
				DEPT_RESOLUTION,
				data.cellToIndices,
			);
			this.logger.log('Map', `dept layers ready: ${this.departments.features.length} depts enriched`);
		}

		const visitedDepts: GeoJSON.FeatureCollection = {
			type: 'FeatureCollection',
			features: this.enrichedDepts.features.filter((f) => (f.properties?.['pct'] ?? 0) > 0),
		};
		const overlayData = this.h3.departmentsToWorldOverlay(visitedDepts);

		// Label points (centroid of each visited dept)
		const labelData: GeoJSON.FeatureCollection<GeoJSON.Point> = {
			type: 'FeatureCollection',
			features: visitedDepts.features.map((f) => ({
				type: 'Feature' as const,
				geometry: {
					type: 'Point' as const,
					coordinates: this.getDeptCentroid(f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon),
				},
				properties: f.properties,
			})),
		};

		if (!this.map.getSource('depts-overlay')) {
			this.map.addSource('depts-overlay', { type: 'geojson', data: overlayData });
			this.map.addLayer({
				id: 'depts-overlay-fill',
				type: 'fill',
				source: 'depts-overlay',
				paint: { 'fill-color': '#fdb300', 'fill-opacity': 0.55 },
				layout: { visibility: 'none' },
			});
		} else {
			(this.map.getSource('depts-overlay') as maplibregl.GeoJSONSource).setData(overlayData);
		}

		if (!this.map.getSource('depts')) {
			this.map.addSource('depts', {
				type: 'geojson',
				data: this.stripPolygonHoles(this.enrichedDepts),
				promoteId: 'code',
			});
			this.map.addLayer({
				id: 'depts-fill',
				type: 'fill',
				source: 'depts',
				paint: {
					'fill-color': '#fdb300',
					'fill-opacity': ['interpolate', ['linear'], ['get', 'pct'], 0, 0, 1, 0.55, 100, 0],
				},
				layout: { visibility: 'none' },
			});
			this.map.addLayer({
				id: 'depts-hover',
				type: 'fill',
				source: 'depts',
				filter: ['==', ['get', 'code'], ''],
				paint: { 'fill-color': '#b37800', 'fill-opacity': 0 },
				layout: { visibility: 'none' },
			});
			if (this.deptFillClickHandler) {
				this.map.off('click', 'depts-fill', this.deptFillClickHandler);
			}
			this.deptFillClickHandler = (e) => this.onDeptClick(e);
			this.map.on('click', 'depts-fill', this.deptFillClickHandler);
			this.map.on('mousemove', 'depts-fill', (e) => {
				const feature = e.features?.[0];
				if (!feature) return;
				const pct: number = feature.properties?.['pct'] ?? 0;
				const code: string = feature.properties?.['code'] ?? '';
				this.map!.getCanvas().style.cursor = pct > 0 ? 'pointer' : '';
				if (code !== this.hoveredDeptId) {
					this.hoveredDeptId = code;
					if (pct > 0) {
						this.map!.setFilter('depts-hover', ['==', ['get', 'code'], code]);
						this.map!.setPaintProperty('depts-hover', 'fill-opacity', 0.2);
						const enriched = this.enrichedDepts?.features.find((f) => f.properties?.['code'] === code);
						if (enriched)
							this.setDeptStats(
								enriched as unknown as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
							);
					} else {
						this.map!.setPaintProperty('depts-hover', 'fill-opacity', 0);
						this.focusStats.set(null);
					}
				}
			});
			this.map.on('mouseleave', 'depts-fill', () => {
				this.map!.getCanvas().style.cursor = '';
				this.hoveredDeptId = null;
				this.map!.setPaintProperty('depts-hover', 'fill-opacity', 0);
				this.focusStats.set(null);
			});
		} else {
			(this.map.getSource('depts') as maplibregl.GeoJSONSource).setData(
				this.stripPolygonHoles(this.enrichedDepts),
			);
		}

		if (!this.map.getSource('depts-labels')) {
			this.map.addSource('depts-labels', { type: 'geojson', data: labelData });
			this.map.addLayer({
				id: 'depts-labels',
				type: 'symbol',
				source: 'depts-labels',
				layout: {
					'text-field': ['concat', ['to-string', ['get', 'pct']], '%'],
					'text-size': this.isMobile
						? ['interpolate', ['linear'], ['get', 'h3Total'], 1, 7, 5, 9, 15, 11, 30, 13, 60, 16]
						: ['interpolate', ['linear'], ['get', 'h3Total'], 1, 10, 5, 13, 15, 16, 30, 20, 60, 24],
					'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
					'text-anchor': 'center',
					'text-allow-overlap': true,
					'text-ignore-placement': true,
					visibility: 'none',
				},
				paint: {
					// fill-opacity: 0.55 at pct=1 → 0 at pct=100 (formula: 0.55*(1-(pct-1)/99))
					// at pct=40 fill is still ~0.33 (orange) → orange text would be invisible
					// transition to orange only at pct=75 where fill drops to ~0.14 (barely orange)
					'text-color': ['step', ['get', 'pct'], '#ffffff', 75, '#fdb300'],
					'text-halo-color': ['step', ['get', 'pct'], 'rgba(0,0,0,0.45)', 75, 'rgba(255,255,255,0.55)'],
					'text-halo-width': 1,
				},
			});
		} else {
			(this.map.getSource('depts-labels') as maplibregl.GeoJSONSource).setData(labelData);
		}
	}

	private stripPolygonHoles(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
		return {
			...fc,
			features: fc.features.map((f) => {
				const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
				const geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon =
					geom.type === 'Polygon'
						? { type: 'Polygon', coordinates: [geom.coordinates[0]] }
						: { type: 'MultiPolygon', coordinates: geom.coordinates.map((poly) => [poly[0]]) };
				return { ...f, geometry };
			}),
		};
	}

	private getDeptCentroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
		const ring =
			geometry.type === 'Polygon'
				? geometry.coordinates[0]
				: geometry.coordinates.reduce((a, b) => (a[0].length >= b[0].length ? a : b))[0];
		const lng = ring.reduce((s, p) => s + (p[0] as number), 0) / ring.length;
		const lat = ring.reduce((s, p) => s + (p[1] as number), 0) / ring.length;
		return [lng, lat];
	}

	private onHexClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void {
		const closingTrip = this.justClosedTrip;
		this.justClosedTrip = false;
		this.logger.log(
			'Map',
			`[HEXCLICK] closingTrip=${closingTrip} isMobile=${this.isMobile} hexTapTimer=${this.hexTapTimer !== null}`,
		);
		const feature = e.features?.[0];
		if (!feature) return;
		const cell = feature.properties?.['cell'] as string;
		const data = this.cellsByResolution[this.currentResolution ?? DEPT_RESOLUTION];
		if (!cell || !data) return;
		const tripIndices = [...new Set(data.cellToIndices[cell] ?? [])];
		const trips = tripIndices.map((i) => this.tripsWithCoords[i]).filter(Boolean);
		const sorted = [...trips].sort((a, b) => b.startTime.localeCompare(a.startTime));
		const center = this.h3.getCellCenter(cell);

		if (!this.isMobile) {
			if (!closingTrip) {
				if (this.openPopupCell === cell) {
					this.popup?.remove();
					this.popup = null;
				} else {
					this.openHexPopup(sorted, center, cell);
				}
			}
			return;
		}
		if (this.hexTapTimer) clearTimeout(this.hexTapTimer);
		if (closingTrip) {
			this.logger.log('Map', '[HEXCLICK] skipping popup (closingTrip)');
			return;
		}
		// Capture at click time: closeOnClick may null openPopupCell before the timer fires
		const wasOpenOnCell = this.openPopupCell === cell;
		this.hexTapTimer = setTimeout(() => {
			this.logger.log('Map', `[HEXCLICK] timer fired → ${wasOpenOnCell ? 'close' : 'open'}`);
			this.hexTapTimer = null;
			if (wasOpenOnCell) {
				this.popup?.remove();
				this.popup = null;
			} else {
				this.openHexPopup(sorted, center, cell);
			}
		}, 300);
	}

	private openHexPopup(sorted: TripWithCoords[], center: [number, number], cell: string): void {
		// Clear any stale polyline when opening a new popup
		this.keepTripLineOnClose = false;
		this.clearTripLine();

		this.popup?.remove();
		this.openPopupCell = cell;
		this.popup = new maplibregl.Popup({ maxWidth: 'min(320px, calc(100vw - 2rem))' })
			.setLngLat(center)
			.setHTML(this.buildHexPopupHtml(sorted))
			.addTo(this.map!);

		this.popup.on('close', () => {
			if (!this.keepTripLineOnClose) this.clearTripLine();
			this.keepTripLineOnClose = false;
			this.openPopupCell = null;
		});

		requestAnimationFrame(() => {
			const el = this.popup?.getElement();
			if (!el) return;
			el.querySelectorAll<HTMLElement>('[data-trip-idx]').forEach((item) => {
				const idx = parseInt(item.getAttribute('data-trip-idx')!, 10);
				item.addEventListener('click', () => {
					this.keepTripLineOnClose = true;
					this.showTripLine(sorted[idx]);
					this.popup?.remove();
					this.popup = null;
				});
			});
		});
	}

	private onDeptClick(e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void {
		const feature = e.features?.[0];
		if (!feature) return;
		const pct: number = feature.properties?.['pct'] ?? 0;
		const code: string | undefined = feature.properties?.['code'];

		if (!this.isMobile) {
			this.processDeptClick(pct, code);
			return;
		}
		if (this.deptTapTimer) clearTimeout(this.deptTapTimer);
		this.deptTapTimer = setTimeout(() => {
			this.deptTapTimer = null;
			this.processDeptClick(pct, code);
		}, 300);
	}

	private processDeptClick(pct: number, code: string | undefined): void {
		this.logger.log(
			'Map',
			`[DEPTCLICK] code=${code} pct=${pct} currentFocus=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'}`,
		);

		if (pct === 0) {
			this.logger.log('Map', '[DEPTCLICK] pct=0 → return');
			return;
		}

		this.clearDeptFocus();

		const enriched = code ? this.enrichedDepts?.features.find((f) => f.properties?.['code'] === code) : undefined;
		this.logger.log('Map', `[DEPTCLICK] enriched found: ${enriched ? 'yes' : 'no (fallback to feature)'}`);
		if (!enriched) return;
		const fullFeature = enriched as unknown as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
		const geom = fullFeature.geometry;
		this.logger.log('Map', `[DEPTCLICK] geom type=${geom?.type ?? 'null'}`);
		if (!geom) return;
		this.focusedDeptFeature = fullFeature;
		this.setDeptStats(fullFeature);

		// Show the mask that darkens everything outside this dept
		this.logger.log('Map', '[DEPTCLICK] setData mask + visibility=visible');
		(this.map!.getSource('dept-focus-mask') as maplibregl.GeoJSONSource).setData(this.deptToWorldMask(geom));
		this.map!.setLayoutProperty('dept-focus-mask', 'visibility', 'visible');
		this.logger.log(
			'Map',
			`[DEPTCLICK] mask visibility after set: ${this.map!.getLayoutProperty('dept-focus-mask', 'visibility')}`,
		);

		// Force updateView to re-render with dept filter applied
		this.currentMode = null;
		this.currentResolution = null;

		this.popup?.remove();

		this.logger.log('Map', `[DEPTCLICK] fitBounds → zoom currently ${this.map!.getZoom().toFixed(2)}`);
		this.isFittingDept = true;
		this.map!.fitBounds(this.getDeptBounds(geom), { padding: 40, maxZoom: 10, speed: 2 });

		// After the fitBounds animation ends, any subsequent drag exits focus mode
		this.map!.once('moveend', () => {
			this.isFittingDept = false;
			this.focusEntryZoom = this.map!.getZoom();
			this.logger.log(
				'Map',
				`[MOVEEND] fired, focusedDept=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'}, zoom=${this.map!.getZoom().toFixed(2)}, maskVisible=${this.map!.getLayoutProperty('dept-focus-mask', 'visibility')}`,
			);
			if (!this.focusedDeptFeature) return;
			const handler = () => {
				this.logger.log('Map', '[DRAGEND from moveend handler] fired → clearDeptFocus');
				this.clearDeptFocus();
				this.currentMode = null;
				this.currentResolution = null;
				this.updateView();
			};
			if (!this.isMobile) {
				this.focusDragHandler = handler;
				this.map!.once('dragend', handler);
			}
		});
	}

	private setDeptStats(feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>): void {
		const props = feature.properties as { pct?: number; h3Visited?: number } | undefined;
		const data = this.cellsByResolution[DEPT_RESOLUTION];
		if (!data) return;
		const deptCells = this.h3.getDepartmentCells(feature, DEPT_RESOLUTION);
		const tripIndices = new Set<number>();
		for (const c of deptCells) {
			for (const idx of data.cellToIndices[c] ?? []) tripIndices.add(idx);
		}
		const km = Math.round([...tripIndices].reduce((s, i) => s + this.tripsWithCoords[i].distance, 0) / 1000);
		this.focusStats.set({
			trips: tripIndices.size,
			km,
			hex: props?.h3Visited ?? deptCells.filter((c) => data.counts[c] !== undefined).length,
			pct: props?.pct ?? 0,
			name: (feature.properties as Record<string, unknown>)?.['nom'] as string | undefined,
		});
	}

	private formatKm(km: number): string {
		if (km >= 10000) return `${Math.round(km / 1000)}k`;
		if (km >= 1000) return `${(km / 1000).toFixed(1)}k`;
		return km.toLocaleString('fr-FR');
	}

	private clearDeptFocus(): void {
		if (this.lockDeptFocus) {
			this.logger.log('Map', '[CLEARFOCUS] Prevented by lockDeptFocus');
			return;
		}
		this.logger.log(
			'Map',
			`[CLEARFOCUS] focusedDept was=${this.focusedDeptFeature?.properties?.['code'] ?? 'null'} dragHandler=${this.focusDragHandler ? 'set' : 'null'}`,
		);
		this.isFittingDept = false;
		this.focusEntryZoom = null;
		this.focusedDeptFeature = null;
		this.focusStats.set(null);
		if (this.focusDragHandler) {
			this.map?.off('dragend', this.focusDragHandler);
			this.focusDragHandler = null;
		}
		if (this.map?.getLayer('dept-focus-mask')) {
			this.map.setLayoutProperty('dept-focus-mask', 'visibility', 'none');
			this.logger.log('Map', '[CLEARFOCUS] mask set to none');
		}
	}

	private deptToWorldMask(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Feature<GeoJSON.Polygon> {
		const world: GeoJSON.Position[] = [
			[-180, -90],
			[180, -90],
			[180, 90],
			[-180, 90],
			[-180, -90],
		];
		const holes: GeoJSON.Position[][] =
			geometry.type === 'Polygon'
				? [geometry.coordinates[0] as GeoJSON.Position[]]
				: geometry.coordinates.map((poly) => poly[0] as GeoJSON.Position[]);
		return {
			type: 'Feature',
			geometry: { type: 'Polygon', coordinates: [world, ...holes] },
			properties: {},
		};
	}

	private getDeptBounds(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [[number, number], [number, number]] {
		const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
		let minLng = Infinity,
			minLat = Infinity,
			maxLng = -Infinity,
			maxLat = -Infinity;
		for (const ring of rings) {
			for (const point of ring as [number, number][]) {
				if (point[0] < minLng) minLng = point[0];
				if (point[1] < minLat) minLat = point[1];
				if (point[0] > maxLng) maxLng = point[0];
				if (point[1] > maxLat) maxLat = point[1];
			}
		}
		return [
			[minLng, minLat],
			[maxLng, maxLat],
		];
	}

	private buildHexPopupHtml(sorted: TripWithCoords[]): string {
		if (!sorted.length) return '<div class="popup-empty">Aucun trajet trouvé</div>';

		const rows = sorted
			.map((t, idx) => {
				const date = new Date(t.startTime).toLocaleDateString('fr-FR', {
					day: '2-digit',
					month: 'short',
					year: 'numeric',
				});
				const km = Math.round(t.distance / 1000);
				const city = (addr: string | undefined) =>
					addr
						?.split(',')
						.map((s) => s.trim())
						.find((s) => s.length > 0) ?? '—';
				const start = city(t.niceStartAddress ?? t.startAddress);
				const end = city(t.niceEndAddress ?? t.endAddress);
				return `<li class="popup-trip" data-trip-idx="${idx}">
        <span class="popup-trip-date">${date}</span>
        <div class="popup-trip-bottom">
          <span class="popup-trip-route">${start} → ${end}</span>
          <span class="popup-trip-km">${km} km</span>
        </div>
      </li>`;
			})
			.join('');

		return `<div class="popup-hex">
      <div class="popup-title">${sorted.length} trajet${sorted.length > 1 ? 's' : ''}</div>
      <ul class="popup-trips">${rows}</ul>
    </div>`;
	}

	private showTripLine(trip: TripWithCoords): void {
		if (!this.map || !this.map.getSource('trip-line')) return;
		const coords = trip.coords.map(([lat, lng]) => [lng, lat] as [number, number]);
		this.selectedTripCoords = coords;
		this.currentMode = null;
		this.updateView();
		(this.map.getSource('trip-line') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
		});
	}

	private clearTripLine(skipUpdateView = false): void {
		this.selectedTripCoords = null;
		if (!this.map || !this.map.getSource('trip-line')) return;
		(this.map.getSource('trip-line') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: [],
		});
		if (!skipUpdateView) {
			this.currentMode = null;
			this.updateView();
		}
	}

	private pointInFeature(lng: number, lat: number, feature: GeoJSON.Feature): boolean {
		const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
		const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
		return polys.some((rings) => {
			if (!this.raycast(lng, lat, rings[0] as [number, number][])) return false;
			for (let i = 1; i < rings.length; i++) {
				if (this.raycast(lng, lat, rings[i] as [number, number][])) return false;
			}
			return true;
		});
	}

	private raycast(lng: number, lat: number, ring: [number, number][]): boolean {
		let inside = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i],
				[xj, yj] = ring[j];
			if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
				inside = !inside;
			}
		}
		return inside;
	}

	private buildAllTripsGeoJSON(): GeoJSON.FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: this.tripsWithCoords.map((trip) => ({
				type: 'Feature' as const,
				geometry: {
					type: 'LineString' as const,
					coordinates: trip.coords.map(([lat, lng]) => [lng, lat]),
				},
				properties: { id: trip.id },
			})),
		};
	}

	private initViewAfterLoad(coords: [number, number][][]): void {
		const fitMaxZoom = 8;
		this.fitToVisited(coords, fitMaxZoom, 1.2, false);
		this.map!.once('idle', () => {
			const all = coords.flat();
			let jumpZoom = this.deptThreshold + 0.1;
			if (all.length) {
				const lats = all.map((c) => c[0]);
				const lons = all.map((c) => c[1]);
				const camera = this.map!.cameraForBounds(
					[
						[Math.min(...lons), Math.min(...lats)],
						[Math.max(...lons), Math.max(...lats)],
					],
					{ padding: 40, maxZoom: fitMaxZoom },
				);
				const expectedZoom = camera?.zoom ?? jumpZoom;
				jumpZoom = expectedZoom <= this.deptThreshold ? this.deptThreshold - 0.1 : this.deptThreshold + 0.1;
			}
			this.map!.jumpTo({ zoom: jumpZoom });
			this.loadingHiding.set(true);
			setTimeout(() => {
				this.loading.set(false);
				this.loadingHiding.set(false);
			}, 500);
			this.logger.log('Map', 'done');
			this.fitToVisited(coords, fitMaxZoom, 0.4);
		});
	}

	private fitToVisited(tripCoords: [number, number][][], maxZoom = 8, speed = 1.2, animate = true): void {
		const all = tripCoords.flat();
		if (!all.length) return;
		const lats = all.map((c) => c[0]);
		const lons = all.map((c) => c[1]);
		this.map!.fitBounds(
			[
				[Math.min(...lons), Math.min(...lats)],
				[Math.max(...lons), Math.max(...lats)],
			],
			{ padding: 40, maxZoom, speed, animate },
		);
	}
}
