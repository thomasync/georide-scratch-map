import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ElevationService } from './elevation';
import { provideSilentLogger } from '../../../test/helpers/providers';

const OPEN_ELEVATION_URL = 'https://api.open-elevation.com/api/v1/lookup';
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 300;

interface ElevationLocation {
	id: string;
	lat: number;
	lon: number;
}

interface LookupBody {
	locations: { latitude: number; longitude: number }[];
}

interface ElevationResult {
	latitude: number;
	longitude: number;
	elevation: number;
}

function makeLocations(count: number, offset = 0): ElevationLocation[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `loc-${offset + i}`,
		lat: 40 + (offset + i) * 0.01,
		lon: 2 + (offset + i) * 0.01,
	}));
}

// Construit une réponse API : une élévation par position (appariement par index)
function makeResults(locations: ElevationLocation[], elevations: number[]): ElevationResult[] {
	return elevations.map((elevation, i) => ({
		latitude: locations[i]?.lat ?? 0,
		longitude: locations[i]?.lon ?? 0,
		elevation,
	}));
}

describe('ElevationService', () => {
	let service: ElevationService;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideSilentLogger()],
		});
		service = TestBed.inject(ElevationService);
		httpMock = TestBed.inject(HttpTestingController);
		// rxjs delay() planifie via setInterval/setTimeout (asyncScheduler)
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	});

	afterEach(() => {
		httpMock.verify();
		vi.useRealTimers();
	});

	describe('fetchForLocations', () => {
		it('emits an empty record and completes without any HTTP request for an empty location list', () => {
			let emitted: Record<string, number> | undefined;
			let completed = false;

			service.fetchForLocations([]).subscribe({
				next: (r) => (emitted = r),
				complete: () => (completed = true),
			});

			// concat() sans source complète de manière synchrone
			expect(emitted).toEqual({});
			expect(completed).toBe(true);
			httpMock.expectNone(OPEN_ELEVATION_URL);
		});

		it('is cold: no request is issued before subscription', async () => {
			service.fetchForLocations(makeLocations(3));

			await vi.advanceTimersByTimeAsync(BATCH_DELAY_MS * 10);
			httpMock.expectNone(OPEN_ELEVATION_URL);
		});

		it('does not issue the first request synchronously on subscribe (delay(0) is still async)', async () => {
			const locations = makeLocations(2);
			service.fetchForLocations(locations).subscribe();

			httpMock.expectNone(OPEN_ELEVATION_URL);

			await vi.advanceTimersByTimeAsync(0);
			const req = httpMock.expectOne(OPEN_ELEVATION_URL);
			req.flush({ results: makeResults(locations, [10, 20]) });
		});

		it('sends a single POST with {latitude, longitude} pairs when locations fit in one batch', async () => {
			const locations = makeLocations(3);
			service.fetchForLocations(locations).subscribe();

			await vi.advanceTimersByTimeAsync(0);
			const req = httpMock.expectOne(OPEN_ELEVATION_URL);
			expect(req.request.method).toBe('POST');
			expect(req.request.body).toEqual({
				locations: locations.map((l) => ({ latitude: l.lat, longitude: l.lon })),
			});
			req.flush({ results: makeResults(locations, [100, 200, 300]) });
		});

		it('maps each location id to its elevation by result index, keeping elevations equal to 0', async () => {
			const locations = makeLocations(3);
			let emitted: Record<string, number> | undefined;
			let completed = false;

			service.fetchForLocations(locations).subscribe({
				next: (r) => (emitted = r),
				complete: () => (completed = true),
			});

			await vi.advanceTimersByTimeAsync(0);
			// Les coordonnées renvoyées par l'API sont ignorées : l'appariement est strictement positionnel
			const results: ElevationResult[] = [
				{ latitude: 99, longitude: 99, elevation: 1500 },
				{ latitude: 98, longitude: 98, elevation: 0 },
				{ latitude: 97, longitude: 97, elevation: -12 },
			];
			httpMock.expectOne(OPEN_ELEVATION_URL).flush({ results });
			await vi.advanceTimersByTimeAsync(0);

			expect(emitted).toEqual({ 'loc-0': 1500, 'loc-1': 0, 'loc-2': -12 });
			expect(completed).toBe(true);
		});

		it('omits locations whose elevation is missing from the response', async () => {
			const locations = makeLocations(3);
			let emitted: Record<string, number> | undefined;

			service.fetchForLocations(locations).subscribe((r) => (emitted = r));

			await vi.advanceTimersByTimeAsync(0);
			// Réponse tronquée : seulement 2 résultats pour 3 positions
			httpMock.expectOne(OPEN_ELEVATION_URL).flush({ results: makeResults(locations, [10, 20]) });
			await vi.advanceTimersByTimeAsync(0);

			expect(emitted).toEqual({ 'loc-0': 10, 'loc-1': 20 });
			expect(emitted).not.toHaveProperty('loc-2');
		});

		it('ignores extra results beyond the batch length', async () => {
			const locations = makeLocations(2);
			let emitted: Record<string, number> | undefined;

			service.fetchForLocations(locations).subscribe((r) => (emitted = r));

			await vi.advanceTimersByTimeAsync(0);
			httpMock.expectOne(OPEN_ELEVATION_URL).flush({ results: makeResults(makeLocations(3), [10, 20, 30]) });
			await vi.advanceTimersByTimeAsync(0);

			expect(emitted).toEqual({ 'loc-0': 10, 'loc-1': 20 });
		});

		it('splits locations into batches of 100 with a 300ms delay between batches and merges all results', async () => {
			const locations = makeLocations(BATCH_SIZE + 1);
			let emitted: Record<string, number> | undefined;
			let completed = false;

			service.fetchForLocations(locations).subscribe({
				next: (r) => (emitted = r),
				complete: () => (completed = true),
			});

			await vi.advanceTimersByTimeAsync(0);
			const req1 = httpMock.expectOne(OPEN_ELEVATION_URL);
			const body1 = req1.request.body as LookupBody;
			expect(body1.locations).toHaveLength(BATCH_SIZE);
			expect(body1.locations[0]).toEqual({ latitude: locations[0].lat, longitude: locations[0].lon });
			req1.flush({
				results: locations
					.slice(0, BATCH_SIZE)
					.map((l, i) => ({ latitude: l.lat, longitude: l.lon, elevation: i })),
			});

			// Le second lot attend BATCH_DELAY_MS après la fin du premier
			await vi.advanceTimersByTimeAsync(BATCH_DELAY_MS - 1);
			httpMock.expectNone(OPEN_ELEVATION_URL);
			expect(emitted).toBeUndefined();

			await vi.advanceTimersByTimeAsync(1);
			const req2 = httpMock.expectOne(OPEN_ELEVATION_URL);
			const body2 = req2.request.body as LookupBody;
			expect(body2.locations).toHaveLength(1);
			expect(body2.locations[0]).toEqual({
				latitude: locations[BATCH_SIZE].lat,
				longitude: locations[BATCH_SIZE].lon,
			});
			req2.flush({ results: [{ latitude: 0, longitude: 0, elevation: 999 }] });
			await vi.advanceTimersByTimeAsync(0);

			expect(completed).toBe(true);
			expect(emitted).toBeDefined();
			expect(Object.keys(emitted!)).toHaveLength(BATCH_SIZE + 1);
			expect(emitted!['loc-0']).toBe(0);
			expect(emitted![`loc-${BATCH_SIZE - 1}`]).toBe(BATCH_SIZE - 1);
			expect(emitted![`loc-${BATCH_SIZE}`]).toBe(999);
		});

		it('invokes onProgress with (batchIndex, totalBatches) after each completed batch', async () => {
			const locations = makeLocations(BATCH_SIZE + 1);
			const onProgress = vi.fn();

			service.fetchForLocations(locations, onProgress).subscribe();

			await vi.advanceTimersByTimeAsync(0);
			expect(onProgress).not.toHaveBeenCalled();

			httpMock.expectOne(OPEN_ELEVATION_URL).flush({
				results: locations
					.slice(0, BATCH_SIZE)
					.map((l, i) => ({ latitude: l.lat, longitude: l.lon, elevation: i })),
			});
			expect(onProgress).toHaveBeenCalledTimes(1);
			expect(onProgress).toHaveBeenLastCalledWith(1, 2);

			await vi.advanceTimersByTimeAsync(BATCH_DELAY_MS);
			httpMock.expectOne(OPEN_ELEVATION_URL).flush({ results: [{ latitude: 0, longitude: 0, elevation: 5 }] });
			await vi.advanceTimersByTimeAsync(0);

			expect(onProgress).toHaveBeenCalledTimes(2);
			expect(onProgress).toHaveBeenLastCalledWith(2, 2);
		});

		it('reports progress as (1, 1) for a single batch and works without an onProgress callback', async () => {
			const locations = makeLocations(2);
			const onProgress = vi.fn();

			service.fetchForLocations(locations, onProgress).subscribe();
			await vi.advanceTimersByTimeAsync(0);
			httpMock.expectOne(OPEN_ELEVATION_URL).flush({ results: makeResults(locations, [1, 2]) });

			expect(onProgress).toHaveBeenCalledExactlyOnceWith(1, 1);
		});

		it('propagates an HTTP error from the first batch and never requests the remaining batches', async () => {
			const locations = makeLocations(BATCH_SIZE + 1);
			let emitted: Record<string, number> | undefined;
			let error: HttpErrorResponse | undefined;

			service.fetchForLocations(locations).subscribe({
				next: (r) => (emitted = r),
				error: (e: HttpErrorResponse) => (error = e),
			});

			await vi.advanceTimersByTimeAsync(0);
			httpMock.expectOne(OPEN_ELEVATION_URL).flush('boom', { status: 500, statusText: 'Server Error' });

			expect(error).toBeInstanceOf(HttpErrorResponse);
			expect(error?.status).toBe(500);
			expect(emitted).toBeUndefined();

			// concat est interrompu : le second lot n'est jamais souscrit
			await vi.advanceTimersByTimeAsync(BATCH_DELAY_MS * 10);
			httpMock.expectNone(OPEN_ELEVATION_URL);
		});

		it('propagates an error from a later batch even after earlier batches succeeded', async () => {
			const locations = makeLocations(BATCH_SIZE + 1);
			let emitted: Record<string, number> | undefined;
			let error: HttpErrorResponse | undefined;

			service.fetchForLocations(locations).subscribe({
				next: (r) => (emitted = r),
				error: (e: HttpErrorResponse) => (error = e),
			});

			await vi.advanceTimersByTimeAsync(0);
			httpMock.expectOne(OPEN_ELEVATION_URL).flush({
				results: locations
					.slice(0, BATCH_SIZE)
					.map((l, i) => ({ latitude: l.lat, longitude: l.lon, elevation: i })),
			});

			await vi.advanceTimersByTimeAsync(BATCH_DELAY_MS);
			httpMock.expectOne(OPEN_ELEVATION_URL).flush('boom', { status: 502, statusText: 'Bad Gateway' });
			await vi.advanceTimersByTimeAsync(0);

			// reduce ne ré-émet rien : le résultat partiel du premier lot est perdu
			expect(emitted).toBeUndefined();
			expect(error).toBeInstanceOf(HttpErrorResponse);
			expect(error?.status).toBe(502);
		});

		it('sends exactly one batch when the location count equals the batch size', async () => {
			const locations = makeLocations(BATCH_SIZE);
			let emitted: Record<string, number> | undefined;

			service.fetchForLocations(locations).subscribe((r) => (emitted = r));

			await vi.advanceTimersByTimeAsync(0);
			const req = httpMock.expectOne(OPEN_ELEVATION_URL);
			expect((req.request.body as LookupBody).locations).toHaveLength(BATCH_SIZE);
			req.flush({ results: locations.map((l, i) => ({ latitude: l.lat, longitude: l.lon, elevation: i * 2 })) });
			await vi.advanceTimersByTimeAsync(0);

			expect(Object.keys(emitted!)).toHaveLength(BATCH_SIZE);
			expect(emitted!['loc-7']).toBe(14);
			// Aucun second lot
			await vi.advanceTimersByTimeAsync(BATCH_DELAY_MS * 10);
			httpMock.expectNone(OPEN_ELEVATION_URL);
		});
	});
});
