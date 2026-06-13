import { Page } from '@playwright/test';

/** Style MapLibre minimal valide : la carte s'initialise sans charger de tuiles réseau. */
const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };

/**
 * Coupe toutes les ressources externes (tuiles cartographiques, élévation, carburant, OSRM)
 * pour des tests déterministes et hors-ligne. L'UI reste pleinement fonctionnelle sans la carte.
 */
export async function blockExternal(page: Page): Promise<void> {
	await page.route(/cartocdn\.com\/.*style\.json/, (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_STYLE) }),
	);
	await page.route(/cartocdn\.com/, (route) => route.abort());
	await page.route(/api\.open-elevation\.com/, (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) }),
	);
	await page.route(/router\.project-osrm\.org/, (route) => route.abort());
	await page.route(/prix-carburants/, (route) => route.abort());
}

const USER = { id: 1, email: 'rider@example.com', firstName: 'Thomas', lastName: 'C' };
const TRACKERS = [{ trackerId: 1, trackerName: 'Moto' }];

/**
 * Mocke l'API GeoRide pour le parcours connecté : login, user, trackers, trips (vides).
 * Par défaut le login réussit ; passe { loginStatus: 401 } pour simuler un échec.
 */
export async function mockGeorideApi(page: Page, opts: { loginStatus?: number } = {}): Promise<void> {
	const loginStatus = opts.loginStatus ?? 200;
	await page.route(/api\.georide\.com\/.*/, (route) => {
		const url = route.request().url();
		const json = (body: unknown, status = 200) =>
			route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

		if (url.includes('/user/login')) {
			return loginStatus === 200
				? json({ authToken: 'e2e-token' })
				: json({ message: 'unauthorized' }, loginStatus);
		}
		if (url.includes('/user/new-token')) return json({ authToken: 'e2e-token-2' });
		if (url.includes('/user/trackers')) return json(TRACKERS);
		if (url.includes('/user')) return json(USER);
		if (url.includes('/trips/positions/link')) return json({ url: 'https://example.com/positions.json' });
		if (url.includes('/trips')) return json([]);
		return json([]);
	});
	await page.route('https://example.com/positions.json', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
	);
}
