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
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import maplibregl from 'maplibre-gl';
import { Observable, catchError, concat, defer, forkJoin, map as rxMap, of, reduce, switchMap, tap } from 'rxjs';
import { MergedTrip } from '../../core/models/trip';
import { GeorideApiService } from '../../core/services/georide-api';
import { H3Data, H3Resolution, H3Service, resolutionForZoom } from '../../core/services/h3';
import { LoggerService } from '../../core/services/logger';
import { PolylineService } from '../../core/services/polyline';
import { MAP_STYLES, ThemeService } from '../../core/services/theme';
import { ScreenshotService } from '../../core/services/screenshot';
import { DemoService, DemoData } from '../../core/services/demo';
import { ActivatedRoute, Router } from '@angular/router';
import { MapSettingsService } from '../../core/services/map-settings';
import { DatabaseService, StoredTrip, TripWithCoords } from '../../core/services/database';
export type { TripWithCoords };
import {
	cellToBoundary,
	cellToLatLng,
	cellToParent,
	compactCells,
	getResolution,
	latLngToCell,
	uncompactCells,
} from 'h3-js';
import { GeoRidePosition } from '../../core/services/georide-api';
import { ANDORRA_FEATURE } from '../../core/data/andorra';
import { LUXEMBOURG_FEATURES } from '../../core/data/luxembourg';
import { DevBoxComponent } from './dev-box';
import {
	StatsModalComponent,
	StatsModalData,
	DistanceStats,
	SpeedStats,
	Records,
	TopTrip,
	TurnStats,
	TurnDeptStat,
	TurnCityStat,
	FilterAction,
	PauseStats,
	FuelStats,
	MonthlyFuelCost,
} from './stats-modal';
import { FuelService } from '../../core/services/fuel.service';
import { haversineKm } from '../../core/utils/elevation';
import {
	estimateLiters,
	estimateCost,
	estimateFillUps,
	estimateCO2Kg,
	costPerKm as fuelCostPerKm,
	CO2_KG_PER_L,
} from '../../core/utils/fuel-consumption';
import { buildSessions } from '../../core/utils/trip-session';
import { TripDetailPanelComponent } from './trip-detail-panel/trip-detail-panel';
import {
	ShareHexPayload,
	SharePolylinePayload,
	ShareService,
	ShareStats,
	TripComputedStats,
} from '../../core/services/share';
import { WrappedCardData } from '../../core/services/screenshot';

type Mode = 'hex' | 'dept' | 'polyline';

interface AltProfile {
	minAlt: number;
	maxAlt: number;
	gain: number;
}

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

import { COUNTRIES, NEIGHBORING_COUNTRIES, NeighboringCountry } from '../../core/data/countries';

