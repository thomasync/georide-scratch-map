import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth';
import { LoggerService } from '../services/logger';

const GEORIDE_API_HOST = 'api.georide.com';
const REFRESH_PATH = '/user/new-token';

function buildAuthReq(req: Parameters<HttpInterceptorFn>[0], token: string) {
	return req.clone({
		setHeaders: {
			Authorization: `Bearer ${token}`,
			'Accept-Language': 'fr-FR',
		},
	});
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
	const logger = inject(LoggerService);
	const authService = inject(AuthService);
	const router = inject(Router);
	const url = new URL(req.url, window.location.origin);

	if (url.hostname !== GEORIDE_API_HOST) {
		logger.log('AuthInterceptor', `skipping non-GeoRide request: ${url.hostname}`);
		return next(req);
	}

	const token = authService.getToken();
	if (!token) {
		logger.warn('AuthInterceptor', 'no token, sending unauthenticated request');
		return next(req);
	}

	logger.log('AuthInterceptor', `attaching Bearer token to ${req.method} ${req.url}`);
	return next(buildAuthReq(req, token)).pipe(
		catchError((err: HttpErrorResponse) => {
			if (err.status !== 401 || url.pathname === REFRESH_PATH) {
				return throwError(() => err);
			}

			logger.warn('AuthInterceptor', '401 received, attempting token refresh');
			return authService.refreshToken().pipe(
				switchMap((newToken) => next(buildAuthReq(req, newToken))),
				catchError((refreshErr) => {
					logger.warn('AuthInterceptor', 'token refresh failed, logging out');
					authService.logout();
					router.navigate(['/login']);
					return throwError(() => refreshErr);
				}),
			);
		}),
	);
};
