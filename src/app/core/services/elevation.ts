import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, concat, delay, map, of, reduce, switchMap } from 'rxjs';
import { LoggerService } from './logger';

const OPEN_ELEVATION_URL = 'https://api.open-elevation.com/api/v1/lookup';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 300;

export interface TripElevation {
	minAlt: number;
	maxAlt: number;
	gain: number;
}

interface ElevationResult {
	latitude: number;
	longitude: number;
	elevation: number;
}

@Injectable({ providedIn: 'root' })
export class ElevationService {
	private http = inject(HttpClient);
	private logger = inject(LoggerService);

	// Fetches elevation for a list of named locations.
	// Returns a Record mapping each location id to its elevation in metres.
	fetchForLocations(
		locations: { id: string; lat: number; lon: number }[],
		onProgress?: (done: number, total: number) => void,
	): Observable<Record<string, number>> {
		const batches = this.chunk(locations, BATCH_SIZE);
		this.logger.log('Elevation', `fetching ${locations.length} points in ${batches.length} batch(es)`);

		const batchRequests = batches.map((batch, i) =>
			of(null).pipe(
				delay(i === 0 ? 0 : BATCH_DELAY_MS),
				switchMap(() => {
					this.logger.log('Elevation', `batch ${i + 1}/${batches.length} (${batch.length} points)`);
					const apiLocations = batch.map((l) => ({ latitude: l.lat, longitude: l.lon }));
					return this.http
						.post<{ results: ElevationResult[] }>(OPEN_ELEVATION_URL, { locations: apiLocations })
						.pipe(
							map((r) => {
								onProgress?.(i + 1, batches.length);
								return { batch, results: r.results };
							}),
						);
				}),
			),
		);

		return concat(...batchRequests).pipe(
			reduce<
				{ batch: typeof locations; results: ElevationResult[] },
				{ batch: typeof locations; results: ElevationResult[] }[]
			>((acc, val) => [...acc, val], []),
			map((allBatches) => {
				const out: Record<string, number> = {};
				for (const { batch, results } of allBatches) {
					for (let i = 0; i < batch.length; i++) {
						const el = results[i]?.elevation;
						if (el !== undefined) out[batch[i].id] = el;
					}
				}
				this.logger.log('Elevation', `done — ${Object.keys(out).length} locations enriched`);
				return out;
			}),
		);
	}

	private chunk<T>(arr: T[], size: number): T[][] {
		const result: T[][] = [];
		for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
		return result;
	}
}
