import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from './auth-guard';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

type LoggerMock = {
	log: ReturnType<typeof vi.fn>;
	warn: ReturnType<typeof vi.fn>;
	error: ReturnType<typeof vi.fn>;
};

describe('authGuard', () => {
	let logger: LoggerMock;

	// Snapshots minimaux : le guard ne lit que route.url (pour le log)
	const makeRoute = (): ActivatedRouteSnapshot => ({ url: [] }) as unknown as ActivatedRouteSnapshot;
	const makeState = (): RouterStateSnapshot => ({ url: '/secret' }) as unknown as RouterStateSnapshot;

	function setup(isAuthenticated: boolean): void {
		logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } },
				{ provide: LoggerService, useValue: logger },
			],
		});
	}

	function runGuard(): boolean | UrlTree {
		return TestBed.runInInjectionContext(() => authGuard(makeRoute(), makeState())) as boolean | UrlTree;
	}

	describe('when the user is authenticated', () => {
		beforeEach(() => setup(true));

		it('returns true', () => {
			expect(runGuard()).toBe(true);
		});

		it('logs the access with the authenticated flag', () => {
			runGuard();

			expect(logger.log).toHaveBeenCalledTimes(1);
			expect(logger.log).toHaveBeenCalledWith('AuthGuard', expect.stringContaining('authenticated: true'));
		});

		it('does not log any warning', () => {
			runGuard();

			expect(logger.warn).not.toHaveBeenCalled();
		});
	});

	describe('when the user is not authenticated', () => {
		beforeEach(() => setup(false));

		it('returns a UrlTree instance', () => {
			const result = runGuard();

			expect(result).toBeInstanceOf(UrlTree);
		});

		it('redirects to /login (serialized UrlTree)', () => {
			const router = TestBed.inject(Router);

			const result = runGuard();

			expect(router.serializeUrl(result as UrlTree)).toBe('/login');
		});

		it('returns the same tree as router.createUrlTree(["/login"])', () => {
			const router = TestBed.inject(Router);

			const result = runGuard() as UrlTree;

			expect(result.toString()).toBe(router.createUrlTree(['/login']).toString());
		});

		it('logs the access with the authenticated flag and warns about the redirect', () => {
			runGuard();

			expect(logger.log).toHaveBeenCalledWith('AuthGuard', expect.stringContaining('authenticated: false'));
			expect(logger.warn).toHaveBeenCalledTimes(1);
			expect(logger.warn).toHaveBeenCalledWith('AuthGuard', 'not authenticated, redirecting to /login');
		});
	});

	it('consults AuthService.isAuthenticated exactly once per activation', () => {
		const isAuthenticated = vi.fn(() => true);
		logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: AuthService, useValue: { isAuthenticated } },
				{ provide: LoggerService, useValue: logger },
			],
		});

		runGuard();

		expect(isAuthenticated).toHaveBeenCalledTimes(1);
	});

	it('throws when executed outside an injection context', () => {
		// inject() n'est utilisable que dans un contexte d'injection
		expect(() => authGuard(makeRoute(), makeState())).toThrowError(/inject/i);
	});
});
