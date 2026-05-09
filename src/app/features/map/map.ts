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
import { catchError, forkJoin, map as rxMap, of, switchMap } from 'rxjs';
import { Trip } from '../../core/models/trip';
import { GeorideApiService } from '../../core/services/georide-api';
import { H3Data, H3Resolution, H3Service, resolutionForZoom } from '../../core/services/h3';
import { LoggerService } from '../../core/services/logger';
import { PolylineService } from '../../core/services/polyline';
import { MAP_STYLES, ThemeService } from '../../core/services/theme';
import { ScreenshotService } from '../../core/services/screenshot';
import { DemoService, DemoData } from '../../core/services/demo';
import { Router } from '@angular/router';
import { MapSettingsService } from '../../core/services/map-settings';
import { ANDORRA_FEATURE } from '../../core/data/andorra';
import { DevBoxComponent } from './dev-box';
import { StatsModalComponent, StatsModalData } from './stats-modal';

type Mode = 'hex' | 'dept' | 'polyline';
type TripWithCoords = Trip & { coords: [number, number][] };

interface NewCellsRecapData {
	newHexCount: number;
	trips: { label: string; km: number }[];
	depts: { code: string; name: string; pct: number; newCells: number }[];
}
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
	imports: [DevBoxComponent, StatsModalComponent],
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
	mapSettings = inject(MapSettingsService);

	get isDemo(): boolean {
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

	private readonly LAST_CLEARED_KEY = 'georide_last_cleared_ts_v1';
	private readonly RECAP_DISMISSED_KEY = 'georide_recap_dismissed_v1';
	private newCellsR7 = new Set<string>();
	private newCellsR7Computed = false;
	private allR7Data: H3Data | null = null;
	private newTripIndicesForPolyline: Set<number> | null = null;
	private savedNewCellsR7 = new Set<string>();

	showControlMenu = signal(false);
	showStatsModal = signal(false);
	statsModalData = signal<StatsModalData | null>(null);

	showNewCellsRecap = signal(false);
	newCellsRecapData = signal<NewCellsRecapData | null>(null);
	isNewTripsPolylineMode = signal(false);
	private recapDismissed = signal(false);

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
		const res = this.mapSettings.deptResolution() as H3Resolution;
		this.cellsByResolution = { [res]: this.h3.computeResolution(tripData, res) };
		this.hexagonCount.set(Object.keys(this.cellsByResolution[res]!.counts).length);

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
			this.map.setPaintProperty('dept-focus-mask', 'fill-opacity', this.mapSettings.deptMaskOpacityScreenshot());
		}
		await this.screenshot.capture(this.map, { items: this.loading() || this.error() ? [] : items });
		if (maskVisible) {
			this.map.setPaintProperty('dept-focus-mask', 'fill-opacity', this.mapSettings.deptMaskOpacityDefault());
			this.map.setPaintProperty('dept-focus-mask', 'fill-opacity-transition', { duration: 300, delay: 0 });
		}
	}

	resetView(): void {
		if (!this.map) return;
		const targetZoom = this.isMobile ? this.mapSettings.minZoomMob() : this.mapSettings.minZoomDesk();
		if (this.map.getZoom() <= targetZoom + 0.1) {
			this.fitToVisited(this.tripsWithCoords.map((t) => t.coords));
		} else {
			this.map.flyTo({ center: [2.3, 46.2], zoom: targetZoom });
		}
	}

	goToLogin(): void {
		this.router.navigate(['/login']);
	}

	focusKmFormatted = computed(() => this.formatKm(this.focusStats()?.km ?? 0));

	@HostListener('window:resize')
	onResize(): void {
		this.updateAvailablePresets();
	}

	constructor() {
		afterNextRender(() => this.initMap());

		effect(() => {
			const res = this.mapSettings.deptResolution() as H3Resolution;
			untracked(() => {
				if (this.tripsWithCoords.length > 0 && !this.cellsByResolution[res]) {
					const tripData = this.tripsWithCoords.map((t) => ({
						coords: t.coords,
						date: t.startTime.substring(0, 10),
					}));
					this.cellsByResolution[res] = this.h3.computeResolution(tripData, res);
					this.hexagonCount.set(Object.keys(this.cellsByResolution[res]!.counts).length);
					if (this.currentResolution) {
						this.currentResolution = null;
						this.updateView();
					}
				}
			});
		});

		effect(() => {
			const start = this.mapSettings.cityLabelsFadeStart();
			const end = this.mapSettings.cityLabelsFadeEnd();
			untracked(() => {
				if (this.map) this.hideCityLabels();
			});
		});

		effect(() => {
			const opacity = this.mapSettings.deptMaskOpacityDefault();
			untracked(() => {
				if (this.map && this.map.getLayer('dept-focus-mask')) {
					this.map.setPaintProperty('dept-focus-mask', 'fill-opacity', opacity);
				}
			});
		});

		effect(() => {
			const thresholds = [
				this.mapSettings.deptModeZoomThresholdDesk(),
				this.mapSettings.deptModeZoomThresholdMob(),
				this.mapSettings.polylineModeZoomThresholdDesk(),
				this.mapSettings.polylineModeZoomThresholdMob(),
				this.mapSettings.deptFocusExitDelta(),
			];
			untracked(() => {
				if (this.map) {
					this.currentResolution = null;
					this.currentMode = null;
					this.updateView();
				}
			});
		});

		effect(() => {
			const minZ = this.isMobile ? this.mapSettings.minZoomMob() : this.mapSettings.minZoomDesk();
			const maxZ = this.mapSettings.maxZoom();
			untracked(() => {
				if (this.map) {
					this.map.setMinZoom(minZ);
					this.map.setMaxZoom(maxZ);
				}
			});
		});

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

	openStatsModal(): void {
		this.statsModalData.set(this.computeStatsData());
		this.showStatsModal.set(true);
	}

	closeStatsModal(): void {
		this.showStatsModal.set(false);
	}

	private computeStatsData(): StatsModalData {
		// Villes par département (point-in-polygon sur les coords GPS de chaque trajet)
		const deptCities: Record<string, Record<string, { count: number; dates: string[] }>> = {};
		for (const trip of this.tripsWithCoords) {
			const startCity = this.extractCity(trip.niceStartAddress ?? trip.startAddress);
			const endCity = this.extractCity(trip.niceEndAddress ?? trip.endAddress);
			if (!endCity || endCity === startCity) continue;
			const code = this.findDeptCodeForPoint(trip.endLon, trip.endLat);
			if (!code) continue;
			if (!deptCities[code]) deptCities[code] = {};
			if (!deptCities[code][endCity]) deptCities[code][endCity] = { count: 0, dates: [] };
			deptCities[code][endCity].count++;
			deptCities[code][endCity].dates.push(trip.startTime.substring(0, 10));
		}

		const depts: StatsModalData['depts'] = [];
		if (this.departments) {
			const data = this.cellsByResolution[this.mapSettings.deptResolution() as H3Resolution];
			if (data) {
				const enriched = this.h3.enrichDepartmentsWithCoverage(
					this.departments,
					data.counts,
					this.mapSettings.deptResolution() as H3Resolution,
					data.cellToIndices,
				);
				for (const f of enriched.features) {
					const pct = (f.properties?.['pct'] as number) ?? 0;
					if (pct === 0) continue;
					const code = (f.properties?.['code'] as string) ?? '';
					const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
					const cities = Object.entries(deptCities[code] ?? {})
						.map(([name, { count, dates }]) => {
							const sorted = dates
								.filter((d, i, arr) => arr.indexOf(d) === i)
								.sort((a, b) => b.localeCompare(a));
							return {
								name,
								count,
								latestRaw: sorted[0] ?? '',
								dates: sorted.slice(0, 4).map((d) => fmt.format(new Date(d))),
							};
						})
						.sort(
							(a, b) =>
								b.count - a.count ||
								b.latestRaw.localeCompare(a.latestRaw) ||
								a.name.localeCompare(b.name, 'fr'),
						)
						.map(({ name, count, dates }) => ({ name, count, dates }));
					depts.push({
						code,
						name: (f.properties?.['nom'] as string) ?? '',
						pct,
						trips: (f.properties?.['tripCount'] as number) ?? 0,
						cities,
					});
				}
				depts.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'fr'));
			}
		}

		const startCityCount: Record<string, number> = {};
		for (const trip of this.tripsWithCoords) {
			const city = this.extractCity(trip.niceStartAddress ?? trip.startAddress);
			if (city) startCityCount[city] = (startCityCount[city] ?? 0) + 1;
		}
		const homeCity = Object.entries(startCityCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

		return { homeCity, depts };
	}

	private findDeptCodeForPoint(lng: number, lat: number): string | null {
		if (!this.departments) return null;
		for (const feature of this.departments.features) {
			if (this.pointInFeature(lng, lat, feature)) {
				return (feature.properties?.['code'] as string) ?? null;
			}
		}
		return null;
	}

	private extractCity(addr: string | null | undefined): string | null {
		if (!addr) return null;
		return (
			addr
				.split(',')
				.map((s) => s.trim())
				.find((s) => s.length > 0 && !/^\d/.test(s)) ?? null
		);
	}

	private get isMobile(): boolean {
		return window.innerWidth < 768;
	}

	private get deptThreshold(): number {
		return this.isMobile
			? this.mapSettings.deptModeZoomThresholdMob()
			: this.mapSettings.deptModeZoomThresholdDesk();
	}

	private initMap(): void {
		this.logger.log('Map', 'initMap called');

		this.map = new maplibregl.Map({
			container: 'map',
			style: MAP_STYLES[this.theme.theme()],
			center: [2.3, 46.2],
			zoom: 8,
			minZoom: this.isMobile ? this.mapSettings.minZoomMob() : this.mapSettings.minZoomDesk(),
			maxZoom: this.mapSettings.maxZoom(),
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
					if (now - this.lastCanvasTouchStart < this.mapSettings.doubleTapDelay()) {
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
				setTimeout(() => {
					this.justClosedTrip = false;
				}, 0);
			} else if (this.newTripIndicesForPolyline) {
				this.exitNewTripsPolylineMode();
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
		const latestTripDate = this.allTripsWithCoords.reduce<Date>((latest, t) => {
			const d = new Date(t.startTime);
			return d > latest ? d : latest;
		}, new Date(0));
		const allR7 = this.h3.computeResolution(
			this.allTripsWithCoords.map((t) => ({ coords: t.coords, date: t.startTime.substring(0, 10) })),
			7,
		);
		this.computeNewCellsR7(allR7, latestTripDate);
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

		const COUNTRY_FILES = [
			{ country: 'FR', file: '/france.geojson', minLat: 41.3, maxLat: 51.2, minLon: -5.2, maxLon: 9.6 },
			{ country: 'ES', file: '/spain.geojson', minLat: 27.6, maxLat: 43.8, minLon: -18.2, maxLon: 4.4 },
		];

		this.api
			.getTrackers()
			.pipe(
				switchMap((trackers) => {
					this.logger.log('Map', `got ${trackers.length} tracker(s), fetching trips`);
					const to = new Date();
					to.setHours(23, 59, 59, 999);
					return forkJoin(
						trackers.map((t) => this.api.getTrips(t.trackerId, new Date(t.activationDate), to)),
					).pipe(rxMap((tripArrays) => tripArrays.flat()));
				}),
				switchMap((allTrips) => {
					const inBounds = (lat: number, lon: number, c: (typeof COUNTRY_FILES)[number]) =>
						lat >= c.minLat && lat <= c.maxLat && lon >= c.minLon && lon <= c.maxLon;
					const needed = COUNTRY_FILES.filter((c) =>
						allTrips.some((t) => inBounds(t.startLat, t.startLon, c) || inBounds(t.endLat, t.endLon, c)),
					);
					const hasAndorra = allTrips.some(
						(t) =>
							(t.startLat >= 42.42 && t.startLat <= 42.66 && t.startLon >= 1.4 && t.startLon <= 1.8) ||
							(t.endLat >= 42.42 && t.endLat <= 42.66 && t.endLon >= 1.4 && t.endLon <= 1.8),
					);
					const log = [...needed.map((c) => c.country), ...(hasAndorra ? ['AD'] : [])];
					this.logger.log('Map', `loading GeoJSON for: ${log.join(', ') || 'none'}`);
					if (needed.length === 0)
						return of({
							allTrips,
							departments: hasAndorra
								? { type: 'FeatureCollection' as const, features: [ANDORRA_FEATURE] }
								: null,
						});
					return forkJoin(
						needed.map((c) =>
							this.http.get<GeoJSON.FeatureCollection>(c.file).pipe(
								rxMap((fc) => ({
									...fc,
									features: fc.features.map((f) => ({
										...f,
										properties: { ...f.properties, country: c.country },
									})),
								})),
							),
						),
					).pipe(
						rxMap((collections) => ({
							allTrips,
							departments: {
								type: 'FeatureCollection' as const,
								features: [
									...collections.flatMap((c) => c.features),
									...(hasAndorra ? [ANDORRA_FEATURE] : []),
								],
							} as GeoJSON.FeatureCollection,
						})),
						catchError(() => {
							this.logger.warn('Map', 'regions not found, dept mode disabled');
							return of({ allTrips, departments: null });
						}),
					);
				}),
			)
			.subscribe({
				next: ({ allTrips, departments }) => {
					this.departments = departments;
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
					const res = this.mapSettings.deptResolution() as H3Resolution;
					this.cellsByResolution[res] = this.h3.computeResolution(tripData, res);
					this.logger.log(
						'Map',
						`resolution ${res}: ${Object.keys(this.cellsByResolution[res].counts).length} cells`,
					);

					this.hexagonCount.set(
						Object.keys(
							this.cellsByResolution[this.mapSettings.deptResolution() as H3Resolution]?.counts ?? {},
						).length,
					);

					const allR7 = this.h3.computeResolution(
						this.allTripsWithCoords.map((t) => ({ coords: t.coords, date: t.startTime.substring(0, 10) })),
						7,
					);
					this.computeNewCellsR7(allR7);

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
			this.map!.setPaintProperty(layer.id, 'text-opacity', [
				'interpolate',
				['linear'],
				['zoom'],
				this.mapSettings.cityLabelsFadeStart(),
				0,
				this.mapSettings.cityLabelsFadeEnd(),
				1,
			]);
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
				paint: { 'fill-color': '#000000', 'fill-opacity': this.mapSettings.deptMaskOpacityDefault() },
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

		// --- New cells highlight (cells discovered since last visit) ---
		if (!this.map.getSource('new-cells')) {
			const glowColor = this.theme.isDark() ? '#fdb300' : '#ffffff';
			this.map.addSource('new-cells', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'new-cells-glow-3',
				type: 'line',
				source: 'new-cells',
				paint: { 'line-color': glowColor, 'line-width': 20, 'line-opacity': 0, 'line-blur': 10 },
			});
			this.map.addLayer({
				id: 'new-cells-glow-2',
				type: 'line',
				source: 'new-cells',
				paint: { 'line-color': glowColor, 'line-width': 12, 'line-opacity': 0, 'line-blur': 5 },
			});
			this.map.addLayer({
				id: 'new-cells-glow-1',
				type: 'line',
				source: 'new-cells',
				paint: { 'line-color': glowColor, 'line-width': 5, 'line-opacity': 0, 'line-blur': 2 },
			});
			this.map.addLayer({
				id: 'new-cells-line',
				type: 'line',
				source: 'new-cells',
				paint: { 'line-color': glowColor, 'line-width': 1.5, 'line-opacity': 0 },
			});
			this.updateNewCellsLayer();
			if (this.newCellsR7.size > 0) setTimeout(() => this.showNewCellsGlow(), 50);
		} else {
			this.updateNewCellsLayer();
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
			this.focusEntryZoom - zoom > this.mapSettings.deptFocusExitDelta() &&
			!this.restoringStyle &&
			!this.isFittingDept
		) {
			this.logger.log(
				'Map',
				`[UPDATEVIEW] delta ${(this.focusEntryZoom - zoom).toFixed(2)} > ${this.mapSettings.deptFocusExitDelta()} → clearDeptFocus`,
			);
			this.clearDeptFocus();
			this.currentMode = null;
			this.currentResolution = null;
		}
		const polylineThreshold = this.isMobile
			? this.mapSettings.polylineModeZoomThresholdMob()
			: this.mapSettings.polylineModeZoomThresholdDesk();
		const mode: Mode =
			this.newTripIndicesForPolyline && zoom > this.deptThreshold
				? 'polyline'
				: zoom <= this.deptThreshold
					? 'dept'
					: zoom >= polylineThreshold && !this.selectedTripCoords
						? 'polyline'
						: 'hex';
		this.logger.log(
			'Map',
			`[updateView] zoom=${zoom.toFixed(2)} deptThreshold=${this.deptThreshold} newTripIndices=${!!this.newTripIndicesForPolyline} → mode=${mode} (current=${this.currentMode})`,
		);

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
				if (this.newTripIndicesForPolyline) this.exitNewTripsPolylineMode();
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

		const newCellsVisibility =
			resolution === 7 && (mode === 'hex' || !!this.newTripIndicesForPolyline) ? 'visible' : 'none';
		for (const id of ['new-cells-glow-3', 'new-cells-glow-2', 'new-cells-glow-1', 'new-cells-line']) {
			if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', newCellsVisibility);
		}

		if ((mode === 'hex' || mode === 'polyline') && (modeChanged || resolutionChanged)) {
			if (!this.cellsByResolution[resolution]) {
				this.logger.log('Map', `lazy-computing resolution ${resolution}`);
				const tripData = this.tripsWithCoords.map((t) => ({
					coords: t.coords,
					date: t.startTime.substring(0, 10),
				}));
				this.cellsByResolution[resolution] = this.h3.computeResolution(tripData, resolution);
				if (resolution === 7 && !this.newCellsR7Computed) {
					const allR7 = this.h3.computeResolution(
						this.allTripsWithCoords.map((t) => ({ coords: t.coords, date: t.startTime.substring(0, 10) })),
						7,
					);
					this.computeNewCellsR7(allR7);
				}
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
			this.updateNewCellsLayer();
		}
	}

	private ensureDeptLayers(): void {
		if (!this.map || !this.departments) return;

		if (!this.enrichedDepts) {
			const data = this.cellsByResolution[this.mapSettings.deptResolution() as H3Resolution];
			if (!data) return;
			this.enrichedDepts = this.h3.enrichDepartmentsWithCoverage(
				this.departments,
				data.counts,
				this.mapSettings.deptResolution() as H3Resolution,
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
						? [
								'interpolate',
								['linear'],
								['zoom'],
								5,
								['interpolate', ['linear'], ['get', 'h3Total'], 1, 4, 5, 5, 15, 6, 30, 7, 60, 8],
								6.8,
								['interpolate', ['linear'], ['get', 'h3Total'], 1, 7, 5, 9, 15, 11, 30, 13, 60, 16],
							]
						: [
								'interpolate',
								['linear'],
								['zoom'],
								6,
								['interpolate', ['linear'], ['get', 'h3Total'], 1, 6, 5, 7, 15, 9, 30, 11, 60, 13],
								7.5,
								['interpolate', ['linear'], ['get', 'h3Total'], 1, 10, 5, 13, 15, 16, 30, 20, 60, 24],
							],
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
					'text-color': this.theme.isDark() ? ['step', ['get', 'pct'], '#ffffff', 75, '#fdb300'] : '#6b4200',
					'text-halo-color': this.theme.isDark()
						? ['step', ['get', 'pct'], 'rgba(0,0,0,0.45)', 75, 'rgba(255,255,255,0.55)']
						: 'rgba(0,0,0,0)',
					'text-halo-width': this.theme.isDark() ? 1 : 0,
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
		const data =
			this.cellsByResolution[this.currentResolution ?? (this.mapSettings.deptResolution() as H3Resolution)];
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
		this.map!.fitBounds(this.getDeptBounds(geom), {
			padding: 40,
			maxZoom: this.mapSettings.fitDeptMaxZoom(),
			speed: 2,
		});

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
		const data = this.cellsByResolution[this.mapSettings.deptResolution() as H3Resolution];
		if (!data) return;
		const deptCells = this.h3.getDepartmentCells(feature, this.mapSettings.deptResolution() as H3Resolution);
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

	protected simulateNewTripForDebug(): void {
		if (!this.allTripsWithCoords.length) return;
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		const yesterdayStr = yesterday.toISOString().substring(0, 10);
		const hasYesterdayTrips = this.allTripsWithCoords.some((t) => t.startTime.substring(0, 10) >= yesterdayStr);
		if (!hasYesterdayTrips) return;

		const dayBeforeYesterday = new Date(yesterday);
		dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 1);
		dayBeforeYesterday.setHours(23, 59, 59, 999);
		try {
			localStorage.setItem(this.LAST_CLEARED_KEY, String(dayBeforeYesterday.getTime()));
			localStorage.removeItem(this.RECAP_DISMISSED_KEY);
		} catch {}

		window.location.reload();
	}

	private readonly NEW_CELLS_MAX_AGE_DAYS = 3;

	private computeNewCellsR7(data: H3Data, referenceDate?: Date): void {
		this.newCellsR7Computed = true;
		this.allR7Data = data;

		const today = referenceDate ?? new Date();
		const cutoff = new Date(today);
		cutoff.setDate(cutoff.getDate() - this.NEW_CELLS_MAX_AGE_DAYS);
		const cutoffStr = cutoff.toISOString().substring(0, 10);

		const dismissedTs = (() => {
			try {
				return parseInt(localStorage.getItem(this.RECAP_DISMISSED_KEY) ?? '0', 10);
			} catch {
				return 0;
			}
		})();
		if (dismissedTs > 0 || referenceDate) this.recapDismissed.set(true);
		const lastClearedTs = referenceDate
			? 0
			: (() => {
					try {
						return parseInt(localStorage.getItem(this.LAST_CLEARED_KEY) ?? '0', 10);
					} catch {
						return 0;
					}
				})();
		const lastClearedDate = new Date(lastClearedTs).toISOString().substring(0, 10);

		const candidates = Object.keys(data.counts).filter((cell) => {
			const indices = data.cellToIndices[cell] ?? [];
			const dates = indices
				.map((i) => this.allTripsWithCoords[i]?.startTime.substring(0, 10))
				.filter((d): d is string => !!d);
			if (dates.length === 0) return false;
			const firstDate = dates.reduce((a, b) => (a < b ? a : b));
			return firstDate >= cutoffStr && firstDate > lastClearedDate;
		});

		if (candidates.length === 0) return;

		this.savedNewCellsR7 = new Set(candidates);
		this.newCellsR7 = new Set(candidates);
		this.buildRecapData();
		if (this.recapDismissed()) {
			this.newCellsR7 = new Set();
		} else {
			this.logger.log('Map', `new cells R7: ${this.newCellsR7.size}`);
		}
	}

	private buildRecapData(): void {
		if (!this.allR7Data) return;
		// Collect only dates where new cells were discovered
		const newCellDates = new Set<string>();
		for (const cell of this.newCellsR7) {
			for (const idx of this.allR7Data.cellToIndices[cell] ?? []) {
				const trip = this.allTripsWithCoords[idx];
				if (trip) newCellDates.add(trip.startTime.substring(0, 10));
			}
		}

		const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
		const kmByDate: Record<string, number> = {};
		for (const trip of this.allTripsWithCoords) {
			const dateKey = trip.startTime.substring(0, 10);
			if (!newCellDates.has(dateKey)) continue;
			kmByDate[dateKey] = (kmByDate[dateKey] ?? 0) + Math.round(trip.distance / 1000);
		}
		const trips: NewCellsRecapData['trips'] = Object.entries(kmByDate).map(([dateKey, km]) => ({
			label: fmt.format(new Date(dateKey)),
			km,
		}));

		this.newCellsRecapData.set({
			newHexCount: this.newCellsR7.size,
			trips,
			depts: this.computeNewCellsDeptStats(),
		});
	}

	private computeNewCellsDeptStats(): NewCellsRecapData['depts'] {
		if (!this.departments || !this.allR7Data) return [];
		const stats: NewCellsRecapData['depts'] = [];
		for (const feature of this.departments.features) {
			const cells = this.h3.getDepartmentCells(
				feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
				7,
			);
			const newCount = cells.filter((c) => this.newCellsR7.has(c)).length;
			if (newCount === 0) continue;
			const visited = cells.filter((c) => c in this.allR7Data!.counts).length;
			const pct = cells.length > 0 ? Math.round((visited / cells.length) * 100) : 0;
			stats.push({
				code: (feature.properties?.['code'] as string) ?? '',
				name: (feature.properties?.['nom'] as string) ?? '',
				pct,
				newCells: newCount,
			});
		}
		return stats.sort((a, b) => b.newCells - a.newCells);
	}

	closeRecap(): void {
		this.showNewCellsRecap.set(false);
	}

	dismissRecap(): void {
		this.showNewCellsRecap.set(false);
		try {
			localStorage.setItem(this.RECAP_DISMISSED_KEY, String(Date.now()));
		} catch {}
		this.recapDismissed.set(true);
		this.clearNewCells();
	}

	reopenRecap(): void {
		try {
			localStorage.removeItem(this.RECAP_DISMISSED_KEY);
		} catch {}
		this.recapDismissed.set(false);
		this.newCellsR7 = new Set(this.savedNewCellsR7);
		this.currentMode = null;
		this.currentResolution = null;
		this.updateView();
		setTimeout(() => this.showNewCellsGlow(), 50);
		this.showNewCellsRecap.set(true);
	}

	onViewNewTrips(): void {
		if (!this.allR7Data) return;
		const newCellDates = new Set<string>();
		for (const cell of this.newCellsR7) {
			for (const idx of this.allR7Data.cellToIndices[cell] ?? []) {
				const trip = this.allTripsWithCoords[idx];
				if (trip) newCellDates.add(trip.startTime.substring(0, 10));
			}
		}
		const indices = new Set<number>();
		this.allTripsWithCoords.forEach((trip, idx) => {
			if (newCellDates.has(trip.startTime.substring(0, 10))) indices.add(idx);
		});
		this.newTripIndicesForPolyline = indices;
		this.logger.log(
			'Map',
			`[onViewNewTrips] indices=${indices.size} dates=${[...newCellDates].join(',')} zoom=${this.map?.getZoom().toFixed(2)} deptThreshold=${this.deptThreshold}`,
		);
		this.isNewTripsPolylineMode.set(true);
		this.showNewCellsRecap.set(false);
		(this.map?.getSource('all-trips') as maplibregl.GeoJSONSource)?.setData(this.buildAllTripsGeoJSON());
		if (this.map && this.map.getZoom() > this.deptThreshold) {
			this.currentMode = null;
			this.currentResolution = null;
			this.updateView();
		}
		const newTripCoords = [...indices].map((i) => this.allTripsWithCoords[i]?.coords).filter(Boolean) as [
			number,
			number,
		][][];
		this.fitToVisited(newTripCoords, 10, 1.5);
	}

	protected exitNewTripsPolylineMode(): void {
		this.logger.log('Map', `[exitNewTripsPolylineMode] called, zoom=${this.map?.getZoom().toFixed(2)}`);
		this.newTripIndicesForPolyline = null;
		this.isNewTripsPolylineMode.set(false);
		(this.map?.getSource('all-trips') as maplibregl.GeoJSONSource)?.setData(this.buildAllTripsGeoJSON());
		this.currentMode = null;
		this.currentResolution = null;
		this.updateView();
	}

	private updateNewCellsLayer(): void {
		const src = this.map?.getSource('new-cells') as maplibregl.GeoJSONSource | undefined;
		if (!src || this.newCellsR7.size === 0) return;
		const data = this.cellsByResolution[7];
		if (!data) return;
		const cells = [...this.newCellsR7].filter((c) => c in data.counts);
		src.setData(this.h3.cellsToOutlineGeoJSON(cells));
	}

	private showNewCellsGlow(): void {
		if (!this.map?.getLayer('new-cells-line')) return;
		const opacities: Record<string, number> = {
			'new-cells-glow-3': 0.07,
			'new-cells-glow-2': 0.18,
			'new-cells-glow-1': 0.55,
			'new-cells-line': 1.0,
		};
		for (const [id, opacity] of Object.entries(opacities)) {
			this.map.setPaintProperty(id, 'line-opacity-transition', { duration: 400, delay: 0 });
			this.map.setPaintProperty(id, 'line-opacity', opacity);
		}
	}

	private clearNewCells(): void {
		this.newCellsR7 = new Set();
		if (this.map?.getLayer('new-cells-line')) {
			for (const id of ['new-cells-glow-3', 'new-cells-glow-2', 'new-cells-glow-1', 'new-cells-line']) {
				this.map.setPaintProperty(id, 'line-opacity-transition', { duration: 400, delay: 0 });
				this.map.setPaintProperty(id, 'line-opacity', 0);
			}
		}
	}

	private buildAllTripsGeoJSON(): GeoJSON.FeatureCollection {
		const trips = this.newTripIndicesForPolyline
			? [...this.newTripIndicesForPolyline].map((i) => this.allTripsWithCoords[i]).filter(Boolean)
			: this.tripsWithCoords;
		return {
			type: 'FeatureCollection',
			features: trips.map((trip) => ({
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
		const fitMaxZoom = this.mapSettings.fitToVisitedMaxZoom();
		this.fitToVisited(coords, fitMaxZoom, 1.2, false);
		this.map!.once('idle', () => {
			const all = coords.flat();
			let jumpZoom = this.deptThreshold + 0.1;
			if (all.length) {
				let minLat = Infinity,
					maxLat = -Infinity,
					minLon = Infinity,
					maxLon = -Infinity;
				for (const [lat, lon] of all) {
					if (lat < minLat) minLat = lat;
					if (lat > maxLat) maxLat = lat;
					if (lon < minLon) minLon = lon;
					if (lon > maxLon) maxLon = lon;
				}
				const camera = this.map!.cameraForBounds(
					[
						[minLon, minLat],
						[maxLon, maxLat],
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
				if (this.newCellsRecapData() && !this.recapDismissed()) {
					setTimeout(() => this.showNewCellsRecap.set(true), 600);
				}
			}, 500);
			this.logger.log('Map', 'done');
			this.fitToVisited(coords, fitMaxZoom, 0.4);
		});
	}

	private fitToVisited(
		tripCoords: [number, number][][],
		maxZoom = this.mapSettings.fitToVisitedMaxZoom(),
		speed = 1.2,
		animate = true,
	): void {
		const all = tripCoords.flat();
		if (!all.length) return;
		let minLat = Infinity,
			maxLat = -Infinity,
			minLon = Infinity,
			maxLon = -Infinity;
		for (const [lat, lon] of all) {
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
			if (lon < minLon) minLon = lon;
			if (lon > maxLon) maxLon = lon;
		}
		this.map!.fitBounds(
			[
				[minLon, minLat],
				[maxLon, maxLat],
			],
			{ padding: 40, maxZoom, speed, animate },
		);
	}
}
