import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
	asyncScheduler,
	catchError,
	concat,
	forkJoin,
	from,
	map,
	Observable,
	observeOn,
	of,
	switchMap,
	tap,
} from 'rxjs';
import { ANDORRA_FEATURE } from '../data/andorra';
import { LUXEMBOURG_FEATURES } from '../data/luxembourg';
import { LoggerService } from './logger';
import { H3Data, H3Resolution, H3Service } from './h3';
import { DatabaseService } from './database';
import { Trip } from '../models/trip';
import { GeoRidePosition } from './georide-api';

const demoCacheKey = (trips: { distanceM: number }[]) =>
	`demo_h3_res6_${trips.length}_${trips.reduce((s, t) => s + t.distanceM, 0)}`;

interface DemoTripData {
	start: string;
	end: string;
	dayOffset: number;
	startHour: number;
	distanceM: number;
	coords: [number, number][];
	alts?: number[]; // altitudes réelles SRTM, même longueur que coords
}

export type DemoTripWithCoords = Trip & { indexId: string; coords: [number, number][]; positions: GeoRidePosition[] };

export interface DemoData {
	departments: GeoJSON.FeatureCollection;
	cellsByResolution: Partial<Record<H3Resolution, H3Data>>;
	tripsWithCoords: DemoTripWithCoords[];
	tripCount: number;
	totalKm: number;
	hexagonCount: number;
}

@Injectable({ providedIn: 'root' })
export class DemoService {
	private http = inject(HttpClient);
	private h3 = inject(H3Service);
	private db = inject(DatabaseService);
	private logger = new LoggerService();