const SEASONS = [
	{ name: 'Printemps', emoji: '🌸', months: [3, 4, 5] as number[] },
	{ name: 'Été', emoji: '☀️', months: [6, 7, 8] as number[] },
	{ name: 'Automne', emoji: '🍂', months: [9, 10, 11] as number[] },
	{ name: 'Hiver', emoji: '❄️', months: [12, 1, 2] as number[] },
] as const;
type Season = (typeof SEASONS)[number];

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
	imports: [DevBoxComponent, StatsModalComponent, TripDetailPanelComponent, NgTemplateOutlet],
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
	private route = inject(ActivatedRoute);
	mapSettings = inject(MapSettingsService);
	private db = inject(DatabaseService);
	private fuel = inject(FuelService);
	private share = inject(ShareService);

	fuelPrices = signal<Record<string, number | null>>({});
	fuelCachedMonths = signal<string[]>([]);
	private fuelType = 'SP98';

	get isDemo(): boolean {
		return this.router.url.startsWith('/demo');
	}

	get isShare(): boolean {
		return this.router.url.startsWith('/share');
	}

	loading = signal(true);
	loadingHiding = signal(false);
	loadingChunk = signal<{ current: number; total: number } | null>(null);
	tripCount = signal(0);
	totalKm = signal(0);
	hexHoverSpeedAvg = signal(null as number | null);
	hexHoverSpeedMax = signal(null as number | null);
	hexagonCount = signal(0);
	streak = signal(0);
	streakVisible = signal(false);
	streakExpiringToday = signal(false);
	fullRegionCount = signal(0);
	countryCountStat = signal(1);
	cityCountStat = signal(0);
	error = signal('');
	zoom = signal(0);
	isDevMode = isDevMode();
	focusStats = signal<{
		trips: number;
		km: number;
		hex: number;
		pct: number;
		name?: string;
		countryName?: string;
	} | null>(null);
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
	private ctxMenuPopup: maplibregl.Popup | null = null;
	private selectedTripCoords: [number, number][] | null = null;
	private keepTripLineOnClose = false;
	private keepStopsPreviewOnClose = false;
	private reopeningStopPopup = false;
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

	private lastClearedTs = 0;
	private recapDismissedTs = 0;
	private newCellsR7 = new Set<string>();
	private newCellsR7Computed = false;
	private allR7Data: H3Data | null = null;
	private newTripIndicesForPolyline: Set<number> | null = null;
	private savedNewCellsR7 = new Set<string>();

	showControlMenu = signal(false);
	showViewMenu = signal(false);
	visitedNeighboringCountries = signal<NeighboringCountry[]>([]);
	seasonFilter = signal<Season | null>(null);
	seasonYear = signal<number | null>(null);
	visitedSeasons = signal<Season[]>([]);
	private viewMenuHideTimer: ReturnType<typeof setTimeout> | null = null;
	showStatsModal = signal(false);
	statsModalData = signal<StatsModalData | null>(null);

	shareStats = signal<ShareStats | null>(null);
	precomputedTripStats = signal<TripComputedStats | null>(null);
	private lastTripComputedStats: TripComputedStats | null = null;
	showSharePanel = signal(false);
	shareShowStats = signal(true);
	shareShowLabels = signal(false);
	shareMode = signal<'dept' | 'hex' | 'trip'>('dept');
	private shareLoopTripCount = 0;
	shareUrl = signal('');
	shareWarning = signal('');
	shareStep = signal<3 | null>(null);
	shareCountryOpts = signal<NeighboringCountry[]>([]);
	shareLoading = signal(false);
	shareCopied = signal(false);
	sharePreviewSrc = signal('');
	shareDateLabel = signal('');
	private shareIsOpen = false;
	private shareCapturedCanvas: HTMLCanvasElement | null = null;
	private shareRecaptureHandler: (() => void) | null = null;
	private shareRecaptureVersion = 0;
	private shareWrappedData: WrappedCardData | null = null;
	private shareInitialCamera: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null =
		null;
	private hiddenLayersOriginalVisibility: Record<string, string> = {};

	showNewCellsRecap = signal(false);
	newCellsRecapData = signal<NewCellsRecapData | null>(null);
	isNewTripsPolylineMode = signal(false);
	private recapDismissed = signal(false);

	colsMode = signal(false);
	turnsMode = signal(false);
	stopsMode = signal(false);
	speedMode = signal(false);
	elevationLoading = signal(false);
	elevationLoadingLabel = signal('Analyse du relief…');
	elevationBatchDone = signal(0);
	elevationBatchTotal = signal(0);
	hexHoverAlt = signal(null as number | null);
	hexHoverTurns = signal(null as number | null);

	private tripAltProfiles: Record<string, AltProfile> = {};
	private colsCellCache: Partial<Record<H3Resolution, Record<string, number>>> = {};
	private turnsCellCache: Partial<Record<H3Resolution, Record<string, number>>> = {};
	private speedCellCache: Partial<Record<H3Resolution, Record<string, number>>> = {};
	private speedCellStatsCache: Partial<Record<H3Resolution, Record<string, { avg: number; max: number }>>> = {};
	private stopPointsCache: GeoJSON.FeatureCollection | null = null;
	private tripSegmentsCache: Record<string, GeoJSON.FeatureCollection> = {};
	private allTripsSegmentsFC: GeoJSON.FeatureCollection | null = null;
	private selectedTrip: TripWithCoords | null = null;
	private maxSpeedTrip: TripWithCoords | null = null;
	private maxDistanceTrip: TripWithCoords | null = null;
	private stopPopup: maplibregl.Popup | null = null;

	showTripPanel = signal(false);
	selectedTripForPanel = signal<TripWithCoords | null>(null);
	selectedTripPositions = signal<GeoRidePosition[] | null>(null);
	clickedPauseIdx = signal<number | null>(null);
	private pauseChipsData: { lat: number; lon: number; label: string }[] = [];

	get allTripsForPanel(): TripWithCoords[] {
		return this.allTripsWithCoords;
	}

	totalKmFormatted = computed(() => this.formatKm(this.totalKm()));

	selectSeason(season: Season, year?: number): void {
		const current = this.seasonFilter();
		const next = current?.name === season.name && this.seasonYear() === (year ?? null) ? null : season;
		this.seasonFilter.set(next);
		this.seasonYear.set(next ? (year ?? null) : null);
		this.dateFilter.set('all');
		this.applyDateFilter();
	}

	selectFilter(filter: DateFilterPreset): void {
		this.seasonFilter.set(null);
		this.seasonYear.set(null);
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

	private updateVisitedNeighboringCountries(): void {
		// Single pass using start/end coords only (1500× faster than checking all coords)
		const allCountriesWithBounds = COUNTRIES.filter((c): c is NeighboringCountry => c.minLat !== undefined);
		const counts: { [code: string]: number } = {};
		for (const t of this.allTripsWithCoords) {
			for (const c of allCountriesWithBounds) {
				const inLat = (lat: number) => lat >= c.minLat && lat <= c.maxLat;
				const inLon = (lon: number) => lon >= c.minLon && lon <= c.maxLon;
				if ((inLat(t.startLat) && inLon(t.startLon)) || (inLat(t.endLat) && inLon(t.endLon))) {
					counts[c.code] = (counts[c.code] ?? 0) + 1;
				}
			}
		}
		this.visitedNeighboringCountries.set(
			allCountriesWithBounds
				.filter((c) => counts[c.code])
				.sort((a, b) => (counts[b.code] ?? 0) - (counts[a.code] ?? 0)),
		);
	}

	private computeStreak(): number {
		const days = new Set(this.allTripsWithCoords.map((t) => t.startTime.substring(0, 10)));
		let count = 0;
		const today = new Date();
		const todayStr = today.toISOString().substring(0, 10);
		const hasRiddenToday = days.has(todayStr);
		for (let i = 0; i < 366; i++) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			if (days.has(d.toISOString().substring(0, 10))) count++;
			else if (i > 0) break;
		}
		this.streakExpiringToday.set(!hasRiddenToday && count > 0 && today.getHours() >= 17);
		this.streakVisible.set(false);
		return count;
	}

	private updateExtraStats(): void {
		const trips = this.tripsWithCoords;
		if (!trips.length) {
			this.countryCountStat.set(0);
			this.cityCountStat.set(0);
			return;
		}
		// Pays (filtrés)
		const countryCodes = new Set<string>();
		for (const t of trips) {
			for (const c of NEIGHBORING_COUNTRIES) {
				const inLat = (lat: number) => lat >= c.minLat && lat <= c.maxLat;
				const inLon = (lon: number) => lon >= c.minLon && lon <= c.maxLon;
				if ((inLat(t.startLat) && inLon(t.startLon)) || (inLat(t.endLat) && inLon(t.endLon))) {
					countryCodes.add(c.code);
				}
			}
		}
		this.countryCountStat.set(countryCodes.size + 1); // +1 France
		// Villes visitées (points d'arrivée uniques, hors ville de départ habituelle)
		const startCityCount: Record<string, number> = {};
		for (const t of trips) {
			const city = this.extractCity(t.niceStartAddress ?? t.startAddress);
			if (city) startCityCount[city] = (startCityCount[city] ?? 0) + 1;
		}
		const homeCity = Object.entries(startCityCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
		const uniqueCities = new Set<string>();
		for (const t of trips) {
			const startCity = this.extractCity(t.niceStartAddress ?? t.startAddress);
			const endCity = this.extractCity(t.niceEndAddress ?? t.endAddress);
			if (!endCity || endCity === startCity || endCity === homeCity) continue;
			uniqueCities.add(endCity);
		}
		this.cityCountStat.set(uniqueCities.size);
		this.maxSpeedTrip = trips.reduce((best, t) => (t.maxSpeed > best.maxSpeed ? t : best), trips[0]);
		this.maxDistanceTrip = trips.reduce((best, t) => (t.distance > best.distance ? t : best), trips[0]);
	}

	private updateFullRegionCount(): void {
		if (!this.enrichedDepts) {
			this.fullRegionCount.set(0);
			return;
		}
		this.fullRegionCount.set(this.enrichedDepts.features.filter((f) => (f.properties?.['pct'] ?? 0) > 50).length);
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
		const season = this.seasonFilter();
		this.tripsWithCoords =
			range || season
				? this.allTripsWithCoords.filter((t) => {
						const d = new Date(t.startTime);
						if (range && (d < range.from || d > range.to)) return false;
						if (season && !season.months.includes(d.getMonth() + 1)) return false;
						return true;
					})
				: this.allTripsWithCoords;

		this.allTripsSegmentsFC = null;
		this.stopPointsCache = null;
		this.tripCount.set(this.tripsWithCoords.length);
		this.totalKm.set(Math.round(this.tripsWithCoords.reduce((s, t) => s + t.distance, 0) / 1000));

		const tripData = this.tripsWithCoords.map((t) => ({
			coords: t.coords,
			date: t.startTime.substring(0, 10),
		}));
		const res = this.mapSettings.deptResolution() as H3Resolution;
		this.cellsByResolution = { [res]: this.h3.computeResolution(tripData, res) };
		this.hexagonCount.set(Object.keys(this.cellsByResolution[res]!.counts).length);
		this.updateExtraStats();

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
			const isFiltered = this.dateFilter() !== 'all' || this.seasonFilter() !== null;
			this.viewMyTrips(true, 1.2, isFiltered ? 11.5 : undefined);
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
					{ value: String(this.tripCount()), label: this.tripCount() === 1 ? 'trajet' : 'trajets' },
					{ value: this.totalKmFormatted(), label: 'km' },
					...(this.countryCountStat() >= 2
						? [{ value: String(this.countryCountStat()), label: 'pays' }]
						: []),
					...(this.cityCountStat() > 0
						? [
								{
									value: String(this.cityCountStat()),
									label: this.cityCountStat() === 1 ? 'ville' : 'villes',
								},
							]
						: []),
					...(this.fullRegionCount() > 0
						? [
								{
									value: String(this.fullRegionCount()),
									label: this.fullRegionCount() === 1 ? 'région' : 'régions',
								},
							]
						: []),
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
			this.viewMyTrips();
		} else {
			this.map.flyTo({ center: [2.3, 46.2], zoom: targetZoom });
		}
	}

	onWorldMapClick(): void {
		if (this.isMobile) {
			this.showViewMenu.set(!this.showViewMenu());
		} else {
			this.viewMyTrips();
			this.showViewMenu.set(false);
		}
	}

	openViewMenu(): void {
		if (this.viewMenuHideTimer) {
			clearTimeout(this.viewMenuHideTimer);
			this.viewMenuHideTimer = null;
		}
		this.showViewMenu.set(true);
	}

	closeViewMenu(): void {
		this.viewMenuHideTimer = setTimeout(() => this.showViewMenu.set(false), 200);
	}

	viewMyTrips(animate = true, speed = 1.2, maxZoom?: number): void {
		if (!this.map || this.tripsWithCoords.length === 0) return;
		let minLat = Infinity,
			maxLat = -Infinity,
			minLon = Infinity,
			maxLon = -Infinity;
		for (const { startLat, startLon, endLat, endLon } of this.tripsWithCoords) {
			if (startLat < minLat) minLat = startLat;
			if (startLat > maxLat) maxLat = startLat;
			if (startLon < minLon) minLon = startLon;
			if (startLon > maxLon) maxLon = startLon;
			if (endLat < minLat) minLat = endLat;
			if (endLat > maxLat) maxLat = endLat;
			if (endLon < minLon) minLon = endLon;
			if (endLon > maxLon) maxLon = endLon;
		}
		const THRESHOLD = 20;
		if (maxLat - minLat <= THRESHOLD && maxLon - minLon <= THRESHOLD) {
			this.fitToVisited(
				this.tripsWithCoords.map((t) => t.coords),
				maxZoom,
				speed,
				animate,
			);
			return;
		}
		// Delta trop grand : fitToVisited sur le dernier trajet réalisé avec maxZoom standard
		const lastTrip = [...this.tripsWithCoords].sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
		if (lastTrip) {
			this.fitToVisited([lastTrip.coords], maxZoom ?? this.mapSettings.fitToVisitedMaxZoom(), speed, animate);
		}
	}

	viewFrance(animate = true): void {
		if (!this.map) return;
		const targetZoom = this.isMobile ? this.mapSettings.minZoomMob() : this.mapSettings.minZoomDesk();
		this.map.easeTo({ center: [2.3, 46.2], zoom: targetZoom, duration: animate ? 800 : 0 });
	}

	viewCountry(country: NeighboringCountry): void {
		if (!this.map) return;
		const camera = this.map.cameraForBounds(
			[
				[country.minLon, country.minLat],
				[country.maxLon, country.maxLat],
			],
			{ padding: 40 },
		);
		if (camera) this.map.easeTo({ ...camera, duration: 800 });
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
		this.fuel.getPrefs().then(({ fuelType }) => {
			this.fuelType = fuelType;
			this.fuel.loadCachedMonths(fuelType).then((months) => this.fuelCachedMonths.set(months));
		});

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
			this.mapSettings.cityLabelsFadeStart();
			this.mapSettings.cityLabelsFadeEnd();
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
			this.mapSettings.deptModeZoomThresholdDesk();
			this.mapSettings.deptModeZoomThresholdMob();
			this.mapSettings.polylineModeZoomThresholdDesk();
			this.mapSettings.polylineModeZoomThresholdMob();
			this.mapSettings.deptFocusExitDelta();
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
		const t0 = performance.now();
		this.statsModalData.set(this.computeStatsData());
		this.showStatsModal.set(true);
		this.loadFuelPrices();
		requestAnimationFrame(() => this.logger.log('Recap', `open in ${Math.round(performance.now() - t0)}ms`));
		// Charger les positions si pas encore fait, puis mettre à jour les stats
		if (this.allTripsWithCoords.some((t) => !t.positions?.length)) {
			this.syncTripAltitudes().subscribe({
				next: () => {
					this.statsModalData.set(this.computeStatsData());
				},
				error: () => {},
			});
		}
	}

	closeStatsModal(): void {
		this.showStatsModal.set(false);
	}

	openSharePanel(): void {
		if (!this.map) return;
		this.shareIsOpen = true;
		this.shareInitialCamera = {
			center: this.map.getCenter().toArray() as [number, number],
			zoom: this.map.getZoom(),
			bearing: this.map.getBearing(),
			pitch: this.map.getPitch(),
		};
		// Pré-sélectionner le tab selon le contexte : trajet ouvert → trip, sinon dept/hex
		if (this.showTripPanel() && this.selectedTripForPanel()) {
			this.shareMode.set('trip');
		} else {
			this.shareMode.set(this.currentMode === 'dept' ? 'dept' : 'hex');
		}
		this.shareShowLabels.set(false);
		this.hideLabelsForShare();
		this.shareUrl.set('');
		this.shareWarning.set('');
		this.shareStep.set(null);
		this.shareCountryOpts.set([]);
		this.shareCopied.set(false);
		this.sharePreviewSrc.set('');
		this.shareCapturedCanvas = null;
		this.shareRecaptureHandler = null;
		// Calcul des stats une seule fois à l'ouverture (coûteux, pas recalculé à chaque preview)
		this.shareWrappedData = this.buildWrappedData();
		const captureAndShow = () => {
			this.showSharePanel.set(true);
			// Pré-charger les couches dept si nécessaire : le worker GeoJSON démarre avant l'attente idle
			if (this.shareMode() === 'dept') this.ensureDeptLayers();
			const doCapture = () => {
				// Attendre idle (tiles + sources chargés), puis 350ms pour le worker GeoJSON,
				// puis capturer dans un vrai frame de rendu
				this.map!.triggerRepaint();
				this.map!.once('idle', () => {
					setTimeout(() => {
						this.map!.once('render', () => {
							this.shareCapturedCanvas = this.screenshot.cropSquare(this.map!.getCanvas());
							this.updateSharePreview();
							void this.buildShareUrlCore();
						});
						this.map!.triggerRepaint();
					}, 350);
				});
			};
			let idleDone = false;
			const onIdle = () => {
				idleDone = true;
				doCapture();
			};
			this.map!.once('idle', onIdle);
			setTimeout(() => {
				if (!idleDone) {
					this.map!.off('idle', onIdle);
					doCapture();
				}
			}, 1500);
		};
		if (this.shareMode() === 'hex') {
			// moveend fire de façon synchrone avec animate:false → listener avant la navigation
			let moved = false;
			const onMoveEnd = () => {
				moved = true;
				captureAndShow();
			};
			this.map.once('moveend', onMoveEnd);
			this.map.fitBounds(this.squareAllTripsBounds(), { padding: 5, maxZoom: 7, animate: false });
			if (!moved) {
				this.map.off('moveend', onMoveEnd);
				captureAndShow();
			}
		} else if (this.shareMode() === 'trip') {
			// Pour trip : fitBounds synchrone puis captureAndShow (le double-idle suffira)
			const trip = this.selectedTripForPanel();
			if (trip?.coords.length) {
				this.map.fitBounds(this.squareTripBounds(trip.coords), { padding: 20, maxZoom: 14, animate: false });
			}
			captureAndShow();
		} else {
			captureAndShow();
		}
	}

	closeSharePanel(): void {
		this.shareIsOpen = false;
		// Annuler tout handler moveend en attente
		if (this.shareRecaptureHandler && this.map) {
			this.map.off('moveend', this.shareRecaptureHandler);
		}
		this.restoreLabels();
		if (this.shareInitialCamera && this.map) {
			this.map.jumpTo(this.shareInitialCamera);
			this.shareInitialCamera = null;
		}
		this.showSharePanel.set(false);
		this.shareUrl.set('');
		this.shareWarning.set('');
		this.shareStep.set(null);
		this.shareCountryOpts.set([]);
		this.shareCopied.set(false);
		this.sharePreviewSrc.set('');
		this.shareCapturedCanvas = null;
		this.shareRecaptureHandler = null;
		this.shareRecaptureVersion = 0;
		this.shareWrappedData = null;
	}

	onShareStatsToggle(): void {
		const showStats = !this.shareShowStats();
		this.shareShowStats.set(showStats);
		// Activer les stats cache automatiquement les noms (si actuellement affichés)
		if (showStats && this.shareShowLabels()) {
			this.shareShowLabels.set(false);
			this.hideLabelsForShare();
			this.captureMapForSharePreview();
			return;
		}
		this.updateSharePreview();
	}

	onShareShowLabelsToggle(): void {
		const show = !this.shareShowLabels();
		this.shareShowLabels.set(show);
		if (show) {
			this.restoreLabels();
		} else {
			this.hideLabelsForShare();
		}
		this.captureMapForSharePreview();
	}

	private hideLabelsForShare(): void {
		if (!this.map) return;
		this.hiddenLayersOriginalVisibility = {};
		for (const layer of this.map.getStyle()?.layers ?? []) {
			if (layer.type === 'symbol') {
				const vis = (this.map.getLayoutProperty(layer.id, 'visibility') as string | undefined) ?? 'visible';
				this.hiddenLayersOriginalVisibility[layer.id] = vis;
				this.map.setLayoutProperty(layer.id, 'visibility', 'none');
			}
		}
	}

	private restoreLabels(): void {
		if (!this.map || !Object.keys(this.hiddenLayersOriginalVisibility).length) return;
		for (const [layerId, visibility] of Object.entries(this.hiddenLayersOriginalVisibility)) {
			if (this.map.getLayer(layerId)) {
				this.map.setLayoutProperty(layerId, 'visibility', visibility);
			}
		}
		this.hiddenLayersOriginalVisibility = {};
	}

	private captureMapForSharePreview(): void {
		if (!this.map) return;
		const version = ++this.shareRecaptureVersion;
		this.map.triggerRepaint();
		this.map.once('idle', () => {
			if (version !== this.shareRecaptureVersion) return;
			this.map!.once('render', () => {
				if (version !== this.shareRecaptureVersion) return;
				this.shareCapturedCanvas = this.screenshot.cropSquare(this.map!.getCanvas());
				this.updateSharePreview();
			});
			this.map!.triggerRepaint();
		});
	}

	private updateSharePreview(): void {
		if (!this.shareCapturedCanvas) return;
		const data =
			this.shareMode() === 'trip'
				? this.buildTripWrappedData()
				: (this.shareWrappedData ?? this.buildWrappedData());
		// Blur plus élevé si les noms sont visibles (labels sur la carte)
		const blurPx = this.shareShowLabels() ? 3 : 1;
		const canvas = this.screenshot.renderWrappedToCanvas(
			this.shareCapturedCanvas,
			data,
			this.shareShowStats(),
			1400,
			blurPx,
		);
		this.sharePreviewSrc.set(canvas.toDataURL('image/png'));
	}

	private recaptureForShare(): void {
		if (!this.map) return;
		// Annule le handler moveend précédent
		if (this.shareRecaptureHandler) {
			this.map.off('moveend', this.shareRecaptureHandler);
		}
		// Incrémente la version — toute capture en attente depuis un tab précédent sera ignorée
		const version = ++this.shareRecaptureVersion;

		// Le canvas WebGL est transparent hors d'un render callback (preserveDrawingBuffer=false)
		// → on doit capturer PENDANT un render via triggerRepaint() + once('render')
		const performCapture = () => {
			if (version !== this.shareRecaptureVersion) return;
			this.map!.triggerRepaint();
			this.map!.once('idle', () => {
				if (version !== this.shareRecaptureVersion) return;
				setTimeout(() => {
					if (version !== this.shareRecaptureVersion) return;
					this.map!.once('render', () => {
						if (version !== this.shareRecaptureVersion) return;
						this.shareCapturedCanvas = this.screenshot.cropSquare(this.map!.getCanvas());
						this.updateSharePreview();
					});
					this.map!.triggerRepaint();
				}, 350);
			});
		};

		const handler = () => {
			this.shareRecaptureHandler = null;
			// Attendre idle (tiles chargés) avant de capturer pour éviter les images partielles
			let idleDone = false;
			const onIdle = () => {
				idleDone = true;
				performCapture();
			};
			this.map!.once('idle', onIdle);
			// Fallback si idle a déjà tiré ou tarde trop (> 1s)
			setTimeout(() => {
				if (!idleDone) {
					this.map!.off('idle', onIdle);
					performCapture();
				}
			}, 1000);
		};
		this.shareRecaptureHandler = handler;
		this.map.once('moveend', handler);
	}

	private navigateForShareMode(): void {
		const mode = this.shareMode();
		// recaptureForShare() AVANT la navigation :
		// viewMyTrips(false) tire moveend de façon synchrone → le listener doit être enregistré avant
		this.recaptureForShare();
		if (mode === 'dept') {
			this.ensureDeptLayers();
			const visitedFeatures = this.enrichedDepts?.features.filter((f) => (f.properties?.['pct'] ?? 0) > 0);
			if (visitedFeatures?.length) {
				this.map!.fitBounds(this.squareDeptBounds(visitedFeatures), {
					padding: 20,
					maxZoom: 7.5,
					animate: false,
				});
			} else {
				this.viewFrance(false);
			}
		} else if (mode === 'hex') {
			if (this.shareStep() === null) {
				this.map!.fitBounds(this.squareAllTripsBounds(), { padding: 5, maxZoom: 7, animate: false });
			} else if (this.shareStep() === 3 && this.shareCountryOpts().length) {
				const country = this.shareCountryOpts()[0];
				this.viewCountry(country);
			}
		} else if (mode === 'trip') {
			const trip = this.selectedTripForPanel();
			if (trip?.coords.length) {
				this.showTripPanel.set(true);
				this.map!.fitBounds(this.squareTripBounds(trip.coords), { padding: 20, maxZoom: 14, animate: false });
			}
		}
	}

	private async buildShareUrlCore(): Promise<void> {
		if (!this.map) return;
		this.shareLoading.set(true);
		const ts = Math.floor(Date.now() / 1000);
		this.shareUrl.set('');
		this.shareWarning.set('');

		const origin = window.location.origin;

		if (this.shareMode() === 'trip') {
			const trip = this.selectedTripForPanel();
			if (!trip) {
				this.shareLoading.set(false);
				return;
			}

			// Downsample coords
			const raw = trip.coords;
			const step = Math.max(1, Math.ceil(raw.length / 500));
			const sampled: [number, number][] = [];
			for (let i = 0; i < raw.length; i += step) sampled.push(raw[i]);
			if (raw.length > 0 && sampled[sampled.length - 1] !== raw[raw.length - 1])
				sampled.push(raw[raw.length - 1]);
			const coords = sampled.map(
				([lat, lon]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5] as [number, number],
			);

			const basePayload: SharePolylinePayload = {
				coords,
				dist: trip.distance,
				dur: trip.duration ? Math.round(trip.duration / 1000) : undefined,
				title: trip.niceEndAddress ?? trip.endAddress ?? undefined,
				startAddr: trip.niceStartAddress ?? trip.startAddress ?? undefined,
				startTime: trip.startTime || undefined,
				endTime: trip.endTime || undefined,
				avgSpd: trip.averageSpeed || undefined,
				maxSpd: trip.maxSpeed || undefined,
				maxAngle: trip.maxAngle || undefined,
				maxLeftAngle: trip.maxLeftAngle ?? undefined,
				maxRightAngle: trip.maxRightAngle ?? undefined,
				computed: this.lastTripComputedStats ?? undefined,
			};
			const stats: ShareStats = { t: this.shareLoopTripCount || 1, k: Math.round((trip.distance ?? 0) / 1000) };

			// Calculer les hexagones du trajet
			const tripData = [{ coords: trip.coords, date: trip.startTime.substring(0, 10) }];
			const h3data = this.h3.computeResolution(tripData, 7 as H3Resolution);
			const allCells = Object.keys(h3data.counts);

			// Étape 1 : avec hexagones R7 bruts (counts=1, pas de degrés)
			const hexPayload: ShareHexPayload = { res: 7 as H3Resolution, cells: allCells };
			const withHexData = {
				v: 1 as const,
				mode: 'polyline' as const,
				poly: { ...basePayload, hex: hexPayload },
				stats,
				ts,
			};
			if ((await this.share.encodedLength(withHexData)) <= 6000) {
				this.shareUrl.set(`${origin}/share?d=${await this.share.encode(withHexData)}`);
				this.shareLoading.set(false);
				return;
			}

			// Étape 2 : avec hexagones compactés (counts=1)
			const compacted = compactCells(allCells);
			const compactHex: ShareHexPayload = { res: 7 as H3Resolution, cells: compacted, compact: true };
			const withCompactData = {
				v: 1 as const,
				mode: 'polyline' as const,
				poly: { ...basePayload, hex: compactHex },
				stats,
				ts,
			};
			if ((await this.share.encodedLength(withCompactData)) <= 6000) {
				this.shareUrl.set(`${origin}/share?d=${await this.share.encode(withCompactData)}`);
				this.shareWarning.set(
					'La définition a été réduite pour tenir dans le lien (zones très parcourues regroupées en zones plus larges)',
				);
				this.shareLoading.set(false);
				return;
			}

			// Étape 3 : sans hexagones (trajet seul)
			const baseData = { v: 1 as const, mode: 'polyline' as const, poly: basePayload, stats, ts };
			this.shareUrl.set(`${origin}/share?d=${await this.share.encode(baseData)}`);
			this.shareLoading.set(false);
			return;
		}

		if (this.shareMode() === 'dept') {
			this.ensureDeptLayers();
			if (!this.enrichedDepts) {
				this.shareLoading.set(false);
				return;
			}
			const payload = this.share.buildDeptPayload(this.enrichedDepts);
			const encoded = await this.share.encode({
				v: 1,
				mode: 'dept',
				dept: payload,
				stats: this.buildShareStats(),
				ts,
			});
			this.shareUrl.set(`${origin}/share?d=${encoded}`);
			this.shareLoading.set(false);
			return;
		}

		// Mode hex : toujours partager en résolution 7 (petits hexagones)
		// Le récepteur dérive la résolution 6 automatiquement via les parents H3
		const HEX_SHARE_RES = 7 as H3Resolution;
		if (!this.cellsByResolution[HEX_SHARE_RES]) {
			const tripData = this.tripsWithCoords.map((t) => ({
				coords: t.coords,
				date: t.startTime.substring(0, 10),
			}));
			this.cellsByResolution[HEX_SHARE_RES] = this.h3.computeResolution(tripData, HEX_SHARE_RES);
		}
		const h3data = this.cellsByResolution[HEX_SHARE_RES];
		if (!h3data) {
			this.shareLoading.set(false);
			return;
		}

		const allCells = Object.keys(h3data.counts);
		const stats = this.buildShareStats();

		// Étape 1 : R7 bruts (meilleure précision)
		const allPayload = this.share.buildHexPayload(h3data.counts, HEX_SHARE_RES);
		const allData = { v: 1 as const, mode: 'hex' as const, hex: allPayload, stats, ts };
		const len1 = await this.share.encodedLength(allData);
		if (len1 <= 6000) {
			this.shareUrl.set(`${origin}/share?d=${await this.share.encode(allData)}`);
			this.shareStep.set(null);
			this.shareLoading.set(false);
			return;
		}

		// Étape 2 : compactCells (fallback si R7 bruts trop volumineux)
		const compacted = compactCells(allCells);
		const compactedCounts = this.deriveCompactCounts(compacted, h3data.counts);
		const compactPayload = {
			...this.share.buildHexPayload(compactedCounts, HEX_SHARE_RES),
			compact: true as const,
		};
		const compactData = { v: 1 as const, mode: 'hex' as const, hex: compactPayload, stats, ts };
		const len2 = await this.share.encodedLength(compactData);
		if (len2 <= 6000) {
			this.shareUrl.set(`${origin}/share?d=${await this.share.encode(compactData)}`);
			this.shareWarning.set(
				'La définition a été réduite pour tenir dans le lien (zones très parcourues regroupées en zones plus larges)',
			);
			this.shareStep.set(null);
			this.shareLoading.set(false);
			return;
		}

		// Étape 3 : sélecteur pays (dernier recours)
		this.shareCountryOpts.set(this.visitedNeighboringCountries());
		this.shareStep.set(3);
		this.shareLoading.set(false);
		if (this.shareCountryOpts().length) {
			await this.buildShareUrlForCountry(this.shareCountryOpts()[0]);
		}
	}

	async buildShareUrl(): Promise<void> {
		this.shareStep.set(null);
		this.navigateForShareMode();
		await this.buildShareUrlCore();
	}

	private deriveCompactCounts(
		compactedCells: string[],
		sourceCounts: Record<string, number>,
	): Record<string, number> {
		const result: Record<string, number> = {};
		for (const cell of compactedCells) {
			if (sourceCounts[cell] !== undefined) {
				result[cell] = sourceCounts[cell];
			} else {
				const r7children = uncompactCells([cell], 7);
				result[cell] = Math.max(...r7children.map((c) => sourceCounts[c] ?? 1));
			}
		}
		return result;
	}

	private buildShareStats(): ShareStats {
		const s: ShareStats = { t: this.tripCount(), k: this.totalKm() };
		if (this.countryCountStat() >= 2) s.c = this.countryCountStat();
		if (this.cityCountStat() > 0) s.ci = this.cityCountStat();
		if (this.fullRegionCount() > 0) s.r = this.fullRegionCount();
		return s;
	}

	private async buildShareUrlForCountry(country: NeighboringCountry): Promise<void> {
		if (!this.map) return;
		const origin = window.location.origin;
		const h3data = this.cellsByResolution[7 as H3Resolution];
		if (!h3data) return;
		const filtered = this.share.filterCellsByCountry(h3data.counts, country);
		const filteredCells = Object.keys(filtered);
		const stats = this.buildShareStats();
		const ts = Math.floor(Date.now() / 1000);

		// R7 bruts d'abord, compact en fallback
		const rawPayload = this.share.buildHexPayload(filtered, 7 as H3Resolution);
		const rawData = { v: 1 as const, mode: 'hex' as const, hex: rawPayload, stats, ts };
		const lenRaw = await this.share.encodedLength(rawData);
		let encoded: string;
		if (lenRaw <= 6000) {
			encoded = await this.share.encode(rawData);
		} else {
			const compacted = compactCells(filteredCells);
			const compactedCounts = this.deriveCompactCounts(compacted, filtered);
			const compactPayload = {
				...this.share.buildHexPayload(compactedCounts, 7 as H3Resolution),
				compact: true as const,
			};
			encoded = await this.share.encode({ v: 1, mode: 'hex', hex: compactPayload, stats, ts });
		}
		this.shareUrl.set(`${origin}/share?d=${encoded}`);
		this.shareWarning.set(`Seuls les hexagones de ${country.name} sont partagés`);
		this.viewCountry(country);
		this.recaptureForShare();
	}

	async onShareCountryChange(event: Event): Promise<void> {
		const select = event.target as HTMLSelectElement;
		const country = this.shareCountryOpts().find((c) => c.code === select.value);
		if (country) await this.buildShareUrlForCountry(country);
	}

	async onShareModeChange(mode: 'dept' | 'hex' | 'trip'): Promise<void> {
		this.shareMode.set(mode);
		this.shareStep.set(null);
		this.navigateForShareMode();
		await this.buildShareUrlCore();
		if (!this.shareShowLabels()) {
			this.restoreLabels();
			// Forcer depts-labels à la visibilité correcte pour le nouveau mode avant re-hide
			if (this.map?.getLayer('depts-labels')) {
				this.map.setLayoutProperty('depts-labels', 'visibility', mode === 'dept' ? 'visible' : 'none');
			}
			this.hideLabelsForShare();
			this.captureMapForSharePreview();
		}
	}

	downloadSharePreview(): void {
		const src = this.sharePreviewSrc();
		if (!src) return;
		const a = document.createElement('a');
		a.href = src;
		const trip = this.shareMode() === 'trip' ? this.selectedTripForPanel() : null;
		const iso = trip?.startTime ? trip.startTime.slice(0, 10) : new Date().toISOString().slice(0, 10);
		a.download = `geo-scratch-map-${iso}.png`;
		a.click();
	}

	copyShareUrl(): void {
		navigator.clipboard.writeText(this.shareUrl()).then(() => {
			this.shareCopied.set(true);
			setTimeout(() => this.shareCopied.set(false), 2000);
		});
	}

	shareTripTabLabel(): string {
		return this.shareLoopTripCount > 1 ? `Trajets (${this.shareLoopTripCount})` : 'Trajet';
	}

	private buildTripWrappedData(): WrappedCardData {
		const trip = this.selectedTripForPanel();
		const computed = this.lastTripComputedStats;
		const distanceKm = Math.round((trip?.distance ?? 0) / 1000);
		const durationMs = trip?.duration ?? 0;
		const durationStr = this.formatTripDuration(durationMs);
		const avgSpeedKmh = trip?.averageSpeed ? Math.round(trip.averageSpeed * 1.852) : undefined;
		const maxSpeedKmh = trip?.maxSpeed ? Math.round(trip.maxSpeed * 1.852) : undefined;
		const fromCity = trip ? (this.extractCity(trip.niceStartAddress ?? trip.startAddress) ?? null) : null;
		const toCity = trip ? (this.extractCity(trip.niceEndAddress ?? trip.endAddress) ?? null) : null;

		// Angles accéléromètre API (toujours dispos, sans chargement des positions)
		const maxAngleFromApiDeg = trip?.maxAngle != null ? Math.round(Math.abs(90 - trip.maxAngle)) : null;
		const maxLeftAngleDeg = trip?.maxLeftAngle != null ? Math.round(Math.abs(90 - trip.maxLeftAngle)) : null;
		const maxRightAngleDeg = trip?.maxRightAngle != null ? Math.round(Math.abs(90 - trip.maxRightAngle)) : null;

		// Date du trajet formatée
		const startDate = trip?.startTime ? new Date(trip.startTime) : null;
		const tripDateLabel = startDate
			? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(startDate) +
				(startDate.getFullYear() !== new Date().getFullYear()
					? ' ' + String(startDate.getFullYear()).slice(2)
					: '')
			: null;

		// Durée totale voyage (riding + pauses)
		const endDate = trip?.endTime ? new Date(trip.endTime) : null;
		const elapsedMs = startDate && endDate ? endDate.getTime() - startDate.getTime() : 0;
		const totalElapsedStr = elapsedMs > durationMs ? this.formatTripDuration(elapsedMs) : null;

		return {
			mode: 'trip',
			totalKm: distanceKm,
			totalTrips: this.shareLoopTripCount || 1,
			ridingDays: 0,
			longestStreak: 0,
			topDaysOfWeek: [],
			departureHour: null,
			bestMonth: null,
			topDepts: [],
			countryCount: 0,
			fullRegionCount: 0,
			filterLabel: '',
			distanceKm,
			durationStr,
			avgSpeedKmh,
			maxSpeedKmh,
			maxAngle: computed?.maxAngleDelta ?? undefined,
			pauseCount: computed?.pauseCount ?? undefined,
			pauseTotalMin: computed?.pauseTotalMin ?? undefined,
			altMax: computed?.altMax ?? undefined,
			pctInTurn: computed?.pctInTurn ?? null,
			avgSpeedInTurnsKmh: computed?.avgSpeedInTurns ?? null,
			maxSpeedInTurnsKmh: computed?.maxSpeedInTurns ?? null,
			fromCity,
			toCity,
			maxAngleFromApiDeg,
			maxLeftAngleDeg,
			maxRightAngleDeg,
			tripDateLabel,
			totalElapsedStr,
		};
	}

	private buildWrappedData(): WrappedCardData {
		const stats = this.computeStatsData();
		const topDepts = stats.depts
			.filter((d) => d.pct > 0)
			.sort((a, b) => b.pct - a.pct)
			.slice(0, 3)
			.map((d) => ({ name: d.name, pct: d.pct }));
		const r = stats.records;
		const filterLabel = this.dateFilterLabels[this.dateFilter()] ?? 'Tout';
		const mode = this.shareMode() as 'dept' | 'hex';
		return {
			mode,
			totalKm: r.totalKm,
			totalTrips: r.totalTrips,
			ridingDays: r.ridingDays,
			longestStreak: r.longestStreak,
			topDaysOfWeek: r.topDaysOfWeek ?? [],
			departureHour: r.departureHour ?? null,
			bestMonth: r.bestMonth ?? null,
			topDepts,
			countryCount: this.countryCountStat(),
			fullRegionCount: this.fullRegionCount(),
			filterLabel,
			maxSpeedAllKmh: stats.speedStats.globalMaxKmh,
			bestDayKm: stats.records.longestDay?.km ?? 0,
			totalRidingHours: stats.records.totalRidingHours ?? 0,
			longestTripKm: stats.records.longestTrip?.km ?? 0,
		};
	}

	private formatTripDuration(ms: number): string {
		const h = Math.floor(ms / 3600000);
		const m = Math.floor((ms % 3600000) / 60000);
		if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
		return `${m}min`;
	}

	private computeStatsData(): StatsModalData {
		// Précomputer dept code + name par trip (évite O(n × depts) répété pour chaque lookup)
		const tripDeptCode: Record<string, string | null> = {};
		const tripDeptName: Record<string, string | null> = {};
		const tripCountryCode: Record<string, string> = {};
		const tripStartCountryCode: Record<string, string> = {};
		for (const trip of this.tripsWithCoords) {
			// Pays de destination (end)
			const code = this.findDeptCodeForPoint(trip.endLon, trip.endLat);
			tripDeptCode[trip.indexId] = code;
			const feat = code ? this.departments?.features.find((f) => f.properties?.['code'] === code) : null;
			tripDeptName[trip.indexId] = feat ? ((feat.properties?.['nom'] as string) ?? code) : null;
			const deptCountry = feat?.properties?.['country'] as string | undefined;
			tripCountryCode[trip.indexId] = deptCountry ?? this.countryForCoords(trip.endLat, trip.endLon);
			// Pays de départ (start) — même logique dept-first
			const startCode = this.findDeptCodeForPoint(trip.startLon, trip.startLat);
			const startFeat = startCode
				? this.departments?.features.find((f) => f.properties?.['code'] === startCode)
				: null;
			const startDeptCountry = startFeat?.properties?.['country'] as string | undefined;
			tripStartCountryCode[trip.indexId] =
				startDeptCountry ?? this.countryForCoords(trip.startLat, trip.startLon);
		}

		const startCityCount: Record<string, number> = {};
		for (const trip of this.tripsWithCoords) {
			const city = this.extractCity(trip.niceStartAddress ?? trip.startAddress);
			if (city) startCityCount[city] = (startCityCount[city] ?? 0) + 1;
		}
		const homeCity = Object.entries(startCityCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

		// Villes par département (point-in-polygon sur les coords GPS de chaque trajet)
		const deptCities: Record<string, Record<string, { count: number; dates: string[] }>> = {};
		for (const trip of this.tripsWithCoords) {
			const startCity = this.extractCity(trip.niceStartAddress ?? trip.startAddress);
			const endCity = this.extractCity(trip.niceEndAddress ?? trip.endAddress);
			if (!endCity || endCity === startCity || endCity === homeCity) continue;
			const code = tripDeptCode[trip.indexId] ?? null;
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
						country: (f.properties?.['country'] as string) ?? 'FR',
						cities,
					});
				}
				depts.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'fr'));
			}
		}

		// DistanceStats
		const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
		const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
		const kmByDay: Record<string, { km: number; trips: number; indexIds: string[] }> = {};
		const kmByMonth: Record<string, { km: number; trips: number }> = {};
		for (const trip of this.tripsWithCoords) {
			const day = trip.startTime.substring(0, 10);
			const month = trip.startTime.substring(0, 7);
			const km = trip.distance / 1000;
			if (!kmByDay[day]) kmByDay[day] = { km: 0, trips: 0, indexIds: [] };
			kmByDay[day].km += km;
			kmByDay[day].trips++;
			kmByDay[day].indexIds.push(trip.indexId);
			if (!kmByMonth[month]) kmByMonth[month] = { km: 0, trips: 0 };
			kmByMonth[month].km += km;
			kmByMonth[month].trips++;
		}
		const topDays = Object.entries(kmByDay)
			.sort(([, a], [, b]) => b.km - a.km)
			.slice(0, 10)
			.map(([date, s]) => ({
				date,
				dateLabel: fmt.format(new Date(date + 'T12:00:00')),
				km: Math.round(s.km),
				tripCount: s.trips,
				indexIds: s.indexIds,
			}));
		const byMonth = Object.entries(kmByMonth)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, s]) => ({
				key,
				label: fmtMonth.format(new Date(key + '-15')),
				km: Math.round(s.km),
				tripCount: s.trips,
			}));
		const kmBySeason: Record<string, { km: number; trips: number }> = {};
		for (const { key, km, tripCount } of byMonth) {
			const [year, mon] = key.split('-').map(Number);
			const seasonLabel = this.tripSeason(year, mon);
			if (!kmBySeason[seasonLabel]) kmBySeason[seasonLabel] = { km: 0, trips: 0 };
			kmBySeason[seasonLabel].km += km;
			kmBySeason[seasonLabel].trips += tripCount;
		}
		const bySeason = Object.entries(kmBySeason)
			.sort(([a], [b]) => this.seasonSortKey(a) - this.seasonSortKey(b))
			.map(([label, s]) => ({ label, km: s.km, tripCount: s.trips }));
		// Top trajets point-à-point (pas des boucles : start/end > 10 km)
		const topTrips: TopTrip[] = [...this.tripsWithCoords]
			.filter((t) => t.distance > 0 && haversineKm(t.startLat, t.startLon, t.endLat, t.endLon) > 10)
			.sort((a, b) => b.distance - a.distance)
			.slice(0, 10)
			.map((t) => ({
				indexId: t.indexId,
				date: t.startTime.substring(0, 10),
				dateLabel: fmt.format(new Date(t.startTime.substring(0, 10) + 'T12:00:00')),
				km: Math.round(t.distance / 1000),
				from: this.extractCity(t.niceStartAddress ?? t.startAddress),
				to: this.extractCity(t.niceEndAddress ?? t.endAddress),
				fromCountryCode: tripStartCountryCode[t.indexId] ?? 'FR',
				toCountryCode: tripCountryCode[t.indexId] ?? 'FR',
			}));
		const distanceStats: DistanceStats = { topDays, byMonth, bySeason, topTrips };

		// SpeedStats
		const validTrips = this.tripsWithCoords.filter((t) => t.maxSpeed > 0);
		const globalMaxKmh =
			validTrips.length > 0 ? Math.round(Math.max(...validTrips.map((t) => t.maxSpeed)) * 1.852) : 0;
		const totalDist = validTrips.reduce((s, t) => s + t.distance, 0);
		const globalAvgKmh =
			totalDist > 0
				? Math.round((validTrips.reduce((s, t) => s + t.averageSpeed * t.distance, 0) / totalDist) * 1.852)
				: 0;
		const maxSpeedTripRaw =
			validTrips.length > 0 ? validTrips.reduce((best, t) => (t.maxSpeed > best.maxSpeed ? t : best)) : null;
		const topByMax = [...validTrips]
			.sort((a, b) => b.maxSpeed - a.maxSpeed)
			.slice(0, 10)
			.map((t) => ({
				indexId: t.indexId,
				date: t.startTime.substring(0, 10),
				dateLabel: fmt.format(new Date(t.startTime.substring(0, 10) + 'T12:00:00')),
				maxKmh: Math.round(t.maxSpeed * 1.852),
				avgKmh: Math.round(t.averageSpeed * 1.852),
				km: Math.round(t.distance / 1000),
				from: this.extractCity(t.niceStartAddress ?? t.startAddress),
				to: this.extractCity(t.niceEndAddress ?? t.endAddress),
				fromCountryCode: tripStartCountryCode[t.indexId] ?? 'FR',
				toCountryCode: tripCountryCode[t.indexId] ?? 'FR',
			}));
		const tripsWithAngle = this.tripsWithCoords.filter((t) => t.maxAngle != null && t.maxAngle !== 0);
		const maxLeanAngle =
			tripsWithAngle.length > 0
				? Math.round(Math.max(...tripsWithAngle.map((t) => Math.abs(t.maxAngle - 90))))
				: null;
		const maxLeanTripRaw =
			tripsWithAngle.length > 0
				? tripsWithAngle.reduce((best, t) =>
						Math.abs(t.maxAngle - 90) > Math.abs(best.maxAngle - 90) ? t : best,
					)
				: null;
		const sportPct =
			tripsWithAngle.length > 0
				? Math.round(
						(tripsWithAngle.filter((t) => Math.abs(t.maxAngle - 90) > 30).length / tripsWithAngle.length) *
							100,
					)
				: null;
		const speedStats: SpeedStats = {
			globalMaxKmh,
			globalAvgKmh,
			maxSpeedTripIndexId: maxSpeedTripRaw?.indexId ?? null,
			topByMax,
		};

		// TurnStats (positions requises)
		const TURN_DEG = 15;
		const tripsWithPos = this.tripsWithCoords.filter((t) => t.positions && t.positions.length > 0);
		let avgSpeedKmh: number | null = null;
		let maxSpeedKmh: number | null = null;
		let avgPctInTurns: number | null = null;
		const deptTurnMap: Record<
			string,
			{
				speeds: number[];
				leans: number[];
				maxKmh: number;
				maxKmhIndexId: string | null;
				maxLeanDeg: number;
				maxLeanIndexId: string | null;
			}
		> = {};
		if (tripsWithPos.length > 0) {
			const allTurnSpeeds: number[] = [];
			const perTripPcts: number[] = [];
			let globalMaxInTurns = 0;
			for (const trip of tripsWithPos) {
				const positions = trip.positions!;
				const inTurn = positions.filter((p) => Math.abs(p.angle - 90) > TURN_DEG && p.speed * 1.852 > 10);
				if (inTurn.length > 0) {
					allTurnSpeeds.push(...inTurn.map((p) => p.speed));
					const tripMax = Math.max(...inTurn.map((p) => p.speed));
					if (tripMax > globalMaxInTurns) globalMaxInTurns = tripMax;
					const deptName = tripDeptName[trip.indexId] ?? null;
					if (deptName) {
						if (!deptTurnMap[deptName])
							deptTurnMap[deptName] = {
								speeds: [],
								leans: [],
								maxKmh: 0,
								maxKmhIndexId: null,
								maxLeanDeg: 0,
								maxLeanIndexId: null,
							};
						deptTurnMap[deptName].speeds.push(...inTurn.map((p) => p.speed * 1.852));
						const turnLeans = inTurn.map((p) => Math.abs(p.angle - 90));
						deptTurnMap[deptName].leans.push(...turnLeans);
						const deptMax = tripMax * 1.852;
						if (deptMax > deptTurnMap[deptName].maxKmh) {
							deptTurnMap[deptName].maxKmh = deptMax;
							deptTurnMap[deptName].maxKmhIndexId = trip.indexId;
						}
						const tripMaxLean = Math.max(...turnLeans);
						if (tripMaxLean > deptTurnMap[deptName].maxLeanDeg) {
							deptTurnMap[deptName].maxLeanDeg = tripMaxLean;
							deptTurnMap[deptName].maxLeanIndexId = trip.indexId;
						}
					}
				}
				perTripPcts.push(Math.round((inTurn.length / positions.length) * 100));
			}
			if (allTurnSpeeds.length > 0) {
				avgSpeedKmh = Math.round((allTurnSpeeds.reduce((s, v) => s + v, 0) / allTurnSpeeds.length) * 1.852);
				maxSpeedKmh = Math.round(globalMaxInTurns * 1.852);
			}
			avgPctInTurns = Math.round(perTripPcts.reduce((s, v) => s + v, 0) / perTripPcts.length);
		}
		const topDepts: TurnDeptStat[] = Object.entries(deptTurnMap)
			.map(([deptName, { speeds, leans, maxKmh, maxKmhIndexId, maxLeanDeg, maxLeanIndexId }]) => {
				const tripInDept = tripsWithPos.filter((t) => tripDeptName[t.indexId] === deptName);
				const countryCode = tripInDept[0] ? (tripCountryCode[tripInDept[0].indexId] ?? 'FR') : 'FR';
				return {
					deptName,
					countryCode,
					avgKmh: Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length),
					maxKmh: Math.round(maxKmh),
					maxKmhTripIndexId: maxKmhIndexId,
					avgLeanDeg: leans.length > 0 ? Math.round(leans.reduce((s, v) => s + v, 0) / leans.length) : 0,
					maxLeanDeg: Math.round(maxLeanDeg),
					maxLeanTripIndexId: maxLeanIndexId,
					tripCount: tripInDept.length,
				};
			})
			.sort((a, b) => b.avgKmh - a.avgKmh)
			.slice(0, 8);

		// Villes proches des virages : pour chaque trajet avec positions, trouver le centre des virages
		// et le matcher à la ville la plus proche parmi les endpoints connus
		const uniqueCityEndpoints: { city: string; deptName: string; countryCode: string; lat: number; lon: number }[] =
			[];
		const seenCities = new Set<string>();
		for (const t of this.tripsWithCoords) {
			for (const [addr, lat, lon] of [
				[t.niceStartAddress ?? t.startAddress, t.startLat, t.startLon] as [string | null, number, number],
				[t.niceEndAddress ?? t.endAddress, t.endLat, t.endLon] as [string | null, number, number],
			]) {
				const city = this.extractCity(addr);
				if (!city || seenCities.has(city)) continue;
				seenCities.add(city);
				const deptName = tripDeptName[t.indexId] ?? '';
				const bboxCountry = this.countryForCoords(lat, lon);
				// Pour les petits pays à bbox très précise (Monaco, Andorre…), la bbox prime sur le dept
				// Pour les grands pays (Espagne…), le dept prime (leurs bbox couvrent la France)
				const bboxArea =
					bboxCountry !== 'FR'
						? (() => {
								const c = NEIGHBORING_COUNTRIES.find((x) => x.code === bboxCountry);
								return c ? (c.maxLat - c.minLat) * (c.maxLon - c.minLon) : 999;
							})()
						: 999;
				const countryCode =
					bboxCountry !== 'FR' && bboxArea < 0.5 ? bboxCountry : (tripCountryCode[t.indexId] ?? 'FR');
				uniqueCityEndpoints.push({ city, deptName, countryCode, lat, lon });
			}
		}
		const cityTurnMap: Record<
			string,
			{
				speeds: number[];
				leans: number[];
				maxKmh: number;
				maxKmhIndexId: string | null;
				maxLeanDeg: number;
				maxLeanIndexId: string | null;
				deptName: string;
				countryCode: string;
			}
		> = {};
		for (const trip of tripsWithPos) {
			const positions = trip.positions!;
			const inTurn = positions.filter((p) => Math.abs(p.angle - 90) > TURN_DEG && p.speed * 1.852 > 10);
			if (inTurn.length === 0) continue;
			const centerLat = inTurn.reduce((s, p) => s + p.latitude, 0) / inTurn.length;
			const centerLon = inTurn.reduce((s, p) => s + p.longitude, 0) / inTurn.length;
			let nearestCity = '';
			let nearestDept = '';
			let nearestCountry = 'FR';
			let nearestDist = 40;
			for (const ep of uniqueCityEndpoints) {
				const d = haversineKm(centerLat, centerLon, ep.lat, ep.lon);
				if (d < nearestDist) {
					nearestDist = d;
					nearestCity = ep.city;
					nearestDept = ep.deptName;
					nearestCountry = ep.countryCode;
				}
			}
			if (!nearestCity) continue;
			if (!cityTurnMap[nearestCity])
				cityTurnMap[nearestCity] = {
					speeds: [],
					leans: [],
					maxKmh: 0,
					maxKmhIndexId: null,
					maxLeanDeg: 0,
					maxLeanIndexId: null,
					deptName: nearestDept,
					countryCode: nearestCountry,
				};
			const citySpeeds = inTurn.map((p) => p.speed * 1.852);
			cityTurnMap[nearestCity].speeds.push(...citySpeeds);
			const cityMaxKmh = Math.max(...citySpeeds);
			if (cityMaxKmh > cityTurnMap[nearestCity].maxKmh) {
				cityTurnMap[nearestCity].maxKmh = cityMaxKmh;
				cityTurnMap[nearestCity].maxKmhIndexId = trip.indexId;
			}
			const cityLeans = inTurn.map((p) => Math.abs(p.angle - 90));
			cityTurnMap[nearestCity].leans.push(...cityLeans);
			const cityMaxLean = Math.max(...cityLeans);
			if (cityMaxLean > cityTurnMap[nearestCity].maxLeanDeg) {
				cityTurnMap[nearestCity].maxLeanDeg = cityMaxLean;
				cityTurnMap[nearestCity].maxLeanIndexId = trip.indexId;
			}
		}
		const topCities: TurnCityStat[] = Object.entries(cityTurnMap)
			.map(
				([
					cityName,
					{ speeds, leans, maxKmh, maxKmhIndexId, maxLeanDeg, maxLeanIndexId, deptName, countryCode },
				]) => ({
					cityName,
					deptName,
					countryCode,
					avgKmh: Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length),
					maxKmh: Math.round(maxKmh),
					maxKmhTripIndexId: maxKmhIndexId,
					avgLeanDeg: leans.length > 0 ? Math.round(leans.reduce((s, v) => s + v, 0) / leans.length) : 0,
					maxLeanDeg: Math.round(maxLeanDeg),
					maxLeanTripIndexId: maxLeanIndexId,
					tripCount: speeds.length,
				}),
			)
			.sort((a, b) => b.avgKmh - a.avgKmh)
			.slice(0, 8);

		// Lean angle distribution from all trips (no positions needed)
		const leanBuckets = [
			{ label: '< 15°', min: 0, max: 15 },
			{ label: '15 – 30°', min: 15, max: 30 },
			{ label: '30 – 45°', min: 30, max: 45 },
			{ label: '> 45°', min: 45, max: 90 },
		];
		const leanDistribution = leanBuckets.map(({ label, min, max }) => {
			const count = tripsWithAngle.filter((t) => {
				const lean = Math.abs(t.maxAngle - 90);
				return lean >= min && lean < max;
			}).length;
			return {
				label,
				pct: tripsWithAngle.length > 0 ? Math.round((count / tripsWithAngle.length) * 100) : 0,
				count,
			};
		});
		const avgLeanAngle =
			tripsWithAngle.length > 0
				? Math.round(tripsWithAngle.reduce((s, t) => s + Math.abs(t.maxAngle - 90), 0) / tripsWithAngle.length)
				: null;
		const turnStats: TurnStats = {
			maxLeanAngle,
			maxLeanTripIndexId: maxLeanTripRaw?.indexId ?? null,
			sportPct,
			avgSpeedKmh,
			maxSpeedKmh,
			avgPctInTurns,
			tripsWithPositions: tripsWithPos.length,
			topDepts,
			topCities,
			leanDistribution,
			avgLeanAngle,
		};

		// Records
		const longestTripRaw =
			this.tripsWithCoords.length > 0
				? this.tripsWithCoords.reduce((best, t) => (t.distance > best.distance ? t : best))
				: null;
		const longestTrip = longestTripRaw
			? {
					km: Math.round(longestTripRaw.distance / 1000),
					dateLabel: fmt.format(new Date(longestTripRaw.startTime.substring(0, 10) + 'T12:00:00')),
					from: this.extractCity(longestTripRaw.niceStartAddress ?? longestTripRaw.startAddress),
					to: this.extractCity(longestTripRaw.niceEndAddress ?? longestTripRaw.endAddress),
					indexId: longestTripRaw.indexId,
				}
			: null;
		const longestDayEntry = Object.entries(kmByDay).sort(([, a], [, b]) => b.km - a.km)[0] ?? null;
		const longestDay = longestDayEntry
			? {
					km: Math.round(longestDayEntry[1].km),
					dateLabel: fmt.format(new Date(longestDayEntry[0] + 'T12:00:00')),
					tripCount: longestDayEntry[1].trips,
				}
			: null;
		const bestMonthEntry = Object.entries(kmByMonth).sort(([, a], [, b]) => b.km - a.km)[0] ?? null;
		const bestMonth = bestMonthEntry
			? { km: Math.round(bestMonthEntry[1].km), label: fmtMonth.format(new Date(bestMonthEntry[0] + '-15')) }
			: null;
		const firstTripRaw =
			this.tripsWithCoords.length > 0
				? this.tripsWithCoords.reduce((oldest, t) => (t.startTime < oldest.startTime ? t : oldest))
				: null;
		const firstTripDate = firstTripRaw
			? fmt.format(new Date(firstTripRaw.startTime.substring(0, 10) + 'T12:00:00'))
			: null;
		const ridingDays = Object.keys(kmByDay).length;
		const sortedDays = Object.keys(kmByDay).sort();
		let maxStreak = sortedDays.length > 0 ? 1 : 0;
		let currentStreak = 1;
		let currentStreakStartIdx = 0;
		let maxStreakStartIdx = 0;
		let maxStreakEndIdx = 0;
		for (let i = 1; i < sortedDays.length; i++) {
			const prev = new Date(sortedDays[i - 1] + 'T12:00:00');
			const curr = new Date(sortedDays[i] + 'T12:00:00');
			const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
			if (diff === 1) {
				currentStreak++;
				if (currentStreak > maxStreak) {
					maxStreak = currentStreak;
					maxStreakStartIdx = currentStreakStartIdx;
					maxStreakEndIdx = i;
				}
			} else {
				currentStreak = 1;
				currentStreakStartIdx = i;
			}
		}
		const longestStreakFrom =
			sortedDays.length > 0 ? fmt.format(new Date(sortedDays[maxStreakStartIdx] + 'T12:00:00')) : null;
		const longestStreakTo =
			sortedDays.length > 0 ? fmt.format(new Date(sortedDays[maxStreakEndIdx] + 'T12:00:00')) : null;
		// Plus longue période sans rouler
		let longestBreak: Records['longestBreak'] = null;
		for (let i = 1; i < sortedDays.length; i++) {
			const prev = new Date(sortedDays[i - 1] + 'T12:00:00');
			const curr = new Date(sortedDays[i] + 'T12:00:00');
			const gap = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)) - 1;
			if (gap > 0 && (!longestBreak || gap > longestBreak.days)) {
				longestBreak = {
					days: gap,
					from: fmt.format(new Date(prev.getTime() + 1000 * 60 * 60 * 24)),
					to: fmt.format(curr),
				};
			}
		}
		// Stats uniques — non visibles ailleurs dans l'app
		const totalKm = Math.round(this.tripsWithCoords.reduce((s, t) => s + t.distance, 0) / 1000);
		const totalTrips = this.tripsWithCoords.length;
		const avgKmPerTrip = totalTrips > 0 ? Math.round(totalKm / totalTrips) : 0;
		const totalDurationMs = this.tripsWithCoords.reduce((s, t) => s + t.duration, 0);
		const totalRidingHours = Math.round(totalDurationMs / (1000 * 60 * 60));
		const avgTripDurationMin = totalTrips > 0 ? Math.round(totalDurationMs / totalTrips / (1000 * 60)) : 0;
		const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
		const dayOfWeekCount: Record<number, number> = {};
		const startHourCount: Record<number, number> = {};
		const endHourCount: Record<number, number> = {};
		for (const trip of this.tripsWithCoords) {
			const d = new Date(trip.startTime);
			const e = new Date(trip.endTime);
			dayOfWeekCount[d.getDay()] = (dayOfWeekCount[d.getDay()] ?? 0) + 1;
			startHourCount[d.getHours()] = (startHourCount[d.getHours()] ?? 0) + 1;
			endHourCount[e.getHours()] = (endHourCount[e.getHours()] ?? 0) + 1;
		}
		const topDaysOfWeek = Object.entries(dayOfWeekCount)
			.sort(([, a], [, b]) => b - a)
			.slice(0, 3)
			.map(([dow]) => DAY_NAMES[Number(dow)]);
		const mostCommonHour = (hourCount: Record<number, number>): number | null =>
			Object.entries(hourCount).sort(([, a], [, b]) => b - a)[0]?.[0] != null
				? Number(Object.entries(hourCount).sort(([, a], [, b]) => b - a)[0][0])
				: null;
		const departureHour = mostCommonHour(startHourCount);
		const arrivalHour = mostCommonHour(endHourCount);
		const pauseHour =
			departureHour !== null && arrivalHour !== null ? Math.round((departureHour + arrivalHour) / 2) : null;
		const records: Records = {
			longestTrip,
			longestDay,
			bestMonth,
			firstTripDate,
			totalKm,
			totalTrips,
			ridingDays,
			longestStreak: maxStreak,
			longestStreakFrom,
			longestStreakTo,
			longestBreak,
			avgKmPerTrip,
			totalRidingHours,
			avgTripDurationMin,
			topDaysOfWeek,
			departureHour,
			pauseHour,
			arrivalHour,
		};

		// PauseStats — basé sur les sessions (boucles) détectées par buildSessions
		// Pauses = intra-trajet (depuis positions GPS) + inter-trajets (gap entre trajets d'une même session)
		const PAUSE_MS = 5 * 60 * 1000;
		const MERGE_KM = 0.2;
		const KM_RANGES: [number, number][] = [
			[0, 50],
			[50, 100],
			[100, 150],
			[150, 200],
			[200, Infinity],
		];
		const kmRangeLabel = (min: number, max: number) => (max === Infinity ? `> ${min} km` : `${min} – ${max} km`);
		const rangeData: { pauseCounts: number[]; durations: number[] }[] = KM_RANGES.map(() => ({
			pauseCounts: [],
			durations: [],
		}));
		let totalPauseCount = 0,
			totalPauseDuration = 0,
			totalSessionCount = 0;
		let maxPauseDuration = 0,
			maxPauseDateLabel: string | null = null,
			maxPauseTripIndexId: string | null = null;
		let totalKmBeforeFirst = 0,
			kmBeforeFirstCount = 0;
		let longestSessionKm = 0,
			longestSessionTripIndexId: string | null = null;

		const sessions = buildSessions(this.tripsWithCoords);
		for (const session of sessions) {
			const sessionKm = session.reduce((s, t) => s + t.distance / 1000, 0);
			const sessionPauses: { durationMin: number; afterKm: number; tripIndexId: string; date: string }[] = [];
			let cumKm = 0;

			for (let si = 0; si < session.length; si++) {
				const trip = session[si];

				// Pauses intra-trajet (depuis les positions GPS si disponibles)
				if (trip.positions && trip.positions.length > 0) {
					const positions = trip.positions;
					const raw: { durationMin: number; lat: number; lon: number; startKm: number }[] = [];
					let tripCumKm = 0;
					for (let i = 1; i < positions.length; i++) {
						const dt =
							new Date(positions[i].fixtime).getTime() - new Date(positions[i - 1].fixtime).getTime();
						const segKm = haversineKm(
							positions[i - 1].latitude,
							positions[i - 1].longitude,
							positions[i].latitude,
							positions[i].longitude,
						);
						tripCumKm += segKm;
						if (dt > PAUSE_MS) {
							raw.push({
								durationMin: Math.round(dt / 60000),
								lat: positions[i - 1].latitude,
								lon: positions[i - 1].longitude,
								startKm: tripCumKm,
							});
						}
					}
					// Fusionner les pauses proches (< 200m)
					const merged: typeof raw = [];
					for (const z of raw) {
						const nearby = merged.find((m) => haversineKm(m.lat, m.lon, z.lat, z.lon) < MERGE_KM);
						if (nearby) nearby.durationMin += z.durationMin;
						else merged.push({ ...z });
					}
					for (const p of merged.filter((z) => cumKm + z.startKm >= 5)) {
						sessionPauses.push({
							durationMin: p.durationMin,
							afterKm: cumKm + p.startKm,
							tripIndexId: trip.indexId,
							date: trip.startTime.substring(0, 10),
						});
					}
				}

				cumKm += trip.distance / 1000;

				// Pause inter-trajet : 3+ trajets seulement, et gap >= 10 min (évite les micro-coupures GPS)
				if (session.length >= 3 && si < session.length - 1) {
					const next = session[si + 1];
					const gapMs = new Date(next.startTime).getTime() - new Date(trip.endTime).getTime();
					const gapMin = Math.round(gapMs / 60000);
					if (gapMin >= 10) {
						sessionPauses.push({
							durationMin: gapMin,
							afterKm: cumKm,
							tripIndexId: trip.indexId,
							date: trip.startTime.substring(0, 10),
						});
					}
				}
			}

			// Agréger les stats de la session
			totalSessionCount++;
			totalPauseCount += sessionPauses.length;
			for (const p of sessionPauses) {
				totalPauseDuration += p.durationMin;
				if (p.durationMin > maxPauseDuration) {
					maxPauseDuration = p.durationMin;
					maxPauseDateLabel = fmt.format(new Date(p.date + 'T12:00:00'));
					maxPauseTripIndexId = p.tripIndexId;
				}
			}
			const firstPause = sessionPauses[0];
			if (firstPause) {
				totalKmBeforeFirst += firstPause.afterKm;
				kmBeforeFirstCount++;
			}
			if (sessionPauses.length === 0 && sessionKm > longestSessionKm) {
				longestSessionKm = sessionKm;
				longestSessionTripIndexId = session[0].indexId;
			}
			const rangeIdx = KM_RANGES.findIndex(([min, max]) => sessionKm >= min && sessionKm < max);
			if (rangeIdx >= 0) {
				rangeData[rangeIdx].pauseCounts.push(sessionPauses.length);
				if (sessionPauses.length > 0)
					rangeData[rangeIdx].durations.push(...sessionPauses.map((p) => p.durationMin));
			}
		}

		const pauseStats: PauseStats = {
			tripsWithPositions: tripsWithPos.length,
			avgPausesPerTrip:
				totalSessionCount > 0 ? Math.round((totalPauseCount / totalSessionCount) * 10) / 10 : null,
			avgPauseDurationMin: totalPauseCount > 0 ? Math.round(totalPauseDuration / totalPauseCount) : null,
			maxPauseDurationMin: maxPauseDuration > 0 ? maxPauseDuration : null,
			maxPauseDateLabel,
			maxPauseTripIndexId,
			avgKmBeforeFirstPause: kmBeforeFirstCount > 0 ? Math.round(totalKmBeforeFirst / kmBeforeFirstCount) : null,
			longestSessionKm: longestSessionKm > 0 ? Math.round(longestSessionKm) : null,
			longestSessionTripIndexId,
			byKmRange: KM_RANGES.map(([min, max], i) => {
				const { pauseCounts, durations } = rangeData[i];
				return {
					label: kmRangeLabel(min, max),
					avgPauses:
						pauseCounts.length > 0
							? Math.round((pauseCounts.reduce((s, v) => s + v, 0) / pauseCounts.length) * 10) / 10
							: 0,
					minPauses: pauseCounts.length > 0 ? Math.min(...pauseCounts) : 0,
					maxPauses: pauseCounts.length > 0 ? Math.max(...pauseCounts) : 0,
					avgDurationMin:
						durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
					minDurationMin: durations.length > 0 ? Math.min(...durations) : 0,
					maxDurationMin: durations.length > 0 ? Math.max(...durations) : 0,
					tripCount: pauseCounts.length,
				};
			}).filter((r) => r.tripCount > 0),
		};

		// FuelStats
		const TANK_L = 15;
		let totalLiters = 0;
		// Initialiser les 12 derniers mois (même si 0 trajet)
		const fuelByMonth: Record<string, { liters: number }> = {};
		const nowDate = new Date();
		for (let i = 11; i >= 0; i--) {
			const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			fuelByMonth[key] = { liters: 0 };
		}
		for (const trip of this.tripsWithCoords) {
			const liters = estimateLiters(trip.distance, trip.averageSpeed, trip.positions);
			totalLiters += liters;
			const month = trip.startTime.substring(0, 7);
			if (fuelByMonth[month] !== undefined) fuelByMonth[month].liters += liters;
		}
		const prices = this.fuelPrices();
		const totalKmAll = this.tripsWithCoords.reduce((s, t) => s + t.distance / 1000, 0);
		let totalCost: number | null = null;
		const fuelByMonthStats: MonthlyFuelCost[] = Object.entries(fuelByMonth)
			.sort(([a], [b]) => a.localeCompare(b))
			.filter(([, { liters }]) => liters > 0)
			.map(([key, { liters }]) => {
				const pricePerL = prices[key] ?? null;
				const cost = pricePerL !== null ? liters * pricePerL : null;
				if (cost !== null) totalCost = (totalCost ?? 0) + cost;
				return {
					key,
					label: fmtMonth.format(new Date(key + '-15')),
					pricePerL: pricePerL !== null ? Math.round(pricePerL * 1000) / 1000 : null,
					litersConsumed: Math.round(liters * 10) / 10,
					cost: cost !== null ? Math.round(cost) : null,
					fillUps: estimateFillUps(liters, TANK_L),
				};
			});
		const fuelStats: FuelStats = {
			fuelType: this.fuelType,
			tankSizeL: TANK_L,
			totalLiters: Math.round(totalLiters * 10) / 10,
			totalCost: totalCost !== null ? Math.round(totalCost) : null,
			avgConsumptionL100: totalKmAll > 0 ? Math.round((totalLiters / totalKmAll) * 1000) / 10 : 0,
			totalFillUps: fuelByMonthStats.reduce((s, m) => s + m.fillUps, 0),
			co2KgTotal: estimateCO2Kg(totalLiters),
			costPerKm: totalCost !== null ? fuelCostPerKm(totalCost, totalKmAll) : null,
			byMonth: fuelByMonthStats,
		};

		return { homeCity, depts, distanceStats, speedStats, turnStats, pauseStats, fuelStats, records };
	}

	private tripSeason(year: number, month: number): string {
		if (month >= 3 && month <= 5) return `Printemps ${year}`;
		if (month >= 6 && month <= 8) return `Été ${year}`;
		if (month >= 9 && month <= 11) return `Automne ${year}`;
		return `Hiver ${month === 12 ? year : year - 1}`;
	}

	private seasonSortKey(label: string): number {
		const m = label.match(/(\d{4})$/);
		if (!m) return 0;
		const year = parseInt(m[1]);
		if (label.startsWith('Printemps')) return year * 10 + 1;
		if (label.startsWith('Été')) return year * 10 + 2;
		if (label.startsWith('Automne')) return year * 10 + 3;
		return year * 10 + 4;
	}

	private countryForCoords(lat: number, lon: number): string {
		// Trier par surface de bbox (plus petit d'abord) pour que Monaco passe avant France/Italie
		const sorted = [...NEIGHBORING_COUNTRIES].sort(
			(a, b) => (a.maxLat - a.minLat) * (a.maxLon - a.minLon) - (b.maxLat - b.minLat) * (b.maxLon - b.minLon),
		);
		for (const c of sorted) {
			if (lat >= c.minLat && lat <= c.maxLat && lon >= c.minLon && lon <= c.maxLon) return c.code;
		}
		return 'FR';
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

	// Quand l'adresse est null, cherche la ville la plus proche parmi les endpoints connus (< 2 km)
	private inferCityFromCoords(lat: number, lon: number): string | null {
		if (!lat || !lon) return null;
		let bestCity: string | null = null;
		let bestDist = 2; // km — seuil max
		for (const t of this.allTripsWithCoords) {
			const candidates: [string | null | undefined, number, number][] = [
				[t.niceStartAddress ?? t.startAddress, t.startLat, t.startLon],
				[t.niceEndAddress ?? t.endAddress, t.endLat, t.endLon],
			];
			for (const [addr, alat, alon] of candidates) {
				const city = this.extractCity(addr);
				if (!city || !alat || !alon) continue;
				const dLat = (lat - alat) * 111;
				const dLon = (lon - alon) * 111 * Math.cos(lat * (Math.PI / 180));
				const dist = Math.sqrt(dLat * dLat + dLon * dLon);
				if (dist < bestDist) {
					bestDist = dist;
					bestCity = city;
				}
			}
		}
		return bestCity;
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

		document.getElementById('map')!.addEventListener(
			'dblclick',
			(e: MouseEvent) => {
				const statEls = document.querySelectorAll<HTMLElement>('[data-stat-action]');
				for (const el of statEls) {
					const r = el.getBoundingClientRect();
					if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
						e.stopPropagation();
						e.preventDefault();
						if (el.dataset['statAction'] === 'maxSpeed') this.openMaxSpeedTrip();
						else if (el.dataset['statAction'] === 'maxDistance') this.openMaxDistanceTrip();
						return;
					}
				}
			},
			{ capture: true },
		);

		this.map.on('zoomend', () => this.updateView());

		// Mise à jour instantanée en cours d'animation quand un seuil est franchi
		let _prevZoom = this.map.getZoom();
		this.map.on('zoom', () => {
			const z = this.map!.getZoom();
			const thresholds = [
				this.deptThreshold,
				9, // résolution hex 6 ↔ 7
				this.isMobile
					? this.mapSettings.polylineModeZoomThresholdMob()
					: this.mapSettings.polylineModeZoomThresholdDesk(),
			];
			if (thresholds.some((t) => _prevZoom < t !== z < t)) this.updateView();
			_prevZoom = z;
		});

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
		this.map.on('contextmenu', (e) => {
			e.originalEvent.preventDefault();
			e.originalEvent.stopPropagation();
			if ((this.map?.getZoom() ?? 0) < 12) return;
			// Fermer le contextmenu précédent s'il existe
			this.ctxMenuPopup?.remove();
			this.ctxMenuPopup = null;
			const { lat, lng } = e.lngLat;
			const latStr = lat.toFixed(6);
			const lngStr = lng.toFixed(6);
			const googleUrl = `https://www.google.com/maps?q=${latStr},${lngStr}`;
			const wazeUrl = `https://waze.com/ul?ll=${latStr},${lngStr}&navigate=yes`;
			this.ctxMenuPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '220px', offset: 8 })
				.setLngLat(e.lngLat)
				.setHTML(
					`
					<div class="ctx-menu">
						<div class="ctx-coords">${latStr}, ${lngStr}</div>
						<a class="ctx-btn" href="${googleUrl}" target="_blank" rel="noopener noreferrer">
							<span>📍</span> Google Maps
						</a>
						<a class="ctx-btn" href="${wazeUrl}" target="_blank" rel="noopener noreferrer">
							<span>🚗</span> Waze
						</a>
					</div>
				`,
				)
				.addTo(this.map!);
			this.ctxMenuPopup?.on('close', () => {
				this.ctxMenuPopup = null;
			});
		});

		this.map.on('zoom', () => {
			if (this.ctxMenuPopup && (this.map?.getZoom() ?? 0) < 12) {
				this.ctxMenuPopup.remove();
				this.ctxMenuPopup = null;
			}
		});

		this.map.on('click', (e) => {
			if (this.isShare) return;
			if (e.originalEvent.defaultPrevented) return;
			if ((e.originalEvent.target as HTMLElement)?.closest?.('.maplibregl-popup')) return;
			// Fermer le contextmenu sur tout clic hors popup
			if (this.ctxMenuPopup) {
				this.ctxMenuPopup.remove();
				this.ctxMenuPopup = null;
				return;
			}
			if (this.map?.queryRenderedFeatures(e.point, { layers: ['stat-points-layer'] }).length) return;
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
		this.logger.log('Map', '[applyDemoData] start');
		this.departments = departments;
		this.allTripsWithCoords = tripsWithCoords as TripWithCoords[];
		this.tripsWithCoords = this.allTripsWithCoords;
		this.streak.set(this.computeStreak());
		this.logger.log('Map', '[applyDemoData] trips set');
		this.updateAvailablePresets();
		this.logger.log('Map', '[applyDemoData] presets updated');
		this.cellsByResolution = cellsByResolution;
		this.tripCount.set(tripCount);
		this.totalKm.set(totalKm);
		this.hexagonCount.set(hexagonCount);
		this.updateExtraStats();
		const latestTripDate = this.allTripsWithCoords.reduce<Date>((latest, t) => {
			const d = new Date(t.startTime);
			return d > latest ? d : latest;
		}, new Date(0));
		// R7 en arrière-plan via worker — libère le main thread dès le load
		this.updateVisitedNeighboringCountries();
		this.h3
			.computeResolutionAsync(
				this.allTripsWithCoords.map((t) => ({ coords: t.coords, date: t.startTime.substring(0, 10) })),
				7,
			)
			.then((allR7) => this.computeNewCellsR7(allR7, latestTripDate));
		this.logger.log('Map', '[applyDemoData] countries done, seasons...');
		this.visitedSeasons.set(
			SEASONS.filter((s) =>
				this.allTripsWithCoords.some((t) => s.months.includes(new Date(t.startTime).getMonth() + 1)),
			) as Season[],
		);
		this.logger.log('Map', '[applyDemoData] addLayers...');
		this.addLayers();
		this.logger.log('Map', '[applyDemoData] initViewAfterLoad...');
		this.initViewAfterLoad();
		this.logger.log('Map', '[applyDemoData] done');
	}

	private getTripsChunked(trackerId: number, from: Date, to: Date, chunkDays = 30): Observable<MergedTrip[]> {
		const chunks: { from: Date; to: Date }[] = [];
		let cursor = new Date(from);
		while (cursor < to) {
			const end = new Date(cursor);
			end.setDate(end.getDate() + chunkDays);
			if (end > to) end.setTime(to.getTime());
			chunks.push({ from: new Date(cursor), to: new Date(end) });
			cursor = new Date(end);
			cursor.setMilliseconds(cursor.getMilliseconds() + 1);
		}
		if (!chunks.length) return of([]);
		const total = chunks.length;
		this.logger.log('Map', `getTripsChunked: ${total} chunks of ${chunkDays}d`);
		if (total > 1) this.loadingChunk.set({ current: 1, total });
		return concat(
			...chunks.map((c, i) =>
				defer(() => {
					if (total > 1) this.loadingChunk.set({ current: i + 1, total });
					return this.api.getTrips(trackerId, c.from, c.to);
				}),
			),
		).pipe(
			reduce((acc: MergedTrip[], trips) => [...acc, ...(trips as MergedTrip[])], []),
			tap(() => this.loadingChunk.set(null)),
		);
	}

	private readonly SHARE_COUNTRY_FILES: Record<string, string> = {
		FR: '/geojson/france.geojson',
		ES: '/geojson/spain.geojson',
		IT: '/geojson/italy.geojson',
		PT: '/geojson/portugal.geojson',
		BE: '/geojson/belgium.geojson',
		NL: '/geojson/netherlands.geojson',
		DE: '/geojson/germany.geojson',
		CH: '/geojson/switzerland.geojson',
		AT: '/geojson/austria.geojson',
		LI: '/geojson/liechtenstein.geojson',
		SI: '/geojson/slovenia.geojson',
		MA: '/geojson/morocco.geojson',
		GB: '/geojson/england.geojson',
		IE: '/geojson/ireland.geojson',
		IM: '/geojson/isle-of-man.geojson',
		SCO: '/geojson/scotland.geojson',
		WAL: '/geojson/wales.geojson',
		HR: '/geojson/croatia.geojson',
		DK: '/geojson/denmark.geojson',
		SE: '/geojson/sweden.geojson',
		NO: '/geojson/norway.geojson',
		CZ: '/geojson/czechia.geojson',
		HU: '/geojson/hungary.geojson',
		RO: '/geojson/romania.geojson',
		GR: '/geojson/greece.geojson',
		TN: '/geojson/tunisia.geojson',
		IS: '/geojson/iceland.geojson',
	};

	private applyShareData(): void {
		const encoded = this.route.snapshot.queryParamMap.get('d');
		if (!encoded) {
			this.error.set('Lien invalide');
			this.loading.set(false);
			return;
		}
		this.share
			.decode(encoded)
			.then((data) => {
				if (!data.ts || !Number.isFinite(data.ts)) {
					this.error.set('Lien invalide ou corrompu');
					this.loading.set(false);
					return;
				}
				const d = new Date(data.ts * 1000);
				if (isNaN(d.getTime())) {
					this.error.set('Lien invalide ou corrompu');
					this.loading.set(false);
					return;
				}
				this.shareDateLabel.set(
					d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
				);
				this.shareStats.set(data.stats ?? null);
				this.updateSharePageMeta(data.stats);
				if (data.mode === 'hex') {
					const countsMap: Record<string, number> = {};
					if (data.hex.compact) {
						// Étaler chaque cellule compacte en R7, en propageant son count aux enfants
						for (let i = 0; i < data.hex.cells.length; i++) {
							const count = data.hex.counts?.[i] ?? 1;
							for (const child of uncompactCells([data.hex.cells[i]], 7)) {
								countsMap[child] = count;
							}
						}
					} else {
						for (let i = 0; i < data.hex.cells.length; i++) {
							countsMap[data.hex.cells[i]] = data.hex.counts?.[i] ?? 1;
						}
					}
					this.applyShareHexData(Object.keys(countsMap), data.hex.res, countsMap);
				} else if (data.mode === 'dept') {
					this.applyShareDeptData(data.dept.depts);
				} else {
					this.applySharePolylineData(data.poly);
				}
			})
			.catch(() => {
				this.error.set('Lien invalide ou corrompu');
				this.loading.set(false);
			});
	}

	private applyShareHexData(cells: string[], res: 6 | 7, countsMap?: Record<string, number>): void {
		const counts: Record<string, number> = {};
		for (const cell of cells) counts[cell] = countsMap?.[cell] ?? 1;
		this.cellsByResolution = { [res]: { counts, cellToIndices: {} } };
		if (res === 7) {
			const counts6: Record<string, number> = {};
			for (const cell of cells) {
				const parent = cellToParent(cell, 6);
				counts6[parent] = Math.max(counts6[parent] ?? 0, counts[cell]);
			}
			this.cellsByResolution[6] = { counts: counts6, cellToIndices: {} };
		}
		this.hexagonCount.set(cells.length);
		this.tripCount.set(0);
		this.totalKm.set(0);
		this.allTripsWithCoords = [];
		this.tripsWithCoords = [];
		this.departments = null;
		this.enrichedDepts = null;

		this.addLayers();

		if (cells.length > 0) {
			const bounds = new maplibregl.LngLatBounds();
			for (const cell of cells) {
				const [lat, lng] = cellToLatLng(cell);
				bounds.extend([lng, lat]);
			}
			this.map!.fitBounds(bounds, { padding: 60, maxZoom: 12 });
		}
		const polylineMaxZoom = this.isMobile
			? this.mapSettings.polylineModeZoomThresholdMob()
			: this.mapSettings.polylineModeZoomThresholdDesk();
		this.map!.setMaxZoom(polylineMaxZoom - 0.01);
		this.hideShareLoading();
		this.loadDepartmentsForShareHex(cells);
	}

	private loadDepartmentsForShareHex(cells: string[]): void {
		const COUNTRY_BBOXES = [
			{ code: 'FR', minLat: 41.3, maxLat: 51.2, minLon: -5.2, maxLon: 9.6 },
			...NEIGHBORING_COUNTRIES.map((c) => ({
				code: c.code,
				minLat: c.minLat,
				maxLat: c.maxLat,
				minLon: c.minLon,
				maxLon: c.maxLon,
			})),
		];
		const needed = new Set<string>();
		for (const cell of cells) {
			const [lat, lng] = cellToLatLng(cell);
			for (const c of COUNTRY_BBOXES) {
				if (lat >= c.minLat && lat <= c.maxLat && lng >= c.minLon && lng <= c.maxLon) {
					needed.add(c.code);
				}
			}
		}
		const loaders = [...needed]
			.filter((code) => this.SHARE_COUNTRY_FILES[code])
			.map((code) =>
				this.http.get<GeoJSON.FeatureCollection>(this.SHARE_COUNTRY_FILES[code]).pipe(
					rxMap((fc) => ({
						...fc,
						features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, country: code } })),
					})),
					catchError(() => of({ type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] })),
				),
			);
		if (!loaders.length) return;
		forkJoin(loaders).subscribe((fcs) => {
			this.departments = { type: 'FeatureCollection', features: fcs.flatMap((fc) => fc.features) };
			if (this.map?.getSource('depts-outline')) {
				(this.map.getSource('depts-outline') as maplibregl.GeoJSONSource).setData(this.departments);
			}
			this.currentMode = null;
			this.currentResolution = null;
			this.updateView();
		});
	}

	private applyShareDeptData(depts: Array<[string, number, string]>): void {
		const pctMap: Record<string, number> = {};
		for (const [code, pct, country] of depts) pctMap[`${country}_${code}`] = pct;

		const countryCodes = [...new Set(depts.map(([, , c]) => c))];
		const loaders = countryCodes
			.filter((c) => this.SHARE_COUNTRY_FILES[c])
			.map((c) =>
				this.http.get<GeoJSON.FeatureCollection>(this.SHARE_COUNTRY_FILES[c]).pipe(
					rxMap((fc) => ({
						...fc,
						features: fc.features.map((f) => ({
							...f,
							properties: { ...f.properties, country: c },
						})),
					})),
					catchError(() => of({ type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] })),
				),
			);

		if (!loaders.length) {
			this.loading.set(false);
			return;
		}

		forkJoin(loaders).subscribe((fcs) => {
			const allFeatures = fcs.flatMap((fc) => fc.features);
			this.departments = { type: 'FeatureCollection', features: allFeatures };

			// Injecter pct directement — evite toute recomputation H3
			this.enrichedDepts = {
				type: 'FeatureCollection',
				features: allFeatures.map((f) => {
					// Estimer la taille du dept (proxy pour h3Total) via son bounding box
					const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
					const flat =
						geom.type === 'Polygon'
							? geom.coordinates[0]
							: (geom.coordinates as GeoJSON.Position[][][]).flat(2);
					let minLon = Infinity,
						maxLon = -Infinity,
						minLat = Infinity,
						maxLat = -Infinity;
					for (const [lon, lat] of flat as number[][]) {
						if (lon < minLon) minLon = lon;
						if (lon > maxLon) maxLon = lon;
						if (lat < minLat) minLat = lat;
						if (lat > maxLat) maxLat = lat;
					}
					const approxArea = (maxLon - minLon) * (maxLat - minLat);
					// Calibration : ~0.5° × 0.5° (petit dept) ≈ h3Total 10 ; ~2° × 2° (grand) ≈ h3Total 40
					const h3Total = Math.min(60, Math.max(5, Math.round(approxArea * 40)));
					return {
						...f,
						properties: {
							...f.properties,
							pct: pctMap[`${f.properties?.['country']}_${f.properties?.['code']}`] ?? 0,
							h3Total,
							h3Visited: 0,
							tripCount: 0,
						},
					};
				}),
			};

			// cellsByResolution vide mais non-null pour passer le check de addLayers()
			const res = this.mapSettings.deptResolution() as H3Resolution;
			this.cellsByResolution = { [res]: { counts: {}, cellToIndices: {} } };
			this.hexagonCount.set(0);
			this.tripCount.set(0);
			this.totalKm.set(0);
			this.allTripsWithCoords = [];
			this.tripsWithCoords = [];

			this.addLayers();
			this.currentMode = null;
			this.currentResolution = null;
			this.updateView();

			const visitedFeatures = allFeatures.filter(
				(f) => (pctMap[`${f.properties?.['country']}_${f.properties?.['code']}`] ?? 0) > 0,
			);
			if (visitedFeatures.length > 0) {
				const bounds = new maplibregl.LngLatBounds();
				for (const f of visitedFeatures) {
					const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
					const allCoords: GeoJSON.Position[] =
						geom.type === 'Polygon'
							? geom.coordinates[0]
							: (geom.coordinates as GeoJSON.Position[][][]).flat(2);
					for (const [lng, lat] of allCoords) bounds.extend([lng, lat]);
				}
				this.map!.fitBounds(bounds, { padding: 40, maxZoom: 7.5, animate: false });
			}
			// Bloquer le zoom au seuil dept pour éviter le passage en mode hex (sans données hex)
			const deptMaxZoom = this.isMobile
				? this.mapSettings.deptModeZoomThresholdMob()
				: this.mapSettings.deptModeZoomThresholdDesk();
			this.map!.setMaxZoom(deptMaxZoom);
			this.hideShareLoading();
		});
	}

	private applySharePolylineData(poly: SharePolylinePayload): void {
		// Décoder les hexagones si présents
		let hexCells: string[] = [];
		let hexCountsMap: Record<string, number> = {};
		if (poly.hex) {
			const rawCells = poly.hex.compact ? uncompactCells(poly.hex.cells, 7) : poly.hex.cells;
			for (let i = 0; i < rawCells.length; i++) {
				hexCountsMap[rawCells[i]] = poly.hex.counts?.[i] ?? 1;
			}
			hexCells = rawCells;
		}

		if (hexCells.length > 0) {
			// Réutiliser applyShareHexData pour les hexagones, puis ajouter la ligne par-dessus
			this.applyShareHexData(hexCells, 7, hexCountsMap);
			// La ligne sera ajoutée après que les layers hex soient prêts
			this.map!.once('idle', () => this.addShareTripLine(poly));
		} else {
			// Pas d'hexagones : init minimal + ligne seule
			this.cellsByResolution = { [6 as H3Resolution]: { counts: {}, cellToIndices: {} } };
			this.allTripsWithCoords = [];
			this.tripsWithCoords = [];
			this.tripCount.set(0);
			this.totalKm.set(0);
			this.departments = null;
			this.enrichedDepts = null;
			this.addLayers();
			this.map!.once('idle', () => {
				this.addShareTripLine(poly);
				this.hideShareLoading();
			});
		}
	}

	private addShareTripLine(poly: SharePolylinePayload): void {
		const coords = poly.coords;
		const coordinates = coords.map(([lat, lon]) => [lon, lat]);
		const geojson: GeoJSON.FeatureCollection = {
			type: 'FeatureCollection',
			features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }],
		};
		if (!this.map!.getSource('share-trip')) {
			this.map!.addSource('share-trip', { type: 'geojson', data: geojson });
			this.map!.addLayer({
				id: 'share-trip-line',
				type: 'line',
				source: 'share-trip',
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': '#fdb300', 'line-width': 3, 'line-opacity': 0.9 },
			});
		}
		// Empêcher de dézoomer jusqu'en mode départements (pas de données dept pour un trajet)
		this.map!.setMinZoom(this.deptThreshold + 0.01);
		if (coordinates.length > 0) {
			const bounds = new maplibregl.LngLatBounds();
			for (const c of coordinates) bounds.extend(c as [number, number]);
			this.map!.fitBounds(bounds, {
				padding: { top: 60, right: 60, bottom: 240, left: 60 },
				maxZoom: 14,
				animate: false,
			});
		}
		const first = coords[0] ?? [0, 0];
		const last = coords[coords.length - 1] ?? [0, 0];
		const syntheticTrip: TripWithCoords = {
			id: 0,
			trackerId: 0,
			indexId: 'share',
			distance: poly.dist ?? 0,
			duration: (poly.dur ?? 0) * 1000,
			averageSpeed: poly.avgSpd ?? 0,
			maxSpeed: poly.maxSpd ?? 0,
			startTime: poly.startTime ?? '',
			endTime: poly.endTime ?? '',
			startLat: first[0],
			startLon: first[1],
			endLat: last[0],
			endLon: last[1],
			startAddress: poly.startAddr ?? '',
			niceStartAddress: null,
			endAddress: poly.title ?? '',
			niceEndAddress: null,
			staticImage: '',
			maxAngle: poly.maxAngle ?? 0,
			maxLeftAngle: poly.maxLeftAngle ?? null,
			maxRightAngle: poly.maxRightAngle ?? null,
			averageAngle: null,
			isFavorite: false,
			coords,
		};
		this.selectedTripForPanel.set(syntheticTrip);
		this.selectedTripPositions.set([]);
		this.precomputedTripStats.set(poly.computed ?? null);
		this.showTripPanel.set(true);
	}

	private hideShareLoading(): void {
		this.map!.once('idle', () => {
			this.loadingHiding.set(true);
			setTimeout(() => {
				this.loading.set(false);
				this.loadingHiding.set(false);
			}, 400);
		});
	}

	private updateSharePageMeta(stats: ShareStats | undefined): void {
		const km = stats?.k ?? 0;
		const trips = stats?.t ?? 0;
		const kmLabel = km >= 1000 ? `${(km / 1000).toFixed(1).replace('.', ',')} k` : String(km);
		const title =
			trips > 0 ? `${trips} trajet${trips > 1 ? 's' : ''} · ${kmLabel} km — GeoRide` : 'GeoRide Scratch Map';
		document.title = title;
		const setMeta = (property: string, content: string) => {
			let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
			if (!el) {
				el = document.createElement('meta');
				el.setAttribute('property', property);
				document.head.appendChild(el);
			}
			el.setAttribute('content', content);
		};
		setMeta('og:title', title);
		setMeta(
			'og:description',
			trips > 0
				? `${trips} trajet${trips > 1 ? 's' : ''} pour ${kmLabel} km parcourus`
				: 'Carte de trajets GeoRide',
		);
		setMeta('og:url', window.location.href);
		setMeta('og:type', 'website');
	}

	private loadData(): void {
		this.logger.log('Map', 'loadData called');

		if (this.isShare) {
			this.applyShareData();
			return;
		}

		if (this.isDemo) {
			let demoInitDone = false;
			this.demo.load().subscribe({
				next: (data) => {
					if (!demoInitDone) {
						demoInitDone = true;
						this.applyDemoData(data);
					} else {
						// 2ème émission : mettre à jour les départements avec tous les pays
						this.logger.log(
							'Map',
							`[demo] all countries loaded: ${data.departments.features.length} depts`,
						);
						this.departments = data.departments;
						this.enrichedDepts = null;
						this.h3.invalidateEnrichedCache(); // invalide le cache H3 créé avec seulement la France
						if (this.map?.getSource('depts-outline')) {
							(this.map.getSource('depts-outline') as maplibregl.GeoJSONSource).setData(data.departments);
						}
						this.updateVisitedNeighboringCountries();
						this.currentMode = null;
						this.updateView();
					}
				},
				error: () => {
					this.error.set('Impossible de charger les départements');
					this.loading.set(false);
				},
			});
			return;
		}

		const COUNTRY_FILES = [
			{ country: 'FR', file: '/geojson/france.geojson', minLat: 41.3, maxLat: 51.2, minLon: -5.2, maxLon: 9.6 },
			{ country: 'ES', file: '/geojson/spain.geojson', minLat: 27.6, maxLat: 43.8, minLon: -18.2, maxLon: 4.4 },
			{ country: 'IT', file: '/geojson/italy.geojson', minLat: 35.5, maxLat: 47.1, minLon: 6.6, maxLon: 18.5 },
			{
				country: 'PT',
				file: '/geojson/portugal.geojson',
				minLat: 29.0,
				maxLat: 42.2,
				minLon: -31.5,
				maxLon: -6.2,
			},
			{ country: 'BE', file: '/geojson/belgium.geojson', minLat: 49.5, maxLat: 51.5, minLon: 2.5, maxLon: 6.4 },
			{
				country: 'NL',
				file: '/geojson/netherlands.geojson',
				minLat: 50.7,
				maxLat: 53.7,
				minLon: 3.3,
				maxLon: 7.3,
			},
			{ country: 'DE', file: '/geojson/germany.geojson', minLat: 47.3, maxLat: 55.1, minLon: 5.9, maxLon: 15.0 },
			{
				country: 'CH',
				file: '/geojson/switzerland.geojson',
				minLat: 45.8,
				maxLat: 47.9,
				minLon: 5.9,
				maxLon: 10.5,
			},
			{
				country: 'LI',
				file: '/geojson/liechtenstein.geojson',
				minLat: 47.0,
				maxLat: 47.3,
				minLon: 9.4,
				maxLon: 9.7,
			},
			{ country: 'AT', file: '/geojson/austria.geojson', minLat: 46.4, maxLat: 49.0, minLon: 9.5, maxLon: 17.2 },
			{
				country: 'SI',
				file: '/geojson/slovenia.geojson',
				minLat: 45.4,
				maxLat: 46.9,
				minLon: 13.4,
				maxLon: 16.6,
			},
			{
				country: 'MA',
				file: '/geojson/morocco.geojson',
				minLat: 21.4,
				maxLat: 36.0,
				minLon: -17.1,
				maxLon: -1.0,
			},
			{ country: 'GB', file: '/geojson/england.geojson', minLat: 49.9, maxLat: 55.8, minLon: -5.7, maxLon: 1.8 },
			{
				country: 'IE',
				file: '/geojson/ireland.geojson',
				minLat: 51.4,
				maxLat: 55.4,
				minLon: -10.5,
				maxLon: -5.9,
			},
			{
				country: 'IM',
				file: '/geojson/isle-of-man.geojson',
				minLat: 54.0,
				maxLat: 54.5,
				minLon: -4.85,
				maxLon: -4.3,
			},
			{
				country: 'SCO',
				file: '/geojson/scotland.geojson',
				minLat: 54.6,
				maxLat: 60.9,
				minLon: -7.6,
				maxLon: -0.7,
			},
			{ country: 'WAL', file: '/geojson/wales.geojson', minLat: 51.3, maxLat: 53.5, minLon: -5.3, maxLon: -2.6 },
			{ country: 'HR', file: '/geojson/croatia.geojson', minLat: 42.4, maxLat: 46.6, minLon: 13.5, maxLon: 19.5 },
			{ country: 'DK', file: '/geojson/denmark.geojson', minLat: 54.5, maxLat: 57.8, minLon: 8.0, maxLon: 15.2 },
			{ country: 'SE', file: '/geojson/sweden.geojson', minLat: 55.3, maxLat: 69.1, minLon: 10.9, maxLon: 24.2 },
			{ country: 'NO', file: '/geojson/norway.geojson', minLat: 57.9, maxLat: 71.2, minLon: 4.5, maxLon: 31.1 },
			{ country: 'CZ', file: '/geojson/czechia.geojson', minLat: 48.5, maxLat: 51.1, minLon: 12.1, maxLon: 18.9 },
			{ country: 'HU', file: '/geojson/hungary.geojson', minLat: 45.7, maxLat: 48.6, minLon: 16.1, maxLon: 22.9 },
			{ country: 'RO', file: '/geojson/romania.geojson', minLat: 43.6, maxLat: 48.3, minLon: 20.3, maxLon: 29.7 },
			{ country: 'GR', file: '/geojson/greece.geojson', minLat: 34.8, maxLat: 41.8, minLon: 19.5, maxLon: 28.3 },
			{ country: 'TN', file: '/geojson/tunisia.geojson', minLat: 30.2, maxLat: 37.5, minLon: 7.5, maxLon: 11.6 },
			{
				country: 'IS',
				file: '/geojson/iceland.geojson',
				minLat: 63.3,
				maxLat: 66.6,
				minLon: -24.5,
				maxLon: -13.5,
			},
		];

		forkJoin([
			this.db.getAllTrips(),
			this.db.kvGet<number>('lastSyncAt'),
			this.db.kvGet<number>('lastClearedTs'),
			this.db.kvGet<number>('recapDismissedTs'),
		])
			.pipe(
				switchMap(([localTrips, lastSyncAt, lastClearedTs, recapDismissedTs]) => {
					this.lastClearedTs = lastClearedTs ?? 0;
					this.recapDismissedTs = recapDismissedTs ?? 0;
					const ONE_HOUR = 60 * 60 * 1000;
					if (lastSyncAt !== null && localTrips.length > 0 && Date.now() - lastSyncAt < ONE_HOUR) {
						return of(localTrips);
					}

					const to = new Date();
					to.setHours(23, 59, 59, 999);

					const from =
						lastSyncAt !== null && localTrips.length > 0
							? new Date(lastSyncAt - 24 * 60 * 60 * 1000)
							: null;

					return this.api.getTrackers().pipe(
						switchMap((trackers) => {
							this.logger.log('Map', `got ${trackers.length} tracker(s), syncing delta`);
							return forkJoin(
								trackers.map((t) =>
									this.getTripsChunked(t.trackerId, from ?? new Date(t.activationDate), to),
								),
							).pipe(
								rxMap((tripArrays) => {
									const flat = tripArrays.flat().flatMap((t) => {
										const merged = t as MergedTrip;
										if (!merged.tripsMerged?.length) return [t];
										const subs = merged.tripsMerged.map((sub) => ({
											...sub,
											isFavorite: t.isFavorite,
										}));
										return subs.length > 0 ? subs : [{ ...t }];
									});
									// indexId = clé stable unique indépendante de l'id API (qui peut être null)
									const withIndexId: StoredTrip[] = flat.map((t) => ({
										...t,
										indexId: `${t.trackerId}_${t.startTime}`,
									}));
									return { localTrips, newTrips: withIndexId };
								}),
							);
						}),
						switchMap(({ localTrips, newTrips }) => {
							const positionsByIndexId: Record<string, GeoRidePosition[]> = {};
							for (const t of localTrips) {
								if (t.positions?.length) positionsByIndexId[t.indexId] = t.positions;
							}
							const newIndexIds = new Set(newTrips.map((t) => t.indexId));
							const mergedNew = newTrips.map((t) =>
								positionsByIndexId[t.indexId] ? { ...t, positions: positionsByIndexId[t.indexId] } : t,
							);
							const merged = [...localTrips.filter((t) => !newIndexIds.has(t.indexId)), ...mergedNew];
							return forkJoin([
								this.db.upsertTrips(newTrips),
								this.db.kvSet('lastSyncAt', Date.now()),
							]).pipe(rxMap(() => merged));
						}),
					);
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
					const hasLuxembourg = allTrips.some(
						(t) =>
							(t.startLat >= 49.4 && t.startLat <= 50.2 && t.startLon >= 5.7 && t.startLon <= 6.5) ||
							(t.endLat >= 49.4 && t.endLat <= 50.2 && t.endLon >= 5.7 && t.endLon <= 6.5),
					);
					const inlineFeatures = [
						...(hasAndorra ? [ANDORRA_FEATURE] : []),
						...(hasLuxembourg ? LUXEMBOURG_FEATURES.features : []),
					];
					const log = [
						...needed.map((c) => c.country),
						...(hasAndorra ? ['AD'] : []),
						...(hasLuxembourg ? ['LU'] : []),
					];
					this.logger.log('Map', `loading GeoJSON for: ${log.join(', ') || 'none'}`);
					if (needed.length === 0)
						return of({
							allTrips,
							departments:
								inlineFeatures.length > 0
									? { type: 'FeatureCollection' as const, features: inlineFeatures }
									: null,
							remainingCountries: [] as typeof needed,
						});

					// Phase 1 : pays du dernier trajet en premier, reste en phase 2
					const lastTrip = [...allTrips].sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
					const primaryFile = lastTrip
						? (needed.find(
								(c) =>
									inBounds(lastTrip.startLat, lastTrip.startLon, c) ||
									inBounds(lastTrip.endLat, lastTrip.endLon, c),
							) ?? needed[0])
						: needed[0];
					const remainingFiles = needed.filter((c) => c !== primaryFile);
					this.logger.log(
						'Map',
						`primary country: ${primaryFile.country}, remaining: ${remainingFiles.length}`,
					);

					const loadFc = (c: (typeof needed)[number]) =>
						this.http.get<GeoJSON.FeatureCollection>(c.file).pipe(
							rxMap((fc) => ({
								...fc,
								features: fc.features.map((f) => ({
									...f,
									properties: { ...f.properties, country: c.country },
								})),
							})),
						);

					return loadFc(primaryFile).pipe(
						rxMap((primaryFc) => ({
							allTrips,
							departments: {
								type: 'FeatureCollection' as const,
								features: [...primaryFc.features, ...inlineFeatures],
							} as GeoJSON.FeatureCollection,
							remainingCountries: remainingFiles,
						})),
						catchError(() => {
							this.logger.warn('Map', 'regions not found, dept mode disabled');
							return of({ allTrips, departments: null, remainingCountries: [] as typeof needed });
						}),
					);
				}),
			)
			.subscribe({
				next: async ({ allTrips, departments, remainingCountries }) => {
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
					this.streak.set(this.computeStreak());
					this.updateVisitedNeighboringCountries();
					this.visitedSeasons.set(
						SEASONS.filter((s) =>
							this.allTripsWithCoords.some((t) =>
								s.months.includes(new Date(t.startTime).getMonth() + 1),
							),
						) as Season[],
					);
					this.updateAvailablePresets();

					this.logger.log('Map', `computing H3 cells for resolution 6`);
					const tripData = this.tripsWithCoords.map((t) => ({
						coords: t.coords,
						date: t.startTime.substring(0, 10),
					}));
					const res = this.mapSettings.deptResolution() as H3Resolution;
					this.cellsByResolution[res] = await this.h3.computeResolutionAsync(tripData, res);
					this.logger.log(
						'Map',
						`resolution ${res}: ${Object.keys(this.cellsByResolution[res].counts).length} cells`,
					);

					this.hexagonCount.set(
						Object.keys(
							this.cellsByResolution[this.mapSettings.deptResolution() as H3Resolution]?.counts ?? {},
						).length,
					);
					this.updateExtraStats();

					this.addLayers();
					this.initViewAfterLoad();

					this.h3
						.computeResolutionAsync(
							this.allTripsWithCoords.map((t) => ({
								coords: t.coords,
								date: t.startTime.substring(0, 10),
							})),
							7,
						)
						.then((allR7) => this.computeNewCellsR7(allR7));

					// Phase 2 : charger les pays restants après que la carte est visible
					if (remainingCountries?.length) {
						forkJoin(
							remainingCountries.map((c) =>
								this.http.get<GeoJSON.FeatureCollection>(c.file).pipe(
									rxMap((fc) => ({
										...fc,
										features: fc.features.map((f) => ({
											...f,
											properties: { ...f.properties, country: c.country },
										})),
									})),
									catchError(() =>
										of({ type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] }),
									),
								),
							),
						).subscribe((remainingFcs) => {
							const allFeatures = [
								...(this.departments?.features ?? []),
								...remainingFcs.flatMap((fc) => fc.features),
							];
							this.departments = { type: 'FeatureCollection', features: allFeatures };
							this.enrichedDepts = null;
							this.h3.invalidateEnrichedCache();
							if (this.map?.getSource('depts-outline')) {
								(this.map.getSource('depts-outline') as maplibregl.GeoJSONSource).setData(
									this.departments,
								);
							}
							this.updateVisitedNeighboringCountries();
							this.currentMode = null;
							this.updateView();
							this.logger.log('Map', `all countries loaded: ${allFeatures.length} depts`);
						});
					}

					// Si les positions ont déjà été chargées (timestamp en IDB),
					// recharger silencieusement en arrière-plan + invalider les caches de modes
					this.db.kvGet<number>('positions_sync_ts').subscribe((ts) => {
						if (ts === null) return;
						this.tripAltProfiles = {};
						this.colsCellCache = {};
						this.turnsCellCache = {};
						this.speedCellCache = {};
						this.speedCellStatsCache = {};
						this.tripSegmentsCache = {};
						this.syncTripAltitudes().subscribe({
							next: (profiles) => {
								this.tripAltProfiles = profiles;
							},
							error: () => {},
						});
					});
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
		if (!this.map.getSource('depts-outline')) {
			this.map.addSource('depts-outline', {
				type: 'geojson',
				data: this.departments ?? { type: 'FeatureCollection', features: [] },
			});
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
				if (this.isShare) return;
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

		// --- Cols altitude overlay ---
		if (!this.map.getSource('cols-heatmap')) {
			this.map.addSource('cols-heatmap', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'cols-fill',
				type: 'fill',
				source: 'cols-heatmap',
				paint: {
					'fill-color': [
						'interpolate',
						['linear'],
						['get', 'count'],
						0,
						'#c5cae9',
						600,
						'#5c6bc0',
						1400,
						'#283593',
						2500,
						'#7b1fa2',
					],
					'fill-opacity': [
						'interpolate',
						['linear'],
						['get', 'count'],
						0,
						0,
						150,
						0.15,
						600,
						0.5,
						1400,
						0.75,
						2500,
						0.92,
					],
				},
				layout: { visibility: 'none' },
			});
			this.map.on('mousemove', 'cols-fill', (e) => {
				const alt = e.features?.[0]?.properties?.['count'] as number | undefined;
				this.hexHoverAlt.set(alt !== undefined ? Math.round(alt) : null);
			});
			this.map.on('mouseleave', 'cols-fill', () => {
				this.hexHoverAlt.set(null);
			});
			if (this.colsMode()) this.showCols();
		}

		// --- Turns overlay ---
		if (!this.map.getSource('turns-heatmap')) {
			this.map.addSource('turns-heatmap', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'turns-fill',
				type: 'fill',
				source: 'turns-heatmap',
				paint: {
					'fill-color': [
						'interpolate',
						['linear'],
						['get', 'count'],
						0,
						'#f48fb1',
						5,
						'#e91e63',
						15,
						'#880e4f',
						30,
						'#4a0018',
					],
					'fill-opacity': [
						'interpolate',
						['linear'],
						['get', 'count'],
						0,
						0,
						1,
						0.1,
						5,
						0.3,
						15,
						0.5,
						30,
						0.65,
					],
				},
				layout: { visibility: 'none' },
			});
			this.map.on('mousemove', 'turns-fill', (e) => {
				const count = e.features?.[0]?.properties?.['count'] as number | undefined;
				this.hexHoverTurns.set(count !== undefined ? Math.round(count) : null);
			});
			this.map.on('mouseleave', 'turns-fill', () => this.hexHoverTurns.set(null));
			if (this.turnsMode()) this.showTurns();
		}

		// --- Speed overlay ---
		if (!this.map.getSource('speed-heatmap')) {
			this.map.addSource('speed-heatmap', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'speed-fill',
				type: 'fill',
				source: 'speed-heatmap',
				paint: {
					'fill-color': '#2e7d32',
					'fill-opacity': [
						'step',
						['get', 'count'],
						0,
						43,
						0.2,
						70,
						0.4,
						76,
						0.55,
						81,
						0.7,
						86,
						0.9,
					] as maplibregl.DataDrivenPropertyValueSpecification<number>,
				},
				layout: { visibility: 'none' },
			});
			this.map.on('mousemove', 'speed-fill', (e) => {
				const cell = e.features?.[0]?.properties?.['cell'] as string | undefined;
				const res = this.currentResolution;
				const stats = cell && res ? this.speedCellStatsCache[res]?.[cell] : undefined;
				this.hexHoverSpeedAvg.set(stats?.avg ?? null);
				this.hexHoverSpeedMax.set(stats?.max ?? null);
			});
			this.map.on('mouseleave', 'speed-fill', () => {
				this.hexHoverSpeedAvg.set(null);
				this.hexHoverSpeedMax.set(null);
			});
			if (this.speedMode()) this.showSpeed();
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

		// --- All-trips enriched segments (colored by mode) ---
		if (!this.map.getSource('all-trips-segments')) {
			this.map.addSource('all-trips-segments', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'all-trips-segments-layer',
				type: 'line',
				source: 'all-trips-segments',
				paint: {
					'line-color': this.segmentColorExpression(),
					'line-width': 2,
					'line-opacity': 0.85,
				},
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

		// --- Enriched trip segments (colored by altitude/speed/angle) ---
		if (!this.map.getSource('trip-line-segments')) {
			this.map.addSource('trip-line-segments', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'trip-line-segments-layer',
				type: 'line',
				source: 'trip-line-segments',
				paint: {
					'line-color': this.segmentColorExpression(),
					'line-width': 3,
					'line-opacity': 0.9,
				},
				layout: { visibility: 'none' },
			});
			if (this.selectedTrip) this.showTripSegments(this.selectedTrip);
		}

		// --- Hover position marker (au-dessus des segments) ---
		if (!this.map.getSource('hover-position')) {
			this.map.addSource('hover-position', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'hover-position-layer',
				type: 'circle',
				source: 'hover-position',
				paint: {
					'circle-radius': 7,
					'circle-color': '#fdb300',
					'circle-stroke-width': 0,
				},
			});
		}

		// --- Segment ville sélectionnée ---
		if (!this.map.getSource('city-segment')) {
			this.map.addSource('city-segment', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'city-segment-line',
				type: 'line',
				source: 'city-segment',
				paint: {
					'line-color': '#e09000',
					'line-width': 4,
					'line-opacity': 0.9,
				},
			});
		}

		// --- Hexagone sélectionné (bordure) ---
		if (!this.map.getSource('selected-hex')) {
			this.map.addSource('selected-hex', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'selected-hex-line',
				type: 'line',
				source: 'selected-hex',
				paint: {
					'line-color': '#f5a800',
					'line-width': 2,
					'line-opacity': 0.85,
				},
			});
		}

		// --- Stat highlight points ---
		if (!this.map.getSource('stat-points')) {
			this.map.addSource('stat-points', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'stat-points-layer',
				type: 'circle',
				source: 'stat-points',
				paint: {
					'circle-radius': 5,
					'circle-color': '#fff',
					'circle-stroke-color': '#fdb300',
					'circle-stroke-width': 2,
				},
			});
			this.map.on('click', 'stat-points-layer', (e) => {
				e.originalEvent.preventDefault();
				e.originalEvent.stopPropagation();
				const coords = (e.features?.[0]?.geometry as GeoJSON.Point)?.coordinates;
				if (!coords) return;
				const [lon, lat] = coords;
				// Identifier si c'est un dot de pause et lequel
				const pauseIdx = this.pauseChipsData.findIndex(
					(p) => Math.abs(p.lat - lat) < 0.0001 && Math.abs(p.lon - lon) < 0.0001,
				);
				if (pauseIdx >= 0) this.clickedPauseIdx.set(pauseIdx);
				this.map!.easeTo({ center: [lon, lat], zoom: 15, duration: 1000 });
			});
			this.map.on('mouseenter', 'stat-points-layer', () => {
				if (this.map) this.map.getCanvas().style.cursor = 'pointer';
			});
			this.map.on('mouseleave', 'stat-points-layer', () => {
				if (this.map) this.map.getCanvas().style.cursor = '';
			});
		}

		// --- Pause chips (labels au dessus des dots de pause) ---
		if (!this.map.getSource('pause-chips')) {
			this.map.addSource('pause-chips', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			this.map.addLayer({
				id: 'pause-chips-layer',
				type: 'symbol',
				source: 'pause-chips',
				layout: {
					'text-field': ['get', 'label'],
					'text-size': 11,
					'text-font': ['Noto Sans Regular'],
					'text-offset': [0, -1.8],
					'text-anchor': 'bottom',
				},
				paint: {
					'text-color': '#000000',
					'text-halo-width': 0,
				},
			});
		}

		// --- Stops circles (au-dessus des polylines) ---
		if (!this.map.getSource('stops')) {
			this.map.addSource('stops', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
				cluster: true,
				clusterMaxZoom: 13,
				clusterRadius: 18,
			});
			// Clusters
			this.map.addLayer({
				id: 'stops-cluster',
				type: 'circle',
				source: 'stops',
				filter: ['has', 'point_count'],
				paint: {
					'circle-radius': [
						'step',
						['get', 'point_count'],
						10,
						5,
						14,
						20,
						18,
					] as maplibregl.DataDrivenPropertyValueSpecification<number>,
					'circle-color': '#283593',
					'circle-stroke-width': 0,
					'circle-opacity': 0.85,
				},
				layout: { visibility: 'none' },
			});
			// Points individuels — grossissent quand on dézoom
			this.map.addLayer({
				id: 'stops-circle',
				type: 'circle',
				source: 'stops',
				filter: ['!', ['has', 'point_count']],
				paint: {
					'circle-radius': [
						'interpolate',
						['linear'],
						['zoom'],
						4,
						10,
						8,
						6,
						14,
						5,
					] as maplibregl.DataDrivenPropertyValueSpecification<number>,
					'circle-color': [
						'interpolate',
						['linear'],
						['get', 'count'],
						1,
						'#5c6bc0',
						5,
						'#3949ab',
						10,
						'#283593',
					] as maplibregl.DataDrivenPropertyValueSpecification<string>,
					'circle-stroke-width': 0,
					'circle-opacity': 0.9,
				},
				layout: { visibility: 'none' },
			});
			this.map.on('click', 'stops-circle', (e) => {
				const f = e.features?.[0];
				if (!f) return;
				const { count, lastDate, address } = f.properties as {
					count: number;
					lastDate: string;
					address: string;
				};
				const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
				this.openStopPopup({ count, lastDate, address, coordinates: coords });
			});
			this.map.on('mouseenter', 'stops-circle', () => {
				this.map!.getCanvas().style.cursor = 'pointer';
			});
			this.map.on('mouseleave', 'stops-circle', () => {
				this.map!.getCanvas().style.cursor = '';
			});
			this.map.on('click', 'stops-cluster', (e) => {
				const f = e.features?.[0];
				if (!f) return;
				const clusterId = f.properties?.['cluster_id'] as number;
				const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
				(this.map!.getSource('stops') as maplibregl.GeoJSONSource)
					.getClusterExpansionZoom(clusterId)
					.then((zoom) => this.map!.easeTo({ center: coords, zoom: Math.max(zoom, 14) }))
					.catch(() => {});
			});
			this.map.on('mouseenter', 'stops-cluster', () => {
				this.map!.getCanvas().style.cursor = 'pointer';
			});
			this.map.on('mouseleave', 'stops-cluster', () => {
				this.map!.getCanvas().style.cursor = '';
			});
			if (this.stopsMode()) this.showStops();
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
		const modeFromZoom: Mode =
			this.newTripIndicesForPolyline && zoom > this.deptThreshold
				? 'polyline'
				: zoom <= this.deptThreshold && !this.selectedTripCoords
					? 'dept'
					: zoom >= polylineThreshold && !this.selectedTripCoords
						? 'polyline'
						: 'hex';
		const shareModeOverride = this.shareMode();
		const mode: Mode = this.shareIsOpen
			? shareModeOverride === 'trip'
				? 'hex' // trajet : forcer hex même si zoom > seuil polyline
				: shareModeOverride === 'dept' || shareModeOverride === 'hex'
					? modeFromZoom !== 'polyline'
						? shareModeOverride
						: modeFromZoom
					: modeFromZoom
			: modeFromZoom;
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

			if (mode === 'dept') this.clearTripLine(true);

			for (const id of ['overlay-fill', 'heatmap-fill']) {
				if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', hexVisible);
			}
			const lineVisible: 'visible' | 'none' =
				mode === 'hex' || mode === 'polyline' || mode === 'dept' ? 'visible' : 'none';
			if (this.map.getLayer('depts-line')) this.map.setLayoutProperty('depts-line', 'visibility', lineVisible);
			const deptsOutlineSource = this.map.getSource('depts-outline') as maplibregl.GeoJSONSource | undefined;
			if (deptsOutlineSource) {
				if (mode === 'dept' && this.enrichedDepts) {
					const visitedCountries = new Set<string>();
					for (const f of this.enrichedDepts.features) {
						if ((f.properties?.['pct'] ?? 0) > 0) {
							visitedCountries.add((f.properties?.['country'] as string | undefined) ?? 'FR');
						}
					}
					deptsOutlineSource.setData({
						type: 'FeatureCollection',
						features: this.enrichedDepts.features.filter((f) =>
							visitedCountries.has((f.properties?.['country'] as string | undefined) ?? 'FR'),
						),
					});
				} else if (mode !== 'dept' && this.departments) {
					deptsOutlineSource.setData(this.departments);
				}
			}
			for (const id of ['depts-overlay-fill', 'depts-fill', 'depts-hover', 'depts-labels']) {
				if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', deptVisible);
			}
			const analysisMode = this.colsMode() || this.turnsMode() || this.speedMode();
			if (this.map.getLayer('all-trips-line')) {
				this.map.setLayoutProperty(
					'all-trips-line',
					'visibility',
					mode === 'polyline' && !analysisMode ? 'visible' : 'none',
				);
			}
			if (this.map.getLayer('all-trips-segments-layer')) {
				if (mode === 'polyline' && analysisMode) {
					(this.map.getSource('all-trips-segments') as maplibregl.GeoJSONSource).setData(
						this.buildAllTripsSegments(),
					);
					this.map.setPaintProperty('all-trips-segments-layer', 'line-color', this.segmentColorExpression());
					this.map.setPaintProperty(
						'all-trips-segments-layer',
						'line-opacity',
						this.segmentOpacityExpression(),
					);
					this.map.setPaintProperty('all-trips-segments-layer', 'line-width', 3);
					this.map.setLayoutProperty('all-trips-segments-layer', 'visibility', 'visible');
					// Garde aussi all-trips-line comme base dorée
					this.map.setLayoutProperty('all-trips-line', 'visibility', 'visible');
				} else {
					this.map.setLayoutProperty('all-trips-segments-layer', 'visibility', 'none');
				}
			}

			// Ne fermer la popup qu'en mode département (les hex restent visibles en mode polyline)
			if (mode === 'dept') this.popup?.remove();
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

		if (this.colsMode() && this.map.getLayer('cols-fill')) {
			if (mode === 'dept') {
				this.map.setLayoutProperty('cols-fill', 'visibility', 'none');
			} else {
				this.showCols();
			}
		}
		if (this.turnsMode() && this.map.getLayer('turns-fill')) {
			if (mode === 'dept') {
				this.map.setLayoutProperty('turns-fill', 'visibility', 'none');
			} else {
				this.showTurns();
			}
		}
		if (this.speedMode() && this.map.getLayer('speed-fill')) {
			if (mode === 'dept') {
				this.map.setLayoutProperty('speed-fill', 'visibility', 'none');
			} else {
				this.showSpeed();
			}
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
			this.updateFullRegionCount();
		}

		const visitedDepts: GeoJSON.FeatureCollection = {
			type: 'FeatureCollection',
			features: this.enrichedDepts.features.filter((f) => (f.properties?.['pct'] ?? 0) > 0),
		};
		const overlayData = this.h3.departmentsToWorldOverlay(visitedDepts);

		// Label points — sorted by h3Total desc so larger regions win collision detection
		const labelData: GeoJSON.FeatureCollection<GeoJSON.Point> = {
			type: 'FeatureCollection',
			features: [...visitedDepts.features]
				.sort((a, b) => (b.properties?.['h3Total'] ?? 0) - (a.properties?.['h3Total'] ?? 0))
				.map((f) => ({
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
				paint: { 'fill-color': '#fdb300', 'fill-opacity': 0.55, 'fill-antialias': false },
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
					'fill-antialias': false,
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
					'text-allow-overlap': false,
					'text-ignore-placement': false,
					'text-padding': 8,
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
		if (this.isShare) return;
		if (e.originalEvent.defaultPrevented) return;
		if ((e.originalEvent.target as HTMLElement)?.closest?.('.maplibregl-popup')) return;
		// Ne pas traiter si l'utilisateur a cliqué sur un stat-point (pause, max vitesse…)
		if (this.map?.queryRenderedFeatures(e.point, { layers: ['stat-points-layer'] }).length) return;
		if (this.stopPopup) {
			this.stopPopup.remove();
			return;
		}
		if ((this.map?.getZoom() ?? 0) > 17) return;
		if (
			this.stopsMode() &&
			this.map?.queryRenderedFeatures(e.point, { layers: ['stops-circle', 'stops-cluster'] }).length
		)
			return;
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
		this.logger.log(
			'Hex',
			cell,
			sorted.map((t) => ({
				indexId: t.indexId,
				startTime: t.startTime,
				distance: t.distance,
				positions: t.positions?.length ?? 0,
			})),
		);
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

		const cellRes = getResolution(cell);
		const stopsData = this.stopPointsCache ?? this.computeStopPoints();
		const stopsInCell = stopsData.features
			.filter((f) => {
				const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
				return latLngToCell(lat, lon, cellRes) === cell;
			})
			.map((f) => ({
				...(f.properties as { count: number; lastDate: string; address: string }),
				coordinates: (f.geometry as GeoJSON.Point).coordinates as [number, number],
			}))
			.sort((a, b) => {
				const dateDiff = b.lastDate.localeCompare(a.lastDate);
				return dateDiff !== 0 ? dateDiff : b.count - a.count;
			});

		this.ensureStopsPreviewLayer();
		(this.map!.getSource('stops-preview') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: stopsInCell.map(({ count, lastDate, address, coordinates }) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates },
				properties: { count, lastDate, address },
			})),
		});

		// Cap à 99 trajets les plus récents pour l'affichage (le reste reste disponible pour les stats etc.)
		const MAX_DISPLAY = 99;
		const displaySorted = sorted.length > MAX_DISPLAY ? sorted.slice(0, MAX_DISPLAY) : sorted;

		// Point le plus au nord de l'hexagone (pour positionner la popup au-dessus des arrêts)
		const boundary = cellToBoundary(cell);
		const northPoint = boundary.reduce((max, p) => (p[0] > max[0] ? p : max), boundary[0]);
		const northLngLat: [number, number] = [northPoint[1], northPoint[0]];

		this.popup?.remove();
		this.openPopupCell = cell;

		// Afficher la bordure de l'hexagone sélectionné
		if (this.map?.getSource('selected-hex')) {
			const boundary = cellToBoundary(cell);
			const ring = boundary.map(([lat, lng]) => [lng, lat] as [number, number]);
			ring.push(ring[0]); // fermer le polygone
			(this.map.getSource('selected-hex') as maplibregl.GeoJSONSource).setData({
				type: 'Feature',
				geometry: { type: 'Polygon', coordinates: [ring] },
				properties: {},
			});
		}

		this.popup = new maplibregl.Popup({ maxWidth: 'min(320px, calc(100vw - 2rem))' })
			.setLngLat(center)
			.setHTML(this.buildHexPopupHtml(displaySorted, stopsInCell, sorted.length))
			.addTo(this.map!);

		this.popup.on('close', () => {
			if (!this.keepTripLineOnClose) this.clearTripLine();
			this.keepTripLineOnClose = false;
			this.openPopupCell = null;
			if (this.map?.getSource('selected-hex')) {
				(this.map.getSource('selected-hex') as maplibregl.GeoJSONSource).setData({
					type: 'FeatureCollection',
					features: [],
				});
			}
			if (!this.keepStopsPreviewOnClose) {
				this.map?.setLayoutProperty('stops-preview-circle', 'visibility', 'none');
			}
			this.keepStopsPreviewOnClose = false;
		});

		requestAnimationFrame(() => {
			const el = this.popup?.getElement();
			if (!el) return;
			el.querySelectorAll<HTMLElement>('[data-trip-idx]').forEach((item) => {
				const idx = parseInt(item.getAttribute('data-trip-idx')!, 10);
				item.addEventListener('click', () => {
					this.keepTripLineOnClose = true;
					this.showTripLine(displaySorted[idx]);
					if ((this.map?.getZoom() ?? 0) < 14) this.fitToVisited([displaySorted[idx].coords], 14);
					this.popup?.remove();
					this.popup = null;
				});
			});
			el.querySelectorAll<HTMLElement>('.popup-tab').forEach((btn) => {
				btn.addEventListener('click', () => {
					const tab = btn.getAttribute('data-tab')!;
					el.querySelectorAll<HTMLElement>('.popup-tab').forEach((b) =>
						b.classList.toggle('active', b === btn),
					);
					el.querySelectorAll<HTMLElement>('.popup-tab-content').forEach((c) =>
						c.style.setProperty('display', c.getAttribute('data-content') === tab ? '' : 'none'),
					);
					this.map?.setLayoutProperty(
						'stops-preview-circle',
						'visibility',
						tab === 'arrets' ? 'visible' : 'none',
					);
					// Déplacer la popup : en haut de l'hex pour les arrêts, au centre pour les passages
					this.popup?.setLngLat(tab === 'arrets' ? northLngLat : center);
					if (tab === 'arrets' && stopsInCell.length && (this.map?.getZoom() ?? 0) <= 12) {
						this.fitToVisited(
							[stopsInCell.map(({ coordinates: [lon, lat] }) => [lat, lon] as [number, number])],
							12,
							1.7,
						);
					}
				});
			});
			el.querySelectorAll<HTMLElement>('[data-stop-idx]').forEach((item) => {
				const idx = parseInt(item.getAttribute('data-stop-idx')!, 10);
				const stop = stopsInCell[idx];
				item.addEventListener('mouseenter', () => {
					(this.map?.getSource('stops-preview-highlight') as maplibregl.GeoJSONSource)?.setData({
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: stop.coordinates },
								properties: { count: stop.count },
							},
						],
					});
					if (stopsInCell.length > 1)
						this.map?.setPaintProperty('stops-preview-circle', 'circle-opacity', 0.3);
					this.map?.setLayoutProperty('stops-preview-highlight-circle', 'visibility', 'visible');
				});
				item.addEventListener('mouseleave', () => {
					if (stopsInCell.length > 1)
						this.map?.setPaintProperty('stops-preview-circle', 'circle-opacity', 0.9);
					this.map?.setLayoutProperty('stops-preview-highlight-circle', 'visibility', 'none');
				});
				item.addEventListener('click', () => {
					this.map?.setLayoutProperty('stops-preview-highlight-circle', 'visibility', 'none');
					this.keepStopsPreviewOnClose = true;
					this.popup?.remove();
					this.popup = null;
					this.openStopPopup(stop, true);
				});
			});
		});
	}

	private openStopPopup(
		stop: { count: number; lastDate: string; address: string; coordinates: [number, number] },
		flyTo = false,
	): void {
		const { address, coordinates } = stop;
		if (flyTo) {
			this.keepStopsPreviewOnClose = true;
			this.map?.flyTo({ center: coordinates, zoom: Math.max(this.map.getZoom(), 12.9), speed: 1.4 });
		}

		const stopCell = latLngToCell(coordinates[1], coordinates[0], 10);
		const trips = this.allTripsWithCoords
			.filter((t) => t.endLat && t.endLon && latLngToCell(t.endLat, t.endLon, 10) === stopCell)
			.sort((a, b) => b.endTime.localeCompare(a.endTime));

		const city = (addr: string | null | undefined, lat = 0, lon = 0): string =>
			this.extractCity(addr) ?? addr?.split(',')[0]?.trim() ?? this.inferCityFromCoords(lat, lon) ?? '—';
		const rows = trips
			.map((t, idx) => {
				const date = new Date(t.endTime).toLocaleDateString('fr-FR', {
					day: '2-digit',
					month: 'short',
					year: 'numeric',
				});
				const start = city(t.niceStartAddress ?? t.startAddress, t.startLat, t.startLon);
				const end = city(t.niceEndAddress ?? t.endAddress, t.endLat, t.endLon);
				return `<li class="popup-trip" data-trip-idx="${idx}">
				<span class="popup-trip-date">${date}</span>
				<div class="popup-trip-bottom">
					<span class="popup-trip-route">${start} → ${end}</span>
				</div>
			</li>`;
			})
			.join('');

		const label = address || '—';
		const countLabel = `${trips.length} arrêt${trips.length > 1 ? 's' : ''}`;
		const gmUrl = `https://www.google.com/maps?q=${coordinates[1]},${coordinates[0]}`;

		this.reopeningStopPopup = true;
		this.stopPopup?.remove();
		this.reopeningStopPopup = false;
		this.stopPopup = new maplibregl.Popup({ maxWidth: 'min(280px, calc(100vw - 2rem))' })
			.setLngLat(coordinates)
			.setHTML(
				`<div class="popup-hex">
				<div class="popup-title">${label}</div>
				<div class="popup-trip-date" style="margin-bottom:0.4rem">${countLabel}</div>
				<ul class="popup-trips">${rows}</ul>
				<a href="${gmUrl}" target="_blank" rel="noopener" style="display:block;margin-top:6px;font-size:0.75rem;color:#fdb300;text-decoration:none">Ouvrir dans Google Maps ↗</a>
			</div>`,
			)
			.addTo(this.map!);
		this.stopPopup.on('close', () => {
			this.stopPopup = null;
			if (flyTo && !this.reopeningStopPopup)
				this.map?.setLayoutProperty('stops-preview-circle', 'visibility', 'none');
		});
		requestAnimationFrame(() => {
			const el = this.stopPopup?.getElement();
			if (!el) return;
			el.querySelectorAll<HTMLElement>('[data-trip-idx]').forEach((item) => {
				const idx = parseInt(item.getAttribute('data-trip-idx')!, 10);
				item.addEventListener('click', () => {
					this.keepTripLineOnClose = true;
					this.showTripLine(trips[idx]);
					if ((this.map?.getZoom() ?? 0) < 14) this.fitToVisited([trips[idx].coords], 14);
					this.stopPopup?.remove();
					this.stopPopup = null;
				});
			});
		});
	}

	private ensureStopsPreviewLayer(): void {
		if (!this.map || this.map.getSource('stops-preview')) return;
		this.map.addSource('stops-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
		this.map.addLayer({
			id: 'stops-preview-circle',
			type: 'circle',
			source: 'stops-preview',
			paint: {
				'circle-radius': [
					'interpolate',
					['linear'],
					['zoom'],
					4,
					10,
					8,
					6,
					14,
					5,
				] as maplibregl.DataDrivenPropertyValueSpecification<number>,
				'circle-color': [
					'interpolate',
					['linear'],
					['get', 'count'],
					1,
					'#5c6bc0',
					5,
					'#3949ab',
					10,
					'#283593',
				] as maplibregl.DataDrivenPropertyValueSpecification<string>,
				'circle-stroke-width': 0,
				'circle-opacity': 0.9,
			},
			layout: { visibility: 'none' },
		});
		this.map.addSource('stops-preview-highlight', {
			type: 'geojson',
			data: { type: 'FeatureCollection', features: [] },
		});
		this.map.addLayer({
			id: 'stops-preview-highlight-circle',
			type: 'circle',
			source: 'stops-preview-highlight',
			paint: {
				'circle-radius': [
					'interpolate',
					['linear'],
					['zoom'],
					4,
					10,
					8,
					6,
					14,
					5,
				] as maplibregl.DataDrivenPropertyValueSpecification<number>,
				'circle-color': [
					'interpolate',
					['linear'],
					['get', 'count'],
					1,
					'#5c6bc0',
					5,
					'#3949ab',
					10,
					'#283593',
				] as maplibregl.DataDrivenPropertyValueSpecification<string>,
				'circle-stroke-width': 0,
				'circle-opacity': 1,
			},
			layout: { visibility: 'none' },
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

		// Sans données hex, afficher les infos sans zoomer ni masquer
		if (this.hexagonCount() === 0) return;

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
		const featureProps = feature.properties as Record<string, unknown>;
		const countryCode = featureProps?.['country'] as string | undefined;
		const countryName = countryCode
			? (COUNTRIES.find((c) => c.code === countryCode)?.name ?? countryCode)
			: 'France';
		this.focusStats.set({
			trips: tripIndices.size,
			km,
			hex: props?.h3Visited ?? deptCells.filter((c) => data.counts[c] !== undefined).length,
			pct: props?.pct ?? 0,
			name: featureProps?.['nom'] as string | undefined,
			countryName,
		});
	}

	private formatKm(km: number): string {
		if (km >= 10000) return `${Math.round(km / 1000)}k`;
		if (km >= 1000) return `${(km / 1000).toFixed(1)}k`;
		return km.toLocaleString('fr-FR');
	}

	toggleColsMode(): void {
		if (this.colsMode()) {
			this.colsMode.set(false);
			this.hideCols();
			return;
		}
		if (this.speedMode()) {
			this.speedMode.set(false);
			this.hideSpeed();
		}
		if (Object.keys(this.tripAltProfiles).length > 0) {
			this.colsMode.set(true);
			this.showCols();
			if (!this.isMobile && (this.map?.getZoom() ?? 0) < 13) this.viewMyTrips();
			return;
		}

		for (const res of [6, 7] as H3Resolution[]) {
			if (!this.cellsByResolution[res]) {
				const tripData = this.tripsWithCoords.map((t) => ({
					coords: t.coords,
					date: t.startTime.substring(0, 10),
				}));
				this.cellsByResolution[res] = this.h3.computeResolution(tripData, res);
			}
		}

		this.elevationLoadingLabel.set('Analyse du relief…');
		this.elevationLoading.set(true);
		this.syncTripAltitudes().subscribe({
			next: (profiles) => {
				this.tripAltProfiles = profiles;
				this.db.kvSet('positions_sync_ts', Date.now()).subscribe();
				this.elevationLoading.set(false);
				this.colsMode.set(true);
				this.showCols();
				if (!this.isMobile && (this.map?.getZoom() ?? 0) < 13) this.viewMyTrips();
			},
			error: (err) => {
				this.logger.error('Elevation', 'sync failed', err);
				this.elevationLoading.set(false);
			},
		});
	}

	private syncTripAltitudes(): Observable<Record<string, AltProfile>> {
		// Trips qui ont déjà leurs positions chargées depuis IDB
		const alreadySynced: Record<string, AltProfile> = {};
		for (const trip of this.allTripsWithCoords) {
			if (!trip.positions?.length) continue;
			const profile = this.computeAltProfile(trip.positions);
			if (profile) alreadySynced[`${trip.trackerId}_${trip.startTime}`] = profile;
		}

		const unsynced = this.allTripsWithCoords.filter((t) => !t.positions?.length);

		if (!unsynced.length) {
			this.logger.log('Elevation', `cache hit — ${Object.keys(alreadySynced).length} trips with positions`);
			return of(alreadySynced);
		}

		const from = unsynced.reduce((min, t) => (t.startTime < min ? t.startTime : min), unsynced[0].startTime);
		const to = unsynced.reduce((max, t) => (t.endTime > max ? t.endTime : max), unsynced[0].endTime);

		return this.fetchPositionsInChunks(from, to).pipe(
			switchMap((positions) => {
				const positionsByTrip = this.matchPositionsToTrips(positions, unsynced);

				// Met à jour les positions en mémoire et invalide les caches
				for (const trip of unsynced) {
					const key = `${trip.trackerId}_${trip.startTime}`;
					if (positionsByTrip[key]) trip.positions = positionsByTrip[key];
				}
				this.colsCellCache = {};
				this.turnsCellCache = {};
				this.speedCellCache = {};
				this.speedCellStatsCache = {};
				this.stopPointsCache = null;
				this.tripSegmentsCache = {};
				this.allTripsSegmentsFC = null;

				// Persiste dans IDB
				const items = Object.entries(positionsByTrip).map(([indexId, pos]) => ({ indexId, positions: pos }));
				return this.db.upsertTripPositions(items).pipe(
					rxMap(() => {
						const newProfiles: Record<string, AltProfile> = {};
						for (const [key, pos] of Object.entries(positionsByTrip)) {
							const profile = this.computeAltProfile(pos);
							if (profile) newProfiles[key] = profile;
						}
						return { ...alreadySynced, ...newProfiles };
					}),
				);
			}),
		);
	}

	private fetchPositionsInChunks(from: string, to: string): Observable<GeoRidePosition[]> {
		const CHUNK_DAYS = 60;
		const toDate = new Date(to);

		return this.api.getTrackers().pipe(
			switchMap((trackers) => {
				const requests = trackers.flatMap((tracker) => {
					const chunks: { from: string; to: string }[] = [];
					let cursor = new Date(from);
					while (cursor < toDate) {
						const end = new Date(Math.min(cursor.getTime() + CHUNK_DAYS * 86400000, toDate.getTime()));
						chunks.push({ from: cursor.toISOString(), to: end.toISOString() });
						cursor = new Date(end.getTime() + 1);
					}
					return chunks.map((chunk) =>
						this.api
							.getPositions(tracker.trackerId, chunk.from, chunk.to)
							.pipe(tap(() => this.elevationBatchDone.update((n) => n + 1))),
					);
				});
				this.elevationBatchDone.set(0);
				this.elevationBatchTotal.set(requests.length);
				return concat(...requests).pipe(
					reduce<GeoRidePosition[], GeoRidePosition[]>((acc, batch) => acc.concat(batch), []),
				);
			}),
		);
	}

	private matchPositionsToTrips(
		positions: GeoRidePosition[],
		trips: TripWithCoords[],
	): Record<string, GeoRidePosition[]> {
		const sorted = [...trips].sort((a, b) => a.startTime.localeCompare(b.startTime));
		const byTrip: Record<string, GeoRidePosition[]> = {};

		let lastFixtime = '';
		for (const pos of positions) {
			if (pos.fixtime === lastFixtime) continue; // dédoublonne
			lastFixtime = pos.fixtime;
			let lo = 0,
				hi = sorted.length - 1,
				found = -1;
			while (lo <= hi) {
				const mid = (lo + hi) >> 1;
				if (sorted[mid].startTime <= pos.fixtime) {
					found = mid;
					lo = mid + 1;
				} else hi = mid - 1;
			}
			if (found < 0 || sorted[found].endTime < pos.fixtime) continue;
			const key = `${sorted[found].trackerId}_${sorted[found].startTime}`;
			(byTrip[key] ??= []).push(pos);
		}

		this.logger.log('Elevation', `matched ${Object.keys(byTrip).length} trips`);
		return byTrip;
	}

	private computeAltProfile(positions: GeoRidePosition[]): AltProfile | null {
		const alts = positions.map((p) => p.altitude).filter((a) => a != null && a > 0);
		if (!alts.length) return null;
		let gain = 0;
		for (let i = 1; i < alts.length; i++) {
			const diff = alts[i] - alts[i - 1];
			if (diff > 0) gain += diff;
		}
		return { minAlt: Math.min(...alts), maxAlt: Math.max(...alts), gain: Math.round(gain) };
	}

	private showCols(): void {
		if (this.currentMode === 'dept') return;
		const res = this.currentResolution ?? (this.mapSettings.deptResolution() as H3Resolution);
		const data = this.cellsByResolution[res];
		if (!data || !this.map?.getSource('cols-heatmap')) return;

		if (!this.colsCellCache[res]) {
			const cellAlts: Record<string, number[]> = {};
			for (const trip of this.allTripsWithCoords) {
				if (!trip.positions?.length) continue;
				for (const pos of trip.positions) {
					if (!pos.altitude) continue;
					const cell = latLngToCell(pos.latitude, pos.longitude, res);
					if (data.counts[cell] !== undefined) {
						(cellAlts[cell] ??= []).push(pos.altitude);
					}
				}
			}
			const visitedCells: Record<string, number> = {};
			for (const [cell, alts] of Object.entries(cellAlts)) {
				const sorted = [...alts].sort((a, b) => a - b);
				visitedCells[cell] = sorted[Math.floor(sorted.length / 2)];
			}
			this.colsCellCache[res] = visitedCells;
			this.logger.log('Elevation', `showCols res=${res} — ${Object.keys(visitedCells).length} cells (computed)`);
		}

		(this.map.getSource('cols-heatmap') as maplibregl.GeoJSONSource).setData(
			this.h3.cellsToHeatmapGeoJSON(this.colsCellCache[res]!),
		);
		this.map.setLayoutProperty('cols-fill', 'visibility', 'visible');
		if (this.turnsMode() && this.map.getLayer('turns-fill')) {
			this.map.setLayoutProperty('turns-fill', 'visibility', 'none');
		}
		this.refreshPolylineSegments();
	}

	private segmentColorExpression(): maplibregl.DataDrivenPropertyValueSpecification<string> {
		if (this.turnsMode()) return '#ff1744';
		if (this.speedMode()) return '#2e7d32';
		return '#283593'; // cols
	}

	private segmentOpacityExpression(): maplibregl.DataDrivenPropertyValueSpecification<number> {
		const prop = this.turnsMode() ? 'is_turn_peak' : this.speedMode() ? 'is_speed_peak' : 'is_alt_peak';
		return ['case', ['==', ['get', prop], 1], 1, 0] as maplibregl.DataDrivenPropertyValueSpecification<number>;
	}

	private buildAllTripsSegments(): GeoJSON.FeatureCollection {
		if (!this.allTripsSegmentsFC) {
			const features: GeoJSON.Feature[] = [];
			for (const trip of this.tripsWithCoords) {
				if (trip.positions?.length) {
					features.push(...this.buildTripSegments(trip).features);
				}
			}
			this.allTripsSegmentsFC = { type: 'FeatureCollection', features };
			this.logger.log('Elevation', `all-trips-segments: ${features.length} segments`);
		}
		return this.allTripsSegmentsFC;
	}

	private buildTripSegments(trip: TripWithCoords): GeoJSON.FeatureCollection {
		if (this.tripSegmentsCache[trip.indexId]) return this.tripSegmentsCache[trip.indexId];

		const positions = trip.positions ?? [];
		const raw: { coords: [[number, number], [number, number]]; alt: number; speed: number; turn: number }[] = [];

		for (let i = 0; i < positions.length - 1; i++) {
			const p1 = positions[i];
			const p2 = positions[i + 1];
			if (p1.fixtime === p2.fixtime) continue;
			const delta = Math.abs(p2.angle - p1.angle);
			raw.push({
				coords: [
					[p1.longitude, p1.latitude],
					[p2.longitude, p2.latitude],
				],
				alt: (p1.altitude + p2.altitude) / 2,
				speed: (p1.speed + p2.speed) / 2,
				turn: (p1.speed + p2.speed) / 2 > 5 ? (delta > 180 ? 360 - delta : delta) : 0,
			});
		}

		const p95 = (arr: number[]) => {
			const s = [...arr].sort((a, b) => a - b);
			return s[Math.floor(s.length * 0.95)] ?? 0;
		};
		const altP75 = p95(raw.map((r) => r.alt));
		const spdP75 = p95(raw.map((r) => r.speed));
		const turnP75 = p95(raw.map((r) => r.turn));

		const tagged = raw.map((r) => ({
			coords: r.coords,
			is_alt_peak: r.alt >= altP75 && altP75 > 0 ? 1 : 0,
			is_speed_peak: r.speed >= spdP75 && spdP75 > 0 ? 1 : 0,
			is_turn_peak: r.turn > 0 && r.turn >= turnP75 && turnP75 > 0 ? 1 : 0,
		}));

		const features: GeoJSON.Feature[] = tagged.map((seg) => ({
			type: 'Feature' as const,
			geometry: { type: 'LineString' as const, coordinates: seg.coords },
			properties: {
				is_alt_peak: seg.is_alt_peak,
				is_speed_peak: seg.is_speed_peak,
				is_turn_peak: seg.is_turn_peak,
			},
		}));

		const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
		this.tripSegmentsCache[trip.indexId] = fc;
		return fc;
	}

	private refreshPolylineSegments(): void {
		if (this.currentMode !== 'polyline' || !this.map?.getLayer('all-trips-segments-layer')) return;
		const analysisMode = this.colsMode() || this.turnsMode() || this.speedMode();
		if (analysisMode) {
			(this.map.getSource('all-trips-segments') as maplibregl.GeoJSONSource).setData(
				this.buildAllTripsSegments(),
			);
			this.map.setPaintProperty('all-trips-segments-layer', 'line-color', this.segmentColorExpression());
			this.map.setPaintProperty('all-trips-segments-layer', 'line-opacity', this.segmentOpacityExpression());
			this.map.setLayoutProperty('all-trips-segments-layer', 'visibility', 'visible');
			this.map.setLayoutProperty('all-trips-line', 'visibility', 'visible');
		} else {
			this.map.setLayoutProperty('all-trips-segments-layer', 'visibility', 'none');
			this.map.setLayoutProperty('all-trips-line', 'visibility', 'visible');
		}
	}

	private hideCols(): void {
		this.hexHoverAlt.set(null);
		if (this.map?.getLayer('cols-fill')) {
			this.map.setLayoutProperty('cols-fill', 'visibility', 'none');
		}
		if (this.turnsMode() && this.map?.getLayer('turns-fill')) {
			this.map.setLayoutProperty('turns-fill', 'visibility', 'visible');
		}
		this.refreshPolylineSegments();
	}

	toggleTurnsMode(): void {
		if (this.turnsMode()) {
			this.turnsMode.set(false);
			this.hideTurns();
			return;
		}
		if (this.speedMode()) {
			this.speedMode.set(false);
			this.hideSpeed();
		}
		if (this.stopsMode()) {
			this.stopsMode.set(false);
			this.hideStops();
		}

		for (const res of [6, 7] as H3Resolution[]) {
			if (!this.cellsByResolution[res]) {
				const tripData = this.tripsWithCoords.map((t) => ({
					coords: t.coords,
					date: t.startTime.substring(0, 10),
				}));
				this.cellsByResolution[res] = this.h3.computeResolution(tripData, res);
			}
		}

		this.elevationLoadingLabel.set('Analyse des virages…');
		this.elevationLoading.set(true);
		this.syncTripAltitudes().subscribe({
			next: () => {
				this.db.kvSet('positions_sync_ts', Date.now()).subscribe();
				this.elevationLoading.set(false);
				this.turnsMode.set(true);
				this.showTurns();
				if (!this.isMobile && (this.map?.getZoom() ?? 0) < 13) this.viewMyTrips();
			},
			error: (err) => {
				this.logger.error('Turns', 'sync failed', err);
				this.elevationLoading.set(false);
			},
		});
	}

	private showTurns(): void {
		if (this.currentMode === 'dept') return;
		const res = this.currentResolution ?? (this.mapSettings.deptResolution() as H3Resolution);
		const data = this.cellsByResolution[res];
		if (!data || !this.map?.getSource('turns-heatmap')) return;

		if (!this.turnsCellCache[res]) {
			const SINGLE_MIN = 20;
			const WIN = 6;
			const WIN_MIN = 45;
			const ad = (a: number, b: number) => {
				const d = Math.abs(b - a);
				return d > 180 ? 360 - d : d;
			};
			const cellScores: Record<string, number> = {};
			const addCount = (lat: number, lon: number) => {
				const cell = latLngToCell(lat, lon, res);
				if (data.counts[cell] !== undefined) cellScores[cell] = (cellScores[cell] ?? 0) + 1;
			};

			for (const trip of this.allTripsWithCoords) {
				if (!trip.positions?.length) continue;
				const pos = trip.positions;

				for (let i = 1; i < pos.length - 1; i++) {
					const p0 = pos[i - 1];
					const p1 = pos[i];
					const p2 = pos[i + 1];
					if (p0.fixtime === p1.fixtime || p1.fixtime === p2.fixtime) continue;
					const speedKmh = p1.speed * 1.852;
					if (speedKmh < 50) continue;

					const angle = ad(p1.angle, p2.angle);
					if (angle >= SINGLE_MIN) addCount(p1.latitude, p1.longitude);

					if (i + WIN < pos.length) {
						let valid = true;
						for (let j = i; j < i + WIN; j++) {
							if (pos[j].speed * 1.852 < 50) {
								valid = false;
								break;
							}
						}
						const netAngle = ad(pos[i].angle, pos[i + WIN].angle);
						if (valid && netAngle >= WIN_MIN) {
							const mid = pos[i + Math.floor(WIN / 2)];
							addCount(mid.latitude, mid.longitude);
						}
					}
				}
			}
			this.turnsCellCache[res] = cellScores;
			this.logger.log('Turns', `res=${res} — ${Object.keys(cellScores).length} cells`);
		}

		(this.map.getSource('turns-heatmap') as maplibregl.GeoJSONSource).setData(
			this.h3.cellsToHeatmapGeoJSON(this.turnsCellCache[res]!),
		);
		// En mode combiné cols+virages, les hexagones cols suffisent — virages = polyline seulement
		if (!this.colsMode()) {
			this.map.setLayoutProperty('turns-fill', 'visibility', 'visible');
		}
		this.refreshPolylineSegments();
	}

	private hideTurns(): void {
		this.hexHoverTurns.set(null);
		if (this.map?.getLayer('turns-fill')) {
			this.map.setLayoutProperty('turns-fill', 'visibility', 'none');
		}
		this.refreshPolylineSegments();
	}

	toggleStopsMode(): void {
		if (this.stopsMode()) {
			this.stopsMode.set(false);
			this.hideStops();
			return;
		}
		this.stopPointsCache = null;
		if (this.turnsMode()) {
			this.turnsMode.set(false);
			this.hideTurns();
		}
		if (this.speedMode()) {
			this.speedMode.set(false);
			this.hideSpeed();
		}
		this.stopsMode.set(true);
		this.showStops();
		if (!this.isMobile && (this.map?.getZoom() ?? 0) < 13) this.viewMyTrips();
		// Charger les positions si pas encore fait
		if (this.allTripsWithCoords.some((t) => !t.positions?.length)) {
			this.syncTripAltitudes().subscribe({ error: () => {} });
		}
	}

	private showStops(): void {
		if (!this.map?.getSource('stops')) return;
		if (!this.stopPointsCache) this.stopPointsCache = this.computeStopPoints();
		(this.map.getSource('stops') as maplibregl.GeoJSONSource).setData(this.stopPointsCache);
		for (const id of ['stops-cluster', 'stops-circle']) {
			if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', 'visible');
		}
	}

	private hideStops(): void {
		for (const id of ['stops-cluster', 'stops-circle']) {
			if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', 'none');
		}
	}

	toggleSpeedMode(): void {
		if (this.speedMode()) {
			this.speedMode.set(false);
			this.hideSpeed();
			return;
		}
		if (this.colsMode()) {
			this.colsMode.set(false);
			this.hideCols();
		}
		if (this.turnsMode()) {
			this.turnsMode.set(false);
			this.hideTurns();
		}
		if (this.stopsMode()) {
			this.stopsMode.set(false);
			this.hideStops();
		}

		for (const res of [6, 7] as H3Resolution[]) {
			if (!this.cellsByResolution[res]) {
				const tripData = this.tripsWithCoords.map((t) => ({
					coords: t.coords,
					date: t.startTime.substring(0, 10),
				}));
				this.cellsByResolution[res] = this.h3.computeResolution(tripData, res);
			}
		}

		this.elevationLoadingLabel.set('Analyse des vitesses…');
		this.elevationLoading.set(true);
		this.syncTripAltitudes().subscribe({
			next: () => {
				this.db.kvSet('positions_sync_ts', Date.now()).subscribe();
				this.elevationLoading.set(false);
				this.speedMode.set(true);
				this.showSpeed();
				if (!this.isMobile && (this.map?.getZoom() ?? 0) < 13) this.viewMyTrips();
			},
			error: (err) => {
				this.logger.error('Speed', 'sync failed', err);
				this.elevationLoading.set(false);
			},
		});
	}

	private showSpeed(): void {
		if (this.currentMode === 'dept') return;
		const res = this.currentResolution ?? (this.mapSettings.deptResolution() as H3Resolution);
		const data = this.cellsByResolution[res];
		if (!data || !this.map?.getSource('speed-heatmap')) return;

		if (!this.speedCellCache[res]) {
			// cell → tripId → speeds[]
			const cellTripSpeeds: Record<string, Record<string, number[]>> = {};
			for (const trip of this.allTripsWithCoords) {
				if (!trip.positions?.length) continue;
				for (const p of trip.positions) {
					if (p.speed < 2) continue;
					const cell = latLngToCell(p.latitude, p.longitude, res);
					if (data.counts[cell] === undefined) continue;
					((cellTripSpeeds[cell] ??= {})[trip.indexId] ??= []).push(p.speed);
				}
			}
			const visitedCells: Record<string, number> = {};
			const statsCache: Record<string, { avg: number; max: number }> = {};
			for (const [cell, byTrip] of Object.entries(cellTripSpeeds)) {
				const allSpeeds = Object.values(byTrip).flat();
				const sorted = [...allSpeeds].sort((a, b) => a - b);
				visitedCells[cell] = sorted[Math.floor(sorted.length * 0.9)]; // p90
				const tripAvgs = Object.values(byTrip).map((s) => s.reduce((a, v) => a + v, 0) / s.length);
				const maxAvgKmh = Math.round(Math.max(...tripAvgs) * 1.852);
				const maxKmh = Math.round(Math.max(...allSpeeds) * 1.852);
				statsCache[cell] = { avg: maxAvgKmh, max: maxKmh };
			}
			this.speedCellCache[res] = visitedCells;
			this.speedCellStatsCache[res] = statsCache;
			this.logger.log('Speed', `res=${res} — ${Object.keys(visitedCells).length} cells`);
		}

		(this.map.getSource('speed-heatmap') as maplibregl.GeoJSONSource).setData(
			this.h3.cellsToHeatmapGeoJSON(this.speedCellCache[res]!),
		);
		this.map.setLayoutProperty('speed-fill', 'visibility', 'visible');
		this.refreshPolylineSegments();
	}

	private hideSpeed(): void {
		this.hexHoverSpeedAvg.set(null);
		this.hexHoverSpeedMax.set(null);
		if (this.map?.getLayer('speed-fill')) {
			this.map.setLayoutProperty('speed-fill', 'visibility', 'none');
		}
		this.refreshPolylineSegments();
	}

	private computeStopPoints(): GeoJSON.FeatureCollection {
		const DEDUP_RES = 10;
		const MERGE_METERS = 20;
		const byCell: Record<string, { lat: number; lon: number; count: number; lastDate: string; address: string }> =
			{};

		const sorted = [...this.allTripsWithCoords].sort((a, b) => b.endTime.localeCompare(a.endTime));
		for (const trip of sorted) {
			const lat = trip.endLat;
			const lon = trip.endLon;
			if (!lat || !lon) continue;
			const cell = latLngToCell(lat, lon, DEDUP_RES);
			const addr = this.extractCity(trip.niceEndAddress ?? trip.endAddress) ?? '';
			if (byCell[cell]) {
				byCell[cell].count++;
			} else {
				byCell[cell] = { lat, lon, count: 1, lastDate: trip.endTime, address: addr };
			}
		}

		// Second pass: merge stops within 20m, keeping highest count (or most recent if equal)
		const candidates = Object.values(byCell).sort((a, b) =>
			b.count !== a.count ? b.count - a.count : b.lastDate.localeCompare(a.lastDate),
		);
		const kept: typeof candidates = [];
		for (const candidate of candidates) {
			const tooClose = kept.some((k) => {
				const dlat = (candidate.lat - k.lat) * 111320;
				const dlon = (candidate.lon - k.lon) * 111320 * Math.cos((k.lat * Math.PI) / 180);
				return Math.sqrt(dlat * dlat + dlon * dlon) < MERGE_METERS;
			});
			if (!tooClose) kept.push(candidate);
		}

		this.logger.log('Stops', `${kept.length} stop points (${Object.keys(byCell).length} before 20m merge)`);
		return {
			type: 'FeatureCollection',
			features: kept.map(({ lat, lon, count, lastDate, address }) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [lon, lat] },
				properties: { count, lastDate, address },
			})),
		};
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

	private squareAllTripsBounds(): maplibregl.LngLatBounds {
		let minLat = Infinity,
			maxLat = -Infinity,
			minLon = Infinity,
			maxLon = -Infinity;
		for (const { coords } of this.tripsWithCoords) {
			for (const [lat, lon] of coords) {
				if (lat < minLat) minLat = lat;
				if (lat > maxLat) maxLat = lat;
				if (lon < minLon) minLon = lon;
				if (lon > maxLon) maxLon = lon;
			}
		}
		const centerLat = (minLat + maxLat) / 2;
		const centerLon = (minLon + maxLon) / 2;
		const latFactor = Math.cos((centerLat * Math.PI) / 180);
		const dLat = maxLat - minLat;
		const dLon = (maxLon - minLon) * latFactor;
		const halfSize = (Math.max(dLat, dLon) / 2) * 1.05;
		return new maplibregl.LngLatBounds(
			[centerLon - halfSize / latFactor, centerLat - halfSize],
			[centerLon + halfSize / latFactor, centerLat + halfSize],
		);
	}

	private squareDeptBounds(features: GeoJSON.Feature[]): maplibregl.LngLatBounds {
		let minLat = Infinity,
			maxLat = -Infinity,
			minLon = Infinity,
			maxLon = -Infinity;
		for (const f of features) {
			const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
			const coords: GeoJSON.Position[] =
				geom.type === 'Polygon' ? geom.coordinates[0] : (geom.coordinates as GeoJSON.Position[][][]).flat(2);
			for (const [lon, lat] of coords as number[][]) {
				if (lat < minLat) minLat = lat;
				if (lat > maxLat) maxLat = lat;
				if (lon < minLon) minLon = lon;
				if (lon > maxLon) maxLon = lon;
			}
		}
		const centerLat = (minLat + maxLat) / 2;
		const centerLon = (minLon + maxLon) / 2;
		const latFactor = Math.cos((centerLat * Math.PI) / 180);
		const dLat = maxLat - minLat;
		const dLon = (maxLon - minLon) * latFactor;
		const halfSize = (Math.max(dLat, dLon) / 2) * 1.35;
		return new maplibregl.LngLatBounds(
			[centerLon - halfSize / latFactor, centerLat - halfSize],
			[centerLon + halfSize / latFactor, centerLat + halfSize],
		);
	}

	private squareTripBounds(coords: [number, number][]): maplibregl.LngLatBounds {
		// Calcule des bounds carrées autour du trajet pour que la preview carré ait
		// des marges homogènes quelle que soit la forme du trajet.
		let minLat = Infinity,
			maxLat = -Infinity,
			minLon = Infinity,
			maxLon = -Infinity;
		for (const [lat, lon] of coords) {
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
			if (lon < minLon) minLon = lon;
			if (lon > maxLon) maxLon = lon;
		}
		const centerLat = (minLat + maxLat) / 2;
		const centerLon = (minLon + maxLon) / 2;
		// Corriger le ratio lon/lat selon la latitude (cos(lat))
		const latFactor = Math.cos((centerLat * Math.PI) / 180);
		const dLat = maxLat - minLat;
		const dLon = (maxLon - minLon) * latFactor; // dLon en "unités lat"
		const halfSize = (Math.max(dLat, dLon) / 2) * 1.35; // 35% de marge
		return new maplibregl.LngLatBounds(
			[centerLon - halfSize / latFactor, centerLat - halfSize],
			[centerLon + halfSize / latFactor, centerLat + halfSize],
		);
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

	private buildHexPopupHtml(
		sorted: TripWithCoords[],
		stopsInCell: Array<{ count: number; lastDate: string; address: string }>,
		totalCount = sorted.length,
	): string {
		if (!sorted.length) return '<div class="popup-empty">Aucun trajet trouvé</div>';

		const rows = sorted
			.map((t, idx) => {
				const date = new Date(t.startTime).toLocaleDateString('fr-FR', {
					day: '2-digit',
					month: 'short',
					year: 'numeric',
				});
				const km = Math.round(t.distance / 1000);
				const city = (addr: string | null | undefined, lat = 0, lon = 0): string =>
					this.extractCity(addr) ?? addr?.split(',')[0]?.trim() ?? this.inferCityFromCoords(lat, lon) ?? '—';
				const start = city(t.niceStartAddress ?? t.startAddress, t.startLat, t.startLon);
				const end = city(t.niceEndAddress ?? t.endAddress, t.endLat, t.endLon);
				return `<li class="popup-trip" data-trip-idx="${idx}">
        <span class="popup-trip-date">${date}</span>
        <div class="popup-trip-bottom">
          <span class="popup-trip-route">${start} → ${end}</span>
          <span class="popup-trip-km">${km} km</span>
        </div>
      </li>`;
			})
			.join('');

		const distinctDays = new Set(sorted.map((t) => t.startTime.substring(0, 10))).size;
		const passagesLabel = totalCount > 99 ? '99+' : `${distinctDays}`;

		const stopRows = stopsInCell.length
			? stopsInCell
					.map(({ count, lastDate, address }, idx) => {
						const date = new Date(lastDate).toLocaleDateString('fr-FR', {
							day: '2-digit',
							month: 'short',
							year: 'numeric',
						});
						return `<li class="popup-trip" data-stop-idx="${idx}">
        <span class="popup-trip-date">${date}</span>
        <div class="popup-trip-bottom">
          <span class="popup-trip-route">${address || '—'}</span>
          <span class="popup-trip-km">${count} arrêt${count > 1 ? 's' : ''}</span>
        </div>
      </li>`;
					})
					.join('')
			: `<li class="popup-trip" style="color:var(--text-muted);font-size:0.78rem">Aucun arrêt enregistré</li>`;

		return `<div class="popup-hex">
      <div class="popup-header-row">
        <div class="popup-tab-toggle">
          <button class="popup-tab active" data-tab="passages" ${distinctDays === 0 ? 'disabled' : ''}>${passagesLabel} passage${distinctDays > 1 ? 's' : ''}</button>
          <button class="popup-tab" data-tab="arrets" ${stopsInCell.length === 0 ? 'disabled' : ''}>${stopsInCell.length} arrêt${stopsInCell.length > 1 ? 's' : ''}</button>
        </div>
      </div>
      <div class="popup-tab-content" data-content="passages">
        <ul class="popup-trips">${rows}</ul>
      </div>
      <div class="popup-tab-content" data-content="arrets" style="display:none">
        <ul class="popup-trips popup-trips--stops">${stopRows}</ul>
      </div>
    </div>`;
	}

	private showTripLine(trip: TripWithCoords): void {
		this.logger.log('Trip', trip.indexId, trip);
		if (!this.map || !this.map.getSource('trip-line')) return;
		this.selectedTrip = trip;
		this.selectedTripForPanel.set(trip);
		this.selectedTripPositions.set(null);
		this.showTripPanel.set(true);
		this.shareLoopTripCount = 1;

		const render = (positions: GeoRidePosition[] | null) => {
			if (positions?.length) trip.positions = positions;
			const coords = trip.positions?.length
				? trip.positions.map((p) => [p.longitude, p.latitude] as [number, number])
				: trip.coords.map(([lat, lng]) => [lng, lat] as [number, number]);
			this.selectedTripCoords = coords;
			this.currentMode = null;
			this.updateView();
			if (!this.map?.getSource('trip-line')) return;
			(this.map.getSource('trip-line') as maplibregl.GeoJSONSource).setData({
				type: 'FeatureCollection',
				features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
			});
			if (trip.positions?.length && (this.colsMode() || this.turnsMode() || this.speedMode())) {
				this.showTripSegments(trip);
			}
			this.selectedTripPositions.set(trip.positions ?? []);
		};

		if (trip.positions?.length) {
			render(null);
		} else {
			this.db.getTripPositions(trip.indexId).subscribe((positions) => render(positions));
		}
	}

	private showTripSegments(trip: TripWithCoords): void {
		if (!this.map?.getSource('trip-line-segments')) return;
		const prop = this.turnsMode() ? 'is_turn_peak' : this.speedMode() ? 'is_speed_peak' : 'is_alt_peak';
		const raw = this.buildTripSegments(trip).features;
		const GAP_TOLERANCE = 2;
		const merged: GeoJSON.Feature[] = [];
		let coords: [number, number][] = [];
		let gapBuffer: [number, number][][] = [];

		const flush = () => {
			if (coords.length >= 2)
				merged.push({
					type: 'Feature',
					geometry: { type: 'LineString', coordinates: coords },
					properties: { [prop]: 1 },
				});
			else
				for (const g of gapBuffer)
					merged.push({
						type: 'Feature',
						geometry: { type: 'LineString', coordinates: g },
						properties: { [prop]: 0 },
					});
			coords = [];
			gapBuffer = [];
		};
		for (const f of raw) {
			const line = (f.geometry as GeoJSON.LineString).coordinates as [number, number][];
			if (f.properties?.[prop] === 1) {
				if (coords.length === 0) coords.push(line[0]);
				// absorb buffered gap segments into the peak
				for (const g of gapBuffer) coords.push(...g.slice(1));
				gapBuffer = [];
				coords.push(...line.slice(1));
			} else {
				if (coords.length > 0 && gapBuffer.length < GAP_TOLERANCE) {
					gapBuffer.push(line);
				} else {
					flush();
					merged.push(f);
				}
			}
		}
		flush();
		(this.map.getSource('trip-line-segments') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: merged,
		});
		this.map.setPaintProperty('trip-line-segments-layer', 'line-color', this.segmentColorExpression());
		this.map.setPaintProperty('trip-line-segments-layer', 'line-opacity', this.segmentOpacityExpression());
		this.map.setPaintProperty('trip-line-segments-layer', 'line-width', 4);
		this.map.setLayoutProperty('trip-line-segments-layer', 'visibility', 'visible');
	}

	openMaxSpeedTrip(): void {
		if (!this.maxSpeedTrip) return;
		this.showTripLine(this.maxSpeedTrip);
		this.fitToVisited([this.maxSpeedTrip.coords], 14);
	}

	openMaxDistanceTrip(): void {
		if (!this.maxDistanceTrip) return;
		this.showTripLine(this.maxDistanceTrip);
		this.fitToVisited([this.maxDistanceTrip.coords], 14);
	}

	onCloseTripPanel(): void {
		if (!this.shareIsOpen) this.clearTripLine();
	}

	onTripStatsComputed(stats: TripComputedStats): void {
		this.lastTripComputedStats = stats;
	}

	clearTripLine(skipUpdateView = false): void {
		this.selectedTrip = null;
		this.selectedTripCoords = null;
		this.showTripPanel.set(false);
		this.selectedTripForPanel.set(null);
		this.selectedTripPositions.set(null);
		this.shareLoopTripCount = 0;
		this.clearHoverPosition();
		if (!this.map || !this.map.getSource('trip-line')) return;
		(this.map.getSource('trip-line') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: [],
		});
		if (this.map.getSource('trip-line-segments')) {
			(this.map.getSource('trip-line-segments') as maplibregl.GeoJSONSource).setData({
				type: 'FeatureCollection',
				features: [],
			});
			this.map.setLayoutProperty('trip-line-segments-layer', 'visibility', 'none');
			this.map.setPaintProperty('trip-line', 'line-opacity', 0.9);
		}
		if (this.map?.getSource('stat-points')) {
			(this.map.getSource('stat-points') as maplibregl.GeoJSONSource).setData({
				type: 'FeatureCollection',
				features: [],
			});
		}
		if (this.map?.getSource('pause-chips')) {
			(this.map.getSource('pause-chips') as maplibregl.GeoJSONSource).setData({
				type: 'FeatureCollection',
				features: [],
			});
		}
		if (this.map?.getSource('city-segment')) {
			(this.map.getSource('city-segment') as maplibregl.GeoJSONSource).setData({
				type: 'FeatureCollection',
				features: [],
			});
		}
		if (!skipUpdateView) {
			this.currentMode = null;
			this.updateView();
		}
	}

	onHoverPosition(pos: [number, number] | null): void {
		if (!this.map?.getSource('hover-position')) return;
		const source = this.map.getSource('hover-position') as maplibregl.GeoJSONSource;
		if (pos) {
			source.setData({
				type: 'FeatureCollection',
				features: [
					{ type: 'Feature', geometry: { type: 'Point', coordinates: [pos[1], pos[0]] }, properties: {} },
				],
			});
		} else {
			source.setData({ type: 'FeatureCollection', features: [] });
		}
	}

	private clearHoverPosition(): void {
		if (!this.map?.getSource('hover-position')) return;
		(this.map.getSource('hover-position') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: [],
		});
	}

	onSelectTrip(trip: TripWithCoords): void {
		this.showTripLine(trip);
		this.fitToVisited([trip.coords], 14);
	}

	onFilterDateFromPanel(date: string): void {
		this.selectFilter('custom');
		this.updateCustomDate('from', date);
		this.updateCustomDate('to', date);
	}

	onSelectTripById(indexId: string): void {
		const trip = this.allTripsWithCoords.find((t) => t.indexId === indexId);
		if (!trip) return;
		this.closeStatsModal();
		this.showTripLine(trip);
		this.fitToVisited([trip.coords], 14);
	}

	onFuelTypeChange(type: string): void {
		this.fuelType = type;
		this.loadFuelPrices();
	}

	async loadFuelPrices(): Promise<void> {
		const now = new Date();
		const currentMonth = now.toISOString().substring(0, 7);
		const months: string[] = [];
		for (let i = 11; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
		}
		// Charger tous les mois passés directement, le mois en cours via fallback
		const pastMonths = months.filter((m) => m < currentMonth);
		const prices = await this.fuel.getMonthlyPrices(this.fuelType, pastMonths);
		// Pour le mois en cours ou les mois sans données : utiliser le plus proche disponible
		const allAvailable = Object.entries(prices)
			.filter(([, v]) => v !== null)
			.map(([k]) => k);
		for (const m of months) {
			if (prices[m] === null || prices[m] === undefined) {
				prices[m] = await this.fuel.getPriceOrNearest(this.fuelType, m, allAvailable);
			}
		}
		this.fuelPrices.set(prices);
		this.fuelCachedMonths.set(
			Object.entries(prices)
				.filter(([, v]) => v !== null)
				.map(([k]) => k),
		);
		this.statsModalData.set(this.computeStatsData());
	}

	onStatsApplyFilter(action: FilterAction): void {
		if (action.type === 'reset') {
			this.selectFilter('all');
			this.statsModalData.set(this.computeStatsData());
			return;
		}
		this.closeStatsModal();
		if (action.type === 'dateRange') {
			this.selectFilter('custom');
			this.updateCustomDate('from', action.from);
			this.updateCustomDate('to', action.to);
		} else if (action.type === 'day') {
			this.selectFilter('custom');
			this.updateCustomDate('from', action.date);
			this.updateCustomDate('to', action.date);
		} else if (action.type === 'month') {
			const [year, mon] = action.month.split('-').map(Number);
			const lastDay = new Date(year, mon, 0).getDate();
			const pad = (n: number) => String(n).padStart(2, '0');
			this.selectFilter('custom');
			this.updateCustomDate('from', `${action.month}-01`);
			this.updateCustomDate('to', `${action.month}-${pad(lastDay)}`);
		} else if (action.type === 'season') {
			const season = SEASONS.find((s) => s.name === action.name);
			if (season) this.selectSeason(season as Season);
		} else if (action.type === 'seasonYear') {
			const season = SEASONS.find((s) => s.name === action.name);
			if (season) this.selectSeason(season as Season, action.year);
		}
	}

	onShowStatPoints(pts: [number, number][]): void {
		if (!this.map?.getSource('stat-points')) return;
		(this.map.getSource('stat-points') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: pts.map(([lat, lon]) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [lon, lat] },
				properties: {},
			})),
		});
		if (pts.length > 1) this.fitToVisited([pts.map(([lat, lon]) => [lat, lon] as [number, number])], 14);
	}

	onFitTrip(): void {
		// selectedTripForPanel a les coords fusionnées en mode boucle
		const coords = this.selectedTripForPanel()?.coords ?? this.selectedTrip?.coords;
		if (coords) this.fitToVisited([coords], 14);
	}

	onShowPauseChips(chips: { lat: number; lon: number; label: string }[]): void {
		this.pauseChipsData = chips;
		if (!this.map?.getSource('pause-chips')) return;
		(this.map.getSource('pause-chips') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features: chips.map(({ lat, lon, label }) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [lon, lat] },
				properties: { label },
			})),
		});
	}

	private pathAnimTimer: ReturnType<typeof setTimeout> | null = null;

	onAnimatePath(coords: [number, number][]): void {
		if (!this.map || !coords.length) return;
		if (this.pathAnimTimer) {
			clearTimeout(this.pathAnimTimer);
			this.pathAnimTimer = null;
		}

		const n = coords.length;
		const TRAVEL_ZOOM = 12;
		const END_ZOOM = 15;

		// Dezoom à 12 au départ
		this.map.easeTo({ center: coords[0], zoom: TRAVEL_ZOOM, duration: 500 });

		// Puis suivre le polyline à zoom 12, et rezoomer à 15 à l'arrivée
		this.pathAnimTimer = setTimeout(() => {
			let i = 1;
			const step = () => {
				if (!this.map || i >= n) return;
				const isLast = i === n - 1;
				this.map.easeTo({
					center: coords[i],
					zoom: isLast ? END_ZOOM : TRAVEL_ZOOM,
					duration: isLast ? 600 : 300,
					easing: (v) => v,
				});
				i++;
				if (i < n) this.pathAnimTimer = setTimeout(step, isLast ? 0 : 270);
			};
			step();
		}, 520);
	}

	onFitCitySegment(coords: [number, number][]): void {
		this.onShowCitySegment(coords);
		if (coords.length >= 2) {
			// fitToVisited attend [lat, lon][], les coords sont [lon, lat][] → swap
			this.fitToVisited([coords.map(([lon, lat]) => [lat, lon] as [number, number])], 15);
		}
	}

	onShowCitySegment(coords: [number, number][]): void {
		if (!this.map?.getSource('city-segment')) return;
		(this.map.getSource('city-segment') as maplibregl.GeoJSONSource).setData(
			coords.length >= 2
				? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
				: { type: 'FeatureCollection', features: [] },
		);
	}

	onSnapToPosition(pos: [number, number]): void {
		if (!this.map) return;
		this.map.easeTo({ center: [pos[1], pos[0]], zoom: Math.max(this.map.getZoom(), 15), duration: 1000 });
	}

	onFlyToPosition(pos: [number, number]): void {
		if (!this.map) return;
		this.map.flyTo({ center: [pos[1], pos[0]], zoom: Math.max(this.map.getZoom(), 13), speed: 1.4 });
	}

	onFollowPosition(pos: [number, number] | null): void {
		if (!this.map || !pos) return;
		const center: [number, number] = [pos[1], pos[0]];
		// Sur mobile le panel occupe ~60vh en bas, décaler le centre vers le haut
		const padding = this.isMobile
			? { top: 20, right: 20, bottom: Math.round(window.innerHeight * 0.62), left: 20 }
			: undefined;
		if (this.map.getZoom() < 12) {
			this.map.easeTo({ center, zoom: 14, duration: 400, ...(padding && { padding }) });
		} else {
			this.map.jumpTo({ center, ...(padding && { padding }) });
		}
	}

	onShowFullDay(trips: TripWithCoords[]): void {
		if (!trips.length || !this.map?.getSource('trip-line')) return;
		this.shareLoopTripCount = trips.length;

		// Trier chronologiquement
		const sorted = [...trips].sort((a, b) => a.startTime.localeCompare(b.startTime));

		// Afficher toutes les polylines sur la carte (positions détaillées si disponibles, sinon staticImage)
		const tripCoords = (t: TripWithCoords): [number, number][] =>
			t.positions?.length
				? t.positions.map((p) => [p.longitude, p.latitude] as [number, number])
				: t.coords.map(([lat, lng]) => [lng, lat] as [number, number]);

		const features = sorted.map((t) => ({
			type: 'Feature' as const,
			geometry: { type: 'LineString' as const, coordinates: tripCoords(t) },
			properties: {},
		}));
		(this.map.getSource('trip-line') as maplibregl.GeoJSONSource).setData({
			type: 'FeatureCollection',
			features,
		});
		this.currentMode = null;
		this.updateView();
		this.fitToVisited(
			sorted.map((t) => t.coords),
			14,
		);

		// Charger les positions de tous les trajets, puis fusionner pour le panel
		const posObs = sorted.map((t) => (t.positions?.length ? of(t.positions) : this.db.getTripPositions(t.indexId)));
		forkJoin(posObs).subscribe((allPos) => {
			const mergedPositions = (allPos as (GeoRidePosition[] | null)[])
				.flat()
				.filter((p): p is GeoRidePosition => p != null)
				.sort((a, b) => a.fixtime.localeCompare(b.fixtime));

			const first = sorted[0];
			const last = sorted[sorted.length - 1];
			const totalDist = sorted.reduce((s, t) => s + t.distance, 0);
			const totalDur = sorted.reduce((s, t) => s + t.duration, 0);
			const avgSpeed =
				totalDist > 0 ? sorted.reduce((s, t) => s + t.averageSpeed * t.distance, 0) / totalDist : 0;

			const mergedTrip: TripWithCoords = {
				...first,
				distance: totalDist,
				duration: totalDur,
				averageSpeed: Math.round(avgSpeed),
				maxSpeed: Math.max(...sorted.map((t) => t.maxSpeed)),
				startTime: first.startTime,
				endTime: last.endTime,
				startLat: first.startLat,
				startLon: first.startLon,
				endLat: last.endLat,
				endLon: last.endLon,
				startAddress: first.startAddress,
				niceStartAddress: first.niceStartAddress,
				endAddress: last.endAddress,
				niceEndAddress: last.niceEndAddress,
				coords: sorted.flatMap((t) => t.coords),
				positions: mergedPositions,
			};

			this.selectedTripForPanel.set(mergedTrip);
			this.selectedTripPositions.set(mergedPositions.length ? mergedPositions : []);

			// Remettre à jour les polylignes avec les vraies positions maintenant chargées
			if (mergedPositions.length && this.map?.getSource('trip-line')) {
				const updatedFeatures = sorted.map((t) => ({
					type: 'Feature' as const,
					geometry: {
						type: 'LineString' as const,
						coordinates: t.positions?.length
							? t.positions.map((p) => [p.longitude, p.latitude] as [number, number])
							: t.coords.map(([lat, lng]) => [lng, lat] as [number, number]),
					},
					properties: {},
				}));
				(this.map.getSource('trip-line') as maplibregl.GeoJSONSource).setData({
					type: 'FeatureCollection',
					features: updatedFeatures,
				});
			}
		});
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
		this.lastClearedTs = dayBeforeYesterday.getTime();
		this.recapDismissedTs = 0;
		this.db.kvSet('lastClearedTs', this.lastClearedTs).subscribe();
		this.db.kvDelete('recapDismissedTs').subscribe();

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

		const dismissedTs = this.recapDismissedTs;
		if (dismissedTs > 0 || referenceDate) this.recapDismissed.set(true);
		const lastClearedTs = referenceDate ? 0 : this.lastClearedTs;
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
		// Différé après le rendu initial : computeNewCellsDeptStats (570 depts × H3 res=7) est trop lourd pour le thread principal au load
		setTimeout(() => this.buildRecapData());
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
		this.recapDismissedTs = Date.now();
		this.db.kvSet('recapDismissedTs', this.recapDismissedTs).subscribe();
		this.recapDismissed.set(true);
		this.clearNewCells();
	}

	reopenRecap(): void {
		this.recapDismissedTs = 0;
		this.db.kvDelete('recapDismissedTs').subscribe();
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

	private initViewAfterLoad(): void {
		this.viewMyTrips(false);
		this.map!.once('idle', () => {
			const z = this.map!.getZoom();
			const jumpZoom = z <= this.deptThreshold ? this.deptThreshold - 0.1 : this.deptThreshold + 0.1;
			this.map!.jumpTo({ zoom: jumpZoom });
			this.loadingHiding.set(true);
			setTimeout(() => {
				this.loading.set(false);
				this.loadingHiding.set(false);
				if (this.streak() >= 3) setTimeout(() => this.streakVisible.set(true), 1400);
				if (this.newCellsRecapData() && !this.recapDismissed()) {
					setTimeout(() => this.showNewCellsRecap.set(true), 600);
				}
			}, 500);
			this.logger.log('Map', 'done');
			this.viewMyTrips(true, 0.4);
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
		// Si le panel de trajet est visible, on laisse de la place en bas pour le graphique
		const padding = this.showTripPanel() ? { top: 80, right: 60, bottom: 320, left: 60 } : 40;
		const effectiveMaxZoom = this.showTripPanel() ? Math.min(maxZoom, 13) : maxZoom;
		this.map!.fitBounds(
			[
				[minLon, minLat],
				[maxLon, maxLat],
			],
			{ padding, maxZoom: effectiveMaxZoom, speed, animate },
		);
	}
}
