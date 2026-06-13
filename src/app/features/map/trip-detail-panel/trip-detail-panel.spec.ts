import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange, SimpleChanges } from '@angular/core';
import { TripDetailPanelComponent } from './trip-detail-panel';
import { FuelService } from '../../../core/services/fuel.service';
import { provideDatabaseServiceMock, provideSilentLogger } from '../../../../test/helpers/providers';
import { makePositions, makeTripWithCoords } from '../../../../test/fixtures/trips';
import { TripWithCoords } from '../map';
import { GeoRidePosition } from '../../../core/services/georide-api';

// jsdom n'a pas ResizeObserver — le composant en instancie un dans ngAfterViewInit
vi.stubGlobal(
	'ResizeObserver',
	class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	},
);

function makeFuelMock() {
	return {
		getPrefs: vi.fn(() => Promise.resolve({ fuelType: 'SP98', tankSize: 15 })),
		getPriceOrNearest: vi.fn(() => Promise.resolve(1.8)),
	};
}

/** Construit le fixture avec le template chart neutralisé (Chart.js inrendrable sous jsdom). */
async function setup(fuel = makeFuelMock()) {
	TestBed.overrideComponent(TripDetailPanelComponent, {
		set: { template: '<div></div>', imports: [] },
	});
	TestBed.configureTestingModule({
		imports: [TripDetailPanelComponent],
		providers: [provideDatabaseServiceMock(), provideSilentLogger(), { provide: FuelService, useValue: fuel }],
	});
	const fixture = TestBed.createComponent(TripDetailPanelComponent);
	const cmp = fixture.componentInstance;
	return { fixture, cmp, fuel };
}

/** Pousse un trip via setInput puis force le recalcul via ngOnChanges (signal inputs + OnChanges). */
async function setTrip(
	fixture: ComponentFixture<TripDetailPanelComponent>,
	trip: TripWithCoords | null,
	positions: GeoRidePosition[] | null = null,
): Promise<void> {
	fixture.componentRef.setInput('trip', trip);
	fixture.componentRef.setInput('positions', positions);
	await fixture.whenStable();
	const changes: SimpleChanges = {
		trip: new SimpleChange(null, trip, true),
	};
	if (positions !== null) {
		changes['positions'] = new SimpleChange(null, positions, true);
	}
	fixture.componentInstance.ngOnChanges(changes);
	await fixture.whenStable();
}

