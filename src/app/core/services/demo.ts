import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { ANDORRA_FEATURE } from '../data/andorra';
import { LUXEMBOURG_FEATURES } from '../data/luxembourg';
import { H3Data, H3Resolution, H3Service } from './h3';
import { Trip } from '../models/trip';
import { GeoRidePosition } from './georide-api';

export type DemoTripWithCoords = Trip & { coords: [number, number][]; positions: GeoRidePosition[] };

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
	{
		start: 'Perpignan',
		end: 'Girona',
		date: '2025-07-05',
		waypoints: [
			[42.69, 2.9],
			[42.42, 2.87],
			[42.1, 2.82],
			[41.98, 2.82],
		],
	},
	{
		start: 'Girona',
		end: 'Barcelona',
		date: '2025-07-06',
		waypoints: [
			[41.98, 2.82],
			[41.72, 2.83],
			[41.57, 2.64],
			[41.39, 2.16],
		],
	},
	{
		start: 'Barcelona',
		end: 'Tarragona',
		date: '2025-07-07',
		waypoints: [
			[41.39, 2.16],
			[41.27, 1.98],
			[41.12, 1.24],
		],
	},
	{
		start: 'Bayonne',
		end: 'San Sebastián',
		date: '2025-07-12',
		waypoints: [
			[43.49, -1.48],
			[43.36, -1.79],
			[43.32, -1.98],
		],
	},
	{
		start: 'San Sebastián',
		end: 'Bilbao',
		date: '2025-07-13',
		waypoints: [
			[43.32, -1.98],
			[43.3, -2.32],
			[43.26, -2.93],
		],
	},
	{
		start: 'Barcelona',
		end: 'Lleida',
		date: '2025-07-20',
		waypoints: [
			[41.39, 2.16],
			[41.53, 1.83],
			[41.62, 1.25],
			[41.62, 0.63],
		],
	},
	{
		start: 'Lleida',
		end: 'Zaragoza',
		date: '2025-07-21',
		waypoints: [
			[41.62, 0.63],
			[41.53, 0.03],
			[41.65, -0.89],
		],
	},
	{
		start: 'Foix',
		end: 'Andorra la Vella',
		date: '2025-08-02',
		waypoints: [
			[42.96, 1.6],
			[42.82, 1.6],
			[42.65, 1.58],
			[42.51, 1.52],
		],
	},
	// --- Nouvelles routes pour couvrir les pays manquants ---
	// A — Monaco 🇲🇨
	{
		start: 'Nice',
		end: 'Monaco',
		date: '2024-06-12',
		waypoints: [
			[43.71, 7.26],
			[43.73, 7.32],
			[43.74, 7.42],
		],
	},
	// B — Italie 🇮🇹
	{
		start: 'Nice',
		end: 'San Remo',
		date: '2024-07-03',
		waypoints: [
			[43.71, 7.26],
			[43.79, 7.52], // Ventimiglia (frontière)
			[43.82, 7.78], // San Remo, Italie
		],
	},
	// C — Suisse 🇨🇭
	{
		start: 'Grenoble',
		end: 'Genève',
		date: '2024-07-20',
		waypoints: [
			[45.19, 5.72],
			[45.58, 5.92],
			[45.9, 6.11],
			[46.2, 6.15], // Genève, Suisse
		],
	},
	// D — Allemagne 🇩🇪
	{
		start: 'Genève',
		end: 'Freiburg-im-Breisgau',
		date: '2024-08-05',
		waypoints: [
			[46.2, 6.15],
			[47.56, 7.59], // Basel, Suisse
			[47.99, 7.85], // Freiburg, Allemagne
		],
	},
	// E — Liechtenstein 🇱🇮
	{
		start: 'Freiburg-im-Breisgau',
		end: 'Vaduz',
		date: '2024-08-18',
		waypoints: [
			[47.99, 7.85],
			[47.5, 9.0], // Constance (DE)
			[47.14, 9.52], // Vaduz, Liechtenstein
		],
	},
	// F — Autriche 🇦🇹
	{
		start: 'Vaduz',
		end: 'Innsbruck',
		date: '2024-09-01',
		waypoints: [
			[47.14, 9.52],
			[47.27, 10.18], // Bregenz (AT)
			[47.27, 11.39], // Innsbruck, Autriche
		],
	},
	// G — Slovénie 🇸🇮
	{
		start: 'Innsbruck',
		end: 'Ljubljana',
		date: '2024-09-15',
		waypoints: [
			[47.27, 11.39],
			[46.62, 13.85], // Villach (AT)
			[46.05, 14.51], // Ljubljana, Slovénie
		],
	},
	// H — Belgique 🇧🇪
	{
		start: 'Toulouse',
		end: 'Bruxelles',
		date: '2024-10-08',
		waypoints: [
			[43.6, 1.44],
			[47.32, 5.04], // Dijon (FR)
			[49.26, 4.03], // Reims (FR)
			[50.85, 4.35], // Bruxelles, Belgique
		],
	},
	// I — Luxembourg 🇱🇺
	{
		start: 'Bruxelles',
		end: 'Luxembourg',
		date: '2024-10-22',
		waypoints: [
			[50.85, 4.35],
			[49.61, 6.13], // Luxembourg City
		],
	},
	// J — Pays-Bas 🇳🇱
	{
		start: 'Bruxelles',
		end: 'Amsterdam',
		date: '2024-11-03',
		waypoints: [
			[50.85, 4.35],
			[51.92, 4.48], // Rotterdam (NL)
			[52.37, 4.89], // Amsterdam, Pays-Bas
		],
	},
	// K — Portugal 🇵🇹
	{
		start: 'Bilbao',
		end: 'Porto',
		date: '2025-04-12',
		waypoints: [
			[43.26, -2.93],
			[40.96, -5.66], // Salamanque (ES)
			[41.15, -8.61], // Porto, Portugal
		],
	},
	// L — Algéciras (étape vers le Maroc)
	{
		start: 'Tarragona',
		end: 'Algeciras',
		date: '2025-05-20',
		waypoints: [
			[41.12, 1.24],
			[38.35, -0.48], // Alicante (ES)
			[37.39, -5.99], // Séville (ES)
			[36.14, -5.35], // Algeciras (ES)
		],
	},
	// M — Maroc 🇲🇦 (suite du ferry Algeciras → Tanger)
	{
		start: 'Tanger',
		end: 'Marrakech',
		date: '2025-05-21',
		waypoints: [
			[35.77, -5.8], // Tanger, Maroc
			[33.57, -7.58], // Casablanca, Maroc
			[31.63, -8.0], // Marrakech, Maroc
		],
	},
	// N — Angleterre 1 🏴󠁧󠁢󠁥󠁮󠁧󠁿 (Eurotunnel → remontée vers le nord)
	{
		start: 'Dover',
		end: 'Newcastle',
		date: '2025-07-10',
		waypoints: [
			[51.13, 1.31], // Dover, South East
			[51.51, -0.13], // London
			[52.48, -1.9], // Birmingham, West Midlands
			[53.48, -2.24], // Manchester, North West
			[54.97, -1.61], // Newcastle, North East
		],
	},
	// O — Angleterre 2 🏴󠁧󠁢󠁥󠁮󠁧󠁿 (boucle couvrant les régions restantes)
	{
		start: 'Bristol',
		end: 'Leeds',
		date: '2025-07-17',
		waypoints: [
			[51.45, -2.6], // Bristol, South West
			[52.95, -1.14], // Nottingham, East Midlands
			[52.2, 0.12], // Cambridge, East of England
			[53.8, -1.55], // Leeds, Yorkshire
		],
	},
	// Q — Irlande 1 🇮🇪 (départ Dublin, descente vers le sud-ouest)
	{
		start: 'Dublin',
		end: 'Galway',
		date: '2025-08-04',
		waypoints: [
			[53.33, -6.25], // Dublin
			[52.26, -7.11], // Waterford, South-East
			[51.9, -8.47], // Cork, South-West
			[52.67, -8.63], // Limerick, Mid-West
			[53.27, -9.05], // Galway, West
		],
	},
	// R — Irlande 2 🇮🇪 (remontée vers le nord)
	{
		start: 'Galway',
		end: 'Donegal',
		date: '2025-08-05',
		waypoints: [
			[53.27, -9.05], // Galway, West
			[53.43, -7.94], // Athlone, Midland
			[54.27, -8.47], // Sligo, Border
			[54.65, -8.12], // Donegal, Border
		],
	},
	// S — Île de Man 🇮🇲 (ferry depuis Liverpool)
	{
		start: 'Douglas',
		end: 'Ramsey',
		date: '2025-08-12',
		waypoints: [
			[54.15, -4.49], // Douglas (capitale)
			[54.25, -4.51], // St John's
			[54.32, -4.39], // Kirk Michael
			[54.42, -4.39], // Ramsey
		],
	},
];

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
		];
		return forkJoin(COUNTRY_LOADS.map((c) => this.http.get<GeoJSON.FeatureCollection>(c.file))).pipe(
			map((collections) => ({
				type: 'FeatureCollection' as const,
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
			})),
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
		// Vitesses variées par trajet pour que la démo soit plus réaliste
		const avgKmh = 25 + Math.floor(Math.random() * 65); // 25–90 km/h
		const maxKmh = avgKmh + 20 + Math.floor(Math.random() * 60); // avg+20 à avg+80
		const durationSec = Math.round((distanceM / 1000 / avgKmh) * 3600);
		const durationMs = durationSec * 1000;
		const avgSpeedKnots = avgKmh / 1.852;
		const maxSpeedKnots = maxKmh / 1.852;

		// Dates relatives pour s'assurer que tous les filtres de la démo soient couverts
		const relativeOffsets = [
			0, // aujourd'hui
			1, // hier
			2, // avant-hier
			5, // cette semaine
			15, // ce mois-ci
			45, // le mois dernier
			80, // 3 mois
			150, // 6 mois
			300, // cette année (ou l'an dernier selon la date)
			500, // l'an dernier
			900, // 3 ans
		];
		const daysAgo = i < relativeOffsets.length ? relativeOffsets[i] : 15 + i * 25;

		const startDate = new Date();
		startDate.setDate(startDate.getDate() - daysAgo);
		startDate.setHours(9, 0, 0, 0);

		const startMs = startDate.getTime();
		const msPerCoord = durationMs / Math.max(coords.length - 1, 1);

		// Keyframes + smoothstep pour des courbes réalistes non-bruitées
		const NUM_KEYS = 6;
		const ss = (a: number, b: number, t: number) => {
			const x = Math.max(0, Math.min(1, t));
			return a + (b - a) * x * x * (3 - 2 * x);
		};
		const baseAlt = 10 + Math.floor(Math.random() * 150);
		// Altitude : part et revient à baseAlt, varie au milieu
		const altKeys = Array.from({ length: NUM_KEYS + 1 }, (_, k) =>
			k === 0 || k === NUM_KEYS ? baseAlt : baseAlt + (Math.random() - 0.4) * 80,
		);
		// Vitesse : faible au départ et à l'arrivée, max au milieu
		const speedKeys = Array.from({ length: NUM_KEYS + 1 }, (_, k) => {
			if (k === 0 || k === NUM_KEYS) return avgSpeedKnots * 0.1; // départ/arrivée lent
			const bell = Math.sin((k / NUM_KEYS) * Math.PI); // enveloppe en cloche
			return avgSpeedKnots * (0.6 + bell * 0.8 + (Math.random() - 0.3) * 0.4);
		});
		// Angle : vertical (90°) au départ et à l'arrivée, inclinaison au milieu
		const angleKeys = Array.from({ length: NUM_KEYS + 1 }, (_, k) =>
			k === 0 || k === NUM_KEYS ? 90 : 90 + (Math.random() - 0.5) * 28,
		);

		const positions: GeoRidePosition[] = coords.map(([lat, lon], idx) => {
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
