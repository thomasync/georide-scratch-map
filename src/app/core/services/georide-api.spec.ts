import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GeorideApiService, GeoRidePosition } from './georide-api';
import { User } from '../models/user';
import { Tracker } from '../models/tracker';
import { Trip } from '../models/trip';
import { Position, PositionsLink } from '../models/position';
import { provideSilentLogger } from '../../../test/helpers/providers';
import { makeTrip, makePositions, resetTripSeq } from '../../../test/fixtures/trips';

const API_URL = 'https://api.georide.com';

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 1,
		email: 'rider@example.com',
		firstName: 'Rider',
		createdAt: '2024-01-01T00:00:00.000Z',
		phoneNumber: '+33600000000',
		pushUserToken: null,
		legal: true,
		legalSocial: false,
		dateOfBirth: '1990-05-15',
		isDemo: false,
		helpCenterType: 'default',
		region: 'eu',
		...overrides,
	};
}

function makeTracker(overrides: Partial<Tracker> = {}): Tracker {
	return {
		trackerId: 1,
		trackerName: 'Ma moto',
		model: 'GeoRide 3',
		activationDate: '2024-03-01T00:00:00.000Z',
		odometer: 12_345,
		latitude: 43.6045,
		longitude: 1.4442,
		speed: 0,
		moving: false,
		isLocked: true,
		status: 'online',
		timezone: 'Europe/Paris',
		fixtime: '2025-06-01T09:00:00.000Z',
		altitude: 150,
		externalBatteryVoltage: 12.6,
		internalBatteryVoltage: 4.1,
		...overrides,
	};
}

function makeS3Position(overrides: Partial<Position> = {}): Position {
	return {
		lat: 43.6045,
		lon: 1.4442,
		alt: 150,
		speed: 35,
		time: '2025-06-01T09:00:00.000Z',
		...overrides,
	};
}

// Prédicat sur l'URL seule (expectOne(string) compare urlWithParams, query params inclus)
function byUrl(url: string): (req: HttpRequest<unknown>) => boolean {
	return (req) => req.url === url;
}