describe('TripDetailPanelComponent', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('creates the component', async () => {
		const { cmp } = await setup();
		expect(cmp).toBeTruthy();
	});

	describe('updateTripMeta (derived stats from trip only)', () => {
		it('computes distance in km, rounded from meters', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords({ distance: 90_000 }));
			expect(cmp.distanceKm).toBe(90);
		});

		it('formats the riding duration (seconds → human string)', async () => {
			const { fixture, cmp } = await setup();
			// 4800 ms → 5 s → "0 min" ; le composant traite duration en ms (Math.round(ms/1000))
			await setTrip(fixture, makeTripWithCoords({ duration: 3_600_000 }));
			expect(cmp.durationStr).toBe('1h 00');
		});

		it('converts average and max speed from knots to km/h', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords({ averageSpeed: 38, maxSpeed: 70 }));
			expect(cmp.avgSpeedKmh).toBe(Math.round(38 * 1.852));
			expect(cmp.maxSpeedKmh).toBe(Math.round(70 * 1.852));
		});

		it('derives start/end city labels from the nice addresses', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords({ niceStartAddress: 'Toulouse', niceEndAddress: 'Carcassonne' }));
			expect(cmp.startLabel).toBe('Toulouse');
			expect(cmp.endLabel).toBe('Carcassonne');
		});

		it('converts the API horizontal angle into a real lean delta (|angle - 90|)', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords({ maxAngle: 60, maxLeftAngle: 65, maxRightAngle: 120 }));
			expect(cmp.maxAngleTrip).toBe(30);
			expect(cmp.maxLeftDeg).toBe(25);
			expect(cmp.maxRightDeg).toBe(30);
		});

		it('computes sinuosity for a point-to-point trip (> 0.5 km crow distance)', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords());
			expect(cmp.sinuosity).not.toBeNull();
			expect(cmp.sinuosity!).toBeGreaterThan(0);
		});

		it('leaves sinuosity null for a loop (start ≈ end)', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(
				fixture,
				makeTripWithCoords({
					startLat: 43.6,
					startLon: 1.44,
					endLat: 43.6,
					endLon: 1.44,
				}),
			);
			expect(cmp.sinuosity).toBeNull();
		});

		it('estimates fuel liters from distance and average speed', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords());
			expect(cmp.estimatedLiters).not.toBeNull();
			expect(cmp.estimatedLiters!).toBeGreaterThan(0);
		});

		it('computes the estimated cost from liters × fuel price', async () => {
			const fuel = makeFuelMock();
			const { fixture, cmp } = await setup(fuel);
			await setTrip(fixture, makeTripWithCoords());
			// getPrefs + getPriceOrNearest sont des promises résolues : on flush la microtask queue
			await fixture.whenStable();
			await Promise.resolve();
			await Promise.resolve();
			await fixture.whenStable();
			expect(fuel.getPrefs).toHaveBeenCalled();
			expect(fuel.getPriceOrNearest).toHaveBeenCalled();
			expect(cmp.estimatedCost).toBe(Math.round(cmp.estimatedLiters! * 1.8 * 100) / 100);
		});
	});

	describe('routeLabel getter', () => {
		it('returns "from → to" when start and end differ', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords({ niceStartAddress: 'Toulouse', niceEndAddress: 'Carcassonne' }));
			expect(cmp.routeLabel).toBe('Toulouse → Carcassonne');
		});

		it('falls back to the start label when there is no distinct destination', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(
				fixture,
				makeTripWithCoords({
					niceStartAddress: 'Toulouse',
					niceEndAddress: 'Toulouse',
					startLat: 43.6,
					startLon: 1.44,
					endLat: 43.6,
					endLon: 1.44,
				}),
			);
			expect(cmp.routeLabel).toBe('Toulouse');
		});
	});

	describe('buildChartData (stats derived from positions)', () => {
		it('clears the loading flag and computes total chart distance once positions arrive', async () => {
			const { fixture, cmp } = await setup();
			const positions = makePositions(60);
			await setTrip(fixture, makeTripWithCoords(), positions);
			expect(cmp.positionsLoading).toBe(false);
			expect(cmp.chartTotalKm).toBeGreaterThan(0);
		});

		it('computes the max lean delta from positions angles', async () => {
			const { fixture, cmp } = await setup();
			// Une position avec un angle marqué (40 → |40-90| = 50)
			const positions = makePositions(40);
			positions[20] = { ...positions[20], angle: 40 };
			await setTrip(fixture, makeTripWithCoords(), positions);
			expect(cmp.maxAngleDelta).toBe(50);
		});

		it('computes the percentage of the trip spent in turns', async () => {
			const { fixture, cmp } = await setup();
			const positions = makePositions(50);
			await setTrip(fixture, makeTripWithCoords(), positions);
			expect(cmp.pctInTurn).not.toBeNull();
			expect(cmp.pctInTurn!).toBeGreaterThanOrEqual(0);
			expect(cmp.pctInTurn!).toBeLessThanOrEqual(100);
		});

		it('records the max-speed highlight position', async () => {
			const { fixture, cmp } = await setup();
			const positions = makePositions(40);
			await setTrip(fixture, makeTripWithCoords(), positions);
			expect(cmp.ptMaxSpeed).not.toBeNull();
			expect(cmp.ptMaxSpeed).toHaveLength(2);
		});

		it('emits statsComputed with the derived stats when positions are processed', async () => {
			const { fixture, cmp } = await setup();
			const spy = vi.fn();
			cmp.statsComputed.subscribe(spy);
			const positions = makePositions(40);
			await setTrip(fixture, makeTripWithCoords(), positions);
			expect(spy).toHaveBeenCalled();
			const payload = spy.mock.calls.at(-1)![0];
			expect(payload).toHaveProperty('altMin');
			expect(payload).toHaveProperty('maxAngleDelta');
			expect(payload).toHaveProperty('pauseCount');
		});

		it('detects a pause when there is a > 2 min gap between two positions', async () => {
			const { fixture, cmp } = await setup();
			const positions = makePositions(30);
			// Crée un trou temporel de 30 min après l'index 14
			for (let i = 15; i < positions.length; i++) {
				positions[i] = {
					...positions[i],
					fixtime: new Date(new Date(positions[i].fixtime).getTime() + 30 * 60_000).toISOString(),
				};
			}
			await setTrip(fixture, makeTripWithCoords(), positions);
			expect(cmp.pauseZones.length).toBeGreaterThan(0);
		});

		it('keeps positionsLoading true while positions are null but a trip is present', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords(), null);
			expect(cmp.positionsLoading).toBe(true);
		});
	});

	describe('outputs', () => {
		it('emits closePanelEvent when the panel is closed', async () => {
			const { fixture, cmp } = await setup();
			const spy = vi.fn();
			cmp.closePanelEvent.subscribe(spy);
			cmp.onClose();
			expect(spy).toHaveBeenCalledTimes(1);
		});

		it('clears the excluded trip ids on close', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords());
			cmp.onClose();
			// Set privé — on vérifie indirectement via allLoopDisplayTrips qui filtre dessus
			expect(cmp.allLoopDisplayTrips.every((d) => d.state !== 'excluded')).toBe(true);
		});

		it('emits showFullDayEvent with the day trips when showing the full day', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords());
			const spy = vi.fn();
			cmp.showFullDayEvent.subscribe(spy);
			cmp.onShowFullDay();
			expect(spy).toHaveBeenCalledTimes(1);
			expect(cmp.isLoopActive).toBe(true);
		});

		it('emits selectTripEvent and resets loop state on trip selection', async () => {
			const { fixture, cmp } = await setup();
			const target = makeTripWithCoords();
			const spy = vi.fn();
			cmp.selectTripEvent.subscribe(spy);
			cmp.onSelectTrip(target, { stopPropagation: vi.fn() } as unknown as Event);
			expect(spy).toHaveBeenCalledWith(target);
			expect(cmp.isLoopActive).toBe(false);
			expect(cmp.showTripsPopup).toBe(false);
		});

		it('toggles follow mode and emits fitTripEvent when disabling it', async () => {
			const { fixture, cmp } = await setup();
			const spy = vi.fn();
			cmp.fitTripEvent.subscribe(spy);
			cmp.onToggleFollow();
			expect(cmp.followEnabled).toBe(true);
			expect(spy).not.toHaveBeenCalled();
			cmp.onToggleFollow();
			expect(cmp.followEnabled).toBe(false);
			expect(spy).toHaveBeenCalledTimes(1);
		});
	});

	describe('onStatToggle', () => {
		it('emits the stat points and snaps to a single point', async () => {
			const { fixture, cmp } = await setup();
			fixture.componentRef.setInput('closeable', true);
			await fixture.whenStable();
			const showSpy = vi.fn();
			const snapSpy = vi.fn();
			cmp.showStatPoints.subscribe(showSpy);
			cmp.snapToPosition.subscribe(snapSpy);
			cmp.onStatToggle('maxSpeed', [[43.6, 1.44]]);
			expect(showSpy).toHaveBeenCalledWith([[43.6, 1.44]]);
			expect(snapSpy).toHaveBeenCalledWith([43.6, 1.44]);
			expect(cmp.activeStatKey).toBe('maxSpeed');
		});

		it('clears the active stat and refits when toggling the same key off', async () => {
			const { fixture, cmp } = await setup();
			fixture.componentRef.setInput('closeable', true);
			await fixture.whenStable();
			const fitSpy = vi.fn();
			cmp.fitTripEvent.subscribe(fitSpy);
			cmp.onStatToggle('maxSpeed', [[43.6, 1.44]]);
			cmp.onStatToggle('maxSpeed', [[43.6, 1.44]]);
			expect(cmp.activeStatKey).toBeNull();
			expect(fitSpy).toHaveBeenCalledTimes(1);
		});

		it('does nothing when the panel is not closeable', async () => {
			const { fixture, cmp } = await setup();
			fixture.componentRef.setInput('closeable', false);
			await fixture.whenStable();
			const showSpy = vi.fn();
			cmp.showStatPoints.subscribe(showSpy);
			cmp.onStatToggle('maxSpeed', [[43.6, 1.44]]);
			expect(showSpy).not.toHaveBeenCalled();
			expect(cmp.activeStatKey).toBeNull();
		});
	});

	describe('pauseCount / totalPauseDurationStr getters', () => {
		it('returns 0 pauses and null total duration with no pause zones', async () => {
			const { fixture, cmp } = await setup();
			await setTrip(fixture, makeTripWithCoords());
			expect(cmp.pauseCount).toBe(0);
			expect(cmp.totalPauseDurationStr).toBeNull();
		});
	});

	describe('helpers', () => {
		it('roundKm converts meters to rounded km', async () => {
			const { cmp } = await setup();
			expect(cmp.roundKm(90_400)).toBe(90);
			expect(cmp.roundKm(89_600)).toBe(90);
		});

		it('tripRoute builds a "from → to" string from a trip', async () => {
			const { cmp } = await setup();
			const route = cmp.tripRoute(
				makeTripWithCoords({ niceStartAddress: 'Toulouse', niceEndAddress: 'Carcassonne' }),
			);
			expect(route).toBe('Toulouse → Carcassonne');
		});
	});
});
