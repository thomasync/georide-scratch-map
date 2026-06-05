import { TripWithCoords } from '../services/database';

function roughDistKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const dLat = (lat2 - lat1) * 111;
	const dLon = (lon2 - lon1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
	return Math.sqrt(dLat * dLat + dLon * dLon);
}

// Deux trajets sont "liés" si un endpoint de B est proche d'un endpoint de A
// ET l'écart temporel entre eux est inférieur à maxGapH heures.
export function isLinkedTrip(a: TripWithCoords, b: TripWithCoords, maxGapH = 3): boolean {
	const DIST_KM = 3;
	const aEnd = new Date(a.endTime).getTime();
	const bStart = new Date(b.startTime).getTime();
	const bEnd = new Date(b.endTime).getTime();
	const aStart = new Date(a.startTime).getTime();
	const gapMs = Math.min(Math.abs(aEnd - bStart), Math.abs(bEnd - aStart));
	if (gapMs > maxGapH * 3_600_000) return false;
	const pairs: [number, number, number, number][] = [
		[a.startLat, a.startLon, b.startLat, b.startLon],
		[a.startLat, a.startLon, b.endLat, b.endLon],
		[a.endLat, a.endLon, b.startLat, b.startLon],
		[a.endLat, a.endLon, b.endLat, b.endLon],
	];
	return pairs.some(([la1, lo1, la2, lo2]) => roughDistKm(la1, lo1, la2, lo2) <= DIST_KM);
}

// Regroupe tous les trajets en sessions via BFS (même logique que updateDayTrips).
// Chaque session est triée chronologiquement.
export function buildSessions(trips: TripWithCoords[], maxGapH = 3): TripWithCoords[][] {
	const visited = new Set<string>();
	const sessions: TripWithCoords[][] = [];
	for (const trip of trips) {
		if (visited.has(trip.indexId)) continue;
		const sessionSet = new Set([trip.indexId]);
		const queue: TripWithCoords[] = [trip];
		while (queue.length > 0) {
			const current = queue.shift()!;
			for (const candidate of trips) {
				if (!sessionSet.has(candidate.indexId) && isLinkedTrip(current, candidate, maxGapH)) {
					sessionSet.add(candidate.indexId);
					queue.push(candidate);
				}
			}
		}
		const session = trips
			.filter((t) => sessionSet.has(t.indexId))
			.sort((a, b) => a.startTime.localeCompare(b.startTime));
		session.forEach((t) => visited.add(t.indexId));
		sessions.push(session);
	}
	return sessions;
}
