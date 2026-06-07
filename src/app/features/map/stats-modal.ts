import {
	Component,
	Input,
	Output,
	EventEmitter,
	signal,
	ViewChild,
	ElementRef,
	OnChanges,
	SimpleChanges,
	ChangeDetectionStrategy,
	inject,
	OnInit,
} from '@angular/core';
import { countryFlag as getCountryFlag } from '../../core/data/countries';
import { FuelService } from '../../core/services/fuel.service';
import { LoggerService } from '../../core/services/logger';
import { estimateFillUps } from '../../core/utils/fuel-consumption';

export type FilterAction =
	| { type: 'day'; date: string }
	| { type: 'month'; month: string }
	| { type: 'season'; name: string }
	| { type: 'seasonYear'; name: string; year: number }
	| { type: 'dateRange'; from: string; to: string }
	| { type: 'reset' };

export interface DayDistance {
	date: string;
	dateLabel: string;
	km: number;
	tripCount: number;
	indexIds: string[];
}

export interface MonthStats {
	key: string;
	label: string;
	km: number;
	tripCount: number;
}

export interface SeasonStats {
	label: string;
	km: number;
	tripCount: number;
}

export interface TopTrip {
	indexId: string;
	dateLabel: string;
	date: string;
	km: number;
	from: string | null;
	to: string | null;
	fromCountryCode: string;
	toCountryCode: string;
}

export interface DistanceStats {
	topDays: DayDistance[];
	byMonth: MonthStats[];
	bySeason: SeasonStats[];
	topTrips: TopTrip[];
}

export interface SpeedEntry {
	indexId: string;
	date: string;
	dateLabel: string;
	maxKmh: number;
	avgKmh: number;
	km: number;
	from: string | null;
	to: string | null;
	fromCountryCode: string;
	toCountryCode: string;
}

export interface SpeedStats {
	globalMaxKmh: number;
	globalAvgKmh: number;
	maxSpeedTripIndexId: string | null;
	topByMax: SpeedEntry[];
}

export interface LeanBucket {
	label: string;
	pct: number;
	count: number;
}

export interface TurnDeptStat {
	deptName: string;
	countryCode: string;
	avgKmh: number;
	maxKmh: number;
	maxKmhTripIndexId: string | null;
	avgLeanDeg: number;
	maxLeanDeg: number;
	maxLeanTripIndexId: string | null;
	tripCount: number;
}

export interface TurnCityStat {
	cityName: string;
	deptName: string;
	countryCode: string;
	avgKmh: number;
	maxKmh: number;
	maxKmhTripIndexId: string | null;
	avgLeanDeg: number;
	maxLeanDeg: number;
	maxLeanTripIndexId: string | null;
	tripCount: number;
}

export interface TurnStats {
	maxLeanAngle: number | null;
	maxLeanTripIndexId: string | null;
	sportPct: number | null;
	avgSpeedKmh: number | null;
	maxSpeedKmh: number | null;
	avgPctInTurns: number | null;
	tripsWithPositions: number;
	topDepts: TurnDeptStat[];
	topCities: TurnCityStat[];
	leanDistribution: LeanBucket[];
	avgLeanAngle: number | null;
}

export interface Records {
	longestTrip: { km: number; dateLabel: string; from: string | null; to: string | null; indexId: string } | null;
	longestDay: { km: number; dateLabel: string; tripCount: number } | null;
	bestMonth: { km: number; label: string } | null;
	firstTripDate: string | null;
	totalKm: number;
	totalTrips: number;
	ridingDays: number;
	longestStreak: number;
	longestStreakFrom: string | null;
	longestStreakTo: string | null;
	longestBreak: { days: number; from: string; to: string } | null;
	avgKmPerTrip: number;
	totalRidingHours: number;
	avgTripDurationMin: number;
	topDaysOfWeek: string[];
	departureHour: number | null;
	pauseHour: number | null;
	arrivalHour: number | null;
}

export interface MonthlyFuelCost {
	key: string;
	label: string;
	pricePerL: number | null;
	litersConsumed: number;
	cost: number | null;
	fillUps: number;
}

