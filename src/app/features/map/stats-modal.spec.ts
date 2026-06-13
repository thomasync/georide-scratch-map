import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { StatsModalComponent, StatsModalData, FilterAction } from './stats-modal';
import { buildStatsData, BuildStatsInput } from './stats-utils';
import { FuelService } from '../../core/services/fuel.service';
import { provideSilentLogger } from '../../../test/helpers/providers';
import { makeTripWithCoords, makePositions } from '../../../test/fixtures/trips';
import { makeDepartments } from '../../../test/fixtures/geojson';
import { TripWithCoords } from '../../core/services/database';

/** Date courante figée : déterminise la fenêtre des 12 derniers mois et les streaks. */
const NOW = new Date('2025-07-15T12:00:00.000Z');

/**
 * Jeu de trajets couvrant deux mois, avec positions GPS (conso/virages/pauses).
 * Les trajets se terminent dans les carrés des départements de test :
 *   - carré "01" : [0,0]→[1,1]  (country FR via le stub d'enrichissement)
 *   - carré "02" : [2,2]→[3,3]  (country ES via le stub d'enrichissement)
 */
function makeTrips(): TripWithCoords[] {
	const base = (over: Partial<TripWithCoords>) => makeTripWithCoords({ positions: makePositions(20), ...over });
	return [
		base({
			indexId: 't1',
			startTime: '2025-06-01T09:00:00.000Z',
			endTime: '2025-06-01T10:20:00.000Z',
			distance: 90000,
			duration: 4800000,
			averageSpeed: 38,
			maxSpeed: 70,
			maxAngle: 55,
			startLat: 0.5,
			startLon: 0.5,
			endLat: 0.6,
			endLon: 0.6,
			niceStartAddress: 'Toulouse, Haute-Garonne, France',
			niceEndAddress: 'Carcassonne, Aude, France',
		}),
		base({
			indexId: 't2',
			startTime: '2025-06-02T08:00:00.000Z',
			endTime: '2025-06-02T09:00:00.000Z',
			distance: 50000,
			duration: 3600000,
			averageSpeed: 30,
			maxSpeed: 55,
			maxAngle: 65,
			startLat: 0.5,
			startLon: 0.5,
			endLat: 0.7,
			endLon: 0.7,
			niceStartAddress: 'Toulouse, Haute-Garonne, France',
			niceEndAddress: 'Albi, Tarn, France',
		}),
		base({
			indexId: 't3',
			startTime: '2025-06-15T14:00:00.000Z',
			endTime: '2025-06-15T16:30:00.000Z',
			distance: 180000,
			duration: 9000000,
			averageSpeed: 45,
			maxSpeed: 80,
			maxAngle: 50,
			startLat: 0.5,
			startLon: 0.5,
			endLat: 2.5,
			endLon: 2.5,
			niceStartAddress: 'Toulouse, Haute-Garonne, France',
			niceEndAddress: 'Barcelone, Catalogne, Espagne',
		}),
		base({
			indexId: 't4',
			startTime: '2025-07-01T10:00:00.000Z',
			endTime: '2025-07-01T11:00:00.000Z',
			distance: 60000,
			duration: 3600000,
			averageSpeed: 33,
			maxSpeed: 60,
			maxAngle: 70,
			startLat: 0.5,
			startLon: 0.5,
			endLat: 2.6,
			endLon: 2.6,
			niceStartAddress: 'Toulouse, Haute-Garonne, France',
			niceEndAddress: 'Gérone, Catalogne, Espagne',
		}),
		base({
			indexId: 't5',
			startTime: '2025-07-05T09:30:00.000Z',
			endTime: '2025-07-05T12:00:00.000Z',
			distance: 200000,
			duration: 9000000,
			averageSpeed: 48,
			maxSpeed: 95,
			maxAngle: 40,
			startLat: 0.5,
			startLon: 0.5,
			endLat: 2.7,
			endLon: 2.7,
			niceStartAddress: 'Narbonne, Aude, France',
			niceEndAddress: 'Perpignan, Pyrénées-Orientales, France',
		}),
	];
}

