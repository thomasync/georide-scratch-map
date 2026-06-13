import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Login } from './login';
import { AuthService } from '../../core/services/auth';
import { ThemeService } from '../../core/services/theme';
import { provideSilentLogger } from '../../../test/helpers/providers';

type AuthMock = {
	login: ReturnType<typeof vi.fn>;
	isAuthenticated: ReturnType<typeof vi.fn>;
	setToken: ReturnType<typeof vi.fn>;
};

function createThemeMock() {
	return {
		theme: signal<'dark' | 'light'>('light'),
		isDark: signal(false),
		toggle: vi.fn(),
	};
}

describe('Login', () => {
	let auth: AuthMock;
	let theme: ReturnType<typeof createThemeMock>;

	function configure(): void {
		auth = {
			login: vi.fn(),
			isAuthenticated: vi.fn(() => false),
			setToken: vi.fn(),
		};
		theme = createThemeMock();

		TestBed.configureTestingModule({
			imports: [Login],
			providers: [
				{ provide: AuthService, useValue: auth },
				provideRouter([]),
				provideSilentLogger(),
				{ provide: ThemeService, useValue: theme },
			],
		});
	}

	function create() {
		// Spy before instantiating so the constructor redirection is captured.
		const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
		const fixture = TestBed.createComponent(Login);
		const cmp = fixture.componentInstance;
		return { fixture, cmp, navigate };
	}

	beforeEach(() => {
		configure();
	});

	describe('constructor redirection', () => {
		it('redirects to /map when the user is already authenticated', () => {
			auth.isAuthenticated.mockReturnValue(true);

			const { navigate } = create();

			expect(navigate).toHaveBeenCalledWith(['/map']);
		});

		it('does not redirect when the user is not authenticated', () => {
			auth.isAuthenticated.mockReturnValue(false);

			const { navigate } = create();

			expect(navigate).not.toHaveBeenCalled();
		});
	});

	describe('submit', () => {
		it('sets loading, clears error and calls auth.login with email and password', () => {
			const { cmp } = create();
			auth.login.mockReturnValue(of({ authToken: 't' }));
			cmp.email.set('user@example.com');
			cmp.password.set('secret');

			cmp.submit();

			expect(auth.login).toHaveBeenCalledWith('user@example.com', 'secret');
		});

		it('navigates to /map on a successful login', () => {
			const { cmp, navigate } = create();
			auth.login.mockReturnValue(of({ authToken: 't' }));
			cmp.email.set('user@example.com');
			cmp.password.set('secret');

			cmp.submit();

			expect(navigate).toHaveBeenCalledWith(['/map']);
		});

		it('sets the error message and resets loading when login fails', () => {
			const { cmp, navigate } = create();
			auth.login.mockReturnValue(throwError(() => new Error('boom')));
			cmp.email.set('user@example.com');
			cmp.password.set('wrong');

			cmp.submit();

			expect(cmp.error()).toBe('Identifiants incorrects');
			expect(cmp.loading()).toBe(false);
			expect(navigate).not.toHaveBeenCalled();
		});

		it('keeps loading true while the login request is pending', () => {
			const { cmp } = create();
			// Observable that never emits: request stays in flight
			auth.login.mockReturnValue(of());
			let resolved = false;
			auth.login.mockReturnValue({
				pipe: () => ({
					subscribe: () => {
						resolved = true;
					},
				}),
			});

			cmp.submit();

			expect(resolved).toBe(true);
			expect(cmp.loading()).toBe(true);
			expect(cmp.error()).toBe('');
		});
	});

	describe('onLogoClick secret mode', () => {
		it('does not trigger the prompt before five clicks', () => {
			const { cmp } = create();
			const prompt = vi.spyOn(window, 'prompt').mockReturnValue('tok');

			for (let i = 0; i < 4; i++) {
				cmp.onLogoClick();
			}

			expect(prompt).not.toHaveBeenCalled();
			expect(cmp.logoClickCount()).toBe(4);
		});

		it('prompts for a token on the fifth click and sets it then navigates', () => {
			const { cmp, navigate } = create();
			const prompt = vi.spyOn(window, 'prompt').mockReturnValue('tok');

			for (let i = 0; i < 5; i++) {
				cmp.onLogoClick();
			}

			expect(prompt).toHaveBeenCalledWith('Token GeoRide');
			expect(auth.setToken).toHaveBeenCalledWith('tok');
			expect(navigate).toHaveBeenCalledWith(['/map']);
			expect(cmp.logoClickCount()).toBe(0);
		});

		it('trims the token returned by the prompt before storing it', () => {
			const { cmp } = create();
			vi.spyOn(window, 'prompt').mockReturnValue('  spaced-token  ');

			for (let i = 0; i < 5; i++) {
				cmp.onLogoClick();
			}

			expect(auth.setToken).toHaveBeenCalledWith('spaced-token');
		});

		it('does not store a token or navigate when the prompt is cancelled', () => {
			const { cmp, navigate } = create();
			vi.spyOn(window, 'prompt').mockReturnValue(null);

			for (let i = 0; i < 5; i++) {
				cmp.onLogoClick();
			}

			expect(auth.setToken).not.toHaveBeenCalled();
			expect(navigate).not.toHaveBeenCalled();
			expect(cmp.logoClickCount()).toBe(0);
		});

		it('does not store an empty token when the prompt returns whitespace only', () => {
			const { cmp, navigate } = create();
			vi.spyOn(window, 'prompt').mockReturnValue('   ');

			for (let i = 0; i < 5; i++) {
				cmp.onLogoClick();
			}

			expect(auth.setToken).not.toHaveBeenCalled();
			expect(navigate).not.toHaveBeenCalled();
		});
	});

	describe('template', () => {
		it('binds the email and password signals to their inputs', async () => {
			const { fixture, cmp } = create();
			fixture.detectChanges();
			await fixture.whenStable();

			cmp.email.set('typed@example.com');
			cmp.password.set('typed-pass');
			fixture.detectChanges();
			await fixture.whenStable();

			const emailInput = fixture.nativeElement.querySelector('#email') as HTMLInputElement;
			const passwordInput = fixture.nativeElement.querySelector('#password') as HTMLInputElement;

			expect(emailInput.value).toBe('typed@example.com');
			expect(passwordInput.value).toBe('typed-pass');
		});

		it('disables the submit button until both fields are filled', async () => {
			const { fixture, cmp } = create();
			fixture.detectChanges();
			await fixture.whenStable();

			const button = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(button.disabled).toBe(true);

			cmp.email.set('user@example.com');
			cmp.password.set('secret');
			fixture.detectChanges();
			await fixture.whenStable();

			expect(button.disabled).toBe(false);
		});

		it('renders the error message when error is set', async () => {
			const { fixture, cmp } = create();
			fixture.detectChanges();
			await fixture.whenStable();

			cmp.error.set('Identifiants incorrects');
			fixture.detectChanges();
			await fixture.whenStable();

			const error = fixture.nativeElement.querySelector('.error') as HTMLElement;
			expect(error.textContent?.trim()).toBe('Identifiants incorrects');
		});

		it('submits the form when ngSubmit fires', async () => {
			const { fixture, cmp } = create();
			auth.login.mockReturnValue(of({ authToken: 't' }));
			cmp.email.set('user@example.com');
			cmp.password.set('secret');
			fixture.detectChanges();
			await fixture.whenStable();

			const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
			form.dispatchEvent(new Event('submit'));
			await fixture.whenStable();

			expect(auth.login).toHaveBeenCalledWith('user@example.com', 'secret');
		});

		it('toggles the theme when the theme button is clicked', async () => {
			const { fixture } = create();
			fixture.detectChanges();
			await fixture.whenStable();

			const button = fixture.nativeElement.querySelector('.theme-toggle') as HTMLButtonElement;
			button.click();
			await fixture.whenStable();

			expect(theme.toggle).toHaveBeenCalled();
		});

		it('triggers onLogoClick when the logo image is clicked', async () => {
			const { fixture, cmp } = create();
			fixture.detectChanges();
			await fixture.whenStable();

			const logo = fixture.nativeElement.querySelector('.logo-icon') as HTMLImageElement;
			logo.click();
			await fixture.whenStable();

			expect(cmp.logoClickCount()).toBe(1);
		});
	});
});
