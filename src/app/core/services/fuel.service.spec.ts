import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FuelService } from './fuel.service';
import {
	createDatabaseServiceMock,
	provideDatabaseServiceMock,
	DatabaseServiceMock,
} from '../../../test/helpers/providers';

const API_BASE = 'https://api.prix-carburants.2aaz.fr';
const KV_PREFIX = 'fuel_price_';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Réponse minimale compatible avec l'usage du service (seuls ok et json() sont lus)
function jsonResponse(body: unknown, ok = true): Response {
	return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

function priceBody(value: unknown): unknown {
	return { PriceTTC: { value } };
}

describe('FuelService', () => {
	let service: FuelService;
	let dbMock: DatabaseServiceMock;
	let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

	// Pré-remplit le cache fuel mocké : toute clé absente renvoie null (cache miss)
	function setCache(entries: Record<string, number>): void {
		dbMock.fuelGet.mockImplementation((key: string) => of(entries[key] ?? null));
	}

	function fuelGetKeys(): string[] {
		return dbMock.fuelGet.mock.calls.map((c) => String(c[0]));
	}

	beforeEach(() => {
		// Date figée : le mois courant est 2026-06 (en UTC comme en local)
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));

		fetchMock = vi.fn<FetchFn>();
		vi.stubGlobal('fetch', fetchMock);

		dbMock = createDatabaseServiceMock();
		TestBed.configureTestingModule({ providers: [provideDatabaseServiceMock(dbMock)] });
		service = TestBed.inject(FuelService);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	describe('getPrice', () => {
		it('returns null for the current month without touching the cache or the network', async () => {
			const price = await service.getPrice('SP98', '2026-06');

			expect(price).toBeNull();
			expect(dbMock.fuelGet).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('returns null for a future month without touching the cache or the network', async () => {
			const price = await service.getPrice('SP98', '2027-01');

			expect(price).toBeNull();
			expect(dbMock.fuelGet).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('returns the cached price without fetching on a cache hit', async () => {
			setCache({ [`${KV_PREFIX}SP98_2026-04`]: 1.87 });

			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBe(1.87);
			expect(dbMock.fuelGet).toHaveBeenCalledExactlyOnceWith(`${KV_PREFIX}SP98_2026-04`);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(dbMock.fuelSet).not.toHaveBeenCalled();
		});

		it('treats a cached price of 0 as a hit (only null means cache miss)', async () => {
			setCache({ [`${KV_PREFIX}SP98_2026-04`]: 0 });

			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBe(0);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('returns null for an unknown fuel type after a cache miss, without fetching', async () => {
			const price = await service.getPrice('GPL', '2026-04');

			expect(price).toBeNull();
			// Le cache est tout de même consulté avant la résolution de l'id carburant
			expect(dbMock.fuelGet).toHaveBeenCalledExactlyOnceWith(`${KV_PREFIX}GPL_2026-04`);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(dbMock.fuelSet).not.toHaveBeenCalled();
		});

		it('fetches the API on a cache miss, parses PriceTTC.value and stores it in the fuel cache', async () => {
			fetchMock.mockResolvedValue(jsonResponse(priceBody(1.92)));

			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBe(1.92);
			expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/fuel/6/price/2026-04`);
			expect(dbMock.fuelSet).toHaveBeenCalledExactlyOnceWith(`${KV_PREFIX}SP98_2026-04`, 1.92);
		});

		it('maps each known fuel type to its API id (SP98=6, SP95=2, E10=5)', async () => {
			fetchMock.mockResolvedValue(jsonResponse(priceBody(2)));
			const cases: [string, number][] = [
				['SP98', 6],
				['SP95', 2],
				['E10', 5],
			];

			for (const [fuelType, fid] of cases) {
				fetchMock.mockClear();
				await service.getPrice(fuelType, '2026-05');
				expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/fuel/${fid}/price/2026-05`);
			}
		});

		it('returns null and does not cache when the API responds with a non-ok status', async () => {
			fetchMock.mockResolvedValue(jsonResponse(priceBody(1.92), false));

			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBeNull();
			expect(dbMock.fuelSet).not.toHaveBeenCalled();
		});

		it('returns null when the response body has no PriceTTC value', async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({}));
			expect(await service.getPrice('SP98', '2026-04')).toBeNull();

			// Corps null : le chaînage optionnel évite le crash
			fetchMock.mockResolvedValueOnce(jsonResponse(null));
			expect(await service.getPrice('SP98', '2026-04')).toBeNull();

			expect(dbMock.fuelSet).not.toHaveBeenCalled();
		});

		it('returns null when PriceTTC.value is not a number', async () => {
			fetchMock.mockResolvedValue(jsonResponse(priceBody('1.92')));

			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBeNull();
			expect(dbMock.fuelSet).not.toHaveBeenCalled();
		});

		it('returns null when the network request fails', async () => {
			fetchMock.mockRejectedValue(new Error('network down'));

			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBeNull();
			expect(dbMock.fuelSet).not.toHaveBeenCalled();
		});

		it('returns null when the response body cannot be parsed as JSON', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				json: () => Promise.reject(new SyntaxError('invalid json')),
			} as unknown as Response);

			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBeNull();
		});

		it('returns null when persisting the fetched price into the cache fails', async () => {
			fetchMock.mockResolvedValue(jsonResponse(priceBody(1.92)));
			dbMock.fuelSet.mockReturnValue(throwError(() => new Error('idb fail')));

			// Le prix a pourtant été récupéré, mais l'échec d'écriture est avalé par le catch
			const price = await service.getPrice('SP98', '2026-04');

			expect(price).toBeNull();
		});
	});

	describe('getPriceOrNearest', () => {
		it('returns the price of the requested month without probing fallbacks', async () => {
			setCache({ [`${KV_PREFIX}SP98_2026-04`]: 1.8 });

			const price = await service.getPriceOrNearest('SP98', '2026-04', ['2026-03', '2026-02']);

			expect(price).toBe(1.8);
			expect(dbMock.fuelGet).toHaveBeenCalledTimes(1);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('falls back to the nearest earlier available month, probing in descending order', async () => {
			// 2026-04 (demandé) et 2026-03 absents partout, 2026-02 et 2026-01 en cache
			fetchMock.mockResolvedValue(jsonResponse(priceBody(undefined)));
			setCache({
				[`${KV_PREFIX}SP98_2026-02`]: 1.7,
				[`${KV_PREFIX}SP98_2026-01`]: 1.6,
			});

			const price = await service.getPriceOrNearest('SP98', '2026-04', ['2026-01', '2026-03', '2026-02']);

			expect(price).toBe(1.7);
			// Ordre de sondage : mois demandé, puis mois disponibles décroissants jusqu'au premier hit
			expect(fuelGetKeys()).toEqual([
				`${KV_PREFIX}SP98_2026-04`,
				`${KV_PREFIX}SP98_2026-03`,
				`${KV_PREFIX}SP98_2026-02`,
			]);
		});

		it('ignores available months later than the requested month', async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, false));
			setCache({
				[`${KV_PREFIX}SP98_2026-05`]: 9.9,
				[`${KV_PREFIX}SP98_2026-04`]: 8.8,
				[`${KV_PREFIX}SP98_2026-01`]: 1.5,
			});

			const price = await service.getPriceOrNearest('SP98', '2026-03', ['2026-05', '2026-04', '2026-01']);

			expect(price).toBe(1.5);
			expect(fuelGetKeys()).toEqual([`${KV_PREFIX}SP98_2026-03`, `${KV_PREFIX}SP98_2026-01`]);
		});

		it('returns null when neither the requested month nor any fallback yields a price', async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, false));

			const price = await service.getPriceOrNearest('SP98', '2026-04', ['2026-03', '2026-02']);

			expect(price).toBeNull();
			expect(dbMock.fuelGet).toHaveBeenCalledTimes(3);
		});

		it('returns null with an empty list of available months', async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, false));

			const price = await service.getPriceOrNearest('SP98', '2026-04', []);

			expect(price).toBeNull();
		});

		it('does not mutate the availableMonths array passed as argument', async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, false));
			const availableMonths = ['2026-01', '2026-03', '2026-02'];

			await service.getPriceOrNearest('SP98', '2026-04', availableMonths);

			expect(availableMonths).toEqual(['2026-01', '2026-03', '2026-02']);
		});
	});

	describe('getMonthlyPrices', () => {
		it('returns a record mapping each month to its price, or null when unavailable', async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, false));
			setCache({ [`${KV_PREFIX}SP98_2026-04`]: 1.8 });

			const prices = await service.getMonthlyPrices('SP98', ['2026-04', '2026-03', '2026-06']);

			// 2026-06 est le mois courant : null sans appel réseau
			expect(prices).toEqual({ '2026-04': 1.8, '2026-03': null, '2026-06': null });
			expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/fuel/6/price/2026-03`);
		});

		it('returns an empty record for an empty month list', async () => {
			const prices = await service.getMonthlyPrices('SP98', []);

			expect(prices).toEqual({});
			expect(dbMock.fuelGet).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('loadCachedMonths', () => {
		it('probes the 24 previous months and returns the cached ones, most recent first', async () => {
			setCache({
				[`${KV_PREFIX}SP98_2026-05`]: 1.9, // i=1
				[`${KV_PREFIX}SP98_2026-01`]: 1.6, // i=5, mois sur un chiffre → zéro-paddé
				[`${KV_PREFIX}SP98_2025-12`]: 1.5, // i=6, passage d'année
				[`${KV_PREFIX}SP98_2024-06`]: 1.2, // i=24, dernier mois sondé
				[`${KV_PREFIX}SP98_2024-05`]: 1.1, // i=25, hors fenêtre → jamais sondé
				[`${KV_PREFIX}SP98_2026-06`]: 2.0, // mois courant → jamais sondé
			});

			const months = await service.loadCachedMonths('SP98');

			expect(months).toEqual(['2026-05', '2026-01', '2025-12', '2024-06']);
			expect(dbMock.fuelGet).toHaveBeenCalledTimes(24);
			expect(fuelGetKeys()).not.toContain(`${KV_PREFIX}SP98_2026-06`);
			expect(fuelGetKeys()).not.toContain(`${KV_PREFIX}SP98_2024-05`);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('includes months whose cached price is 0', async () => {
			setCache({ [`${KV_PREFIX}E10_2026-03`]: 0 });

			const months = await service.loadCachedMonths('E10');

			expect(months).toEqual(['2026-03']);
		});

		it('returns an empty list when nothing is cached', async () => {
			const months = await service.loadCachedMonths('SP98');

			expect(months).toEqual([]);
			expect(dbMock.fuelGet).toHaveBeenCalledTimes(24);
		});
	});

	describe('getPrefs', () => {
		it('returns the defaults (SP98, 15) when nothing is stored', async () => {
			const prefs = await service.getPrefs();

			expect(prefs).toEqual({ fuelType: 'SP98', tankSize: 15 });
			expect(dbMock.kvGet).toHaveBeenCalledWith('pref_fuelType');
			expect(dbMock.kvGet).toHaveBeenCalledWith('pref_tankSize');
		});

		it('returns the stored preferences', async () => {
			dbMock.kvGet.mockImplementation((key: string) => of(key === 'pref_fuelType' ? 'E10' : 42));

			const prefs = await service.getPrefs();

			expect(prefs).toEqual({ fuelType: 'E10', tankSize: 42 });
		});

		it('keeps a stored tank size of 0 and applies the default only for the missing preference', async () => {
			dbMock.kvGet.mockImplementation((key: string) => of(key === 'pref_tankSize' ? 0 : null));

			const prefs = await service.getPrefs();

			// ?? ne remplace que null/undefined : 0 est une valeur valide
			expect(prefs).toEqual({ fuelType: 'SP98', tankSize: 0 });
		});
	});

	describe('savePrefs', () => {
		it('persists both preferences in the kv store', async () => {
			await service.savePrefs('SP95', 20);

			expect(dbMock.kvSet).toHaveBeenCalledTimes(2);
			expect(dbMock.kvSet).toHaveBeenCalledWith('pref_fuelType', 'SP95');
			expect(dbMock.kvSet).toHaveBeenCalledWith('pref_tankSize', 20);
		});
	});
});