	load(): Observable<DemoData> {
		const ALL_COUNTRY_LOADS: {
			file: string;
			country: string;
			forceCountry?: boolean;
			minLat: number;
			maxLat: number;
			minLon: number;
			maxLon: number;
		}[] = [
			{
				file: '/geojson/france.geojson',
				country: 'FR',
				forceCountry: true,
				minLat: 41.3,
				maxLat: 51.2,
				minLon: -5.2,
				maxLon: 9.6,
			},
			{ file: '/geojson/spain.geojson', country: 'ES', minLat: 27.6, maxLat: 43.8, minLon: -18.2, maxLon: 4.4 },
			{ file: '/geojson/italy.geojson', country: 'IT', minLat: 35.5, maxLat: 47.1, minLon: 6.6, maxLon: 18.5 },
			{
				file: '/geojson/portugal.geojson',
				country: 'PT',
				minLat: 29.0,
				maxLat: 42.2,
				minLon: -31.5,
				maxLon: -6.2,
			},
			{ file: '/geojson/belgium.geojson', country: 'BE', minLat: 49.5, maxLat: 51.5, minLon: 2.5, maxLon: 6.4 },
			{
				file: '/geojson/netherlands.geojson',
				country: 'NL',
				minLat: 50.7,
				maxLat: 53.7,
				minLon: 3.3,
				maxLon: 7.3,
			},
			{ file: '/geojson/germany.geojson', country: 'DE', minLat: 47.3, maxLat: 55.1, minLon: 5.9, maxLon: 15.0 },
			{
				file: '/geojson/switzerland.geojson',
				country: 'CH',
				minLat: 45.8,
				maxLat: 47.9,
				minLon: 5.9,
				maxLon: 10.5,
			},
			{
				file: '/geojson/liechtenstein.geojson',
				country: 'LI',
				minLat: 47.0,
				maxLat: 47.3,
				minLon: 9.4,
				maxLon: 9.7,
			},
			{ file: '/geojson/austria.geojson', country: 'AT', minLat: 46.4, maxLat: 49.0, minLon: 9.5, maxLon: 17.2 },
			{
				file: '/geojson/slovenia.geojson',
				country: 'SI',
				minLat: 45.4,
				maxLat: 46.9,
				minLon: 13.4,
				maxLon: 16.6,
			},
			{
				file: '/geojson/morocco.geojson',
				country: 'MA',
				minLat: 21.4,
				maxLat: 36.0,
				minLon: -17.1,
				maxLon: -1.0,
			},
			{ file: '/geojson/england.geojson', country: 'GB', minLat: 49.9, maxLat: 55.8, minLon: -5.7, maxLon: 1.8 },
			{
				file: '/geojson/ireland.geojson',
				country: 'IE',
				minLat: 51.4,
				maxLat: 55.4,
				minLon: -10.5,
				maxLon: -5.9,
			},
			{
				file: '/geojson/isle-of-man.geojson',
				country: 'IM',
				minLat: 54.0,
				maxLat: 54.5,
				minLon: -4.85,
				maxLon: -4.3,
			},
			{
				file: '/geojson/scotland.geojson',
				country: 'SCO',
				minLat: 54.6,
				maxLat: 60.9,
				minLon: -7.6,
				maxLon: -0.7,
			},
			{ file: '/geojson/wales.geojson', country: 'WAL', minLat: 51.3, maxLat: 53.5, minLon: -5.3, maxLon: -2.6 },
			{ file: '/geojson/croatia.geojson', country: 'HR', minLat: 42.4, maxLat: 46.6, minLon: 13.5, maxLon: 19.5 },
			{ file: '/geojson/denmark.geojson', country: 'DK', minLat: 54.5, maxLat: 57.8, minLon: 8.0, maxLon: 15.2 },
			{ file: '/geojson/sweden.geojson', country: 'SE', minLat: 55.3, maxLat: 69.1, minLon: 10.9, maxLon: 24.2 },
			{ file: '/geojson/norway.geojson', country: 'NO', minLat: 57.9, maxLat: 71.2, minLon: 4.5, maxLon: 31.1 },
			{ file: '/geojson/czechia.geojson', country: 'CZ', minLat: 48.5, maxLat: 51.1, minLon: 12.1, maxLon: 18.9 },
			{ file: '/geojson/hungary.geojson', country: 'HU', minLat: 45.7, maxLat: 48.6, minLon: 16.1, maxLon: 22.9 },
			{ file: '/geojson/romania.geojson', country: 'RO', minLat: 43.6, maxLat: 48.3, minLon: 20.3, maxLon: 29.7 },
			{ file: '/geojson/greece.geojson', country: 'GR', minLat: 34.8, maxLat: 41.8, minLon: 19.5, maxLon: 28.3 },
			{ file: '/geojson/tunisia.geojson', country: 'TN', minLat: 30.2, maxLat: 37.5, minLon: 7.5, maxLon: 11.6 },
			{
				file: '/geojson/iceland.geojson',
				country: 'IS',
				minLat: 63.3,
				maxLat: 66.6,
				minLon: -24.5,
				maxLon: -13.5,
			},
		];

		const buildDepts = (
			collections: GeoJSON.FeatureCollection[],
			loads: (typeof ALL_COUNTRY_LOADS)[number][],
			extra: GeoJSON.Feature[],
		): GeoJSON.FeatureCollection => ({
			type: 'FeatureCollection',
			features: [
				...collections.flatMap((fc, i) =>
					fc.features.map((f) => ({
						...f,
						properties: loads[i].forceCountry
							? { ...f.properties, country: loads[i].country }
							: f.properties,
					})),
				),
				...extra,
			],
		});

		// Charge d'abord les trips pour détecter dynamiquement le pays du dernier trajet
		return this.http.get<DemoTripData[]>('/demo-trips.json').pipe(
			switchMap((demoTrips) => {
				// Dernier trajet = dayOffset le plus bas (le plus récent)
				const lastTrip = demoTrips.reduce((a, b) => (a.dayOffset <= b.dayOffset ? a : b));
				const [lat, lon] = lastTrip.coords[0];
				// Trouver le pays du dernier trajet
				const primaryLoad =
					ALL_COUNTRY_LOADS.find(
						(c) => lat >= c.minLat && lat <= c.maxLat && lon >= c.minLon && lon <= c.maxLon,
					) ?? ALL_COUNTRY_LOADS[0]; // fallback France
				const remainingLoads = ALL_COUNTRY_LOADS.filter((c) => c !== primaryLoad);
				this.logger.log(
					'Demo',
					`primary country: ${primaryLoad.country} (last trip at [${lat.toFixed(2)},${lon.toFixed(2)}])`,
				);

				return forkJoin([this.http.get<GeoJSON.FeatureCollection>(primaryLoad.file), of(demoTrips)]).pipe(
					observeOn(asyncScheduler),
					map(([primaryFc]) => {
						const departments = buildDepts(
							[primaryFc],
							[primaryLoad],
							[ANDORRA_FEATURE, ...LUXEMBOURG_FEATURES.features],
						);
						const tripsWithCoords = demoTrips.map((route, i) => this.buildTrip(route, i));
						return { departments, tripsWithCoords, remainingLoads };
					}),
					switchMap(({ departments, tripsWithCoords, remainingLoads }) => {
						const tripData = tripsWithCoords.map((t) => ({
							coords: t.coords,
							date: t.startTime.substring(0, 10),
						}));
						const cacheKey = demoCacheKey(demoTrips);
						const compute$ = from(this.h3.computeResolutionAsync(tripData, 6)).pipe(
							tap((h3Data) => this.db.kvSet(cacheKey, h3Data).subscribe()),
						);
						return this.db.kvGet<H3Data>(cacheKey).pipe(
							tap((cached) =>
								this.logger.log('Demo', cached ? 'H3 res=6 from cache' : 'H3 res=6 computing...'),
							),
							switchMap((cached) => (cached ? of(cached) : compute$)),
							map((h3Data) => ({
								initialData: {
									departments,
									cellsByResolution: { 6: h3Data } as Partial<Record<H3Resolution, H3Data>>,
									tripsWithCoords,
									tripCount: tripsWithCoords.length,
									totalKm: Math.round(tripsWithCoords.reduce((s, t) => s + t.distance, 0) / 1000),
									hexagonCount: Object.keys(h3Data.counts).length,
								},
								remainingLoads,
							})),
						);
					}),
					switchMap(({ initialData, remainingLoads }) =>
						concat(
							of(initialData),
							forkJoin(
								remainingLoads.map((c) =>
									this.http
										.get<GeoJSON.FeatureCollection>(c.file)
										.pipe(
											catchError(() => of({ type: 'FeatureCollection' as const, features: [] })),
										),
								),
							).pipe(
								tap((fcs) => this.logger.log('Demo', `remaining countries loaded: ${fcs.length}`)),
								map((remainingFcs) => ({
									...initialData,
									departments: buildDepts(remainingFcs, remainingLoads, [
										...initialData.departments.features,
									]),
								})),
							),
						),
					),
				);
			}),
		);
	}

