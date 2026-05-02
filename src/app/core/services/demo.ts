import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { H3Data, H3Resolution, H3Service } from './h3';
import { Trip } from '../models/trip';

export type DemoTripWithCoords = Trip & { coords: [number, number][] };

export interface DemoData {
	departments: GeoJSON.FeatureCollection;
	cellsByResolution: Partial<Record<H3Resolution, H3Data>>;
	tripsWithCoords: DemoTripWithCoords[];
	tripCount: number;
	totalKm: number;
	hexagonCount: number;
}

interface OsrmRoute {
	routes: Array<{ geometry: { coordinates: [number, number][] }; distance: number }>;
}

const ROUTES: { start: string; end: string; date: string; waypoints: [number, number][] }[] = [
	{
		start: 'Toulouse',
		end: 'Carcassonne',
		date: '2024-03-15',
		waypoints: [
			[43.6, 1.44],
			[43.36, 1.81],
			[43.22, 2.35],
		],
	},
	{
		start: 'Carcassonne',
		end: 'Perpignan',
		date: '2024-03-16',
		waypoints: [
			[43.22, 2.35],
			[43.0, 2.65],
			[42.69, 2.9],
		],
	},
	{
		start: 'Toulouse',
		end: 'Montpellier',
		date: '2024-04-10',
		waypoints: [
			[43.6, 1.44],
			[43.42, 2.8],
			[43.34, 3.22],
			[43.61, 3.88],
		],
	},
	{
		start: 'Toulouse',
		end: 'Bayonne',
		date: '2024-05-01',
		waypoints: [
			[43.6, 1.44],
			[43.47, 0.67],
			[43.3, -0.37],
			[43.49, -1.48],
		],
	},
	{
		start: 'Toulouse',
		end: 'Foix',
		date: '2024-05-20',
		waypoints: [
			[43.6, 1.44],
			[43.3, 1.44],
			[42.96, 1.6],
		],
	},
	{
		start: 'Foix',
		end: 'Perpignan',
		date: '2024-05-21',
		waypoints: [
			[42.96, 1.6],
			[42.76, 2.2],
			[42.69, 2.9],
		],
	},
	{
		start: 'Montpellier',
		end: 'Marseille',
		date: '2024-06-05',
		waypoints: [
			[43.61, 3.88],
			[43.83, 4.36],
			[43.95, 4.81],
			[43.53, 5.45],
			[43.3, 5.37],
		],
	},
	{
		start: 'Marseille',
		end: 'Nice',
		date: '2024-07-14',
		waypoints: [
			[43.3, 5.37],
			[43.12, 5.93],
			[43.43, 6.74],
			[43.71, 7.26],
		],
	},
	{
		start: 'Nice',
		end: 'Grenoble',
		date: '2024-08-10',
		waypoints: [
			[43.71, 7.26],
			[44.11, 6.24],
			[44.56, 6.08],
			[45.19, 5.72],
		],
	},
	{
		start: 'Grenoble',
		end: 'Valence',
		date: '2024-08-12',
		waypoints: [
			[45.19, 5.72],
			[45.0, 5.1],
			[44.93, 4.89],
		],
	},
	{
		start: 'Valence',
		end: 'Avignon',
		date: '2024-09-03',
		waypoints: [
			[44.93, 4.89],
			[44.3, 4.81],
			[43.95, 4.81],
		],
	},
	{
		start: 'Bordeaux',
		end: 'Toulouse',
		date: '2024-09-20',
		waypoints: [
			[44.84, -0.58],
			[44.57, 0.25],
			[44.2, 0.62],
			[43.88, 1.0],
			[43.6, 1.44],
		],
	},
	{
		start: 'Toulouse',
		end: 'Albi',
		date: '2024-10-05',
		waypoints: [
			[43.6, 1.44],
			[43.68, 1.78],
			[43.93, 2.15],
		],
	},
	{
		start: 'Albi',
		end: 'Millau',
		date: '2024-10-06',
		waypoints: [
			[43.93, 2.15],
			[44.01, 2.57],
			[44.09, 2.99],
		],
	},
	{
		start: 'Millau',
		end: 'Mende',
		date: '2024-10-07',
		waypoints: [
			[44.09, 2.99],
			[44.3, 3.25],
			[44.52, 3.5],
		],
	},
	{
		start: 'Pau',
		end: 'Lourdes',
		date: '2024-10-20',
		waypoints: [
			[43.3, -0.37],
			[43.1, -0.05],
			[43.1, -0.01],
		],
	},
	{
		start: 'Bordeaux',
		end: 'Arcachon',
		date: '2024-11-01',
		waypoints: [
			[44.84, -0.58],
			[44.66, -1.17],
		],
	},
	{
		start: 'Agen',
		end: 'Cahors',
		date: '2024-11-10',
		waypoints: [
			[44.2, 0.62],
			[44.35, 1.04],
			[44.44, 1.44],
		],
	},
	{
		start: 'Toulouse',
		end: 'Montauban',
		date: '2025-03-05',
		waypoints: [
			[43.6, 1.44],
			[43.76, 1.35],
			[44.01, 1.35],
		],
	},
	{
		start: 'Avignon',
		end: 'Gap',
		date: '2025-04-15',
		waypoints: [
			[43.95, 4.81],
			[44.2, 5.0],
			[44.56, 6.08],
		],
	},
	{
		start: 'Béziers',
		end: 'Sète',
		date: '2025-03-10',
		waypoints: [
			[43.34, 3.22],
			[43.31, 3.47],
			[43.41, 3.7],
		],
	},
	{
		start: 'Béziers',
		end: 'Limoux',
		date: '2025-03-11',
		waypoints: [
			[43.34, 3.22],
			[43.18, 3.0],
			[43.18, 2.76],
			[43.05, 2.22],
		],
	},
	{
		start: 'Béziers',
		end: 'Le Vigan',
		date: '2025-03-18',
		waypoints: [
			[43.34, 3.22],
			[43.6, 3.07],
			[43.73, 3.32],
			[43.99, 3.61],
		],
	},
	{
		start: 'Béziers',
		end: 'Mazamet',
		date: '2025-03-25',
		waypoints: [
			[43.34, 3.22],
			[43.48, 2.77],
			[43.6, 2.24],
			[43.49, 2.37],
		],
	},
	{
		start: 'Béziers',
		end: 'Saint-Affrique',
		date: '2025-04-01',
		waypoints: [
			[43.34, 3.22],
			[43.61, 3.16],
			[43.71, 3.05],
			[43.95, 2.89],
		],
	},
	{
		start: 'Béziers',
		end: 'Montpellier',
		date: '2025-04-08',
		waypoints: [
			[43.34, 3.22],
			[43.46, 3.42],
			[43.65, 3.56],
			[43.61, 3.88],
		],
	},
	{
		start: 'Béziers',
		end: 'Roquebrun',
		date: '2025-04-12',
		waypoints: [
			[43.34, 3.22],
			[43.39, 3.09],
			[43.48, 2.97],
		],
	},
	{
		start: 'Béziers',
		end: 'Vailhan',
		date: '2025-04-19',
		waypoints: [
			[43.34, 3.22],
			[43.44, 3.3],
			[43.55, 3.3],
		],
	},
	{
		start: "Cazouls-d'Hérault",
		end: 'Pouzolles',
		date: '2025-04-22',
		waypoints: [
			[43.55, 3.41],
			[43.53, 3.36],
			[43.51, 3.32],
		],
	},
	{
		start: 'Cessenon-sur-Orb',
		end: 'Olargues',
		date: '2025-04-26',
		waypoints: [
			[43.45, 3.05],
			[43.5, 2.99],
			[43.55, 2.91],
		],
	},
	{
		start: 'Béziers',
		end: "Clermont-l'Hérault",
		date: '2025-05-03',
		waypoints: [
			[43.34, 3.22],
			[43.43, 3.35],
			[43.47, 3.48],
			[43.63, 3.43],
		],
	},
	{
		start: 'Lodève',
		end: "Clermont-l'Hérault",
		date: '2025-05-04',
		waypoints: [
			[43.73, 3.32],
			[43.66, 3.36],
			[43.63, 3.43],
		],
	},
	{
		start: 'Gignac',
		end: 'Saint-Guilhem-le-Désert',
		date: '2025-05-10',
		waypoints: [
			[43.65, 3.56],
			[43.67, 3.57],
			[43.73, 3.55],
		],
	},
	{
		start: 'Montpellier',
		end: 'Ganges',
		date: '2025-05-17',
		waypoints: [
			[43.61, 3.88],
			[43.72, 3.81],
			[43.79, 3.72],
			[43.93, 3.71],
		],
	},
	{
		start: 'Béziers',
		end: 'Frontignan',
		date: '2025-05-24',
		waypoints: [
			[43.34, 3.22],
			[43.38, 3.43],
			[43.43, 3.61],
			[43.45, 3.75],
		],
	},
	{
		start: 'Montpellier',
		end: 'Lunel',
		date: '2025-05-28',
		waypoints: [
			[43.61, 3.88],
			[43.64, 4.02],
			[43.68, 4.13],
		],
	},
	{
		start: 'Béziers',
		end: 'Capestang',
		date: '2025-06-01',
		waypoints: [
			[43.34, 3.22],
			[43.39, 3.09],
			[43.33, 2.98],
		],
	},
	{
		start: 'Pézenas',
		end: 'Montpellier',
		date: '2025-06-05',
		waypoints: [
			[43.46, 3.42],
			[43.47, 3.48],
			[43.44, 3.63],
			[43.5, 3.78],
			[43.61, 3.88],
		],
	},
	{
		start: 'Gignac',
		end: 'Montpellier',
		date: '2025-06-07',
		waypoints: [
			[43.65, 3.56],
			[43.53, 3.57],
			[43.49, 3.62],
			[43.55, 3.74],
			[43.61, 3.88],
		],
	},
	{
		start: 'Saint-Pons',
		end: 'La Salvetat-sur-Agout',
		date: '2025-06-10',
		waypoints: [
			[43.48, 2.77],
			[43.53, 2.81],
			[43.63, 2.75],
			[43.65, 2.68],
		],
	},
	{
		start: 'Bédarieux',
		end: "Le Bousquet-d'Orb",
		date: '2025-06-14',
		waypoints: [
			[43.61, 3.16],
			[43.68, 3.09],
			[43.71, 3.03],
		],
	},
	{
		start: 'Bédarieux',
		end: 'Lodève',
		date: '2025-06-17',
		waypoints: [
			[43.61, 3.16],
			[43.67, 3.24],
			[43.73, 3.32],
		],
	},
	{
		start: 'Lodève',
		end: 'Avène',
		date: '2025-06-20',
		waypoints: [
			[43.73, 3.32],
			[43.72, 3.18],
			[43.71, 3.03],
		],
	},
	{
		start: 'Millau',
		end: 'Lodève',
		date: '2025-06-24',
		waypoints: [
			[44.09, 2.99],
			[43.87, 3.27],
			[43.77, 3.37],
			[43.73, 3.32],
		],
	},
];

