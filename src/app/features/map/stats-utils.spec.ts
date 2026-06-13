import {
	buildStatsData,
	BuildStatsInput,
	tripSeason,
	seasonSortKey,
	countryForCoords,
	pointInFeature,
	raycast,
	findDeptCodeForPoint,
} from './stats-utils';
import { makeTripWithCoords, makePositions } from '../../../test/fixtures/trips';
import { makeDepartments } from '../../../test/fixtures/geojson';
import { TripWithCoords } from '../../core/services/database';

/** Date courante figée pour rendre streaks / fenêtres de 12 mois déterministes. */
const NOW = new Date('2025-07-15T12:00:00.000Z');

/** Jeu de trajets déterministe couvrant deux mois, avec positions pour conso/virages/pauses. */
function makeTrips(): TripWithCoords[] {
	const base = (over: Partial<TripWithCoords>) => makeTripWithCoords({ positions: makePositions(20), ...over });
	return [
		base({
			indexId: 't1',
			startTime: '2025-06-01T09:00:00.000Z',
			endTime: '2025-06-01T10:20:00.000Z',
			distance: 90000,
			averageSpeed: 38,
			maxSpeed: 70,
			niceStartAddress: 'Toulouse',
			niceEndAddress: 'Carcassonne',
		}),
		base({
			indexId: 't2',
			startTime: '2025-06-02T08:00:00.000Z',
			endTime: '2025-06-02T09:00:00.000Z',
			distance: 50000,
			averageSpeed: 30,
			maxSpeed: 55,
			niceStartAddress: 'Toulouse',
			niceEndAddress: 'Albi',
		}),
		base({
			indexId: 't3',
			startTime: '2025-06-15T14:00:00.000Z',
			endTime: '2025-06-15T16:30:00.000Z',
			distance: 180000,
			averageSpeed: 45,
			maxSpeed: 80,
			niceStartAddress: 'Toulouse',
			niceEndAddress: 'Montpellier',
		}),
		base({
			indexId: 't4',
			startTime: '2025-07-01T10:00:00.000Z',
			endTime: '2025-07-01T11:00:00.000Z',
			distance: 60000,
			averageSpeed: 33,
			maxSpeed: 60,
			niceStartAddress: 'Toulouse',
			niceEndAddress: 'Foix',
		}),
		base({
			indexId: 't5',
			startTime: '2025-07-05T09:30:00.000Z',
			endTime: '2025-07-05T12:00:00.000Z',
			distance: 200000,
			averageSpeed: 48,
			maxSpeed: 95,
			niceStartAddress: 'Narbonne',
			niceEndAddress: 'Perpignan',
		}),
	];
}

function makeInput(over: Partial<BuildStatsInput> = {}): BuildStatsInput {
	const trips = makeTrips();
	return {
		tripsWithCoords: trips,
		allTripsWithCoords: trips,
		departments: null,
		cellsByResolution: {},
		deptResolution: 6,
		enrichDepartments: (d) => d,
		fuelPrices: {},
		fuelType: 'SP98',
		allR7Data: null,
		now: NOW,
		...over,
	};
}

