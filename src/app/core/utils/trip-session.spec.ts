import { TripWithCoords } from '../services/database';
import { makeTripWithCoords, resetTripSeq } from '../../../test/fixtures/trips';
import { buildSessions, isLinkedTrip } from './trip-session';

// Aide : construit un trajet avec horaires et endpoints contrôlés.
// Rappel distances (roughDistKm) : 0.01° de latitude ≈ 1.11 km, 0.02° ≈ 2.22 km (≤ 3 km),
// 0.05° ≈ 5.55 km (> 3 km). À l'équateur, cos ≈ 1 donc la longitude se comporte pareil.
function tripAt(opts: {
	indexId: string;
	start: string;
	end: string;
	from: [number, number];
	to: [number, number];
}): TripWithCoords {
	return makeTripWithCoords({
		indexId: opts.indexId,
		startTime: opts.start,
		endTime: opts.end,
		startLat: opts.from[0],
		startLon: opts.from[1],
		endLat: opts.to[0],
		endLon: opts.to[1],
	});
}

describe('trip-session', () => {
	beforeEach(() => {
		resetTripSeq();
	});

	describe('isLinkedTrip', () => {
		it('links two trips when b starts where a ends within the default time gap', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T11:30:00.000Z',
				end: '2025-06-01T12:30:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			expect(isLinkedTrip(a, b)).toBe(true);
		});

		it('returns false when the time gap exceeds the default 3h threshold', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			// Même endroit mais 4h d'écart → trop tard
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T14:00:00.000Z',
				end: '2025-06-01T15:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			expect(isLinkedTrip(a, b)).toBe(false);
		});

		it('returns true when the time gap is exactly 3h (inclusive boundary)', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T13:00:00.000Z',
				end: '2025-06-01T14:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			expect(isLinkedTrip(a, b)).toBe(true);
		});

		it('returns false when the gap exceeds 3h by one millisecond', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T13:00:00.001Z',
				end: '2025-06-01T14:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			expect(isLinkedTrip(a, b)).toBe(false);
		});

		it('respects a custom maxGapH threshold', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T14:00:00.000Z',
				end: '2025-06-01T15:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			expect(isLinkedTrip(a, b, 5)).toBe(true);
			expect(isLinkedTrip(a, b, 3)).toBe(false);
		});

		it('uses the minimum gap of both time orderings (b before a still links)', () => {
			// b se termine 1h avant le début de a : |bEnd - aStart| = 1h, |aEnd - bStart| = 4h
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T12:00:00.000Z',
				end: '2025-06-01T13:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			expect(isLinkedTrip(a, b)).toBe(true);
		});

		it('returns false when all endpoints are farther than 3 km apart', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			// Endpoints à ≥ 0.05° (~5.55 km) de tous ceux de a
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [0.05, 0],
				to: [0.05, 0.5],
			});
			expect(isLinkedTrip(a, b)).toBe(false);
		});

		it('links via a.start <-> b.start proximity only', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [0.02, 0],
				to: [0, 1],
			});
			expect(isLinkedTrip(a, b)).toBe(true);
		});

		it('links via a.start <-> b.end proximity only', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [0, 1],
				to: [0.02, 0],
			});
			expect(isLinkedTrip(a, b)).toBe(true);
		});

		it('links via a.end <-> b.start proximity only', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [0.02, 0.5],
				to: [0, 1],
			});
			expect(isLinkedTrip(a, b)).toBe(true);
		});

		it('links via a.end <-> b.end proximity only', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [0, 1],
				to: [0.02, 0.5],
			});
			expect(isLinkedTrip(a, b)).toBe(true);
		});

		it('applies the cosine latitude correction to longitude distances', () => {
			// Même écart de longitude (0.04°) : ~4.44 km à l'équateur (trop loin),
			// mais ~2.22 km à 60° de latitude (cos 60° = 0.5 → lié)
			const equatorA = tripAt({
				indexId: 'eq-a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 10],
				to: [0, 10],
			});
			const equatorB = tripAt({
				indexId: 'eq-b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [0, 10.04],
				to: [0, 10.04],
			});
			expect(isLinkedTrip(equatorA, equatorB)).toBe(false);

			const northA = tripAt({
				indexId: 'no-a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [60, 10],
				to: [60, 10],
			});
			const northB = tripAt({
				indexId: 'no-b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [60, 10.04],
				to: [60, 10.04],
			});
			expect(isLinkedTrip(northA, northB)).toBe(true);
		});

		it('is symmetric for both linked and unlinked pairs', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const linked = tripAt({
				indexId: 'linked',
				start: '2025-06-01T11:00:00.000Z',
				end: '2025-06-01T12:00:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			const unlinked = tripAt({
				indexId: 'unlinked',
				start: '2025-06-01T20:00:00.000Z',
				end: '2025-06-01T21:00:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			expect(isLinkedTrip(a, linked)).toBe(true);
			expect(isLinkedTrip(linked, a)).toBe(true);
			expect(isLinkedTrip(a, unlinked)).toBe(false);
			expect(isLinkedTrip(unlinked, a)).toBe(false);
		});
	});

	describe('buildSessions', () => {
		it('returns an empty array for no trips', () => {
			expect(buildSessions([])).toEqual([]);
		});

		it('returns a single session containing a lone trip', () => {
			const trip = tripAt({
				indexId: 'solo',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const sessions = buildSessions([trip]);
			expect(sessions).toHaveLength(1);
			expect(sessions[0]).toHaveLength(1);
			expect(sessions[0][0].indexId).toBe('solo');
		});

		it('groups two linked trips into one session', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T11:00:00.000Z',
				end: '2025-06-01T12:00:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			const sessions = buildSessions([a, b]);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].map((t) => t.indexId)).toEqual(['a', 'b']);
		});

		it('splits spatially distant trips into separate sessions', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.01],
			});
			// Proche dans le temps mais à ~250 km
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [2, 2],
				to: [2, 2.01],
			});
			const sessions = buildSessions([a, b]);
			expect(sessions).toHaveLength(2);
			expect(sessions[0].map((t) => t.indexId)).toEqual(['a']);
			expect(sessions[1].map((t) => t.indexId)).toEqual(['b']);
		});

		it('splits temporally distant trips into separate sessions', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			// Même endroit mais 4h plus tard
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T14:00:00.000Z',
				end: '2025-06-01T15:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			const sessions = buildSessions([a, b]);
			expect(sessions).toHaveLength(2);
		});

		it('chains transitively linked trips via BFS even when ends are not directly linked', () => {
			// A → B → C : A et C ne sont liés ni dans le temps (6h) ni dans l'espace (~55 km)
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T12:30:00.000Z',
				end: '2025-06-01T13:30:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			const c = tripAt({
				indexId: 'c',
				start: '2025-06-01T16:00:00.000Z',
				end: '2025-06-01T17:00:00.000Z',
				from: [0, 1],
				to: [0, 1.5],
			});
			// Garde-fou : la liaison A-C n'existe que par transitivité
			expect(isLinkedTrip(a, c)).toBe(false);
			expect(isLinkedTrip(a, b)).toBe(true);
			expect(isLinkedTrip(b, c)).toBe(true);

			const sessions = buildSessions([a, b, c]);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].map((t) => t.indexId)).toEqual(['a', 'b', 'c']);
		});

		it('sorts each session chronologically regardless of input order', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T12:30:00.000Z',
				end: '2025-06-01T13:30:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			const c = tripAt({
				indexId: 'c',
				start: '2025-06-01T16:00:00.000Z',
				end: '2025-06-01T17:00:00.000Z',
				from: [0, 1],
				to: [0, 1.5],
			});
			const sessions = buildSessions([c, a, b]);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].map((t) => t.indexId)).toEqual(['a', 'b', 'c']);
		});

		it('keeps sessions in input encounter order and each trip in exactly one session', () => {
			const isolated = tripAt({
				indexId: 'isolated',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [5, 5],
				to: [5, 5.5],
			});
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T10:30:00.000Z',
				end: '2025-06-01T11:30:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			const sessions = buildSessions([isolated, b, a]);
			expect(sessions.map((s) => s.map((t) => t.indexId))).toEqual([['isolated'], ['a', 'b']]);

			const all = sessions.flat().map((t) => t.indexId);
			expect(all).toHaveLength(3);
			expect(new Set(all).size).toBe(3);
		});

		it('forwards a custom maxGapH to the linking logic', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T14:00:00.000Z',
				end: '2025-06-01T15:00:00.000Z',
				from: [0, 0],
				to: [0, 0],
			});
			expect(buildSessions([a, b])).toHaveLength(2);
			const widened = buildSessions([a, b], 5);
			expect(widened).toHaveLength(1);
			expect(widened[0].map((t) => t.indexId)).toEqual(['a', 'b']);
		});

		it('handles a mix of a linked group and isolated trips', () => {
			const a = tripAt({
				indexId: 'a',
				start: '2025-06-01T09:00:00.000Z',
				end: '2025-06-01T10:00:00.000Z',
				from: [0, 0],
				to: [0, 0.5],
			});
			const b = tripAt({
				indexId: 'b',
				start: '2025-06-01T11:00:00.000Z',
				end: '2025-06-01T12:00:00.000Z',
				from: [0, 0.5],
				to: [0, 1],
			});
			// Trop tard pour rejoindre la session a-b
			const lateAlone = tripAt({
				indexId: 'late',
				start: '2025-06-01T20:00:00.000Z',
				end: '2025-06-01T21:00:00.000Z',
				from: [0, 1],
				to: [0, 1.5],
			});
			// Trop loin de tout le monde
			const farAlone = tripAt({
				indexId: 'far',
				start: '2025-06-01T10:00:00.000Z',
				end: '2025-06-01T11:00:00.000Z',
				from: [10, 10],
				to: [10, 10.5],
			});
			const sessions = buildSessions([a, b, lateAlone, farAlone]);
			expect(sessions.map((s) => s.map((t) => t.indexId))).toEqual([['a', 'b'], ['late'], ['far']]);
		});
	});
});
