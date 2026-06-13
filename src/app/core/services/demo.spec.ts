import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { DemoService, DemoData } from './demo';
import { H3Service, H3Data } from './h3';
import { DatabaseService } from './database';
import {
	createDatabaseServiceMock,
	provideDatabaseServiceMock,
	DatabaseServiceMock,
} from '../../../test/helpers/providers';

/** Deux trajets en France (Toulouse), pour que le pays principal détecté soit la France. */
const DEMO_TRIPS = [
	{
		start: 'Toulouse',
		end: 'Blagnac',
		dayOffset: 5,
		startHour: 9,
		distanceM: 12000,
		coords: [
			[43.6, 1.44],
			[43.61, 1.45],
			[43.63, 1.43],
		] as [number, number][],
	},
	{
		start: 'Toulouse',
		end: 'Balma',
		dayOffset: 0, // le plus récent → détermine le pays principal
		startHour: 14,
		distanceM: 8000,
		coords: [
			[43.6, 1.44],
			[43.62, 1.46],
		] as [number, number][],
	},
];

const FRANCE_FC: GeoJSON.FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: { code: '31', nom: 'Haute-Garonne' },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[1.0, 43.0],
						[2.0, 43.0],
						[2.0, 44.0],
						[1.0, 44.0],
						[1.0, 43.0],
					],
				],
			},
		},
	],
};

const H3_RESULT: H3Data = { counts: { '861fb4667ffffff': 2 }, cellToIndices: { '861fb4667ffffff': [0, 1] } };

