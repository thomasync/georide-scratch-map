import { Injectable } from '@angular/core';
import { latLngToCell, gridPathCells, cellToBoundary, cellToLatLng, polygonToCells, cellsToMultiPolygon } from 'h3-js';
import { LoggerService } from './logger';

export const RESOLUTIONS = [6, 7] as const;
export type H3Resolution = (typeof RESOLUTIONS)[number];

export interface H3Data {
	counts: Record<string, number>; // cell → visit count
	cellToIndices: Record<string, number[]>; // cell → trip indices
}

const WORLD_RING: [number, number][] = [
	[-180, -90],
	[180, -90],
	[180, 90],
	[-180, 90],
	[-180, -90],
];

export function resolutionForZoom(zoom: number): H3Resolution {
	if (zoom < 9) return 6;
	return 7;
}

const DEPT_CELLS_STORAGE_KEY = 'georide_h3_dept_cells_v1';

@Injectable({ providedIn: 'root' })
export class H3Service {
	private deptCellsCache = new Map<string, string[]>();
	private enrichedDeptCache = new Map<string, GeoJSON.FeatureCollection>();
	private logger = new LoggerService();
	private deptCacheDirty = false;

	constructor() {
		this.loadDeptCellsFromStorage();
	}

	private loadDeptCellsFromStorage(): void {
		try {
			const raw = localStorage.getItem(DEPT_CELLS_STORAGE_KEY);
			if (raw) {
				const entries: [string, string[]][] = JSON.parse(raw);
				for (const [k, v] of entries) this.deptCellsCache.set(k, v);
				this.logger.log('H3', `loaded ${entries.length} dept cell entries from localStorage`);
			}
		} catch {}
	}

	private flushDeptCellsToStorage(): void {
		if (!this.deptCacheDirty) return;
		try {
			localStorage.setItem(DEPT_CELLS_STORAGE_KEY, JSON.stringify([...this.deptCellsCache.entries()]));
			this.deptCacheDirty = false;
		} catch {}
	}

	// Invalidate enriched department cache (call when trip data changes)
	invalidateEnrichedCache(): void {
		this.logger.log('H3', 'invalidateEnrichedCache');
		this.enrichedDeptCache.clear();
	}

	// Compute H3 data for a single resolution — use for lazy computation
	computeResolution(trips: { coords: [number, number][]; date: string }[], resolution: H3Resolution): H3Data {
		this.logger.log('H3', `computeResolution res=${resolution} trips=${trips.length} — start`);
		const t0 = performance.now();
		const result = this.tripsToVisitedCells(trips, resolution);
		this.logger.log(
			'H3',
			`computeResolution res=${resolution} — done in ${Math.round(performance.now() - t0)}ms, cells=${Object.keys(result.counts).length}`,
		);
		return result;
	}

	// trips: array of { coords, date } — counts distinct days per cell, not distinct trips
	computeAllResolutions(trips: { coords: [number, number][]; date: string }[]): Record<H3Resolution, H3Data> {
		this.logger.log('H3', `computeAllResolutions trips=${trips.length} — start`);
		const t0 = performance.now();
		const result = Object.fromEntries(
			RESOLUTIONS.map((res) => [res, this.tripsToVisitedCells(trips, res)]),
		) as Record<H3Resolution, H3Data>;
		this.logger.log('H3', `computeAllResolutions — done in ${Math.round(performance.now() - t0)}ms`);
		return result;
	}

	// Minimum total meters a polyline must travel inside a hexagon for it to count as visited.
	// Accumulates across all segments of a trip, so a single barely-clipping GPS point can't
	// trigger a cell — the route must genuinely pass through it.
	private readonly MIN_SEGMENT_METERS = 500;

	private haversineMeters(lat0: number, lng0: number, lat1: number, lng1: number): number {
		const R = 6371000;
		const dLat = ((lat1 - lat0) * Math.PI) / 180;
		const dLng = ((lng1 - lng0) * Math.PI) / 180;
		const midLat = ((lat0 + lat1) / 2) * (Math.PI / 180);
		const a = (dLat / 2) ** 2 + Math.cos(midLat) ** 2 * (dLng / 2) ** 2;
		return 2 * R * Math.asin(Math.sqrt(a));
	}