describe('GeorideApiService', () => {
	let api: GeorideApiService;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		resetTripSeq();
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideSilentLogger()],
		});
		api = TestBed.inject(GeorideApiService);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
	});

	describe('getUser', () => {
		it('issues a GET to /user without query params', () => {
			api.getUser().subscribe();

			const req = httpMock.expectOne(`${API_URL}/user`);
			expect(req.request.method).toBe('GET');
			expect(req.request.params.keys()).toEqual([]);
			expect(req.request.body).toBeNull();
			req.flush(makeUser());
		});

		it('passes the user response through unchanged', () => {
			const user = makeUser({ id: 99, firstName: 'Thomas' });
			let emitted: User | undefined;

			api.getUser().subscribe((u) => (emitted = u));
			httpMock.expectOne(`${API_URL}/user`).flush(user);

			expect(emitted).toEqual(user);
		});

		it('is cold: no request is issued before subscription', () => {
			api.getUser();
			httpMock.expectNone(`${API_URL}/user`);
		});

		it('propagates HTTP errors to the subscriber', () => {
			let error: HttpErrorResponse | undefined;

			api.getUser().subscribe({ error: (e: HttpErrorResponse) => (error = e) });
			httpMock.expectOne(`${API_URL}/user`).flush('boom', { status: 500, statusText: 'Server Error' });

			expect(error).toBeInstanceOf(HttpErrorResponse);
			expect(error?.status).toBe(500);
		});
	});

	describe('getTrackers', () => {
		it('issues a GET to /user/trackers without query params', () => {
			api.getTrackers().subscribe();

			const req = httpMock.expectOne(`${API_URL}/user/trackers`);
			expect(req.request.method).toBe('GET');
			expect(req.request.params.keys()).toEqual([]);
			req.flush([]);
		});

		it('passes the trackers list through unchanged', () => {
			const trackers = [makeTracker({ trackerId: 1 }), makeTracker({ trackerId: 2, trackerName: 'Scooter' })];
			let emitted: Tracker[] | undefined;

			api.getTrackers().subscribe((t) => (emitted = t));
			httpMock.expectOne(`${API_URL}/user/trackers`).flush(trackers);

			expect(emitted).toEqual(trackers);
		});

		it('passes an empty trackers list through', () => {
			let emitted: Tracker[] | undefined;

			api.getTrackers().subscribe((t) => (emitted = t));
			httpMock.expectOne(`${API_URL}/user/trackers`).flush([]);

			expect(emitted).toEqual([]);
		});
	});

	describe('getTrips', () => {
		const from = new Date('2025-06-01T00:00:00.000Z');
		const to = new Date('2025-06-30T23:59:59.000Z');

		it('issues a GET to /tracker/:id/trips with from/to serialized as ISO strings', () => {
			api.getTrips(42, from, to).subscribe();

			const req = httpMock.expectOne(byUrl(`${API_URL}/tracker/42/trips`));
			expect(req.request.method).toBe('GET');
			expect(req.request.params.get('from')).toBe('2025-06-01T00:00:00.000Z');
			expect(req.request.params.get('to')).toBe('2025-06-30T23:59:59.000Z');
			expect(req.request.params.keys()).toEqual(['from', 'to']);
			req.flush([]);
		});

		it('interpolates the trackerId into the URL', () => {
			api.getTrips(7, from, to).subscribe();

			const req = httpMock.expectOne(byUrl(`${API_URL}/tracker/7/trips`));
			req.flush([]);
		});

		it('passes the trips list through unchanged', () => {
			const trips = [makeTrip(), makeTrip({ isFavorite: true })];
			let emitted: Trip[] | undefined;

			api.getTrips(42, from, to).subscribe((t) => (emitted = t));
			httpMock.expectOne(byUrl(`${API_URL}/tracker/42/trips`)).flush(trips);

			expect(emitted).toEqual(trips);
		});
	});

	describe('getTripPositionsLink', () => {
		it('issues a GET to /tracker/:id/trips/positions/link with from/to passed verbatim', () => {
			api.getTripPositionsLink(42, '2025-06-01T09:00:00.000Z', '2025-06-01T10:20:00.000Z').subscribe();

			const req = httpMock.expectOne(byUrl(`${API_URL}/tracker/42/trips/positions/link`));
			expect(req.request.method).toBe('GET');
			expect(req.request.params.get('from')).toBe('2025-06-01T09:00:00.000Z');
			expect(req.request.params.get('to')).toBe('2025-06-01T10:20:00.000Z');
			expect(req.request.params.keys()).toEqual(['from', 'to']);
			req.flush({ url: 'https://s3.example.com/positions.json', expiresAt: '2025-06-01T11:00:00.000Z' });
		});

		it('passes the positions link response through unchanged', () => {
			const link: PositionsLink = {
				url: 'https://s3.example.com/abc/positions.json',
				expiresAt: '2025-06-01T11:00:00.000Z',
			};
			let emitted: PositionsLink | undefined;

			api.getTripPositionsLink(1, 'a', 'b').subscribe((l) => (emitted = l));
			httpMock.expectOne(byUrl(`${API_URL}/tracker/1/trips/positions/link`)).flush(link);

			expect(emitted).toEqual(link);
		});
	});

	describe('getTripPositions', () => {
		const S3_URL = 'https://s3.example.com/abc/positions.json?signature=xyz';

		it('issues a GET to the provided S3 URL as-is', () => {
			api.getTripPositions(S3_URL).subscribe();

			const req = httpMock.expectOne(S3_URL);
			expect(req.request.method).toBe('GET');
			// L'URL signée est utilisée telle quelle, sans params HttpClient supplémentaires
			expect(req.request.params.keys()).toEqual([]);
			req.flush([]);
		});

		it('passes the S3 positions through unchanged', () => {
			const positions = [
				makeS3Position(),
				makeS3Position({ lat: 43.7, lon: 1.5, time: '2025-06-01T09:01:00.000Z' }),
			];
			let emitted: Position[] | undefined;

			api.getTripPositions(S3_URL).subscribe((p) => (emitted = p));
			httpMock.expectOne(S3_URL).flush(positions);

			expect(emitted).toEqual(positions);
		});

		it('passes an empty positions list through', () => {
			let emitted: Position[] | undefined;

			api.getTripPositions(S3_URL).subscribe((p) => (emitted = p));
			httpMock.expectOne(S3_URL).flush([]);

			expect(emitted).toEqual([]);
		});
	});

	describe('getPositions', () => {
		it('issues a GET to /tracker/:id/trips/positions with from/to passed verbatim', () => {
			api.getPositions(3, '2025-06-01T09:00:00.000Z', '2025-06-01T10:20:00.000Z').subscribe();

			const req = httpMock.expectOne(byUrl(`${API_URL}/tracker/3/trips/positions`));
			expect(req.request.method).toBe('GET');
			expect(req.request.params.get('from')).toBe('2025-06-01T09:00:00.000Z');
			expect(req.request.params.get('to')).toBe('2025-06-01T10:20:00.000Z');
			expect(req.request.params.keys()).toEqual(['from', 'to']);
			req.flush([]);
		});

		it('passes the GeoRide positions through unchanged', () => {
			const positions: GeoRidePosition[] = makePositions(5);
			let emitted: GeoRidePosition[] | undefined;

			api.getPositions(3, 'a', 'b').subscribe((p) => (emitted = p));
			httpMock.expectOne(byUrl(`${API_URL}/tracker/3/trips/positions`)).flush(positions);

			expect(emitted).toEqual(positions);
		});

		it('passes an empty positions list through', () => {
			let emitted: GeoRidePosition[] | undefined;

			api.getPositions(3, 'a', 'b').subscribe((p) => (emitted = p));
			httpMock.expectOne(byUrl(`${API_URL}/tracker/3/trips/positions`)).flush([]);

			expect(emitted).toEqual([]);
		});
	});
});
