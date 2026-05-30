import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of, switchMap, tap } from 'rxjs';
import { DatabaseService } from '../services/database';

const TTL_1H = 60 * 60 * 1000;
const TTL_7D = 7 * 24 * 60 * 60 * 1000;
const PREFIX = 'cache_';

const CACHED_URLS = [
	{ pattern: '/user/trackers', ttl: TTL_1H },
	{ pattern: '/user', ttl: TTL_1H },
	{ pattern: 'router.project-osrm.org', ttl: TTL_7D },
] as const;

export const cacheInterceptor: HttpInterceptorFn = (req, next) => {
	const db = inject(DatabaseService);
	const rule = CACHED_URLS.find((r) => req.url.includes(r.pattern));
	if (req.method !== 'GET' || !rule) return next(req);

	const key = PREFIX + req.urlWithParams;

	return db.kvGet<unknown>(key).pipe(
		switchMap((cached) => {
			if (cached !== null) {
				return of(new HttpResponse({ status: 200, body: cached }));
			}
			return next(req).pipe(
				tap((event) => {
					if (event instanceof HttpResponse && event.status === 200) {
						db.kvSet(key, event.body, rule.ttl).subscribe();
					}
				}),
			);
		}),
	);
};