	// Ray-casting point-in-polygon (works regardless of winding order).
	// poly uses [lat, lng] pairs as returned by cellToBoundary().
	private pointInPoly(lat: number, lng: number, poly: [number, number][]): boolean {
		let inside = false;
		for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
			const [xi, yi] = poly[i];
			const [xj, yj] = poly[j];
			if (yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi) {
				inside = !inside;
			}
		}
		return inside;
	}

	// Meters of segment [lat0,lng0]→[lat1,lng1] that lie inside poly.
	// Finds all edge crossings, sorts by t, checks midpoints to identify interior spans.
	private segmentMetersInsidePoly(
		lat0: number,
		lng0: number,
		lat1: number,
		lng1: number,
		poly: [number, number][],
	): number {
		const dlat = lat1 - lat0;
		const dlng = lng1 - lng0;
		const ts: number[] = [0, 1];

		for (let i = 0; i < poly.length; i++) {
			const [ax, ay] = poly[i];
			const [bx, by] = poly[(i + 1) % poly.length];
			const ex = bx - ax;
			const ey = by - ay;
			const denom = dlat * ey - dlng * ex;
			if (Math.abs(denom) < 1e-12) continue;
			const wx = ax - lat0;
			const wy = ay - lng0;
			const t = (wx * ey - wy * ex) / denom;
			const s = (wx * dlng - wy * dlat) / denom;
			if (t >= 0 && t <= 1 && s >= 0 && s <= 1) ts.push(t);
		}

		ts.sort((a, b) => a - b);

		let insideFraction = 0;
		for (let i = 0; i < ts.length - 1; i++) {
			const tMid = (ts[i] + ts[i + 1]) / 2;
			if (this.pointInPoly(lat0 + tMid * dlat, lng0 + tMid * dlng, poly)) {
				insideFraction += ts[i + 1] - ts[i];
			}
		}

		return insideFraction * this.haversineMeters(lat0, lng0, lat1, lng1);
	}

	private tripsToVisitedCells(
		trips: { coords: [number, number][]; date: string }[],
		resolution: H3Resolution,
	): H3Data {
		this.logger.log('H3', `tripsToVisitedCells res=${resolution} trips=${trips.length} — start`);
		const t0 = performance.now();
		const dayVisits: Record<string, Set<string>> = {}; // date → cells visited that day
		const cellToIndices: Record<string, number[]> = {};
		const cellDayAssigned: Record<string, Set<string>> = {}; // cell → dates already assigned an index
		const boundaryCache = new Map<string, [number, number][]>();

		const getBoundary = (cell: string): [number, number][] => {
			if (!boundaryCache.has(cell)) boundaryCache.set(cell, cellToBoundary(cell) as [number, number][]);
			return boundaryCache.get(cell)!;
		};

		for (let i = 0; i < trips.length; i++) {
			const { coords, date } = trips[i];
			if (coords.length < 2) continue;

			// Accumulate total meters per cell across all segments of this trip.
			// This means a GPS point barely inside a cell edge won't count unless the
			// route actually travels a meaningful distance through it.
			const cellAccum = new Map<string, number>();

			for (let j = 1; j < coords.length; j++) {
				const lat0 = coords[j - 1][0],
					lng0 = coords[j - 1][1];
				const lat1 = coords[j][0],
					lng1 = coords[j][1];
				const c0 = latLngToCell(lat0, lng0, resolution);
				const c1 = latLngToCell(lat1, lng1, resolution);

				if (c0 === c1) {
					cellAccum.set(c0, (cellAccum.get(c0) ?? 0) + this.haversineMeters(lat0, lng0, lat1, lng1));
				} else {
					for (const c of gridPathCells(c0, c1)) {
						const m = this.segmentMetersInsidePoly(lat0, lng0, lat1, lng1, getBoundary(c));
						if (m > 0) cellAccum.set(c, (cellAccum.get(c) ?? 0) + m);
					}
				}
			}

			const tripCells = new Set<string>();
			for (const [c, meters] of cellAccum) {
				if (meters >= this.MIN_SEGMENT_METERS) tripCells.add(c);
			}

			if (!dayVisits[date]) dayVisits[date] = new Set();
			for (const cell of tripCells) {
				dayVisits[date].add(cell);
				if (!cellDayAssigned[cell]?.has(date)) {
					(cellDayAssigned[cell] ??= new Set()).add(date);
					(cellToIndices[cell] ??= []).push(i);
				}
			}
		}

		// Count = number of distinct days the cell was visited
		const counts: Record<string, number> = {};
		for (const cells of Object.values(dayVisits)) {
			for (const cell of cells) {
				counts[cell] = (counts[cell] ?? 0) + 1;
			}
		}

		this.logger.log(
			'H3',
			`tripsToVisitedCells res=${resolution} — done in ${Math.round(performance.now() - t0)}ms, cells=${Object.keys(counts).length}`,
		);
		return { counts, cellToIndices };
	}

	// World overlay with visited cells as holes.
	// Uses cellsToMultiPolygon to dissolve adjacent cells into merged clusters for performance.
	// Returns a MultiPolygon: world-with-outer-holes + inner-covers to re-fill ring interiors,
	// so a circular trip doesn't incorrectly reveal the area inside the ring.
	cellsToOverlayGeoJSON(cells: string[]): GeoJSON.Feature<GeoJSON.MultiPolygon> {
		this.logger.log('H3', `cellsToOverlayGeoJSON cells=${cells.length}`);
		const merged = cellsToMultiPolygon(cells, true) as [number, number][][][];

		const worldWithHoles = [WORLD_RING, ...merged.map((poly) => poly[0])];
		const innerCovers = merged
			.filter((poly) => poly.length > 1)
			.flatMap((poly) => poly.slice(1).map((ring) => [ring]));

		return {
			type: 'Feature',
			geometry: {
				type: 'MultiPolygon',
				coordinates: [worldWithHoles, ...innerCovers] as unknown as GeoJSON.Position[][][],
			},
			properties: {},
		};
	}

	// FeatureCollection with count + cell ID per hexagon (for heatmap, borders, click)
	cellsToHeatmapGeoJSON(counts: Record<string, number>): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
		this.logger.log('H3', `cellsToHeatmapGeoJSON cells=${Object.keys(counts).length}`);
		return {
			type: 'FeatureCollection',
			features: Object.entries(counts).map(([cell, count]) => {
				const boundary = cellToBoundary(cell, true) as [number, number][];
				return {
					type: 'Feature',
					geometry: { type: 'Polygon', coordinates: [[...boundary, boundary[0]]] },
					properties: { count, cell },
				};
			}),
		};
	}

	// World polygon with department boundaries as holes — used as overlay in dept mode
	departmentsToWorldOverlay(departments: GeoJSON.FeatureCollection): GeoJSON.Feature<GeoJSON.Polygon> {
		this.logger.log('H3', `departmentsToWorldOverlay features=${departments.features.length}`);
		const holes: GeoJSON.Position[][] = [];
		for (const feature of departments.features) {
			const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
			if (geom.type === 'Polygon') {
				holes.push(geom.coordinates[0]);
			} else {
				for (const poly of geom.coordinates) holes.push(poly[0]);
			}
		}
		return {
			type: 'Feature',
			geometry: { type: 'Polygon', coordinates: [WORLD_RING as GeoJSON.Position[], ...holes] },
			properties: {},
		};
	}

	// Returns [lng, lat] center of a cell for MapLibre popup positioning
	getCellCenter(cell: string): [number, number] {
		const [lat, lng] = cellToLatLng(cell);
		return [lng, lat];
	}

	// Enriches a dept GeoJSON with coverage stats at given resolution — result is cached
	enrichDepartmentsWithCoverage(
		departments: GeoJSON.FeatureCollection,
		counts: Record<string, number>,
		resolution: H3Resolution,
		cellToIndices: Record<string, number[]>,
	): GeoJSON.FeatureCollection {
		const cacheKey = `${resolution}_${Object.keys(counts).length}`;
		const cached = this.enrichedDeptCache.get(cacheKey);
		if (cached) {
			this.logger.log('H3', `enrichDepartmentsWithCoverage cache HIT key=${cacheKey}`);
			return cached;
		}
		this.logger.log('H3', `enrichDepartmentsWithCoverage cache MISS key=${cacheKey} — computing`);
		const t0 = performance.now();

		const visitedSet = new Set(Object.keys(counts));
		const result: GeoJSON.FeatureCollection = {
			...departments,
			features: departments.features.map((feature) => {
				const cells = this.getDepartmentCells(
					feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
					resolution,
				);
				const h3Total = cells.length;
				const h3Visited = cells.filter((c) => visitedSet.has(c)).length;
				const pct = h3Total > 0 ? Math.round((h3Visited / h3Total) * 100) : 0;
				const tripIndices = new Set<number>();
				for (const cell of cells) {
					for (const idx of cellToIndices[cell] ?? []) tripIndices.add(idx);
				}
				return {
					...feature,
					properties: {
						...feature.properties,
						h3Total,
						h3Visited,
						pct,
						tripCount: tripIndices.size,
					},
				};
			}),
		};
		this.logger.log('H3', `enrichDepartmentsWithCoverage — done in ${Math.round(performance.now() - t0)}ms`);
		this.enrichedDeptCache.set(cacheKey, result);
		this.flushDeptCellsToStorage();
		return result;
	}

	getDepartmentCells(
		feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
		resolution: H3Resolution,
	): string[] {
		const code = (feature.properties?.['code'] as string) ?? '';
		const key = `${code}_${resolution}`;
		const cached = this.deptCellsCache.get(key);
		if (cached) return cached;

		const geom = feature.geometry;
		const allCells = new Set<string>();

		const processPolygon = (coords: GeoJSON.Position[][]) => {
			// polygonToCells expects [lng, lat] — same as GeoJSON, no conversion needed
			try {
				for (const cell of polygonToCells(coords as [number, number][][], resolution, true)) allCells.add(cell);
			} catch {}
		};

		if (geom.type === 'Polygon') {
			processPolygon(geom.coordinates as GeoJSON.Position[][]);
		} else {
			for (const poly of geom.coordinates as GeoJSON.Position[][][]) processPolygon(poly);
		}

		const result = [...allCells];
		if (code) {
			this.deptCellsCache.set(key, result);
			this.deptCacheDirty = true;
		}
		return result;
	}
}