export interface FuelStats {
	fuelType: string;
	tankSizeL: number;
	totalLiters: number;
	totalCost: number | null;
	avgConsumptionL100: number;
	totalFillUps: number;
	co2KgTotal: number;
	costPerKm: number | null;
	byMonth: MonthlyFuelCost[];
}

export interface KmRangePauseStats {
	label: string;
	avgPauses: number;
	minPauses: number;
	maxPauses: number;
	avgDurationMin: number;
	minDurationMin: number;
	maxDurationMin: number;
	tripCount: number;
}

export interface PauseStats {
	tripsWithPositions: number;
	avgPausesPerTrip: number | null;
	avgPauseDurationMin: number | null;
	maxPauseDurationMin: number | null;
	maxPauseDateLabel: string | null;
	maxPauseTripIndexId: string | null;
	avgKmBeforeFirstPause: number | null;
	longestSessionKm: number | null;
	longestSessionTripIndexId: string | null;
	byKmRange: KmRangePauseStats[];
}

export interface MonthSummary {
	key: string;
	label: string;
	shortLabel: string;
	km: number;
	trips: number;
	ridingDays: number;
	maxSpeedKmh: number | null;
	bestDayKm: number | null;
	bestDayDateLabel: string | null;
	newCities: { name: string; deptName: string; country: string; tripIndexId: string }[];
	newPassingCities: { name: string; country: string; tripIndexId: string }[];
	newDepts: { name: string; country: string }[];
	newCountries: { code: string }[];
	newHexCount: number;
}

export interface RecentStats {
	months: MonthSummary[];
	currentStreakDays: number;
	currentStreakSince: string | null;
	speedRecordDate: string | null;
	leanRecordDate: string | null;
	longestTripDate: string | null;
	bestMonthIsCurrent: boolean;
}

export interface StatsModalData {
	homeCity: string | null;
	depts: {
		code: string;
		name: string;
		pct: number;
		trips: number;
		country: string;
		cities: { name: string; count: number; dates: string[] }[];
	}[];
	distanceStats: DistanceStats;
	speedStats: SpeedStats;
	turnStats: TurnStats;
	pauseStats: PauseStats;
	fuelStats: FuelStats;
	records: Records;
	recentStats: RecentStats;
}

type Tab = 'discovery' | 'distances' | 'speeds' | 'turns' | 'pauses' | 'fuel' | 'records';

