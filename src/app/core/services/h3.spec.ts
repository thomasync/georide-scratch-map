import { TestBed } from '@angular/core/testing';
import { latLngToCell, cellToChildren } from 'h3-js';
import { H3Service, resolutionForZoom, H3Resolution } from './h3';
import { DatabaseService } from './database';
import {
	createDatabaseServiceMock,
	provideDatabaseServiceMock,
	DatabaseServiceMock,
} from '../../../test/helpers/providers';
import { makeDepartments } from '../../../test/fixtures/geojson';

describe('resolutionForZoom', () => {
	it('returns 6 below zoom 9', () => {
		expect(resolutionForZoom(0)).toBe(6);
		expect(resolutionForZoom(8.99)).toBe(6);
	});

	it('returns 7 at zoom 9 and above', () => {
		expect(resolutionForZoom(9)).toBe(7);
		expect(resolutionForZoom(15)).toBe(7);
	});
});

describe('H3Service', () => {
	let service: H3Service;
	let db: DatabaseServiceMock;

	beforeEach(() => {
		// LoggerService est instancié en interne (new LoggerService()) → on coupe le bruit console
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		db = createDatabaseServiceMock();
		TestBed.configureTestingModule({
			providers: [H3Service, provideDatabaseServiceMock(db)],
		});
		service = TestBed.inject(H3Service);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** Deux points ~666 m l'un de l'autre, dans la même cellule res-6. */
	const A: [number, number] = [43.6, 1.44];
	const B: [number, number] = [43.606, 1.44];

	describe('computeResolution', () => {
		it('counts a cell traversed by a single trip', () => {
			const result = service.computeResolution([{ coords: [A, B], date: '2025-06-01' }], 6);
			const cell = latLngToCell(A[0], A[1], 6);
			expect(result.counts[cell]).toBe(1);
			expect(result.cellToIndices[cell]).toEqual([0]);
		});

		it('ignores trips with fewer than two coordinates', () => {
			const result = service.computeResolution([{ coords: [A], date: '2025-06-01' }], 6);
			expect(Object.keys(result.counts)).toHaveLength(0);
		});

		it('does not count a segment shorter than the minimum distance', () => {
			// ~11 m : bien en dessous du seuil de 500 m
			const near: [number, number] = [43.6001, 1.44];
			const result = service.computeResolution([{ coords: [A, near], date: '2025-06-01' }], 6);
			const cell = latLngToCell(A[0], A[1], 6);
			expect(result.counts[cell]).toBeUndefined();
		});

		it('counts distinct days, not distinct trips, per cell', () => {
			const result = service.computeResolution(
				[
					{ coords: [A, B], date: '2025-06-01' },
					{ coords: [A, B], date: '2025-06-01' }, // même jour → pas de double comptage
					{ coords: [A, B], date: '2025-06-02' }, // jour différent → +1
				],
				6,
			);
			const cell = latLngToCell(A[0], A[1], 6);
			expect(result.counts[cell]).toBe(2);
			// cellToIndices accumule en revanche chaque trajet
			expect(result.cellToIndices[cell]).toEqual([0, 1, 2]);
		});
	});

	describe('computeAllResolutions', () => {
		it('computes both resolutions 6 and 7', () => {
			const result = service.computeAllResolutions([{ coords: [A, B], date: '2025-06-01' }]);
			expect(Object.keys(result).map(Number).sort()).toEqual([6, 7]);
			expect(result[6].counts[latLngToCell(A[0], A[1], 6)]).toBe(1);
			expect(result[7].counts[latLngToCell(A[0], A[1], 7)]).toBe(1);
		});
	});

	describe('cellsToOverlayGeoJSON', () => {
		it('builds a MultiPolygon whose first ring is the world ring', () => {
			const cells = [latLngToCell(43.6, 1.44, 6), latLngToCell(43.65, 1.5, 6)];
			const feature = service.cellsToOverlayGeoJSON(cells);
			expect(feature.type).toBe('Feature');
			expect(feature.geometry.type).toBe('MultiPolygon');
			const worldWithHoles = feature.geometry.coordinates[0];
			// Premier ring = contour monde [-180,-90]...[-180,-90]
			expect(worldWithHoles[0][0]).toEqual([-180, -90]);
			// Au moins un trou (les cellules visitées)
			expect(worldWithHoles.length).toBeGreaterThan(1);
		});
	});

	describe('cellsToHeatmapGeoJSON', () => {
		it('emits one closed polygon per cell with count and cell properties', () => {
			const cell = latLngToCell(43.6, 1.44, 6);
			const fc = service.cellsToHeatmapGeoJSON({ [cell]: 3 });
			expect(fc.features).toHaveLength(1);
			const f = fc.features[0];
			expect(f.properties).toEqual({ count: 3, cell });
			const ring = f.geometry.coordinates[0];
			// Polygone fermé : premier point === dernier point
			expect(ring[0]).toEqual(ring[ring.length - 1]);
		});
	});

	describe('cellsToOutlineGeoJSON', () => {
		it('returns dissolved polygons for a set of cells', () => {
			const cells = [latLngToCell(43.6, 1.44, 6)];
			const fc = service.cellsToOutlineGeoJSON(cells);
			expect(fc.type).toBe('FeatureCollection');
			expect(fc.features.length).toBeGreaterThan(0);
			expect(fc.features[0].geometry.type).toBe('Polygon');
		});
	});

	describe('departmentsToWorldOverlay', () => {
		it('produces a MultiPolygon difference between the world and the departments', () => {
			const feature = service.departmentsToWorldOverlay(makeDepartments());
			expect(feature.geometry.type).toBe('MultiPolygon');
			expect(feature.geometry.coordinates.length).toBeGreaterThan(0);
		});

		it('returns the whole world when there are no departments', () => {
			const feature = service.departmentsToWorldOverlay({ type: 'FeatureCollection', features: [] });
			expect(feature.geometry.coordinates[0][0][0]).toEqual([-180, -90]);
		});
	});

	describe('getCellCenter', () => {
		it('returns the center as [lng, lat]', () => {
			const cell = latLngToCell(43.6, 1.44, 6);
			const [lng, lat] = service.getCellCenter(cell);
			expect(lat).toBeCloseTo(43.6, 1);
			expect(lng).toBeCloseTo(1.44, 1);
		});
	});

	describe('expandCellsToResolution', () => {
		it('returns the same cells when target resolution is 6', () => {
			const cells = [latLngToCell(43.6, 1.44, 6)];
			expect(service.expandCellsToResolution(cells, 6)).toEqual(cells);
		});

		it('expands res-6 cells to their res-7 children', () => {
			const cell = latLngToCell(43.6, 1.44, 6);
			const expanded = service.expandCellsToResolution([cell], 7);
			expect(expanded).toEqual(cellToChildren(cell, 7));
			expect(expanded.length).toBeGreaterThan(1);
		});
	});

	describe('getDepartmentCells', () => {
		it('returns cells covering a department polygon and caches by code', () => {
			const dept = makeDepartments().features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
			const cells = service.getDepartmentCells(dept, 6);
			expect(cells.length).toBeGreaterThan(0);
			// 2e appel → même référence (cache mémoire)
			const again = service.getDepartmentCells(dept, 6);
			expect(again).toBe(cells);
		});
	});

	describe('enrichDepartmentsWithCoverage', () => {
		it('annotates each department with coverage percentage and trip count', () => {
			const departments = makeDepartments();
			// Cellules réellement comprises dans le département "01" (issues de son propre découpage H3)
			const d1Feature = departments.features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
			const d1Cells = service.getDepartmentCells(d1Feature, 6);
			// Marque la moitié des cellules comme visitées → pct clairement > 0
			const visited = d1Cells.slice(0, Math.ceil(d1Cells.length / 2));
			const counts = Object.fromEntries(visited.map((c) => [c, 1]));
			const cellToIndices = { [visited[0]]: [0, 1] };

			const enriched = service.enrichDepartmentsWithCoverage(departments, counts, 6, cellToIndices);
			const d1 = enriched.features.find((f) => f.properties?.['code'] === '01');
			expect(d1?.properties?.['h3Visited']).toBe(visited.length);
			expect(d1?.properties?.['pct']).toBeGreaterThan(0);
			expect(d1?.properties?.['tripCount']).toBe(2);
			// Le département "02" (carré disjoint) n'a aucune cellule visitée
			const d2 = enriched.features.find((f) => f.properties?.['code'] === '02');
			expect(d2?.properties?.['pct']).toBe(0);
		});

		it('persists department cells to IndexedDB after enriching', () => {
			const departments = makeDepartments();
			service.enrichDepartmentsWithCoverage(departments, {}, 6, {});
			expect(db.kvSet).toHaveBeenCalledWith('h3_dept_cells', expect.any(Array));
		});

		it('returns a cached result on the second call with the same key', () => {
			const departments = makeDepartments();
			const counts = { [latLngToCell(0.5, 0.5, 6)]: 1 };
			const first = service.enrichDepartmentsWithCoverage(departments, counts, 6, {});
			const second = service.enrichDepartmentsWithCoverage(departments, counts, 6, {});
			expect(second).toBe(first);
		});

		it('recomputes after invalidateEnrichedCache', () => {
			const departments = makeDepartments();
			const counts = { [latLngToCell(0.5, 0.5, 6)]: 1 };
			const first = service.enrichDepartmentsWithCoverage(departments, counts, 6, {});
			service.invalidateEnrichedCache();
			const second = service.enrichDepartmentsWithCoverage(departments, counts, 6, {});
			expect(second).not.toBe(first);
		});
	});
});
