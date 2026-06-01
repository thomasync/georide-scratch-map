/// <reference lib="webworker" />
import { latLngToCell, gridPathCells, cellToBoundary } from 'h3-js';

const MIN_SEGMENT_METERS = 500;

function haversineMeters(lat0: number, lng0: number, lat1: number, lng1: number): number {
	const R = 6371000;
	const dLat = ((lat1 - lat0) * Math.PI) / 180;
	const dLng = ((lng1 - lng0) * Math.PI) / 180;
	const midLat = ((lat0 + lat1) / 2) * (Math.PI / 180);
	const a = (dLat / 2) ** 2 + Math.cos(midLat) ** 2 * (dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

function pointInPoly(lat: number, lng: number, poly: [number, number][]): boolean {
	let inside = false;
	for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

function segmentMetersInsidePoly(
	lat0: number,
	lng0: number,
	lat1: number,
	lng1: number,
	poly: [number, number][],
): number {
	const dlat = lat1 - lat0,
		dlng = lng1 - lng0;
	const ts: number[] = [0, 1];
	for (let i = 0; i < poly.length; i++) {
		const [ax, ay] = poly[i],
			[bx, by] = poly[(i + 1) % poly.length];
		const ex = bx - ax,
			ey = by - ay;
		const denom = dlat * ey - dlng * ex;
		if (Math.abs(denom) < 1e-12) continue;
		const wx = ax - lat0,
			wy = ay - lng0;
		const t = (wx * ey - wy * ex) / denom;
		const s = (wx * dlng - wy * dlat) / denom;
		if (t >= 0 && t <= 1 && s >= 0 && s <= 1) ts.push(t);
	}
	ts.sort((a, b) => a - b);
	let insideFraction = 0;
	for (let i = 0; i < ts.length - 1; i++) {
		const tMid = (ts[i] + ts[i + 1]) / 2;
		if (pointInPoly(lat0 + tMid * dlat, lng0 + tMid * dlng, poly)) insideFraction += ts[i + 1] - ts[i];
	}
	return insideFraction * haversineMeters(lat0, lng0, lat1, lng1);
}

function tripsToVisitedCells(
	trips: { coords: [number, number][]; date: string }[],
	resolution: number,
): { counts: Record<string, number>; cellToIndices: Record<string, number[]> } {
	const dayVisits: Record<string, Set<string>> = {};
	const cellToIndices: Record<string, number[]> = {};
	const cellDayAssigned: Record<string, Set<string>> = {};
	const boundaryCache = new Map<string, [number, number][]>();
	const getBoundary = (cell: string): [number, number][] => {
		if (!boundaryCache.has(cell)) boundaryCache.set(cell, cellToBoundary(cell) as [number, number][]);
		return boundaryCache.get(cell)!;
	};

	for (let i = 0; i < trips.length; i++) {
		const { coords, date } = trips[i];
		if (coords.length < 2) continue;
		const cellAccum = new Map<string, number>();
		for (let j = 1; j < coords.length; j++) {
			const lat0 = coords[j - 1][0],
				lng0 = coords[j - 1][1];
			const lat1 = coords[j][0],
				lng1 = coords[j][1];
			const c0 = latLngToCell(lat0, lng0, resolution);
			const c1 = latLngToCell(lat1, lng1, resolution);
			if (c0 === c1) {
				cellAccum.set(c0, (cellAccum.get(c0) ?? 0) + haversineMeters(lat0, lng0, lat1, lng1));
			} else {
				for (const c of gridPathCells(c0, c1)) {
					const m = segmentMetersInsidePoly(lat0, lng0, lat1, lng1, getBoundary(c));
					if (m > 0) cellAccum.set(c, (cellAccum.get(c) ?? 0) + m);
				}
			}
		}
		const tripCells = new Set<string>();
		for (const [c, meters] of cellAccum) if (meters >= MIN_SEGMENT_METERS) tripCells.add(c);
		if (!dayVisits[date]) dayVisits[date] = new Set();
		for (const cell of tripCells) {
			dayVisits[date].add(cell);
			if (!cellDayAssigned[cell]?.has(date)) (cellDayAssigned[cell] ??= new Set()).add(date);
			(cellToIndices[cell] ??= []).push(i);
		}
	}

	const counts: Record<string, number> = {};
	for (const cells of Object.values(dayVisits)) for (const cell of cells) counts[cell] = (counts[cell] ?? 0) + 1;

	return { counts, cellToIndices };
}

addEventListener(
	'message',
	({
		data,
	}: MessageEvent<{ trips: { coords: [number, number][]; date: string }[]; resolution: number; id: number }>) => {
		const t0 = performance.now();
		const result = tripsToVisitedCells(data.trips, data.resolution);
		postMessage({ result, id: data.id, ms: Math.round(performance.now() - t0) });
	},
);
