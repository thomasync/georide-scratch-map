import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, Observable } from 'rxjs';
import { ANDORRA_FEATURE } from '../data/andorra';
import { LUXEMBOURG_FEATURES } from '../data/luxembourg';
import { H3Data, H3Resolution, H3Service } from './h3';
import { Trip } from '../models/trip';
import { GeoRidePosition } from './georide-api';

interface DemoTripData {
	start: string;
	end: string;
	dayOffset: number;
	startHour: number;
	distanceM: number;
	coords: [number, number][];
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

	load(): Observable<DemoData> {
		const COUNTRY_LOADS: { file: string; country: string; forceCountry?: boolean }[] = [
			{ file: '/geojson/france.geojson', country: 'FR', forceCountry: true },
			{ file: '/geojson/spain.geojson', country: 'ES' },
			{ file: '/geojson/italy.geojson', country: 'IT' },
			{ file: '/geojson/portugal.geojson', country: 'PT' },
			{ file: '/geojson/belgium.geojson', country: 'BE' },
			{ file: '/geojson/netherlands.geojson', country: 'NL' },
			{ file: '/geojson/germany.geojson', country: 'DE' },
			{ file: '/geojson/switzerland.geojson', country: 'CH' },
			{ file: '/geojson/liechtenstein.geojson', country: 'LI' },
			{ file: '/geojson/austria.geojson', country: 'AT' },
			{ file: '/geojson/slovenia.geojson', country: 'SI' },
			{ file: '/geojson/morocco.geojson', country: 'MA' },
			{ file: '/geojson/england.geojson', country: 'GB' },
			{ file: '/geojson/ireland.geojson', country: 'IE' },
			{ file: '/geojson/isle-of-man.geojson', country: 'IM' },
			{ file: '/geojson/scotland.geojson', country: 'SCO' },
			{ file: '/geojson/wales.geojson', country: 'WAL' },
			{ file: '/geojson/croatia.geojson', country: 'HR' },
			{ file: '/geojson/denmark.geojson', country: 'DK' },
			{ file: '/geojson/sweden.geojson', country: 'SE' },
			{ file: '/geojson/norway.geojson', country: 'NO' },
			{ file: '/geojson/czechia.geojson', country: 'CZ' },
			{ file: '/geojson/hungary.geojson', country: 'HU' },
			{ file: '/geojson/romania.geojson', country: 'RO' },
			{ file: '/geojson/greece.geojson', country: 'GR' },
			{ file: '/geojson/tunisia.geojson', country: 'TN' },
			{ file: '/geojson/iceland.geojson', country: 'IS' },
		];
		return forkJoin([
			...COUNTRY_LOADS.map((c) => this.http.get<GeoJSON.FeatureCollection>(c.file)),
			this.http.get<DemoTripData[]>('/demo-trips.json'),
		]).pipe(
			map((results) => {
				const demoTrips = results.pop() as DemoTripData[];
				const collections = results as GeoJSON.FeatureCollection[];
				const departments: GeoJSON.FeatureCollection = {
					type: 'FeatureCollection',
					features: [
						...collections.flatMap((fc, i) => {
							const c = COUNTRY_LOADS[i];
							return fc.features.map((f) => ({
								...f,
								properties: c.forceCountry ? { ...f.properties, country: c.country } : f.properties,
							}));
						}),
						ANDORRA_FEATURE,
						...LUXEMBOURG_FEATURES.features,
					],
				};
				const tripsWithCoords = demoTrips.map((route, i) => this.buildTrip(route, i));
				const tripData = tripsWithCoords.map((t) => ({
					coords: t.coords,
					date: t.startTime.substring(0, 10),
				}));
				const h3Data = this.h3.computeResolution(tripData, 6);
				return {
					departments,
					cellsByResolution: { 6: h3Data } as Partial<Record<H3Resolution, H3Data>>,
					tripsWithCoords,
					tripCount: tripsWithCoords.length,
					totalKm: Math.round(tripsWithCoords.reduce((s, t) => s + t.distance, 0) / 1000),
					hexagonCount: Object.keys(h3Data.counts).length,
				};
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
		const baseAlt = 10 + Math.floor(rand() * 150);
		// Altitude : part et revient à baseAlt, varie au milieu
		const altKeys = Array.from({ length: NUM_KEYS + 1 }, (_, k) =>
			k === 0 || k === NUM_KEYS ? baseAlt : baseAlt + (rand() - 0.4) * 80,
		);
		// Vitesse : faible au départ et à l'arrivée, max au milieu
		const speedKeys = Array.from({ length: NUM_KEYS + 1 }, (_, k) => {
			if (k === 0 || k === NUM_KEYS) return avgSpeedKnots * 0.1;
			const bell = Math.sin((k / NUM_KEYS) * Math.PI);
			return avgSpeedKnots * (0.6 + bell * 0.8 + (rand() - 0.3) * 0.4);
		});
		// Angle : vertical (90°) au départ et à l'arrivée, inclinaison au milieu
		const angleKeys = Array.from({ length: NUM_KEYS + 1 }, (_, k) =>
			k === 0 || k === NUM_KEYS ? 90 : 90 + (rand() - 0.5) * 28,
		);

		// Échantillonnage 1/10 pour les positions (graphiques + pauses) — le panneau rééchantillonne de toute façon
		const POS_STEP = 10;
		const sampledIndices = coords.reduce<number[]>((acc, _, idx) => {
			if (idx % POS_STEP === 0 || idx === coords.length - 1) acc.push(idx);
			return acc;
		}, []);
		const positions: GeoRidePosition[] = sampledIndices.map((idx) => {
			const [lat, lon] = coords[idx];
			const t = idx / Math.max(coords.length - 1, 1);
			const seg = Math.min(Math.floor(t * NUM_KEYS), NUM_KEYS - 1);
			const st = t * NUM_KEYS - seg;
			const altitude = Math.round(Math.max(1, ss(altKeys[seg], altKeys[seg + 1], st)));
			const speedKnots = Math.max(0.3, ss(speedKeys[seg], speedKeys[seg + 1], st));
			const angle = ss(angleKeys[seg], angleKeys[seg + 1], st);
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

		// Stats d'angle réalistes depuis les positions
		const maxAngleVal = Math.max(...positions.map((p) => Math.abs(p.angle - 90)));
		const maxLeftAngle = 90 - Math.min(...positions.map((p) => p.angle));
		const maxRightAngle = Math.max(...positions.map((p) => p.angle)) - 90;

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
			maxAngle: 90 + maxAngleVal,
			maxLeftAngle,
			maxRightAngle,
			averageAngle: 14,
			isFavorite: false,
			coords,
			positions,
		};
	}
}
