import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

export const authGuard: CanActivateFn = (route) => {
	const auth = inject(AuthService);
	const router = inject(Router);
	const logger = inject(LoggerService);

	const authenticated = auth.isAuthenticated();
	logger.log('AuthGuard', `accessing "${route.url}" — authenticated: ${authenticated}`);

	if (authenticated) return true;

	logger.warn('AuthGuard', 'not authenticated, redirecting to /login');
	return router.createUrlTree(['/login']);
};