/** Laisse tourner la boucle d'événements : observeOn(asyncScheduler) + résolution de Promise. */
function pump(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DemoService', () => {
	let service: DemoService;
	let httpMock: HttpTestingController;
	let db: DatabaseServiceMock;
	let h3Mock: { computeResolutionAsync: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		db = createDatabaseServiceMock();
		h3Mock = { computeResolutionAsync: vi.fn(() => Promise.resolve(H3_RESULT)) };
		TestBed.configureTestingModule({
			providers: [
				DemoService,
				provideHttpClient(),
				provideHttpClientTesting(),
				provideDatabaseServiceMock(db),
				{ provide: H3Service, useValue: h3Mock },
			],
		});
		service = TestBed.inject(DemoService);
		httpMock = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		httpMock.verify();
		vi.restoreAllMocks();
	});

	/**
	 * Pilote le flux complet de load() : trips → pays principal → calcul H3 → pays restants.
	 * Renvoie toutes les émissions (load émet deux fois : données initiales puis enrichies).
	 */
	async function driveLoad(): Promise<{ emissions: DemoData[]; completed: boolean }> {
		const emissions: DemoData[] = [];
		let completed = false;
		service.load().subscribe({ next: (d) => emissions.push(d), complete: () => (completed = true) });

		httpMock.expectOne('/demo-trips.json').flush(DEMO_TRIPS);
		await pump();
		httpMock.expectOne('/geojson/france.geojson').flush(FRANCE_FC);
		await pump(); // observeOn(asyncScheduler)
		await pump(); // résolution de la Promise computeResolutionAsync / kvGet

		// Émission initiale présente, les pays restants sont maintenant en attente
		const remaining = httpMock.match(
			(req) => req.url.startsWith('/geojson/') && req.url !== '/geojson/france.geojson',
		);
		remaining.forEach((r) => r.flush({ type: 'FeatureCollection', features: [] }));
		await pump();

		return { emissions, completed };
	}

	it('loads demo trips, detects France as primary country and emits twice', async () => {
		const { emissions, completed } = await driveLoad();
		expect(emissions).toHaveLength(2);
		expect(completed).toBe(true);
	});

	it('reconstructs trips with positions, distances and stats', async () => {
		const { emissions } = await driveLoad();
		const initial = emissions[0];
		expect(initial.tripCount).toBe(2);
		expect(initial.totalKm).toBe(Math.round((12000 + 8000) / 1000));
		expect(initial.hexagonCount).toBe(Object.keys(H3_RESULT.counts).length);
		expect(initial.cellsByResolution[6]).toEqual(H3_RESULT);

		const trips = initial.tripsWithCoords;
		expect(trips).toHaveLength(2);
		const t0 = trips[0];
		expect(t0.trackerId).toBe(1);
		expect(t0.distance).toBe(12000);
		expect(t0.coords).toEqual(DEMO_TRIPS[0].coords);
		// Une position GPS interpolée par coordonnée
		expect(t0.positions).toHaveLength(DEMO_TRIPS[0].coords.length);
		expect(t0.indexId.startsWith('1_')).toBe(true);
		// maxAngle = 90 + inclinaison synthétique
		expect(t0.maxAngle).toBeGreaterThanOrEqual(90);
		// Vitesses recalculées depuis les positions
		expect(t0.maxSpeed).toBeGreaterThanOrEqual(t0.averageSpeed);
	});

	it('orders trips chronologically from dayOffset and startHour', async () => {
		const { emissions } = await driveLoad();
		const [tripA, tripB] = emissions[0].tripsWithCoords;
		// tripB a dayOffset 0 (plus récent) que tripA (dayOffset 5)
		expect(new Date(tripB.startTime).getTime()).toBeGreaterThan(new Date(tripA.startTime).getTime());
	});

	it('computes H3 and caches the result when no cache exists', async () => {
		await driveLoad();
		expect(h3Mock.computeResolutionAsync).toHaveBeenCalledTimes(1);
		// Mise en cache du résultat calculé
		expect(db.kvSet).toHaveBeenCalledWith(expect.stringContaining('demo_h3_res6_'), H3_RESULT);
	});

	it('uses the cached H3 data and does not re-persist it on a cache hit', async () => {
		const CACHED: H3Data = { counts: { '861fb4600ffffff': 9, '861fb4607ffffff': 3 }, cellToIndices: {} };
		db.kvGet.mockReturnValue(of(CACHED));
		const { emissions } = await driveLoad();
		// Les données émises proviennent du cache, pas du calcul
		expect(emissions[0].cellsByResolution[6]).toBe(CACHED);
		expect(emissions[0].hexagonCount).toBe(2);
		// Le tap de mise en cache (compute$) n'est jamais souscrit → aucun kvSet
		expect(db.kvSet).not.toHaveBeenCalled();
		// NB: computeResolutionAsync est tout de même appelé (Promise créée avec empressement
		// dans `from(this.h3.computeResolutionAsync(...))`), mais son résultat est ignoré.
	});

	it('merges the primary country features into the final emission', async () => {
		const { emissions } = await driveLoad();
		const final = emissions[1];
		// Les features de la France (Haute-Garonne) + Andorre + Luxembourg sont présentes
		const codes = final.departments.features.map((f) => f.properties?.['code']);
		expect(codes).toContain('31');
		// forceCountry: la France force country=FR sur ses features
		const hg = final.departments.features.find((f) => f.properties?.['code'] === '31');
		expect(hg?.properties?.['country']).toBe('FR');
	});

	it('tolerates a failed remaining-country fetch via catchError', async () => {
		const emissions: DemoData[] = [];
		let completed = false;
		service.load().subscribe({ next: (d) => emissions.push(d), complete: () => (completed = true) });

		httpMock.expectOne('/demo-trips.json').flush(DEMO_TRIPS);
		await pump();
		httpMock.expectOne('/geojson/france.geojson').flush(FRANCE_FC);
		await pump();
		await pump();

		const remaining = httpMock.match(
			(req) => req.url.startsWith('/geojson/') && req.url !== '/geojson/france.geojson',
		);
		// Le premier pays restant échoue (réseau), les autres répondent vide
		remaining.forEach((r, i) =>
			i === 0
				? r.flush(null, { status: 500, statusText: 'Server Error' })
				: r.flush({ type: 'FeatureCollection', features: [] }),
		);
		await pump();

		expect(emissions).toHaveLength(2);
		expect(completed).toBe(true);
	});
});
