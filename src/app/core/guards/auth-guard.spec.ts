import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from './auth-guard';
import { AuthService } from '../services/auth';
import { provideSilentLogger } from '../../../test/helpers/providers';

describe('authGuard', () => {
	const makeRoute = (): ActivatedRouteSnapshot => ({ url: [] }) as unknown as ActivatedRouteSnapshot;
	const makeState = (): RouterStateSnapshot => ({ url: '/secret' }) as unknown as RouterStateSnapshot;

	function setup(isAuthenticated: boolean): void {
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } },
				provideSilentLogger(),
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
	});

	it('consults AuthService.isAuthenticated exactly once per activation', () => {
		const isAuthenticated = vi.fn(() => true);
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: AuthService, useValue: { isAuthenticated } },
				provideSilentLogger(),
			],
		});

		runGuard();

		expect(isAuthenticated).toHaveBeenCalledTimes(1);
	});

	it('throws when executed outside an injection context', () => {
		// inject() n'est utilisable que dans un contexte d'injection
		expect(() => authGuard(makeRoute(), makeState())).toThrow(/inject/i);
	});
});