	private buildTrip(route: DemoTripData, i: number): DemoTripWithCoords {
		const { coords, distanceM } = route;

		// PRNG déterministe seedé sur l'index du trajet — comportement identique à chaque chargement
		let seed = (i * 2654435761) >>> 0;
		const rand = (): number => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 4294967296;
		};

		const avgKmh = 25 + Math.floor(rand() * 65); // 25–90 km/h
		const maxKmh = avgKmh + 20 + Math.floor(rand() * 60); // avg+20 à avg+80
		const durationSec = Math.round((distanceM / 1000 / avgKmh) * 3600);
		const durationMs = durationSec * 1000;
		const avgSpeedKnots = avgKmh / 1.852;
		const maxSpeedKnots = maxKmh / 1.852;

		const startDate = new Date();
		startDate.setDate(startDate.getDate() - route.dayOffset);
		startDate.setHours(route.startHour, 0, 0, 0);

		const startMs = startDate.getTime();
		const msPerCoord = durationMs / Math.max(coords.length - 1, 1);

		// Keyframes + smoothstep pour des courbes réalistes non-bruitées
		const NUM_KEYS = 6;
		const ss = (a: number, b: number, t: number) => {
			const x = Math.max(0, Math.min(1, t));
			return a + (b - a) * x * x * (3 - 2 * x);
		};
		// Altitudes : vraies valeurs SRTM si disponibles, sinon synthétiques
		const hasRealAlts = route.alts && route.alts.length === coords.length;
		const baseAlt = 100 + Math.floor(rand() * 500);
		const altKeys = hasRealAlts
			? []
			: Array.from({ length: NUM_KEYS + 1 }, (_, k) =>
					k === 0 || k === NUM_KEYS ? baseAlt : baseAlt + rand() * 900,
				);
		// Vitesse : faible au départ et à l'arrivée, max au milieu
		const speedKeys = Array.from({ length: NUM_KEYS + 1 }, (_, k) => {
			if (k === 0 || k === NUM_KEYS) return avgSpeedKnots * 0.1;
			const bell = Math.sin((k / NUM_KEYS) * Math.PI);
			return avgSpeedKnots * (0.6 + bell * 0.8 + (rand() - 0.3) * 0.4);
		});

