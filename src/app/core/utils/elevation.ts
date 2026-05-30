import { GeoRidePosition } from '../services/georide-api';

export interface AltProfile {
	minAlt: number;
	maxAlt: number;
	gain: number;
}

export function computeAltProfile(positions: GeoRidePosition[]): AltProfile | null {
	const alts = positions.map((p) => p.altitude).filter((a) => a != null && a > 0);
	if (!alts.length) return null;
	let gain = 0;
	for (let i = 1; i < alts.length; i++) {
		const diff = alts[i] - alts[i - 1];
		if (diff > 0) gain += diff;
	}
	return { minAlt: Math.min(...alts), maxAlt: Math.max(...alts), gain: Math.round(gain) };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
