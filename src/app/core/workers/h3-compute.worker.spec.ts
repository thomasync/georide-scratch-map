import { cellToLatLng, gridPathCells, latLngToCell } from 'h3-js';
import { haversineMeters, pointInPoly, segmentMetersInsidePoly, tripsToVisitedCells } from './h3-compute.worker';
import { makeTripWithCoords, resetTripSeq } from '../../../test/fixtures/trips';

// Carré [0,0]-[1,1] en coordonnées [lat, lng]
const SQUARE: [number, number][] = [
	[0, 0],
	[0, 1],
	[1, 1],
	[1, 0],
];

// Forme en L (concave) : couvre [0,2]x[0,1] + [0,1]x[1,2], encoche en lat∈(1,2), lng∈(1,2)
const L_SHAPE: [number, number][] = [
	[0, 0],
	[0, 2],
	[1, 2],
	[1, 1],
	[2, 1],
	[2, 0],
];

const RES = 7;

/** Centre de la cellule H3 contenant le point donné. */
function cellCenter(lat: number, lng: number): { cell: string; lat: number; lng: number } {
	const cell = latLngToCell(lat, lng, RES);
	const [cLat, cLng] = cellToLatLng(cell);
	return { cell, lat: cLat, lng: cLng };
}

describe('h3-compute.worker', () => {
	beforeEach(() => {
		resetTripSeq();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('module import', () => {
		it('imports without crashing and exposes the pure functions', () => {
			// Le addEventListener top-level s'exécute à l'import — jsdom fournit le global
			expect(typeof haversineMeters).toBe('function');
			expect(typeof pointInPoly).toBe('function');
			expect(typeof segmentMetersInsidePoly).toBe('function');
			expect(typeof tripsToVisitedCells).toBe('function');
		});

		it('responds to a message event by posting the result with id and timing', () => {
			const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
			window.dispatchEvent(new MessageEvent('message', { data: { trips: [], resolution: RES, id: 42 } }));
			expect(postMessageSpy).toHaveBeenCalledTimes(1);
			expect(postMessageSpy).toHaveBeenCalledWith({
				result: { counts: {}, cellToIndices: {} },
				id: 42,
				ms: expect.any(Number),
			});
		});
	});

	describe('haversineMeters', () => {
		it('returns 0 for identical points', () => {
			expect(haversineMeters(43.6, 1.44, 43.6, 1.44)).toBe(0);
		});

		it('returns ~111195 m for 1 degree of latitude', () => {
			// 1° de latitude ≈ R * π/180 ≈ 111.2 km
			expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111195, -2);
		});

		it('matches the latitude distance for 1 degree of longitude at the equator', () => {
			expect(haversineMeters(0, 0, 0, 1)).toBeCloseTo(haversineMeters(0, 0, 1, 0), 6);
		});

		it('shrinks longitude distance by cos(latitude)', () => {
			// cos(60°) = 0.5 → moitié de la distance à l'équateur
			expect(haversineMeters(60, 0, 60, 1)).toBeCloseTo(55598, -2);
		});

		it('is symmetric', () => {
			expect(haversineMeters(43.6, 1.44, 43.7, 1.5)).toBe(haversineMeters(43.7, 1.5, 43.6, 1.44));
		});

		it('approximates a known city pair distance (Paris-Lyon ~392 km)', () => {
			const d = haversineMeters(48.8566, 2.3522, 45.764, 4.8357);
			expect(d).toBeGreaterThan(385_000);
			expect(d).toBeLessThan(400_000);
		});
	});

	describe('pointInPoly', () => {
		it('returns true for a point inside the square', () => {
			expect(pointInPoly(0.5, 0.5, SQUARE)).toBe(true);
		});

		it('returns false for points outside the square', () => {
			expect(pointInPoly(1.5, 0.5, SQUARE)).toBe(false);
			expect(pointInPoly(0.5, -0.1, SQUARE)).toBe(false);
			expect(pointInPoly(2, 2, SQUARE)).toBe(false);
			expect(pointInPoly(-0.5, 0.5, SQUARE)).toBe(false);
		});

		it('uses half-open semantics on the boundary (ray casting)', () => {
			// Bord lat=0 inclus, bord lat=1 exclu — comportement classique du ray casting
			expect(pointInPoly(0, 0.5, SQUARE)).toBe(true);
			expect(pointInPoly(1, 0.5, SQUARE)).toBe(false);
		});

		it('treats the (0,0) vertex as inside', () => {
			expect(pointInPoly(0, 0, SQUARE)).toBe(true);
		});

		it('handles a concave polygon', () => {
			expect(pointInPoly(1.5, 1.5, L_SHAPE)).toBe(false); // dans l'encoche
			expect(pointInPoly(1.5, 0.5, L_SHAPE)).toBe(true); // bras du bas
			expect(pointInPoly(0.5, 1.5, L_SHAPE)).toBe(true); // bras de gauche
		});
	});

	describe('segmentMetersInsidePoly', () => {
		it('returns the full haversine length for a segment entirely inside', () => {
			const result = segmentMetersInsidePoly(0.2, 0.5, 0.8, 0.5, SQUARE);
			expect(result).toBeCloseTo(haversineMeters(0.2, 0.5, 0.8, 0.5), 6);
			expect(result).toBeGreaterThan(0);
		});

		it('returns 0 for a segment entirely outside', () => {
			expect(segmentMetersInsidePoly(2, 2, 3, 2, SQUARE)).toBe(0);
		});

		it('returns half the length for a segment half inside', () => {
			// Entre à lng=0 au milieu du segment
			const result = segmentMetersInsidePoly(0.5, -0.5, 0.5, 0.5, SQUARE);
			expect(result).toBeCloseTo(0.5 * haversineMeters(0.5, -0.5, 0.5, 0.5), 6);
		});

		it('counts only the traversed fraction for a segment crossing the whole square', () => {
			// Traverse de lat=-0.5 à lat=1.5 : entre à t=0.25, sort à t=0.75 → fraction 0.5
			const result = segmentMetersInsidePoly(-0.5, 0.5, 1.5, 0.5, SQUARE);
			expect(result).toBeCloseTo(0.5 * haversineMeters(-0.5, 0.5, 1.5, 0.5), 6);
		});

		it('returns 0 for a zero-length segment', () => {
			expect(segmentMetersInsidePoly(0.5, 0.5, 0.5, 0.5, SQUARE)).toBe(0);
		});
	});

	describe('tripsToVisitedCells', () => {
		it('returns empty results for an empty trips array', () => {
			expect(tripsToVisitedCells([], RES)).toEqual({ counts: {}, cellToIndices: {} });
		});

		it('ignores trips with fewer than 2 coords', () => {
			const trips = [
				{ coords: [] as [number, number][], date: '2025-06-01' },
				{ coords: [[43.6, 1.44]] as [number, number][], date: '2025-06-01' },
			];
			expect(tripsToVisitedCells(trips, RES)).toEqual({ counts: {}, cellToIndices: {} });
		});

		it('excludes cells with less than 500 m travelled inside', () => {
			const { cell, lat, lng } = cellCenter(43.6, 1.44);
			// ~110 m autour du centre — même cellule, sous le seuil
			const coords: [number, number][] = [
				[lat - 0.0005, lng],
				[lat + 0.0005, lng],
			];
			expect(latLngToCell(coords[0][0], coords[0][1], RES)).toBe(cell);
			expect(latLngToCell(coords[1][0], coords[1][1], RES)).toBe(cell);
			expect(tripsToVisitedCells([{ coords, date: '2025-06-01' }], RES)).toEqual({
				counts: {},
				cellToIndices: {},
			});
		});

		it('counts a single-cell trip of at least 500 m', () => {
			const { cell, lat, lng } = cellCenter(43.6, 1.44);
			// ~556 m autour du centre — même cellule, au-dessus du seuil
			const coords: [number, number][] = [
				[lat - 0.0025, lng],
				[lat + 0.0025, lng],
			];
			expect(latLngToCell(coords[0][0], coords[0][1], RES)).toBe(cell);
			expect(latLngToCell(coords[1][0], coords[1][1], RES)).toBe(cell);
			const { counts, cellToIndices } = tripsToVisitedCells([{ coords, date: '2025-06-01' }], RES);
			expect(counts).toEqual({ [cell]: 1 });
			expect(cellToIndices).toEqual({ [cell]: [0] });
		});

		it('accumulates meters across segments of the same trip within one cell', () => {
			const { cell, lat, lng } = cellCenter(43.6, 1.44);
			// Deux segments de ~300 m chacun (< 500 m individuellement, ~600 m cumulés)
			const coords: [number, number][] = [
				[lat - 0.0027, lng],
				[lat, lng],
				[lat + 0.0027, lng],
			];
			for (const [cLat, cLng] of coords) expect(latLngToCell(cLat, cLng, RES)).toBe(cell);
			const { counts } = tripsToVisitedCells([{ coords, date: '2025-06-01' }], RES);
			expect(counts).toEqual({ [cell]: 1 });
		});

		it('counts distinct days per cell, not distinct trips', () => {
			const { lat, lng, cell } = cellCenter(43.6, 1.44);
			const coords: [number, number][] = [
				[lat - 0.0025, lng],
				[lat + 0.0025, lng],
			];
			const trips = [
				{ coords, date: '2025-06-01' },
				{ coords, date: '2025-06-02' },
				{ coords, date: '2025-06-02' },
			];
			const { counts, cellToIndices } = tripsToVisitedCells(trips, RES);
			// 2 jours distincts seulement, mais les 3 indices de trips sont référencés
			expect(counts).toEqual({ [cell]: 2 });
			expect(cellToIndices).toEqual({ [cell]: [0, 1, 2] });
		});

		it('counts the same cell once for two trips on the same day', () => {
			const { lat, lng, cell } = cellCenter(43.6, 1.44);
			const coords: [number, number][] = [
				[lat - 0.0025, lng],
				[lat + 0.0025, lng],
			];
			const trips = [
				{ coords, date: '2025-06-01' },
				{ coords, date: '2025-06-01' },
			];
			const { counts, cellToIndices } = tripsToVisitedCells(trips, RES);
			expect(counts).toEqual({ [cell]: 1 });
			expect(cellToIndices).toEqual({ [cell]: [0, 1] });
		});

		it('splits a multi-cell segment along the grid path and counts both endpoint cells', () => {
			const start = cellCenter(43.6, 1.44);
			const end = cellCenter(43.6 + 0.05, 1.44); // ~5,5 km plus au nord
			expect(end.cell).not.toBe(start.cell);
			const coords: [number, number][] = [
				[start.lat, start.lng],
				[end.lat, end.lng],
			];
			const { counts, cellToIndices } = tripsToVisitedCells([{ coords, date: '2025-06-01' }], RES);
			expect(counts[start.cell]).toBe(1);
			expect(counts[end.cell]).toBe(1);
			// Toutes les cellules retenues sont sur le chemin H3 entre les deux extrémités
			const path = new Set(gridPathCells(start.cell, end.cell));
			for (const cell of Object.keys(counts)) {
				expect(path.has(cell)).toBe(true);
				expect(cellToIndices[cell]).toEqual([0]);
			}
		});

		it('excludes all cells when a short segment straddles a cell boundary', () => {
			// Cherche un segment de ~400 m dont les extrémités tombent dans deux cellules différentes
			const step = 0.0036; // ≈ 400 m de latitude
			let lat = 43.6;
			while (latLngToCell(lat, 1.44, RES) === latLngToCell(lat + step, 1.44, RES)) lat += step;
			const coords: [number, number][] = [
				[lat, 1.44],
				[lat + step, 1.44],
			];
			expect(haversineMeters(lat, 1.44, lat + step, 1.44)).toBeLessThan(500);
			// Chaque cellule reçoit moins de 400 m → aucune ne dépasse le seuil
			expect(tripsToVisitedCells([{ coords, date: '2025-06-01' }], RES)).toEqual({
				counts: {},
				cellToIndices: {},
			});
		});

		it('handles a realistic fixture trip spanning many cells', () => {
			const trip = makeTripWithCoords();
			const trips = [{ coords: trip.coords, date: trip.startTime.substring(0, 10) }];
			const { counts, cellToIndices } = tripsToVisitedCells(trips, RES);
			const cells = Object.keys(counts);
			// Toulouse → Carcassonne (~90 km) traverse beaucoup de cellules res 7 (~2 km)
			expect(cells.length).toBeGreaterThan(10);
			// Un seul jour → chaque cellule comptée une fois, indexée sur le trip 0
			expect(Object.keys(cellToIndices).sort()).toEqual(cells.sort());
			for (const cell of cells) {
				expect(counts[cell]).toBe(1);
				expect(cellToIndices[cell]).toEqual([0]);
			}
		});
	});
});
