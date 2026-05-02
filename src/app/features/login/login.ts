import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { LoggerService } from '../../core/services/logger';
import { ThemeService } from '../../core/services/theme';

@Component({
	selector: 'app-login',
	imports: [FormsModule, RouterLink],
	templateUrl: './login.html',
	styleUrl: './login.scss',
})
export class Login {
	private auth = inject(AuthService);
	private router = inject(Router);
	private logger = inject(LoggerService);
	theme = inject(ThemeService);

	constructor() {
		if (this.auth.isAuthenticated()) {
			this.logger.log('Login', 'already authenticated, redirecting to /map');
			this.router.navigate(['/map']);
		}
	}

	email = signal('');
	password = signal('');
	loading = signal(false);
	error = signal('');

	logoClickCount = signal(0);

	onLogoClick(): void {
		const count = this.logoClickCount() + 1;
		this.logoClickCount.set(count);
		if (count >= 5) {
			this.logoClickCount.set(0);
			this.logger.log('Login', 'secret mode activated');
			const token = window.prompt('Token GeoRide')?.trim();
			if (token) {
				this.auth.setToken(token);
				this.router.navigate(['/map']);
			}
		}
	}

	submit(): void {
		this.logger.log('Login', 'submit', this.email());
		this.loading.set(true);
		this.error.set('');

		this.auth.login(this.email(), this.password()).subscribe({
			next: () => {
				this.logger.log('Login', 'login success, navigating to /map');
				this.router.navigate(['/map']);
			},
			error: (err) => {
				this.logger.error('Login', 'login failed', err);
				this.error.set('Identifiants incorrects');
				this.loading.set(false);
			},
		});
	}
}