@Injectable({ providedIn: 'root' })
export class DemoService {
	private http = inject(HttpClient);
	private h3 = inject(H3Service);

	load(): Observable<DemoData> {
		return this.http.get<GeoJSON.FeatureCollection>('/departements.geojson').pipe(
			switchMap((departments) =>
				forkJoin(ROUTES.map((r) => this.fetchRoute(r.waypoints))).pipe(
					map((coordArrays) => {
						const tripsWithCoords = ROUTES.map((route, i) => this.buildTrip(route, i, coordArrays[i]));
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
				),
			),
		);
	}

	// OSRM public API — coords in [lng,lat], converted to [lat,lng] for H3
	private fetchRoute(waypoints: [number, number][]): Observable<{ coords: [number, number][]; distanceM: number }> {
		const coordStr = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
		const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
		return this.http.get<OsrmRoute>(url).pipe(
			map((res) => ({
				coords: res.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
				distanceM: res.routes[0].distance,
			})),
			catchError(() => of({ coords: waypoints, distanceM: this.haversineTotal(waypoints) })),
		);
	}

	private buildTrip(
		route: (typeof ROUTES)[number],
		i: number,
		{ coords, distanceM }: { coords: [number, number][]; distanceM: number },
	): DemoTripWithCoords {
		const durationSec = Math.round((distanceM / 1000 / 75) * 3600);
		const startDate = new Date(route.date + 'T09:00:00Z');
		return {
			id: i + 1,
			trackerId: 1,
			distance: distanceM,
			duration: durationSec,
			averageSpeed: 75,
			maxSpeed: 130,
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
			maxAngle: 0,
			maxLeftAngle: null,
			maxRightAngle: null,
			averageAngle: null,
			isFavorite: false,
			coords,
		};
	}

	private haversineTotal(coords: [number, number][]): number {
		let total = 0;
		for (let i = 1; i < coords.length; i++) {
			const [lat1, lng1] = coords[i - 1];
			const [lat2, lng2] = coords[i];
			const R = 6371000;
			const dLat = ((lat2 - lat1) * Math.PI) / 180;
			const dLng = ((lng2 - lng1) * Math.PI) / 180;
			const a =
				Math.sin(dLat / 2) ** 2 +
				Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
			total += 2 * R * Math.asin(Math.sqrt(a));
		}
		return total;
	}
}
