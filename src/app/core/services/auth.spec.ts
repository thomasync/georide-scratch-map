import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth';
import { DatabaseService } from './database';
import { AuthLoginResponse } from '../models/user';
import { provideSilentLogger } from '../../../test/helpers/providers';

const TOKEN_KEY = 'georide_token';
const LOGIN_URL = 'https://api.georide.com/user/login';
const NEW_TOKEN_URL = 'https://api.georide.com/user/new-token';

function makeLoginResponse(authToken: string): AuthLoginResponse {
	return {
		id: 1,
		email: 'user@example.com',
		isAdmin: false,
		authToken,
		updatedAt: '2026-01-01T00:00:00.000Z',
	};
}

describe('AuthService', () => {
	let auth: AuthService;
	let db: DatabaseService;
	let httpMock: HttpTestingController;

	beforeEach(() => {
		// isolate:false → le localStorage jsdom persiste entre les tests
		localStorage.removeItem(TOKEN_KEY);
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideSilentLogger()],
		});
		auth = TestBed.inject(AuthService);
		db = TestBed.inject(DatabaseService);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
		localStorage.removeItem(TOKEN_KEY);
	});

	describe('initial state', () => {
		it('has no token and is not authenticated', () => {
			expect(auth.getToken()).toBeNull();
			expect(auth.isAuthenticated()).toBe(false);
		});
	});

	describe('login', () => {
		it('POSTs the credentials to the GeoRide login endpoint', () => {
			auth.login('user@example.com', 's3cret').subscribe();

			const req = httpMock.expectOne(LOGIN_URL);
			expect(req.request.method).toBe('POST');
			expect(req.request.body).toEqual({ email: 'user@example.com', password: 's3cret' });
			req.flush(makeLoginResponse('tok-login'));
		});

		it('emits the full server response and stores the token in memory', () => {
			const response = makeLoginResponse('tok-login');
			let emitted: AuthLoginResponse | undefined;

			auth.login('user@example.com', 's3cret').subscribe((r) => (emitted = r));
			httpMock.expectOne(LOGIN_URL).flush(response);

			expect(emitted).toEqual(response);
			expect(auth.getToken()).toBe('tok-login');
			expect(auth.isAuthenticated()).toBe(true);
		});

		it('persists the token in IndexedDB and clears any stale localStorage token', async () => {
			localStorage.setItem(TOKEN_KEY, 'stale-ls-token');

			auth.login('user@example.com', 's3cret').subscribe();
			httpMock.expectOne(LOGIN_URL).flush(makeLoginResponse('tok-fresh'));

			expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBe('tok-fresh');
		});

		it('does not send the request until subscribed (cold observable)', () => {
			auth.login('user@example.com', 's3cret');

			httpMock.expectNone(LOGIN_URL);
		});

		it('propagates the error and stores nothing when the server rejects the credentials', async () => {
			const errors: HttpErrorResponse[] = [];

			auth.login('user@example.com', 'wrong').subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });
			httpMock.expectOne(LOGIN_URL).flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

			expect(errors).toHaveLength(1);
			expect(errors[0].status).toBe(401);
			expect(auth.getToken()).toBeNull();
			expect(auth.isAuthenticated()).toBe(false);
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBeNull();
		});
	});

	describe('setToken', () => {
		it('stores the token in memory immediately', () => {
			auth.setToken('manual-token');

			expect(auth.getToken()).toBe('manual-token');
			expect(auth.isAuthenticated()).toBe(true);
		});

		it('persists the token in IndexedDB and removes the localStorage entry', async () => {
			localStorage.setItem(TOKEN_KEY, 'stale-ls-token');

			auth.setToken('manual-token');

			expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBe('manual-token');
		});

		it('overwrites a previously stored token', async () => {
			auth.setToken('first');
			auth.setToken('second');

			expect(auth.getToken()).toBe('second');
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBe('second');
		});
	});

	describe('logout', () => {
		it('clears the in-memory token', () => {
			auth.setToken('to-clear');

			auth.logout();

			expect(auth.getToken()).toBeNull();
			expect(auth.isAuthenticated()).toBe(false);
		});

		it('deletes the token from IndexedDB', async () => {
			auth.setToken('to-delete');
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBe('to-delete');

			auth.logout();

			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBeNull();
		});

		it('removes the localStorage entry', () => {
			localStorage.setItem(TOKEN_KEY, 'stale-ls-token');

			auth.logout();

			expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
		});

		it('is a no-op safe to call when no token was ever stored', async () => {
			auth.logout();

			expect(auth.getToken()).toBeNull();
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBeNull();
		});
	});

	describe('refreshToken', () => {
		it('GETs the new-token endpoint and stores the refreshed token', async () => {
			const tokens: string[] = [];

			auth.refreshToken().subscribe((t) => tokens.push(t));
			const req = httpMock.expectOne(NEW_TOKEN_URL);
			expect(req.request.method).toBe('GET');
			req.flush({ authToken: 'refreshed' });

			expect(tokens).toEqual(['refreshed']);
			expect(auth.getToken()).toBe('refreshed');
			expect(auth.isAuthenticated()).toBe(true);
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBe('refreshed');
		});

		it('does not send any request before the first subscription', () => {
			auth.refreshToken();

			httpMock.expectNone(NEW_TOKEN_URL);
		});

		it('returns the same in-flight observable while a refresh is pending', () => {
			const first = auth.refreshToken();
			const second = auth.refreshToken();

			expect(second).toBe(first);

			first.subscribe();
			httpMock.expectOne(NEW_TOKEN_URL).flush({ authToken: 'tok' });
		});

		it('deduplicates concurrent subscriptions into a single HTTP request', () => {
			const tokens: string[] = [];

			auth.refreshToken().subscribe((t) => tokens.push(t));
			auth.refreshToken().subscribe((t) => tokens.push(t));

			// expectOne échoue si plus d'une requête est partie
			httpMock.expectOne(NEW_TOKEN_URL).flush({ authToken: 'shared' });

			expect(tokens).toEqual(['shared', 'shared']);
			expect(auth.getToken()).toBe('shared');
		});

		it('starts a brand new request after a successful refresh', () => {
			auth.refreshToken().subscribe();
			httpMock.expectOne(NEW_TOKEN_URL).flush({ authToken: 'first' });

			auth.refreshToken().subscribe();
			httpMock.expectOne(NEW_TOKEN_URL).flush({ authToken: 'second' });

			expect(auth.getToken()).toBe('second');
		});

		it('propagates the failure to every concurrent subscriber from the single shared request', () => {
			const errors: HttpErrorResponse[] = [];

			auth.refreshToken().subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });
			auth.refreshToken().subscribe({ error: (e: HttpErrorResponse) => errors.push(e) });

			httpMock.expectOne(NEW_TOKEN_URL).flush({ error: 'expired' }, { status: 401, statusText: 'Unauthorized' });

			expect(errors).toHaveLength(2);
			expect(errors[0].status).toBe(401);
			expect(errors[1].status).toBe(401);
		});

		it('keeps the previous token untouched when the refresh fails', () => {
			auth.setToken('still-valid');

			auth.refreshToken().subscribe({ error: () => {} });
			httpMock.expectOne(NEW_TOKEN_URL).flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });

			expect(auth.getToken()).toBe('still-valid');
		});

		it('resets its internal state on failure so the next call issues a new request', () => {
			const errors: unknown[] = [];
			const tokens: string[] = [];

			auth.refreshToken().subscribe({ error: (e) => errors.push(e) });
			httpMock.expectOne(NEW_TOKEN_URL).flush({ error: 'expired' }, { status: 401, statusText: 'Unauthorized' });
			expect(errors).toHaveLength(1);

			auth.refreshToken().subscribe((t) => tokens.push(t));
			httpMock.expectOne(NEW_TOKEN_URL).flush({ authToken: 'recovered' });

			expect(tokens).toEqual(['recovered']);
			expect(auth.getToken()).toBe('recovered');
		});
	});

	describe('restoreFromDb', () => {
		it('loads the token from IndexedDB when present', async () => {
			await firstValueFrom(db.kvSet(TOKEN_KEY, 'idb-token'));

			await auth.restoreFromDb();

			expect(auth.getToken()).toBe('idb-token');
			expect(auth.isAuthenticated()).toBe(true);
		});

		it('leaves the token null when neither IndexedDB nor localStorage holds one', async () => {
			await auth.restoreFromDb();

			expect(auth.getToken()).toBeNull();
			expect(auth.isAuthenticated()).toBe(false);
		});

		it('migrates a localStorage token to IndexedDB and removes the localStorage entry', async () => {
			localStorage.setItem(TOKEN_KEY, 'ls-token');

			await auth.restoreFromDb();

			expect(auth.getToken()).toBe('ls-token');
			expect(auth.isAuthenticated()).toBe(true);
			expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBe('ls-token');
		});

		it('prefers the IndexedDB token and skips the migration when both stores hold one', async () => {
			await firstValueFrom(db.kvSet(TOKEN_KEY, 'idb-token'));
			localStorage.setItem(TOKEN_KEY, 'ls-token');

			await auth.restoreFromDb();

			expect(auth.getToken()).toBe('idb-token');
			// La branche migration ne s'exécute pas : le token localStorage périmé reste en place
			expect(localStorage.getItem(TOKEN_KEY)).toBe('ls-token');
			await expect(firstValueFrom(db.kvGet<string>(TOKEN_KEY))).resolves.toBe('idb-token');
		});

		it('clears a previously set in-memory token when the stores are empty', async () => {
			auth.setToken('in-memory');
			auth.logout();

			await auth.restoreFromDb();

			expect(auth.getToken()).toBeNull();
			expect(auth.isAuthenticated()).toBe(false);
		});
	});
});
