import { Trip } from '../../app/core/models/trip';
import { GeoRidePosition } from '../../app/core/services/georide-api';
import { StoredTrip, TripWithCoords } from '../../app/core/services/database';

let tripSeq = 0;

/** Trip réaliste : Toulouse → Carcassonne, ~90 km, vitesses en nœuds, maxAngle 90 = moto droite. */
export function makeTrip(overrides: Partial<Trip> = {}): Trip {
	tripSeq++;
	return {
		id: tripSeq,
		trackerId: 1,
		distance: 90_000,
		duration: 4800,
		averageSpeed: 38, // nœuds (~70 km/h)
		maxSpeed: 70, // nœuds (~130 km/h)
		startTime: '2025-06-01T09:00:00.000Z',
		endTime: '2025-06-01T10:20:00.000Z',
		startLat: 43.6045,
		startLon: 1.4442,
		endLat: 43.2128,
		endLon: 2.3508,
		startAddress: 'Toulouse, Haute-Garonne, France',
		niceStartAddress: 'Toulouse',
		endAddress: 'Carcassonne, Aude, France',
		niceEndAddress: 'Carcassonne',
		staticImage: 'https://maps.example.com/static.png',
		maxAngle: 60, // |60-90| = 30° d'inclinaison
		maxLeftAngle: 65,
		maxRightAngle: 120,
		averageAngle: null,
		isFavorite: false,
		...overrides,
	};
}

export function makeStoredTrip(overrides: Partial<StoredTrip> = {}): StoredTrip {
	const trip = makeTrip(overrides);
	return {
		...trip,
		indexId: overrides.indexId ?? `${trip.trackerId}-${trip.id}`,
		positions: overrides.positions,
		...overrides,
	};
}

export function makeTripWithCoords(overrides: Partial<TripWithCoords> = {}): TripWithCoords {
	const stored = makeStoredTrip(overrides);
	return {
		...stored,
		coords: overrides.coords ?? [
			[stored.startLat, stored.startLon],
			[(stored.startLat + stored.endLat) / 2, (stored.startLon + stored.endLon) / 2],
			[stored.endLat, stored.endLon],
		],
	};
}

/** Positions régulièrement espacées le long d'un segment, 1/minute. */
export function makePositions(count: number, overrides: Partial<GeoRidePosition> = {}): GeoRidePosition[] {
	const startMs = new Date('2025-06-01T09:00:00.000Z').getTime();
	return Array.from({ length: count }, (_, i) => ({
		fixtime: new Date(startMs + i * 60_000).toISOString(),
		latitude: 43.6 + (i / Math.max(count - 1, 1)) * 0.4,
		longitude: 1.44 + (i / Math.max(count - 1, 1)) * 0.9,
		altitude: 150 + (i % 5) * 20,
		speed: 30 + (i % 20), // nœuds
		angle: 90,
		address: null,
		...overrides,
	}));
}

export function makePosition(overrides: Partial<GeoRidePosition> = {}): GeoRidePosition {
	return { ...makePositions(1)[0], ...overrides };
}

export function resetTripSeq(): void {
	tripSeq = 0;
}
