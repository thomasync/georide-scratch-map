import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of, tap } from 'rxjs';

const TTL = 60 * 60 * 1000;
const PREFIX = 'georide_cache_';

let pruned = false;

// Remove expired cache entries whose URLs changed (e.g. daily `to` param drift)
function pruneExpiredCache(): void {
	if (pruned) return;
	pruned = true;
	const toRemove: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key?.startsWith(PREFIX)) continue;
		try {
			const { expiresAt } = JSON.parse(localStorage.getItem(key)!);
			if (Date.now() >= expiresAt) toRemove.push(key);
		} catch {
			toRemove.push(key);
		}
	}
	toRemove.forEach((k) => localStorage.removeItem(k));
}

export const cacheInterceptor: HttpInterceptorFn = (req, next) => {
	pruneExpiredCache();
	if (req.method !== 'GET' || !req.url.includes('api.georide.com')) {
		return next(req);
	}

	const key = PREFIX + req.urlWithParams;
	const raw = localStorage.getItem(key);

	if (raw) {
		try {
			const { body, expiresAt } = JSON.parse(raw);
			if (Date.now() < expiresAt) {
				return of(new HttpResponse({ status: 200, body }));
			}
		} catch {}
		localStorage.removeItem(key);
	}

	return next(req).pipe(
		tap((event) => {
			if (event instanceof HttpResponse && event.status === 200) {
				localStorage.setItem(key, JSON.stringify({ body: event.body, expiresAt: Date.now() + TTL }));
			}
		}),
	);
};
