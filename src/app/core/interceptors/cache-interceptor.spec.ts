import { HttpClient, HttpErrorResponse, HttpResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { cacheInterceptor } from './cache-interceptor';
import {
	createDatabaseServiceMock,
	provideDatabaseServiceMock,
	DatabaseServiceMock,
} from '../../../test/helpers/providers';

const TRACKERS_URL = 'https://api.georide.com/user/trackers';
const USER_URL = 'https://api.georide.com/user';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/1,2;3,4';

const TTL_1H = 60 * 60 * 1000;
const TTL_7D = 7 * 24 * 60 * 60 * 1000;

describe('cacheInterceptor', () => {
	let http: HttpClient;
	let httpMock: HttpTestingController;
	let db: DatabaseServiceMock;

	beforeEach(() => {
		db = createDatabaseServiceMock();

		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(withInterceptors([cacheInterceptor])),
				provideHttpClientTesting(),
				provideDatabaseServiceMock(db),
			],
		});

		http = TestBed.inject(HttpClient);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
	});

	describe('cacheable GET on a cache miss', () => {
		it('forwards the request to the network and caches the 200 body with a 1h TTL (/user/trackers)', () => {
			let body: unknown;
			http.get(TRACKERS_URL).subscribe((b) => (body = b));

			const req = httpMock.expectOne(TRACKERS_URL);
			expect(req.request.method).toBe('GET');
			req.flush([{ trackerId: 1 }]);

			expect(body).toEqual([{ trackerId: 1 }]);
			expect(db.kvGet).toHaveBeenCalledWith(`cache_${TRACKERS_URL}`);
			expect(db.kvSet).toHaveBeenCalledTimes(1);
			expect(db.kvSet).toHaveBeenCalledWith(`cache_${TRACKERS_URL}`, [{ trackerId: 1 }], TTL_1H);
		});

		it('caches the /user endpoint with a 1h TTL', () => {
			http.get(USER_URL).subscribe();

			httpMock.expectOne(USER_URL).flush({ id: 42 });

			expect(db.kvSet).toHaveBeenCalledWith(`cache_${USER_URL}`, { id: 42 }, TTL_1H);
		});

		it('caches OSRM routing responses with a 7d TTL', () => {
			http.get(OSRM_URL).subscribe();

			httpMock.expectOne(OSRM_URL).flush({ routes: [] });

			expect(db.kvSet).toHaveBeenCalledWith(`cache_${OSRM_URL}`, { routes: [] }, TTL_7D);
		});

		it('includes the query params in the cache key (urlWithParams)', () => {
			http.get(TRACKERS_URL, { params: { page: '2' } }).subscribe();

			httpMock.expectOne(`${TRACKERS_URL}?page=2`).flush({});

			expect(db.kvGet).toHaveBeenCalledWith(`cache_${TRACKERS_URL}?page=2`);
			expect(db.kvSet).toHaveBeenCalledWith(`cache_${TRACKERS_URL}?page=2`, {}, TTL_1H);
		});

		it('does not cache non-200 success responses', () => {
			http.get(TRACKERS_URL).subscribe();

			httpMock.expectOne(TRACKERS_URL).flush(null, { status: 204, statusText: 'No Content' });

			expect(db.kvSet).not.toHaveBeenCalled();
		});

		it('does not cache error responses and propagates the error', () => {
			const errors: HttpErrorResponse[] = [];
			http.get(TRACKERS_URL).subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne(TRACKERS_URL).flush({}, { status: 500, statusText: 'Server Error' });

			expect(db.kvSet).not.toHaveBeenCalled();
			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(500);
		});
	});

	describe('cacheable GET on a cache hit', () => {
		it('serves the cached body without any network request', () => {
			db.kvGet.mockReturnValue(of({ id: 42, cached: true }));

			let body: unknown;
			http.get(TRACKERS_URL).subscribe((b) => (body = b));

			httpMock.expectNone(TRACKERS_URL);
			expect(body).toEqual({ id: 42, cached: true });
			expect(db.kvGet).toHaveBeenCalledWith(`cache_${TRACKERS_URL}`);
			expect(db.kvSet).not.toHaveBeenCalled();
		});

		it('builds a synthetic 200 HttpResponse around the cached value', () => {
			db.kvGet.mockReturnValue(of('cached-payload'));

			let response: HttpResponse<unknown> | undefined;
			http.get(TRACKERS_URL, { observe: 'response' }).subscribe((r) => (response = r));

			httpMock.expectNone(TRACKERS_URL);
			expect(response).toBeInstanceOf(HttpResponse);
			expect(response?.status).toBe(200);
			expect(response?.body).toBe('cached-payload');
		});

		it('treats falsy cached values as hits: only null means a miss', () => {
			// Seul null déclenche un appel réseau ; 0, '' ou false sont des valeurs en cache valides
			db.kvGet.mockReturnValue(of(0));

			let body: unknown;
			http.get(TRACKERS_URL).subscribe((b) => (body = b));

			httpMock.expectNone(TRACKERS_URL);
			expect(body).toBe(0);
		});
	});

	describe('passthrough', () => {
		it('bypasses the cache entirely for a POST to a cacheable url', () => {
			http.post(TRACKERS_URL, { a: 1 }).subscribe();

			const req = httpMock.expectOne(TRACKERS_URL);
			expect(req.request.method).toBe('POST');
			req.flush({ ok: true });

			expect(db.kvGet).not.toHaveBeenCalled();
			expect(db.kvSet).not.toHaveBeenCalled();
		});

		it('bypasses the cache for a DELETE to a cacheable url', () => {
			http.delete(TRACKERS_URL).subscribe();

			httpMock.expectOne(TRACKERS_URL).flush({});

			expect(db.kvGet).not.toHaveBeenCalled();
			expect(db.kvSet).not.toHaveBeenCalled();
		});

		it('passes a GET to a non-cacheable url through without touching the cache', () => {
			let body: unknown;
			http.get('https://example.com/data').subscribe((b) => (body = b));

			httpMock.expectOne('https://example.com/data').flush({ raw: true });

			expect(body).toEqual({ raw: true });
			expect(db.kvGet).not.toHaveBeenCalled();
			expect(db.kvSet).not.toHaveBeenCalled();
		});

		it('does not match cache patterns against the query params (req.url only)', () => {
			// Le matching se fait sur req.url (sans params) : '/user' dans un param ne déclenche pas le cache
			http.get('https://example.com/data', { params: { redirect: '/user' } }).subscribe();

			httpMock.expectOne('https://example.com/data?redirect=/user').flush({});

			expect(db.kvGet).not.toHaveBeenCalled();
			expect(db.kvSet).not.toHaveBeenCalled();
		});

		it('caches a third-party url whose path contains /user (the host is not checked)', () => {
			// Comportement réel : le pattern '/user' matche n'importe quel hôte
			http.get('https://example.com/user/profile').subscribe();

			httpMock.expectOne('https://example.com/user/profile').flush({ name: 'x' });

			expect(db.kvGet).toHaveBeenCalledWith('cache_https://example.com/user/profile');
			expect(db.kvSet).toHaveBeenCalledWith('cache_https://example.com/user/profile', { name: 'x' }, TTL_1H);
		});
	});
});