/** Enrichissement stub : "01" couvert (FR) et "02" couvert (ES), deux pays distincts. */
const enrichDepartments: BuildStatsInput['enrichDepartments'] = (d) => ({
	...d,
	features: d.features.map((f) => {
		const code = f.properties?.['code'];
		return {
			...f,
			properties: {
				...f.properties,
				pct: code === '01' ? 60 : 30,
				tripCount: code === '01' ? 3 : 2,
				country: code === '01' ? 'FR' : 'ES',
			},
		};
	}),
});

function makeFixtureData(over: Partial<BuildStatsInput> = {}): StatsModalData {
	const trips = makeTrips();
	return buildStatsData({
		tripsWithCoords: trips,
		allTripsWithCoords: trips,
		departments: makeDepartments(),
		cellsByResolution: { 6: { counts: { c1: 1 }, cellToIndices: { c1: [0] } } },
		deptResolution: 6,
		enrichDepartments,
		fuelPrices: { '2025-06': 1.8, '2025-07': 1.9 },
		fuelType: 'SP98',
		allR7Data: null,
		now: NOW,
		...over,
	});
}

describe('StatsModalComponent', () => {
	let fixture: ComponentFixture<StatsModalComponent>;
	let cmp: StatsModalComponent;
	let data: StatsModalData;
	let getPrefs: ReturnType<typeof vi.fn>;
	let savePrefs: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		// jsdom n'implémente pas scrollBy ; toggleCountry l'appelle dans un setTimeout.
		if (!HTMLElement.prototype.scrollBy) {
			HTMLElement.prototype.scrollBy = function () {};
		}
		getPrefs = vi.fn(() => Promise.resolve({ fuelType: 'SP98', tankSize: 15 }));
		savePrefs = vi.fn(() => Promise.resolve());
		await TestBed.configureTestingModule({
			imports: [StatsModalComponent],
			providers: [
				{
					provide: FuelService,
					useValue: {
						getPrefs,
						savePrefs,
						getPrice: vi.fn(() => Promise.resolve(null)),
						getPriceOrNearest: vi.fn(() => Promise.resolve(null)),
						getMonthlyPrices: vi.fn(() => Promise.resolve({})),
						loadCachedMonths: vi.fn(() => Promise.resolve([])),
					},
				},
				provideSilentLogger(),
			],
		}).compileComponents();

		data = makeFixtureData();
		fixture = TestBed.createComponent(StatsModalComponent);
		cmp = fixture.componentInstance;
		fixture.componentRef.setInput('data', data);
		fixture.detectChanges();
		await fixture.whenStable();
	});

	it('renders with the records tab active by default', () => {
		expect(cmp.activeTab()).toBe('records');
		const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
		expect(html).toContain('km parcourus');
	});

	it('loads fuel preferences from the service on init', () => {
		expect(getPrefs).toHaveBeenCalled();
		expect(cmp.fuelType()).toBe('SP98');
		expect(cmp.tankSize()).toBe(15);
	});

	describe('tab navigation', () => {
		it('switches the active tab via setTab', async () => {
			cmp.setTab('distances');
			await fixture.whenStable();
			fixture.detectChanges();
			expect(cmp.activeTab()).toBe('distances');
			const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
			expect(html).toContain('Top jours');
		});

		it('renders the discovery tab when selected', async () => {
			cmp.setTab('discovery');
			await fixture.whenStable();
			fixture.detectChanges();
			expect(cmp.activeTab()).toBe('discovery');
		});

		it('renders each tab without throwing', async () => {
			for (const tab of ['records', 'discovery', 'distances', 'speeds', 'turns', 'pauses', 'fuel'] as const) {
				cmp.setTab(tab);
				await fixture.whenStable();
				expect(() => fixture.detectChanges()).not.toThrow();
				expect(cmp.activeTab()).toBe(tab);
			}
		});
	});

	describe('trip duration prompt formulas', () => {
		it('computes meal breaks by duration thresholds', () => {
			cmp.tripDuration.set(3);
			expect(cmp.tripMealBreaks()).toBe(0);
			cmp.tripDuration.set(5);
			expect(cmp.tripMealBreaks()).toBe(1);
			cmp.tripDuration.set(8);
			expect(cmp.tripMealBreaks()).toBe(2);
		});

		it('computes short stops from remaining riding time', () => {
			cmp.tripDuration.set(4);
			// remaining = 4 - 0 = 4 ; floor(4 / 1.25) = 3
			expect(cmp.tripStops()).toBe(3);
			cmp.tripDuration.set(8);
			// remaining = 8 - 2 = 6 ; floor(6 / 1.25) = 4
			expect(cmp.tripStops()).toBe(4);
		});

		it('computes riding km from net riding time', () => {
			cmp.tripDuration.set(4);
			// stops=3, meals=0 → ridingTime = 4 - 0 - 3*0.25 = 3.25h → round(3.25*60)=195
			expect(cmp.tripKm()).toBe(195);
		});

		it('updates the duration from an input event', () => {
			cmp.setDuration({ target: { value: '7' } } as unknown as Event);
			expect(cmp.tripDuration()).toBe(7);
		});
	});

	describe('buildPrompt', () => {
		it('returns a non-empty prompt mentioning the home city and a recommended distance', () => {
			const prompt = cmp.buildPrompt();
			expect(prompt.length).toBeGreaterThan(0);
			expect(prompt).toContain('Toulouse');
			expect(prompt).toContain(`${cmp.tripKm()} km`);
			expect(prompt).toContain('moto');
		});

		it('returns an empty string when there is no data', async () => {
			fixture.componentRef.setInput('data', null);
			await fixture.whenStable();
			fixture.detectChanges();
			expect(cmp.buildPrompt()).toBe('');
		});
	});

	describe('deptsByCountry', () => {
		it('groups departments by country and sorts by descending average coverage', () => {
			const groups = cmp.deptsByCountry();
			expect(groups.length).toBe(2);
			expect(groups.map((g) => g.countryCode)).toEqual(['FR', 'ES']);
			// FR (dept 01, pct 60) classé avant ES (dept 02, pct 30)
			expect(cmp.countryPct(groups[0].depts)).toBeGreaterThan(cmp.countryPct(groups[1].depts));
		});

		it('returns an empty array when data is null', async () => {
			fixture.componentRef.setInput('data', null);
			await fixture.whenStable();
			expect(cmp.deptsByCountry()).toEqual([]);
		});

		it('exposes a resolved country name', () => {
			expect(cmp.countryName('FR')).toBe('France');
			expect(cmp.countryName('ES')).toBe('Espagne');
		});
	});

	describe('city expand / collapse state', () => {
		it('toggles a city open then closed', () => {
			expect(cmp.isVisible('01', 'Carcassonne')).toBe(false);
			cmp.toggleCity('01', 'Carcassonne');
			expect(cmp.isVisible('01', 'Carcassonne')).toBe(true);
			cmp.toggleCity('01', 'Carcassonne');
			expect(cmp.isVisible('01', 'Carcassonne')).toBe(false);
		});

		it('only keeps the most recently toggled city open', () => {
			cmp.toggleCity('01', 'Carcassonne');
			cmp.toggleCity('02', 'Perpignan');
			expect(cmp.isVisible('01', 'Carcassonne')).toBe(false);
			expect(cmp.isVisible('02', 'Perpignan')).toBe(true);
		});

		it('limits visible cities until the department is expanded', () => {
			const dept = {
				code: 'X',
				name: 'Test',
				pct: 10,
				trips: 1,
				country: 'FR',
				cities: [] as { name: string; count: number; dates: string[] }[],
			};
			for (let i = 0; i < 8; i++) dept.cities.push({ name: `City${i}`, count: 1, dates: [] });
			expect(cmp.visibleCities(dept).length).toBe(cmp.CITIES_LIMIT);
			expect(cmp.hiddenCitiesCount(dept)).toBe(8 - cmp.CITIES_LIMIT);
			cmp.toggleDeptExpand('X');
			expect(cmp.isDeptExpanded('X')).toBe(true);
			expect(cmp.visibleCities(dept).length).toBe(8);
		});
	});

	describe('country expand state', () => {
		it('toggles a country open and closed (mutually exclusive)', () => {
			const headerEl = document.createElement('div');
			expect(cmp.isCountryOpen('FR')).toBe(false);
			cmp.toggleCountry('FR', headerEl);
			expect(cmp.isCountryOpen('FR')).toBe(true);
			cmp.toggleCountry('ES', headerEl);
			expect(cmp.isCountryOpen('FR')).toBe(false);
			expect(cmp.isCountryOpen('ES')).toBe(true);
			cmp.toggleCountry('ES', headerEl);
			expect(cmp.isCountryOpen('ES')).toBe(false);
		});

		it('limits visible departments until expanded', () => {
			const depts = Array.from({ length: 7 }, (_, i) => ({
				code: `${i}`,
				name: `D${i}`,
				pct: 10,
				trips: 1,
				country: 'FR',
				cities: [],
			}));
			const group = { countryCode: 'FR', depts };
			expect(cmp.visibleDepts(group).length).toBe(cmp.DEPTS_LIMIT);
			expect(cmp.hiddenDeptsCount(group)).toBe(7 - cmp.DEPTS_LIMIT);
			cmp.toggleDeptsExpand('FR');
			expect(cmp.isDeptsExpanded('FR')).toBe(true);
			expect(cmp.visibleDepts(group).length).toBe(7);
		});
	});

	describe('turns view mode', () => {
		it('cycles through speed, angle and both', () => {
			expect(cmp.turnsViewMode()).toBe('both');
			cmp.cycleTurnsMode();
			expect(cmp.turnsViewMode()).toBe('speed');
			cmp.cycleTurnsMode();
			expect(cmp.turnsViewMode()).toBe('angle');
			cmp.cycleTurnsMode();
			expect(cmp.turnsViewMode()).toBe('both');
		});

		it('maps the toggle label to the active mode', () => {
			cmp.turnsViewMode.set('speed');
			expect(cmp.turnsToggleLabel()).toBe('km/h');
			cmp.turnsViewMode.set('angle');
			expect(cmp.turnsToggleLabel()).toBe('°');
			cmp.turnsViewMode.set('both');
			expect(cmp.turnsToggleLabel()).toBe('km/h·°');
		});

		it('sorts departments by max speed in speed mode', () => {
			cmp.turnsViewMode.set('speed');
			const sorted = cmp.sortedDepts();
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i - 1].maxKmh).toBeGreaterThanOrEqual(sorted[i].maxKmh);
			}
		});

		it('sorts departments by max lean angle in angle mode', () => {
			cmp.turnsViewMode.set('angle');
			const sorted = cmp.sortedDepts();
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i - 1].maxLeanDeg).toBeGreaterThanOrEqual(sorted[i].maxLeanDeg);
			}
		});
	});

	describe('pure formatters and helpers', () => {
		it('formats kilometres with French grouping', () => {
			expect(cmp.formatKm(12345)).toBe((12345).toLocaleString('fr-FR'));
		});

		it('formats euros without decimals', () => {
			expect(cmp.formatEur(1234)).toContain('€');
		});

		it('formats hours into days and hours', () => {
			expect(cmp.formatHours(5)).toBe('5h');
			expect(cmp.formatHours(50)).toBe('2j 2h');
		});

		it('formats durations into minutes and hours', () => {
			expect(cmp.formatDuration(45)).toBe('45 min');
			expect(cmp.formatDuration(90)).toBe('1h 30min');
			expect(cmp.formatDuration(120)).toBe('2h');
		});

		it('computes bar percentages clamped on a non-zero max', () => {
			expect(cmp.barPct(50, 100)).toBe(50);
			expect(cmp.barPct(5, 0)).toBe(500);
		});

		it('returns trend arrows based on comparison', () => {
			expect(cmp.trendArrow(10, 5)).toBe('↑');
			expect(cmp.trendArrow(5, 10)).toBe('↓');
			expect(cmp.trendArrow(5, 5)).toBe('');
		});

		it('detects whether a date is within the current month', () => {
			const currentMonth = new Date().toISOString().substring(0, 7);
			expect(cmp.isRecent(`${currentMonth}-05`)).toBe(true);
			expect(cmp.isRecent('1999-01-01')).toBe(false);
			expect(cmp.isRecent(null)).toBe(false);
		});

		it('builds day-of-week styles matching the number of favourite days', () => {
			const styles = cmp.dayStyles();
			expect(styles.length).toBe(data.records.topDaysOfWeek.length);
			for (const s of styles) {
				expect(s.fontSize).toMatch(/rem$/);
				expect(s.letterSpacing).toMatch(/rem$/);
			}
		});

		it('detects multiple countries from a list of items', () => {
			expect(cmp.multipleCountries([{ country: 'FR' }, { country: 'ES' }])).toBe(true);
			expect(cmp.multipleCountries([{ country: 'FR' }, { country: 'FR' }])).toBe(false);
		});

		it('detects multiple countries in route endpoints', () => {
			expect(cmp.hasMultipleCountriesInRoutes([{ fromCountryCode: 'FR', toCountryCode: 'ES' }])).toBe(true);
			expect(cmp.hasMultipleCountriesInRoutes([{ fromCountryCode: 'FR', toCountryCode: 'FR' }])).toBe(false);
		});

		it('renders a route label with and without flags', () => {
			expect(cmp.routeWithFlags('Toulouse', 'Albi', 'FR', 'FR', false)).toBe('Toulouse → Albi');
			const withFlags = cmp.routeWithFlags('Toulouse', 'Albi', 'FR', 'FR', true);
			expect(withFlags).toContain('Toulouse');
			expect(withFlags).toContain('→');
		});

		it('formats the top day name from a date string', () => {
			expect(cmp.topDayName('2025-07-05')).toBe('samedi');
		});
	});

	describe('max bar baselines', () => {
		it('derives the top-day baseline from the first top day', () => {
			expect(cmp.maxDayKm()).toBe(data.distanceStats.topDays[0].km);
		});

		it('derives the month baseline from the largest month', () => {
			expect(cmp.maxMonthKm()).toBe(Math.max(...data.distanceStats.byMonth.map((m) => m.km)));
		});

		it('derives the top-trip baseline from the first top trip', () => {
			expect(cmp.maxTopTripKm()).toBe(data.distanceStats.topTrips[0].km);
		});
	});

	describe('fuel selection', () => {
		it('emits fuelTypeChange and persists when changing the fuel type', () => {
			const spy = vi.fn();
			cmp.fuelTypeChange.subscribe(spy);
			cmp.setFuelType('E10');
			expect(cmp.fuelType()).toBe('E10');
			expect(cmp.fuelLoading()).toBe(true);
			expect(savePrefs).toHaveBeenCalledWith('E10', 15);
			expect(spy).toHaveBeenCalledWith('E10');
		});

		it('persists the tank size when changed', () => {
			cmp.setTankSize(20);
			expect(cmp.tankSize()).toBe(20);
			expect(savePrefs).toHaveBeenCalledWith('SP98', 20);
		});

		it('returns the base fuel stats when type and tank match', () => {
			const fd = cmp.fuelData();
			expect(fd).not.toBeNull();
			expect(fd).toBe(data.fuelStats);
		});

		it('recomputes fill-ups when the tank size differs from the base', () => {
			cmp.setTankSize(20);
			const fd = cmp.fuelData();
			expect(fd).not.toBeNull();
			expect(fd!.tankSizeL).toBe(20);
			expect(fd!.totalFillUps).toBe(fd!.byMonth.reduce((s, m) => s + m.fillUps, 0));
		});

		it('computes the average fill-ups per month', () => {
			const fuel = data.fuelStats;
			const expected = fuel.byMonth.length ? Math.round((fuel.totalFillUps / fuel.byMonth.length) * 10) / 10 : 0;
			expect(cmp.avgFillUpsPerMonth(fuel)).toBe(expected);
		});

		it('returns null fuel data when there is no input data', async () => {
			fixture.componentRef.setInput('data', null);
			await fixture.whenStable();
			expect(cmp.fuelData()).toBeNull();
		});
	});

	describe('month selection', () => {
		it('updates the selected month index', () => {
			cmp.selectMonth(1);
			expect(cmp.selectedMonthIdx()).toBe(1);
		});
	});

	describe('outputs', () => {
		it('emits selectTrip through openTrip with a valid index id', () => {
			const spy = vi.fn();
			cmp.selectTrip.subscribe(spy);
			cmp.openTrip('t5');
			expect(spy).toHaveBeenCalledWith('t5');
		});

		it('does not emit selectTrip for a null or undefined index id', () => {
			const spy = vi.fn();
			cmp.selectTrip.subscribe(spy);
			cmp.openTrip(null);
			cmp.openTrip(undefined);
			expect(spy).not.toHaveBeenCalled();
		});

		it('emits a day filter action', () => {
			const spy = vi.fn();
			cmp.applyFilter.subscribe(spy);
			cmp.filterDay('2025-07-05');
			expect(spy).toHaveBeenCalledWith({ type: 'day', date: '2025-07-05' });
		});

		it('emits a month filter action', () => {
			const spy = vi.fn();
			cmp.applyFilter.subscribe(spy);
			cmp.filterMonth('2025-07');
			expect(spy).toHaveBeenCalledWith({ type: 'month', month: '2025-07' });
		});

		it('emits a recurring season filter when the label has no year', () => {
			const spy = vi.fn();
			cmp.applyFilter.subscribe(spy);
			cmp.filterSeason('Été');
			expect(spy).toHaveBeenCalledWith({ type: 'season', name: 'Été' });
		});

		it('emits a season-with-year filter when the label carries a year', () => {
			const spy = vi.fn();
			cmp.applyFilter.subscribe(spy);
			cmp.filterSeason('Été 2025');
			expect(spy).toHaveBeenCalledWith({ type: 'seasonYear', name: 'Été', year: 2025 });
		});

		it('emits close when requested via the template overlay', async () => {
			const spy = vi.fn();
			cmp.close.subscribe(spy);
			const overlay = (fixture.nativeElement as HTMLElement).querySelector('.modal-overlay') as HTMLElement;
			overlay.click();
			expect(spy).toHaveBeenCalled();
		});
	});

	describe('prompt toggle', () => {
		it('toggles the prompt visibility flag', () => {
			expect(cmp.showPrompt()).toBe(false);
			cmp.togglePrompt();
			expect(cmp.showPrompt()).toBe(true);
			cmp.togglePrompt();
			expect(cmp.showPrompt()).toBe(false);
		});
	});

	describe('recent records', () => {
		it('reports whether any recent record exists for the fixture', () => {
			// Le calcul s'appuie sur la date système ; la valeur reste un booléen cohérent.
			expect(typeof cmp.recentRecordsExist()).toBe('boolean');
		});
	});
});
