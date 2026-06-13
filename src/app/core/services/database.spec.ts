import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { DatabaseService } from './database';
import { makePositions, makeStoredTrip, resetTripSeq } from '../../../test/fixtures/trips';

describe('DatabaseService', () => {
	beforeEach(() => {
		resetTripSeq();
		TestBed.configureTestingModule({});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('constructor localStorage cleanup', () => {
		const legacyKeys = [
			'georide_h3_dept_cells_v1',
			'georide_map_settings',
			'georide_dev_box_expanded',
			'georide_last_cleared_ts_v1',
			'georide_recap_dismissed_v1',
			'georide_seen_cells_r7_v1',
			'georide_new_cells_first_seen_v1',
		];

		afterEach(() => {
			// isolate:false → le localStorage jsdom persiste entre les tests, on nettoie ce qu'on a posé
			['georide_keep_me', 'unrelated_key', ...legacyKeys].forEach((k) => localStorage.removeItem(k));
		});

		it('removes legacy migrated keys but keeps unrelated georide keys', () => {
			legacyKeys.forEach((k) => localStorage.setItem(k, 'legacy'));
			localStorage.setItem('georide_keep_me', 'keep');

			TestBed.inject(DatabaseService);

			legacyKeys.forEach((k) => expect(localStorage.getItem(k)).toBeNull());
			expect(localStorage.getItem('georide_keep_me')).toBe('keep');
		});

		it('removes every georide_cache_* prefixed key and keeps other keys', () => {
			localStorage.setItem('georide_cache_one', '1');
			localStorage.setItem('georide_cache_two', '2');
			localStorage.setItem('unrelated_key', 'keep');

			TestBed.inject(DatabaseService);

			expect(localStorage.getItem('georide_cache_one')).toBeNull();
			expect(localStorage.getItem('georide_cache_two')).toBeNull();
			expect(localStorage.getItem('unrelated_key')).toBe('keep');
		});
	});

	describe('test isolation (fresh service and fresh IndexedDB per test)', () => {
		it('writes a probe value in a first test', async () => {
			const service = TestBed.inject(DatabaseService);

			await firstValueFrom(service.kvSet('isolation-probe', 'first'));

			await expect(firstValueFrom(service.kvGet<string>('isolation-probe'))).resolves.toBe('first');
		});

		it('does not see the value written by the previous test', async () => {
			const service = TestBed.inject(DatabaseService);

			await expect(firstValueFrom(service.kvGet<string>('isolation-probe'))).resolves.toBeNull();
		});
	});

	describe('kv store', () => {
		let service: DatabaseService;

		beforeEach(() => {
			service = TestBed.inject(DatabaseService);
		});

		it('roundtrips strings, numbers, falsy values, arrays and nested objects', async () => {
			const samples: [string, unknown][] = [
				['k-string', 'héllo wörld'],
				['k-number', 42.5],
				['k-zero', 0],
				['k-false', false],
				['k-empty-string', ''],
				['k-array', [1, 'two', { three: 3 }]],
				['k-object', { nested: { deep: [true, null] }, when: '2025-06-01' }],
			];

			for (const [key, value] of samples) {
				await firstValueFrom(service.kvSet(key, value));
			}

			for (const [key, value] of samples) {
				await expect(firstValueFrom(service.kvGet(key))).resolves.toEqual(value);
			}
		});

		it('returns null for a missing key', async () => {
			await expect(firstValueFrom(service.kvGet<string>('does-not-exist'))).resolves.toBeNull();
		});

		it('returns null when the stored value is null or undefined', async () => {
			await firstValueFrom(service.kvSet('k-null', null));
			await firstValueFrom(service.kvSet('k-undef', undefined));

			await expect(firstValueFrom(service.kvGet('k-null'))).resolves.toBeNull();
			await expect(firstValueFrom(service.kvGet('k-undef'))).resolves.toBeNull();
		});

		it('overwrites an existing key (last write wins)', async () => {
			await firstValueFrom(service.kvSet('k-over', 'first'));
			await firstValueFrom(service.kvSet('k-over', 'second'));

			await expect(firstValueFrom(service.kvGet<string>('k-over'))).resolves.toBe('second');
		});

		it('treats a negative ttlMs as already expired', async () => {
			await firstValueFrom(service.kvSet('k-ttl-neg', 'value', -1000));

			await expect(firstValueFrom(service.kvGet<string>('k-ttl-neg'))).resolves.toBeNull();
		});

		it('expires an entry exactly when its TTL elapses', async () => {
			// On ne fake que Date : fake-indexeddb délivre ses événements via setImmediate/setTimeout,
			// qui doivent rester réels pour que les requêtes IDB aboutissent.
			vi.useFakeTimers({ toFake: ['Date'] });

			await firstValueFrom(service.kvSet('k-ttl', 'fresh', 60_000));
			await expect(firstValueFrom(service.kvGet<string>('k-ttl'))).resolves.toBe('fresh');

			await vi.advanceTimersByTimeAsync(59_999);
			await expect(firstValueFrom(service.kvGet<string>('k-ttl'))).resolves.toBe('fresh');

			// À expiresAt pile, Date.now() >= expiresAt → expiré
			await vi.advanceTimersByTimeAsync(1);
			await expect(firstValueFrom(service.kvGet<string>('k-ttl'))).resolves.toBeNull();
		});

		it('never expires when ttlMs is 0 (falsy → no expiresAt)', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });

			await firstValueFrom(service.kvSet('k-ttl-zero', 'eternal', 0));
			await vi.advanceTimersByTimeAsync(10 * 365 * 24 * 3600 * 1000);

			await expect(firstValueFrom(service.kvGet<string>('k-ttl-zero'))).resolves.toBe('eternal');
		});

		it('deletes an existing key', async () => {
			await firstValueFrom(service.kvSet('k-del', 'bye'));

			await expect(firstValueFrom(service.kvDelete('k-del'))).resolves.toBeUndefined();
			await expect(firstValueFrom(service.kvGet<string>('k-del'))).resolves.toBeNull();
		});

		it('completes without error when deleting a missing key', async () => {
			await expect(firstValueFrom(service.kvDelete('never-existed'))).resolves.toBeUndefined();
		});
	});

	describe('fuels store', () => {
		let service: DatabaseService;

		beforeEach(() => {
			service = TestBed.inject(DatabaseService);
		});

		it('roundtrips a fuel value', async () => {
			await expect(firstValueFrom(service.fuelSet('1-42', 5.4))).resolves.toBeUndefined();

			await expect(firstValueFrom(service.fuelGet('1-42'))).resolves.toBe(5.4);
		});

		it('returns null for a missing fuel key', async () => {
			await expect(firstValueFrom(service.fuelGet('missing'))).resolves.toBeNull();
		});

		it('returns 0 (not null) when the stored value is 0', async () => {
			await firstValueFrom(service.fuelSet('1-43', 0));

			await expect(firstValueFrom(service.fuelGet('1-43'))).resolves.toBe(0);
		});

		it('overwrites an existing fuel value', async () => {
			await firstValueFrom(service.fuelSet('1-44', 6.1));
			await firstValueFrom(service.fuelSet('1-44', 7.2));

			await expect(firstValueFrom(service.fuelGet('1-44'))).resolves.toBe(7.2);
		});
	});

	describe('getAllTrips', () => {
		let service: DatabaseService;

		beforeEach(() => {
			service = TestBed.inject(DatabaseService);
		});

		it('returns an empty array when the store is empty', async () => {
			await expect(firstValueFrom(service.getAllTrips())).resolves.toEqual([]);
		});

		it('returns all stored trips', async () => {
			const trips = [
				makeStoredTrip({ indexId: 'a' }),
				makeStoredTrip({ indexId: 'b' }),
				makeStoredTrip({ indexId: 'c' }),
			];

			await firstValueFrom(service.upsertTrips(trips));
			const all = await firstValueFrom(service.getAllTrips());

			// getAll renvoie les enregistrements triés par clé (indexId)
			expect(all).toEqual(trips);
		});
	});

	describe('upsertTrips', () => {
		let service: DatabaseService;

		beforeEach(() => {
			service = TestBed.inject(DatabaseService);
		});

		it('completes immediately without opening the database for an empty batch', async () => {
			const openSpy = vi.spyOn(indexedDB, 'open');

			await expect(firstValueFrom(service.upsertTrips([]))).resolves.toBeUndefined();

			expect(openSpy).not.toHaveBeenCalled();
		});

		it('inserts a trip with its positions when it does not exist yet', async () => {
			const positions = makePositions(4);

			await firstValueFrom(service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', positions })]));

			await expect(firstValueFrom(service.getTripPositions('trip-A'))).resolves.toEqual(positions);
		});

		it('preserves existing positions when re-upserting the trip without positions', async () => {
			const positions = makePositions(5);
			await firstValueFrom(
				service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', positions, distance: 90_000 })]),
			);

			await firstValueFrom(service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', distance: 120_000 })]));

			const all = await firstValueFrom(service.getAllTrips());
			expect(all).toHaveLength(1);
			expect(all[0].distance).toBe(120_000);
			expect(all[0].positions).toEqual(positions);
		});

		it('keeps the existing positions even when the incoming trip provides fresh ones', async () => {
			const existingPositions = makePositions(3);
			await firstValueFrom(
				service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', positions: existingPositions })]),
			);

			const freshPositions = makePositions(8, { angle: 45 });
			await firstValueFrom(
				service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', positions: freshPositions })]),
			);

			// Les positions déjà en base gagnent toujours sur celles du trip entrant
			await expect(firstValueFrom(service.getTripPositions('trip-A'))).resolves.toEqual(existingPositions);
		});

		it('fully overwrites the record when the existing trip has no positions', async () => {
			await firstValueFrom(service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', distance: 90_000 })]));

			await firstValueFrom(
				service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', distance: 150_000, isFavorite: true })]),
			);

			const all = await firstValueFrom(service.getAllTrips());
			expect(all).toHaveLength(1);
			expect(all[0].distance).toBe(150_000);
			expect(all[0].isFavorite).toBe(true);
			expect(all[0].positions ?? null).toBeNull();
		});

		it('upserts a mixed batch of new and existing trips in one transaction', async () => {
			const positions = makePositions(2);
			await firstValueFrom(
				service.upsertTrips([makeStoredTrip({ indexId: 'old', positions, distance: 10_000 })]),
			);

			await firstValueFrom(
				service.upsertTrips([
					makeStoredTrip({ indexId: 'old', distance: 20_000 }),
					makeStoredTrip({ indexId: 'new' }),
				]),
			);

			const all = await firstValueFrom(service.getAllTrips());
			expect(all.map((t) => t.indexId)).toEqual(['new', 'old']);
			const old = all.find((t) => t.indexId === 'old');
			expect(old?.distance).toBe(20_000);
			expect(old?.positions).toEqual(positions);
		});
	});

	describe('upsertTripPositions', () => {
		let service: DatabaseService;

		beforeEach(() => {
			service = TestBed.inject(DatabaseService);
		});

		it('completes immediately without opening the database for an empty batch', async () => {
			const openSpy = vi.spyOn(indexedDB, 'open');

			await expect(firstValueFrom(service.upsertTripPositions([]))).resolves.toBeUndefined();

			expect(openSpy).not.toHaveBeenCalled();
		});

		it('replaces the positions of an existing trip and keeps its other fields', async () => {
			await firstValueFrom(
				service.upsertTrips([
					makeStoredTrip({ indexId: 'trip-A', positions: makePositions(3), distance: 90_000 }),
				]),
			);

			const fresh = makePositions(6, { angle: 45 });
			await firstValueFrom(service.upsertTripPositions([{ indexId: 'trip-A', positions: fresh }]));

			await expect(firstValueFrom(service.getTripPositions('trip-A'))).resolves.toEqual(fresh);
			const all = await firstValueFrom(service.getAllTrips());
			expect(all[0].distance).toBe(90_000);
		});

		it('ignores an unknown indexId without creating a record', async () => {
			await firstValueFrom(service.upsertTripPositions([{ indexId: 'ghost', positions: makePositions(2) }]));

			await expect(firstValueFrom(service.getAllTrips())).resolves.toEqual([]);
			await expect(firstValueFrom(service.getTripPositions('ghost'))).resolves.toBeNull();
		});

		it('applies known indexIds and skips unknown ones within the same batch', async () => {
			await firstValueFrom(service.upsertTrips([makeStoredTrip({ indexId: 'known' })]));

			const positions = makePositions(2);
			await firstValueFrom(
				service.upsertTripPositions([
					{ indexId: 'known', positions },
					{ indexId: 'ghost', positions: makePositions(4) },
				]),
			);

			await expect(firstValueFrom(service.getTripPositions('known'))).resolves.toEqual(positions);
			const all = await firstValueFrom(service.getAllTrips());
			expect(all.map((t) => t.indexId)).toEqual(['known']);
		});
	});

	describe('getTripPositions', () => {
		let service: DatabaseService;

		beforeEach(() => {
			service = TestBed.inject(DatabaseService);
		});

		it('returns null when the trip does not exist', async () => {
			await expect(firstValueFrom(service.getTripPositions('absent'))).resolves.toBeNull();
		});

		it('returns null when the trip exists but has no positions', async () => {
			await firstValueFrom(service.upsertTrips([makeStoredTrip({ indexId: 'trip-A' })]));

			await expect(firstValueFrom(service.getTripPositions('trip-A'))).resolves.toBeNull();
		});

		it('returns the stored positions when present', async () => {
			const positions = makePositions(10);
			await firstValueFrom(service.upsertTrips([makeStoredTrip({ indexId: 'trip-A', positions })]));

			await expect(firstValueFrom(service.getTripPositions('trip-A'))).resolves.toEqual(positions);
		});
	});
});
