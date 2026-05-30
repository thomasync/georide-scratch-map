import { Injectable } from '@angular/core';
import { catchError, Observable, of, shareReplay, switchMap } from 'rxjs';
import { Trip } from '../models/trip';
import { GeoRidePosition } from './georide-api';

export type StoredTrip = Trip & {
	indexId: string;
	positions?: GeoRidePosition[];
};

interface KvEntry<T> {
	value: T;
	expiresAt?: number;
}

@Injectable({ providedIn: 'root' })
export class DatabaseService {
	private readonly DB_NAME = 'georide';
	private readonly DB_VERSION = 3;
	private readonly KV = 'kv';
	private readonly TRIPS = 'trips';

	private readonly db$: Observable<IDBDatabase>;

	constructor() {
		// Supprime les anciennes clés localStorage migrées vers IDB
		[
			'georide_h3_dept_cells_v1',
			'georide_map_settings',
			'georide_dev_box_expanded',
			'georide_last_cleared_ts_v1',
			'georide_recap_dismissed_v1',
			'georide_seen_cells_r7_v1',
			'georide_new_cells_first_seen_v1',
		].forEach((k) => localStorage.removeItem(k));
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (key?.startsWith('georide_cache_')) localStorage.removeItem(key);
		}

		this.db$ = new Observable<IDBDatabase>((s) => {
			const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(this.KV)) {
					db.createObjectStore(this.KV);
				}
				if (db.objectStoreNames.contains(this.TRIPS)) {
					db.deleteObjectStore(this.TRIPS);
				}
				const store = db.createObjectStore(this.TRIPS, { keyPath: 'indexId' });
				store.createIndex('startTime', 'startTime');
				store.createIndex('trackerId', 'trackerId');
			};
			req.onsuccess = () => {
				s.next(req.result);
				s.complete();
			};
			req.onerror = () => s.error(req.error);
		}).pipe(shareReplay(1));
	}

	// ── KV ──────────────────────────────────────────────────────────────────

	kvGet<T>(key: string): Observable<T | null> {
		return this.db$.pipe(
			switchMap(
				(db) =>
					new Observable<T | null>((s) => {
						const req = db.transaction(this.KV, 'readonly').objectStore(this.KV).get(key);
						req.onsuccess = () => {
							const entry = req.result as KvEntry<T> | undefined;
							if (!entry) {
								s.next(null);
								s.complete();
								return;
							}
							if (entry.expiresAt && Date.now() >= entry.expiresAt) {
								s.next(null);
							} else {
								s.next(entry.value ?? null);
							}
							s.complete();
						};
						req.onerror = () => s.error(req.error);
					}),
			),
			catchError(() => of(null)),
		);
	}

	kvSet(key: string, value: unknown, ttlMs?: number): Observable<void> {
		const entry: KvEntry<unknown> = { value, ...(ttlMs ? { expiresAt: Date.now() + ttlMs } : {}) };
		return this.db$.pipe(
			switchMap(
				(db) =>
					new Observable<void>((s) => {
						const req = db.transaction(this.KV, 'readwrite').objectStore(this.KV).put(entry, key);
						req.onsuccess = () => {
							s.next();
							s.complete();
						};
						req.onerror = () => s.error(req.error);
					}),
			),
			catchError(() => of(void 0)),
		);
	}

	kvDelete(key: string): Observable<void> {
		return this.db$.pipe(
			switchMap(
				(db) =>
					new Observable<void>((s) => {
						const req = db.transaction(this.KV, 'readwrite').objectStore(this.KV).delete(key);
						req.onsuccess = () => {
							s.next();
							s.complete();
						};
						req.onerror = () => s.error(req.error);
					}),
			),
			catchError(() => of(void 0)),
		);
	}

	// ── Trips ────────────────────────────────────────────────────────────────

	getAllTrips(): Observable<StoredTrip[]> {
		return this.db$.pipe(
			switchMap(
				(db) =>
					new Observable<StoredTrip[]>((s) => {
						const req = db.transaction(this.TRIPS, 'readonly').objectStore(this.TRIPS).getAll();
						req.onsuccess = () => {
							s.next(req.result as StoredTrip[]);
							s.complete();
						};
						req.onerror = () => s.error(req.error);
					}),
			),
			catchError(() => of([])),
		);
	}

	upsertTripPositions(items: { indexId: string; positions: GeoRidePosition[] }[]): Observable<void> {
		if (!items.length) return of(void 0);
		return this.db$.pipe(
			switchMap(
				(db) =>
					new Observable<void>((s) => {
						const tx = db.transaction(this.TRIPS, 'readwrite');
						const store = tx.objectStore(this.TRIPS);
						for (const { indexId, positions } of items) {
							const req = store.get(indexId);
							req.onsuccess = () => {
								if (req.result) store.put({ ...req.result, positions });
							};
						}
						tx.oncomplete = () => {
							s.next();
							s.complete();
						};
						tx.onerror = () => s.error(tx.error);
						tx.onabort = () => s.error(new Error('upsertTripPositions: transaction aborted'));
					}),
			),
			catchError(() => of(void 0)),
		);
	}

	upsertTrips(trips: StoredTrip[]): Observable<void> {
		if (!trips.length) return of(void 0);
		return this.db$.pipe(
			switchMap(
				(db) =>
					new Observable<void>((s) => {
						const tx = db.transaction(this.TRIPS, 'readwrite');
						const store = tx.objectStore(this.TRIPS);
						for (const trip of trips) {
							const req = store.put(trip);
							req.onerror = (e) => e.preventDefault(); // évite l'abort si un put échoue
						}
						tx.oncomplete = () => {
							s.next();
							s.complete();
						};
						tx.onerror = () => s.error(tx.error);
						tx.onabort = () => s.error(new Error('upsertTrips: transaction aborted'));
					}),
			),
			catchError(() => of(void 0)),
		);
	}
}