@Component({
	selector: 'app-stats-modal',
	imports: [],
	templateUrl: './stats-modal.html',
	styleUrl: './stats-modal.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsModalComponent implements OnChanges, OnInit {
	private fuel = inject(FuelService);
	private logger = inject(LoggerService);
	@Input() data: StatsModalData | null = null;
	@Input() isFiltered = false;
	@Output() close = new EventEmitter<void>();
	@Output() selectTrip = new EventEmitter<string>();
	@Output() applyFilter = new EventEmitter<FilterAction>();
	@Output() fuelTypeChange = new EventEmitter<string>();

	@ViewChild('modalBody') modalBody?: ElementRef<HTMLElement>;
	@ViewChild('promptTextarea') promptTextarea?: ElementRef<HTMLTextAreaElement>;

	activeTab = signal<Tab>('records');
	selectedMonthIdx = signal(0);
	showPrompt = signal(false);
	swipeDelta = signal(0);
	snapping = signal(false);
	slideDir = signal<'left' | 'right' | null>(null);
	private readonly TAB_ORDER: Tab[] = ['records', 'discovery', 'distances', 'speeds', 'turns', 'pauses', 'fuel'];
	private touchStartX = 0;
	private touchStartY = 0;
	private swipeBlocked = false;
	tripDuration = signal(4);
	turnsViewMode = signal<'speed' | 'angle' | 'both'>('both');
	fuelLoading = signal(false);
	readonly fuelTypes = ['SP98', 'SP95', 'E10'] as const;
	fuelType = signal<'SP98' | 'SP95' | 'E10'>('SP98');
	tankSize = signal<number>(15);

	ngOnInit(): void {
		this.fuel.getPrefs().then(({ fuelType, tankSize }) => {
			this.fuelType.set(fuelType as 'SP98' | 'SP95' | 'E10');
			this.tankSize.set(tankSize);
		});
	}

	onTouchStart(e: TouchEvent): void {
		this.touchStartX = e.touches[0].clientX;
		this.touchStartY = e.touches[0].clientY;
		this.swipeBlocked = (e.target as Element).closest('.tabs') !== null;
	}

	onTouchMove(e: TouchEvent): void {
		if (this.swipeBlocked) return;
		const dx = e.touches[0].clientX - this.touchStartX;
		const dy = e.touches[0].clientY - this.touchStartY;
		if (Math.abs(dx) > Math.abs(dy)) {
			this.swipeDelta.set(dx);
		}
	}

	onTouchEnd(e: TouchEvent): void {
		if (this.swipeBlocked) return;
		const dx = e.changedTouches[0].clientX - this.touchStartX;
		const dy = e.changedTouches[0].clientY - this.touchStartY;
		const absX = Math.abs(dx);

		if (absX < 50 || absX < Math.abs(dy) * 1.5) {
			this.snapping.set(true);
			this.swipeDelta.set(0);
			setTimeout(() => this.snapping.set(false), 250);
			return;
		}

		this.swipeDelta.set(0);

		const idx = this.TAB_ORDER.indexOf(this.activeTab());
		let newIdx = idx;
		if (dx < 0 && idx < this.TAB_ORDER.length - 1) newIdx = idx + 1;
		else if (dx > 0 && idx > 0) newIdx = idx - 1;

		if (newIdx === idx) {
			this.snapping.set(true);
			setTimeout(() => this.snapping.set(false), 250);
			return;
		}

		this.setTab(this.TAB_ORDER[newIdx]);
		this.slideDir.set(dx < 0 ? 'right' : 'left');
		setTimeout(() => this.slideDir.set(null), 300);
	}

	setTab(tab: Tab): void {
		const t0 = performance.now();
		this.activeTab.set(tab);
		requestAnimationFrame(() => {
			this.logger.log('Tab', `${tab} render: ${Math.round(performance.now() - t0)}ms`);
		});
	}

	ngOnChanges(changes: SimpleChanges): void {
		if (changes['data']) {
			this.selectedMonthIdx.set(0);
			if (this.data?.fuelStats.fuelType === this.fuelType()) {
				this.fuelLoading.set(false);
			}
			this.expandedCountries.set(new Set());
		}
	}

	setFuelType(type: 'SP98' | 'SP95' | 'E10'): void {
		this.fuelType.set(type);
		this.fuel.savePrefs(type, this.tankSize());
		this.fuelLoading.set(true);
		this.fuelTypeChange.emit(type);
	}

	setTankSize(size: number): void {
		this.tankSize.set(size);
		this.fuel.savePrefs(this.fuelType(), size);
	}

	openTrip(indexId: string | null | undefined): void {
		if (!indexId) return;
		this.selectTrip.emit(indexId);
	}

	filterDay(date: string): void {
		this.applyFilter.emit({ type: 'day', date });
	}

	filterMonth(month: string): void {
		this.applyFilter.emit({ type: 'month', month });
	}

	filterSeason(label: string): void {
		const [name, yearStr] = label.split(' ');
		const year = yearStr ? parseInt(yearStr) : null;
		if (!year) {
			// Pas d'année → filtre saison récurrente (même comportement que le menu)
			this.applyFilter.emit({ type: 'season', name });
			return;
		}
		// Avec année → filtre saison récurrente + stocker l'année pour l'affichage du chip
		this.applyFilter.emit({ type: 'seasonYear', name, year });
	}

	setDuration(event: Event): void {
		this.tripDuration.set(+(event.target as HTMLInputElement).value);
	}

	tripMealBreaks(): number {
		const h = this.tripDuration();
		return h > 7 ? 2 : h > 4 ? 1 : 0;
	}

	tripStops(): number {
		const remaining = this.tripDuration() - this.tripMealBreaks();
		return Math.floor(remaining / (1 + 15 / 60));
	}

	tripKm(): number {
		const ridingTime = this.tripDuration() - this.tripMealBreaks() - this.tripStops() * (15 / 60);
		return Math.round(ridingTime * 60);
	}

	private expandedKey = signal<string | null>(null);
	private expandedCountries = signal<Set<string>>(new Set());
	private expandedDept = signal<string | null>(null);
	private expandedCountryDepts = signal<string | null>(null);
	readonly CITIES_LIMIT = 5;
	readonly DEPTS_LIMIT = 5;

	toggleCountry(code: string, headerEl: HTMLElement): void {
		const wasOpen = this.expandedCountries().has(code);
		this.expandedCountries.set(wasOpen ? new Set() : new Set([code]));
		this.expandedCountryDepts.set(null);
		if (!wasOpen) {
			setTimeout(() => {
				const body = this.modalBody?.nativeElement;
				if (!body) return;
				const bodyRect = body.getBoundingClientRect();
				const elRect = headerEl.getBoundingClientRect();
				body.scrollBy({ top: elRect.top - bodyRect.top - 12, behavior: 'smooth' });
			}, 0);
		}
	}

	isCountryOpen(code: string): boolean {
		return this.expandedCountries().has(code);
	}

	isDeptExpanded(deptCode: string): boolean {
		return this.expandedDept() === deptCode;
	}

	toggleDeptExpand(deptCode: string): void {
		this.expandedDept.set(this.expandedDept() === deptCode ? null : deptCode);
	}

	visibleCities(dept: StatsModalData['depts'][0]): StatsModalData['depts'][0]['cities'] {
		if (this.isDeptExpanded(dept.code)) return dept.cities;
		return dept.cities.slice(0, this.CITIES_LIMIT);
	}

	hiddenCitiesCount(dept: StatsModalData['depts'][0]): number {
		return Math.max(0, dept.cities.length - this.CITIES_LIMIT);
	}

	isDeptsExpanded(countryCode: string): boolean {
		return this.expandedCountryDepts() === countryCode;
	}

	toggleDeptsExpand(countryCode: string): void {
		this.expandedCountryDepts.set(this.expandedCountryDepts() === countryCode ? null : countryCode);
	}

	visibleDepts(group: { countryCode: string; depts: StatsModalData['depts'] }): StatsModalData['depts'] {
		if (this.isDeptsExpanded(group.countryCode)) return group.depts;
		return group.depts.slice(0, this.DEPTS_LIMIT);
	}

	hiddenDeptsCount(group: { countryCode: string; depts: StatsModalData['depts'] }): number {
		return Math.max(0, group.depts.length - this.DEPTS_LIMIT);
	}

	countryPct(depts: StatsModalData['depts']): number {
		if (depts.length === 0) return 0;
		return Math.round(depts.reduce((s, d) => s + d.pct, 0) / depts.length);
	}

	private static countryNames = new Intl.DisplayNames(['fr'], { type: 'region' });

	private static safeCountryName(code: string): string {
		try {
			return StatsModalComponent.countryNames.of(code) ?? code;
		} catch {
			return code;
		}
	}

	deptsByCountry(): { countryCode: string; countryName: string; depts: StatsModalData['depts'] }[] {
		if (!this.data) return [];
		const groups = new Map<string, StatsModalData['depts']>();
		for (const dept of this.data.depts) {
			const c = dept.country ?? 'FR';
			if (!groups.has(c)) groups.set(c, []);
			groups.get(c)!.push(dept);
		}
		return [...groups.entries()]
			.map(([code, depts]) => ({
				countryCode: code,
				countryName: StatsModalComponent.safeCountryName(code),
				depts,
			}))
			.sort((a, b) => this.countryPct(b.depts) - this.countryPct(a.depts));
	}

	isVisible(deptCode: string, cityName: string): boolean {
		return this.expandedKey() === `${deptCode}-${cityName}`;
	}

	togglePrompt(): void {
		this.showPrompt.set(!this.showPrompt());
		if (this.showPrompt()) {
			setTimeout(() => {
				if (this.modalBody) this.modalBody.nativeElement.scrollTop = 0;
				if (this.promptTextarea) this.promptTextarea.nativeElement.select();
			}, 0);
		}
	}

	private currentSeason(): string {
		const m = new Date().getMonth() + 1;
		const d = new Date().getDate();
		if ((m === 3 && d >= 20) || m === 4 || m === 5 || (m === 6 && d < 21)) return 'printemps';
		if ((m === 6 && d >= 21) || m === 7 || m === 8 || (m === 9 && d < 23)) return 'été';
		if ((m === 9 && d >= 23) || m === 10 || m === 11 || (m === 12 && d < 21)) return 'automne';
		return 'hiver';
	}

	private rideCountries(): string {
		if (!this.data) return '';
		const pctByCountry: Record<string, number> = {};
		for (const dept of this.data.depts) {
			if (dept.pct < 10) continue;
			const c = dept.country ?? 'FR';
			pctByCountry[c] = (pctByCountry[c] ?? 0) + dept.pct;
		}
		return Object.entries(pctByCountry)
			.sort((a, b) => b[1] - a[1])
			.map(([code]) => StatsModalComponent.safeCountryName(code))
			.join(' et ');
	}

	buildPrompt(): string {
		if (!this.data) return '';
		const countries = this.rideCountries();
		const lines: string[] = [];
		if (this.data.homeCity) {
			lines.push(
				`Je fais de la moto en ${countries}, je pars principalement de ${this.data.homeCity}. Nous sommes en ${this.currentSeason()}.`,
			);
			lines.push('');
		} else {
			lines.push(`Je fais de la moto en ${countries}. Nous sommes en ${this.currentSeason()}.`);
			lines.push('');
		}
		lines.push('Voici les villes et villages où je me suis arrêté (pas juste traversé) par département :');
		for (const dept of this.data.depts) {
			if (dept.cities.length === 0) continue;
			const cityList = dept.cities
				.filter((c) => c.name !== this.data!.homeCity)
				.map((c) => `${c.name} (${c.count} fois, dernière visite : ${c.dates[0]})`)
				.join(', ');
			if (!cityList) continue;
			lines.push(`${dept.name} (${dept.pct}%) : ${cityList}`);
		}
		lines.push('');
		const hours = this.tripDuration();
		const stops = this.tripStops();
		const mealBreaks = this.tripMealBreaks();
		const km = this.tripKm();
		const pauseDetail = [
			stops > 0 ? `${stops} pause${stops > 1 ? 's' : ''} courte${stops > 1 ? 's' : ''} de 15 min` : '',
			mealBreaks > 0 ? `${mealBreaks} pause${mealBreaks > 1 ? 's' : ''} repas d'1h` : '',
		]
			.filter(Boolean)
			.join(' et ');
		lines.push(
			`Propose-moi une belle boucle à faire en moto${this.data.homeCity ? ` depuis ${this.data.homeCity}` : ''} que je n'ai pas encore explorée, d'une durée totale d'environ ${hours}h (≈ ${km} km de route, avec ${pauseDetail}). Cols, routes panoramiques, villages pittoresques. Découpe la boucle en ${stops} étapes courtes et${mealBreaks > 0 ? ` ${mealBreaks} étape${mealBreaks > 1 ? 's' : ''} repas,` : ''} avec une pause à chaque étape. Génère une image de mise en page suivante : sur le côté gauche un aperçu visuel de la boucle complète (tracé de l'itinéraire sur fond de carte ou illustration), et sur le reste de l'image toutes les étapes affichées sous forme de vignettes avec pour chacune une photo emblématique du lieu, le nom du lieu, la distance depuis l'étape précédente en km et la durée de route. Ambiance ${this.currentSeason()}, style photographique, lumière naturelle.`,
		);
		return lines.join('\n');
	}

	toggleCity(deptCode: string, cityName: string): void {
		const key = `${deptCode}-${cityName}`;
		this.expandedKey.set(this.expandedKey() === key ? null : key);
	}

	formatKm(km: number): string {
		return km.toLocaleString('fr-FR');
	}

	private static dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

	topDayName(dateStr: string): string {
		return StatsModalComponent.dayFmt.format(new Date(dateStr + 'T12:00:00'));
	}

	maxDayKm(): number {
		return this.data?.distanceStats.topDays[0]?.km ?? 1;
	}

	maxMonthKm(): number {
		return Math.max(...(this.data?.distanceStats.byMonth.map((m) => m.km) ?? [1]));
	}

	maxSeasonKm(): number {
		return Math.max(...(this.data?.distanceStats.bySeason.map((s) => s.km) ?? [1]));
	}

	maxTopTripKm(): number {
		return this.data?.distanceStats.topTrips[0]?.km ?? 1;
	}

	private combinedScore<T extends { maxKmh: number; maxLeanDeg: number }>(items: T[]): (item: T) => number {
		const maxKmh = Math.max(...items.map((d) => d.maxKmh), 1);
		const maxLean = Math.max(...items.map((d) => d.maxLeanDeg), 1);
		return (item) => (item.maxKmh / maxKmh) * 0.5 + (item.maxLeanDeg / maxLean) * 0.5;
	}

	sortedDepts(): TurnDeptStat[] {
		const depts = this.data?.turnStats.topDepts ?? [];
		if (this.turnsViewMode() === 'angle') return [...depts].sort((a, b) => b.maxLeanDeg - a.maxLeanDeg);
		if (this.turnsViewMode() === 'both') {
			const score = this.combinedScore(depts);
			return [...depts].sort((a, b) => score(b) - score(a));
		}
		return [...depts].sort((a, b) => b.maxKmh - a.maxKmh);
	}

	sortedCities(): TurnCityStat[] {
		const cities = this.data?.turnStats.topCities ?? [];
		if (this.turnsViewMode() === 'angle') return [...cities].sort((a, b) => b.maxLeanDeg - a.maxLeanDeg);
		if (this.turnsViewMode() === 'both') {
			const score = this.combinedScore(cities);
			return [...cities].sort((a, b) => score(b) - score(a));
		}
		return [...cities].sort((a, b) => b.maxKmh - a.maxKmh);
	}

	countryFlag(code: string): string {
		return getCountryFlag(code);
	}

	hasMultipleCountries(items: { countryCode: string }[]): boolean {
		return new Set(items.map((i) => i.countryCode)).size > 1;
	}

	hasMultipleCountriesInTurns(): boolean {
		const codes = new Set([
			...this.sortedDepts().map((d) => d.countryCode),
			...this.sortedCities().map((c) => c.countryCode),
		]);
		return codes.size > 1;
	}

	hasMultipleCountriesInRoutes(items: { fromCountryCode: string; toCountryCode: string }[]): boolean {
		const codes = new Set(items.flatMap((i) => [i.fromCountryCode, i.toCountryCode]));
		return codes.size > 1;
	}

	routeWithFlags(from: string | null, to: string | null, fromCC: string, toCC: string, show: boolean): string {
		if (!show) return `${from ?? ''}${from && to ? ' → ' : ''}${to ?? ''}`;
		const fromFlag = this.countryFlag(fromCC);
		const toFlag = this.countryFlag(toCC);
		const fromStr = from ? `${from} ${fromFlag}` : '';
		const toStr = to ? `${to} ${toFlag}` : '';
		return `${fromStr}${fromStr && toStr ? ' → ' : ''}${toStr}`;
	}

	maxTurnDeptVal(): number {
		const depts = this.sortedDepts();
		if (this.turnsViewMode() === 'angle') return Math.max(...depts.map((d) => d.maxLeanDeg), 1);
		return Math.max(...depts.map((d) => d.maxKmh), 1);
	}

	maxTurnCityVal(): number {
		const cities = this.sortedCities();
		if (this.turnsViewMode() === 'angle') return Math.max(...cities.map((c) => c.maxLeanDeg), 1);
		return Math.max(...cities.map((c) => c.maxKmh), 1);
	}

	cycleTurnsMode(): void {
		const next: Record<string, 'speed' | 'angle' | 'both'> = { speed: 'angle', angle: 'both', both: 'speed' };
		this.turnsViewMode.set(next[this.turnsViewMode()]);
	}

	turnsToggleLabel(): string {
		return { speed: 'km/h', angle: '°', both: 'km/h·°' }[this.turnsViewMode()];
	}

	barPct(val: number, max: number): number {
		return Math.round((val / Math.max(max, 1)) * 100);
	}

	// Taille + letter-spacing calculés ensemble pour garantir l'effet escalier
	dayStyles(): { fontSize: string; letterSpacing: string }[] {
		const days = this.data?.records.topDaysOfWeek ?? [];
		const n = days.length;
		if (n === 0) return [];
		const MIN = 0.7;
		const MAX = 1.1;
		// Letter-spacing décroissant (en em relatif à la font-size)
		const LS_EM = [0.03, 0.01, 0];
		const STEP = 1.3;
		const sizes = new Array<number>(n);
		const visuals = new Array<number>(n);
		// La largeur visuelle effective = fontSize × (1 + letterSpacing_em) × charCount
		sizes[n - 1] = MIN;
		visuals[n - 1] = MIN * (1 + LS_EM[n - 1]) * days[n - 1].length;
		for (let i = n - 2; i >= 0; i--) {
			const needed = (visuals[i + 1] * STEP) / ((1 + LS_EM[i]) * days[i].length);
			sizes[i] = Math.min(MAX, Math.max(sizes[i + 1], needed));
			visuals[i] = sizes[i] * (1 + LS_EM[i]) * days[i].length;
		}
		return sizes.map((s, i) => ({
			fontSize: `${s.toFixed(3)}rem`,
			letterSpacing: `${(LS_EM[i] * s).toFixed(3)}rem`,
		}));
	}

	// Retourne les stats essence pour le type et la taille du réservoir sélectionnés
	fuelData(): FuelStats | null {
		if (!this.data) return null;
		const base = this.data.fuelStats;
		const ft = this.fuelType();
		const tank = this.tankSize();
		if (base.fuelType === ft && base.tankSizeL === tank) return base;
		// Recalcule localement le nombre de fill-ups et le coût si changement de réservoir
		// (le type de carburant change les prix — géré via le signal dans map.ts au reload)
		const byMonth = base.byMonth.map((m) => ({
			...m,
			fillUps: estimateFillUps(m.litersConsumed, tank),
		}));
		return { ...base, tankSizeL: tank, byMonth, totalFillUps: byMonth.reduce((s, m) => s + m.fillUps, 0) };
	}

	avgFillUpsPerMonth(fuel: FuelStats): number {
		if (!fuel.byMonth.length) return 0;
		return Math.round((fuel.totalFillUps / fuel.byMonth.length) * 10) / 10;
	}

	maxFuelMonthCost(): number {
		return Math.max(...(this.data?.fuelStats.byMonth.map((m) => m.cost ?? 0) ?? [1]), 1);
	}

	maxFuelMonthLiters(): number {
		return Math.max(...(this.data?.fuelStats.byMonth.map((m) => m.litersConsumed) ?? [1]), 1);
	}

	selectMonth(idx: number): void {
		this.selectedMonthIdx.set(idx);
	}

	multipleCountries(items: { country: string }[]): boolean {
		return new Set(items.map((i) => i.country)).size > 1;
	}

	trendArrow(current: number, prev: number): '↑' | '↓' | '' {
		if (current > prev) return '↑';
		if (current < prev) return '↓';
		return '';
	}

	private static shortDateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

	formatShortDate(dateStr: string): string {
		return StatsModalComponent.shortDateFmt.format(new Date(dateStr + 'T12:00:00'));
	}

	countryName(code: string): string {
		return StatsModalComponent.safeCountryName(code);
	}

	isRecent(date: string | null): boolean {
		if (!date) return false;
		const currentMonth = new Date().toISOString().substring(0, 7);
		return date.substring(0, 7) === currentMonth;
	}

	recentRecordsExist(): boolean {
		const r = this.data?.recentStats;
		if (!r) return false;
		return (
			this.isRecent(r.speedRecordDate) ||
			this.isRecent(r.leanRecordDate) ||
			this.isRecent(r.longestTripDate) ||
			r.bestMonthIsCurrent
		);
	}

	formatEur(v: number): string {
		return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
	}

	formatHours(h: number): string {
		const days = Math.floor(h / 24);
		const remaining = Math.round(h % 24);
		if (days > 0) return `${days}j ${remaining}h`;
		return `${Math.round(h)}h`;
	}

	formatDuration(min: number): string {
		if (min < 60) return `${Math.round(min)} min`;
		const h = Math.floor(min / 60);
		const m = Math.round(min % 60);
		return m > 0 ? `${h}h ${m}min` : `${h}h`;
	}
}
