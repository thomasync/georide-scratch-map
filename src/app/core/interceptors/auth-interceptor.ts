import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

const GEORIDE_API_HOST = 'api.georide.com';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
	const logger = inject(LoggerService);
	const url = new URL(req.url, window.location.origin);

	if (url.hostname !== GEORIDE_API_HOST) {
		logger.log('AuthInterceptor', `skipping non-GeoRide request: ${url.hostname}`);
		return next(req);
	}

	const token = inject(AuthService).getToken();
	if (!token) {
		logger.warn('AuthInterceptor', 'no token, sending unauthenticated request');
		return next(req);
	}

	logger.log('AuthInterceptor', `attaching Bearer token to ${req.method} ${req.url}`);
	return next(
		req.clone({
			setHeaders: {
				Authorization: `Bearer ${token}`,
				'Accept-Language': 'fr-FR',
			},
		}),
	);
};