describe('buildStatsData', () => {
	it('produces a stable snapshot for a fixed dataset and date', () => {
		const result = buildStatsData(makeInput());
		expect(result).toMatchSnapshot();
	});

	it('aggregates records from all trips', () => {
		const { records } = buildStatsData(makeInput());
		expect(records.totalTrips).toBe(5);
		// totalKm arrondi = somme des distances / 1000
		expect(records.totalKm).toBe(Math.round((90 + 50 + 180 + 60 + 200) * 1000) / 1000);
		expect(records.firstTripDate).toBe('1 juin 2025');
		// Trajet le plus long = 200 km (t5)
		expect(records.longestTrip?.km).toBe(200);
	});

	it('computes distance stats by month and top days', () => {
		const { distanceStats } = buildStatsData(makeInput());
		// Juin (320 km) et juillet (260 km)
		expect(distanceStats.byMonth.map((m) => m.key)).toEqual(['2025-06', '2025-07']);
		expect(distanceStats.byMonth[0].km).toBe(320);
		expect(distanceStats.byMonth[1].km).toBe(260);
		// Le jour le plus roulé = t5 (200 km le 5 juillet)
		expect(distanceStats.topDays[0].km).toBe(200);
		expect(distanceStats.topDays[0].date).toBe('2025-07-05');
	});

	it('converts knots to km/h for speed stats', () => {
		const { speedStats } = buildStatsData(makeInput());
		// maxSpeed le plus élevé = 95 nœuds → 95 * 1.852 ≈ 176 km/h
		expect(speedStats.globalMaxKmh).toBe(Math.round(95 * 1.852));
		expect(speedStats.maxSpeedTripIndexId).toBe('t5');
	});

	it('detects the most frequent start city as home city', () => {
		const { homeCity } = buildStatsData(makeInput());
		// 4 départs sur 5 depuis Toulouse
		expect(homeCity).toBe('Toulouse');
	});

	it('passes the fuel type through and reports months that have consumption', () => {
		const { fuelStats } = buildStatsData(makeInput({ fuelType: 'E10' }));
		expect(fuelStats.fuelType).toBe('E10');
		// byMonth ne garde que les mois avec litres > 0 → juin et juillet 2025
		expect(fuelStats.byMonth.map((m) => m.key)).toEqual(['2025-06', '2025-07']);
		expect(fuelStats.totalLiters).toBeGreaterThan(0);
	});

	it('returns no departments when departments are null', () => {
		const { depts } = buildStatsData(makeInput({ departments: null }));
		expect(depts).toEqual([]);
	});

	it('builds department stats from the enriched coverage callback', () => {
		const departments = makeDepartments();
		const cellsByResolution = { 6: { counts: { c1: 1 }, cellToIndices: { c1: [0] } } };
		// Stub d'enrichissement : le département "01" est couvert à 50 %, "02" à 0 %
		const enrichDepartments: BuildStatsInput['enrichDepartments'] = (d) => ({
			...d,
			features: d.features.map((f) => ({
				...f,
				properties: {
					...f.properties,
					pct: f.properties?.['code'] === '01' ? 50 : 0,
					tripCount: f.properties?.['code'] === '01' ? 3 : 0,
				},
			})),
		});
		const { depts } = buildStatsData(makeInput({ departments, cellsByResolution, enrichDepartments }));
		// Seuls les départements avec pct > 0 sont retenus
		expect(depts).toHaveLength(1);
		expect(depts[0].code).toBe('01');
		expect(depts[0].pct).toBe(50);
		expect(depts[0].trips).toBe(3);
	});

	it('handles an empty dataset without throwing', () => {
		const result = buildStatsData(makeInput({ tripsWithCoords: [], allTripsWithCoords: [] }));
		expect(result.records.totalTrips).toBe(0);
		expect(result.records.totalKm).toBe(0);
		expect(result.distanceStats.byMonth).toEqual([]);
	});
});

describe('geographic helpers', () => {
	describe('tripSeason', () => {
		it('maps months to seasons', () => {
			expect(tripSeason(2025, 4)).toBe('Printemps 2025');
			expect(tripSeason(2025, 7)).toBe('Été 2025');
			expect(tripSeason(2025, 10)).toBe('Automne 2025');
			expect(tripSeason(2025, 1)).toBe('Hiver 2024');
			expect(tripSeason(2025, 12)).toBe('Hiver 2025');
		});
	});

	describe('seasonSortKey', () => {
		it('orders seasons within a year', () => {
			expect(seasonSortKey('Printemps 2025')).toBe(20251);
			expect(seasonSortKey('Été 2025')).toBe(20252);
			expect(seasonSortKey('Automne 2025')).toBe(20253);
			expect(seasonSortKey('Hiver 2025')).toBe(20254);
			expect(seasonSortKey('inconnu')).toBe(0);
		});
	});

	describe('countryForCoords', () => {
		it('returns FR for a central France point matching no neighbour box', () => {
			// FR est le fallback implicite (absent de NEIGHBORING_COUNTRIES) : un point au centre
			// de la France ne tombe dans aucune bbox voisine et retombe donc sur 'FR'.
			expect(countryForCoords(47.0, 2.5)).toBe('FR');
		});

		it('falls back to FR for a point outside every bounding box', () => {
			expect(countryForCoords(-40, 140)).toBe('FR');
		});

		it('attributes a neighbour box when the point lies inside it', () => {
			// Quirk connu : les bbox voisines débordent sur la France (ex. l'Espagne couvre Toulouse).
			expect(countryForCoords(43.6, 1.44)).toBe('ES');
		});
	});

	describe('raycast / pointInFeature', () => {
		const square: [number, number][] = [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
			[0, 0],
		];

		it('detects points inside and outside a ring', () => {
			expect(raycast(0.5, 0.5, square)).toBe(true);
			expect(raycast(5, 5, square)).toBe(false);
		});

		it('detects points inside a polygon feature', () => {
			const dept = makeDepartments().features[0];
			expect(pointInFeature(0.5, 0.5, dept)).toBe(true);
			expect(pointInFeature(5, 5, dept)).toBe(false);
		});
	});

	describe('findDeptCodeForPoint', () => {
		it('returns the department code containing the point', () => {
			const departments = makeDepartments();
			expect(findDeptCodeForPoint(departments, 0.5, 0.5)).toBe('01');
			expect(findDeptCodeForPoint(departments, 2.5, 2.5)).toBe('02');
			expect(findDeptCodeForPoint(departments, 5, 5)).toBeNull();
		});

		it('returns null when there are no departments', () => {
			expect(findDeptCodeForPoint(null, 0.5, 0.5)).toBeNull();
		});
	});
});