		// Cap compass calculé depuis les coords — requis pour la détection des virages
		const toRad = (d: number) => (d * Math.PI) / 180;
		const compassBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
			const dLon = toRad(lon2 - lon1);
			const y = Math.sin(dLon) * Math.cos(toRad(lat2));
			const x =
				Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
				Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
			return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
		};

		const positions: GeoRidePosition[] = coords.map(([lat, lon], idx) => {
			const t = idx / Math.max(coords.length - 1, 1);
			const seg = Math.min(Math.floor(t * NUM_KEYS), NUM_KEYS - 1);
			const st = t * NUM_KEYS - seg;
			const altitude = hasRealAlts
				? Math.max(1, route.alts![idx])
				: Math.round(Math.max(1, ss(altKeys[seg], altKeys[seg + 1], st)));
			const speedKnots = Math.max(0.3, ss(speedKeys[seg], speedKeys[seg + 1], st));
			const angle =
				idx < coords.length - 1
					? compassBearing(lat, lon, coords[idx + 1][0], coords[idx + 1][1])
					: idx > 0
						? compassBearing(coords[idx - 1][0], coords[idx - 1][1], lat, lon)
						: 0;
			return {
				fixtime: new Date(startMs + idx * msPerCoord).toISOString(),
				latitude: lat,
				longitude: lon,
				altitude,
				speed: speedKnots,
				angle,
				address: null,
			};
		});

		// Stats d'inclinaison synthétiques (angle = cap compass, pas lean angle)
		const maxLean = 10 + rand() * 35;
		const maxLeftAngle = rand() * maxLean;
		const maxRightAngle = maxLean - maxLeftAngle;

		// Calculer les vitesses réelles depuis les positions pour cohérence avec le graphique
		const actualMaxSpeed = Math.max(...positions.map((p) => p.speed));
		const actualAvgSpeed = positions.reduce((s, p) => s + p.speed, 0) / positions.length;

		return {
			id: i + 1,
			indexId: `1_${startDate.toISOString()}`,
			trackerId: 1,
			distance: distanceM,
			duration: durationMs,
			averageSpeed: actualAvgSpeed,
			maxSpeed: actualMaxSpeed,
			startTime: startDate.toISOString(),
			endTime: new Date(startDate.getTime() + durationSec * 1000).toISOString(),
			startLat: coords[0][0],
			startLon: coords[0][1],
			endLat: coords[coords.length - 1][0],
			endLon: coords[coords.length - 1][1],
			startAddress: route.start,
			niceStartAddress: route.start,
			endAddress: route.end,
			niceEndAddress: route.end,
			staticImage: '',
			maxAngle: 90 + maxLean,
			maxLeftAngle,
			maxRightAngle,
			averageAngle: 14,
			isFavorite: false,
			coords,
			positions,
		};
	}
}
