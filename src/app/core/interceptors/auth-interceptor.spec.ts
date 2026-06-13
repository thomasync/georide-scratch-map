import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import type { Mock } from 'vitest';
import { authInterceptor } from './auth-interceptor';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

const API_URL = 'https://api.georide.com/user/trackers';
const REFRESH_URL = 'https://api.georide.com/user/new-token';

type AuthServiceMock = {
	getToken: Mock<() => string | null>;
	refreshToken: Mock<() => Observable<string>>;
	logout: Mock<() => void>;
};

type LoggerMock = {
	log: Mock<(...args: unknown[]) => void>;
	warn: Mock<(...args: unknown[]) => void>;
	error: Mock<(...args: unknown[]) => void>;
};

describe('authInterceptor', () => {
	let http: HttpClient;
	let httpMock: HttpTestingController;
	let router: Router;
	let auth: AuthServiceMock;
	let logger: LoggerMock;

	beforeEach(() => {
		auth = {
			getToken: vi.fn<() => string | null>(() => 'tok-1'),
			refreshToken: vi.fn<() => Observable<string>>(() => of('tok-2')),
			logout: vi.fn<() => void>(),
		};
		logger = {
			log: vi.fn<(...args: unknown[]) => void>(),
			warn: vi.fn<(...args: unknown[]) => void>(),
			error: vi.fn<(...args: unknown[]) => void>(),
		};

		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(withInterceptors([authInterceptor])),
				provideHttpClientTesting(),
				provideRouter([]),
				{ provide: AuthService, useValue: auth },
				{ provide: LoggerService, useValue: logger },
			],
		});

		http = TestBed.inject(HttpClient);
		httpMock = TestBed.inject(HttpTestingController);
		router = TestBed.inject(Router);
		// Pas de route /login déclarée : on neutralise la vraie navigation
		vi.spyOn(router, 'navigate').mockResolvedValue(true);
	});

	afterEach(() => {
		httpMock.verify();
	});

	describe('GeoRide requests with a token', () => {
		it('attaches the Bearer token and the Accept-Language header', () => {
			http.get(API_URL).subscribe();

			const req = httpMock.expectOne(API_URL);
			expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
			expect(req.request.headers.get('Accept-Language')).toBe('fr-FR');
			req.flush({});
		});

		it('keeps the existing custom headers on the cloned request', () => {
			http.get(API_URL, { headers: { 'X-Custom': 'yes' } }).subscribe();

			const req = httpMock.expectOne(API_URL);
			expect(req.request.headers.get('X-Custom')).toBe('yes');
			expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
			req.flush({});
		});

		it('does not alter the method or the body of the request', () => {
			http.post(API_URL, { a: 1 }).subscribe();

			const req = httpMock.expectOne(API_URL);
			expect(req.request.method).toBe('POST');
			expect(req.request.body).toEqual({ a: 1 });
			req.flush({});
		});

		it('matches the GeoRide host by hostname regardless of the scheme', () => {
			http.get('http://api.georide.com/foo').subscribe();

			const req = httpMock.expectOne('http://api.georide.com/foo');
			expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
			req.flush({});
		});

		it('logs the token attachment with the method and the url', () => {
			http.get(API_URL).subscribe();

			httpMock.expectOne(API_URL).flush({});
			expect(logger.log).toHaveBeenCalledWith('AuthInterceptor', `attaching Bearer token to GET ${API_URL}`);
		});
	});

	describe('non-GeoRide requests', () => {
		it('forwards requests to other hosts untouched, without reading the token', () => {
			http.get('https://example.com/data').subscribe();

			const req = httpMock.expectOne('https://example.com/data');
			expect(req.request.headers.has('Authorization')).toBe(false);
			expect(req.request.headers.has('Accept-Language')).toBe(false);
			expect(auth.getToken).not.toHaveBeenCalled();
			expect(logger.log).toHaveBeenCalledWith('AuthInterceptor', 'skipping non-GeoRide request: example.com');
			req.flush({});
		});

		it('treats a lookalike subdomain as a foreign host (no token leak)', () => {
			http.get('https://api.georide.com.evil.com/user/trackers').subscribe();

			const req = httpMock.expectOne('https://api.georide.com.evil.com/user/trackers');
			expect(req.request.headers.has('Authorization')).toBe(false);
			req.flush({});
		});

		it('resolves relative urls against the window origin and skips them', () => {
			http.get('/demo-trips.json').subscribe();

			const req = httpMock.expectOne('/demo-trips.json');
			expect(req.request.headers.has('Authorization')).toBe(false);
			expect(req.request.headers.has('Accept-Language')).toBe(false);
			req.flush({});
		});

		it('does not refresh on a 401 coming from another host', () => {
			const errors: HttpErrorResponse[] = [];
			http.get('https://example.com/data').subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne('https://example.com/data').flush({}, { status: 401, statusText: 'Unauthorized' });

			expect(auth.refreshToken).not.toHaveBeenCalled();
			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(401);
		});
	});

	describe('GeoRide requests without a token', () => {
		it('sends the request unauthenticated and warns about it', () => {
			auth.getToken.mockReturnValue(null);

			http.get(API_URL).subscribe();

			const req = httpMock.expectOne(API_URL);
			expect(req.request.headers.has('Authorization')).toBe(false);
			expect(req.request.headers.has('Accept-Language')).toBe(false);
			expect(logger.warn).toHaveBeenCalledWith('AuthInterceptor', 'no token, sending unauthenticated request');
			req.flush({});
		});

		it('does not try to refresh on 401 when the request was sent without a token', () => {
			auth.getToken.mockReturnValue(null);
			const errors: HttpErrorResponse[] = [];

			http.get(API_URL).subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });
			httpMock.expectOne(API_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

			expect(auth.refreshToken).not.toHaveBeenCalled();
			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(401);
		});
	});

	describe('401 handling and token refresh', () => {
		it('refreshes the token on 401 and retries the request with the new token', () => {
			let body: unknown;
			http.get(API_URL).subscribe((b) => (body = b));

			const first = httpMock.expectOne(API_URL);
			expect(first.request.headers.get('Authorization')).toBe('Bearer tok-1');
			first.flush({ message: 'expired' }, { status: 401, statusText: 'Unauthorized' });

			const retry = httpMock.expectOne(API_URL);
			expect(retry.request.headers.get('Authorization')).toBe('Bearer tok-2');
			expect(retry.request.headers.get('Accept-Language')).toBe('fr-FR');
			retry.flush({ ok: true });

			expect(auth.refreshToken).toHaveBeenCalledTimes(1);
			expect(body).toEqual({ ok: true });
		});

		it('retries with the original method, body and custom headers', () => {
			http.post(API_URL, { a: 1 }, { headers: { 'X-Custom': 'yes' } }).subscribe();

			httpMock.expectOne(API_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

			const retry = httpMock.expectOne(API_URL);
			expect(retry.request.method).toBe('POST');
			expect(retry.request.body).toEqual({ a: 1 });
			expect(retry.request.headers.get('X-Custom')).toBe('yes');
			retry.flush({});
		});

		it('warns before attempting the refresh', () => {
			http.get(API_URL).subscribe();

			httpMock.expectOne(API_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
			httpMock.expectOne(API_URL).flush({});

			expect(logger.warn).toHaveBeenCalledWith('AuthInterceptor', '401 received, attempting token refresh');
		});

		it('propagates non-401 errors without refreshing or logging out', () => {
			const errors: HttpErrorResponse[] = [];
			http.get(API_URL).subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne(API_URL).flush({}, { status: 500, statusText: 'Server Error' });

			expect(auth.refreshToken).not.toHaveBeenCalled();
			expect(auth.logout).not.toHaveBeenCalled();
			expect(router.navigate).not.toHaveBeenCalled();
			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(500);
		});
	});

	describe('refresh endpoint exclusion (no infinite loop)', () => {
		it('still attaches the token to the refresh endpoint request itself', () => {
			http.get(REFRESH_URL).subscribe();

			const req = httpMock.expectOne(REFRESH_URL);
			expect(req.request.headers.get('Authorization')).toBe('Bearer tok-1');
			req.flush({ authToken: 'tok-2' });
		});

		it('propagates a 401 from the refresh endpoint without re-entering the refresh flow', () => {
			const errors: HttpErrorResponse[] = [];
			http.get(REFRESH_URL).subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne(REFRESH_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

			expect(auth.refreshToken).not.toHaveBeenCalled();
			expect(auth.logout).not.toHaveBeenCalled();
			expect(router.navigate).not.toHaveBeenCalled();
			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(401);
		});

		it('matches the refresh path by pathname, ignoring query parameters', () => {
			const url = `${REFRESH_URL}?source=test`;
			const errors: HttpErrorResponse[] = [];
			http.get(url).subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne(url).flush({}, { status: 401, statusText: 'Unauthorized' });

			expect(auth.refreshToken).not.toHaveBeenCalled();
			expect(errors).toHaveLength(1);
		});
	});

	describe('refresh failure', () => {
		it('logs out, redirects to /login and propagates the refresh error (not the original 401)', () => {
			const refreshError = new Error('refresh down');
			auth.refreshToken.mockReturnValue(throwError(() => refreshError));
			const errors: unknown[] = [];

			http.get(API_URL).subscribe({ error: (e: unknown) => errors.push(e) });
			httpMock.expectOne(API_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

			expect(auth.logout).toHaveBeenCalledTimes(1);
			expect(router.navigate).toHaveBeenCalledTimes(1);
			expect(router.navigate).toHaveBeenCalledWith(['/login']);
			expect(logger.warn).toHaveBeenCalledWith('AuthInterceptor', 'token refresh failed, logging out');
			expect(errors).toEqual([refreshError]);
		});

		it('also logs out and redirects when the retried request fails, even with a non-401 status', () => {
			// Le catchError interne englobe aussi la requête rejouée : un 500 au retry déconnecte l'utilisateur
			const errors: HttpErrorResponse[] = [];
			http.get(API_URL).subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne(API_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
			httpMock.expectOne(API_URL).flush({}, { status: 500, statusText: 'Server Error' });

			expect(auth.refreshToken).toHaveBeenCalledTimes(1);
			expect(auth.logout).toHaveBeenCalledTimes(1);
			expect(router.navigate).toHaveBeenCalledWith(['/login']);
			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(500);
		});

		it('does not loop when the retried request comes back 401 again: single refresh then logout', () => {
			const errors: HttpErrorResponse[] = [];
			http.get(API_URL).subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne(API_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
			httpMock.expectOne(API_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

			// Pas de troisième requête : httpMock.verify() dans afterEach le garantit aussi
			expect(auth.refreshToken).toHaveBeenCalledTimes(1);
			expect(auth.logout).toHaveBeenCalledTimes(1);
			expect(router.navigate).toHaveBeenCalledWith(['/login']);
			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(401);
		});
	});
});
