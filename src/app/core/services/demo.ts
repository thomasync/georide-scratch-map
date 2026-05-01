import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { H3Data, H3Resolution } from './h3';

const FAKE_PCT: Record<string, number> = {
	'04': 38, '05': 52, '06': 61,
	'07': 22, '09': 45,
	'11': 62, '12': 38, '13': 71,
	'15': 18, '16': 12, '17': 8, '19': 14,
	'24': 19, '26': 27,
	'30': 55, '31': 68, '32': 42, '33': 35, '34': 78,
	'40': 29, '43': 16, '46': 33, '47': 25, '48': 52,
	'63': 11, '64': 74, '65': 83, '66': 69,
	'81': 47, '82': 31, '83': 58, '84': 44,
	'2A': 24, '2B': 15,
};

export interface DemoData {
	departments: GeoJSON.FeatureCollection;
	enrichedDepts: GeoJSON.FeatureCollection;
	cellsByResolution: Partial<Record<H3Resolution, H3Data>>;
	tripCount: number;
	totalKm: number;
}

@Injectable({ providedIn: 'root' })
export class DemoService {
	private http = inject(HttpClient);

	load(): Observable<DemoData> {
		return this.http.get<GeoJSON.FeatureCollection>('/departements.geojson').pipe(
			map((departments) => ({
				departments,
				enrichedDepts: this.buildEnrichedDepts(departments),
				cellsByResolution: { 6: { counts: {}, cellToIndices: {} } } as Partial<Record<H3Resolution, H3Data>>,
				tripCount: 247,
				totalKm: 42800,
			})),
		);
	}

	getDeptStats(code: string): { trips: number; km: number } {
		const pct = FAKE_PCT[code] ?? 0;
		return { trips: Math.round(pct * 0.35), km: pct * 17 };
	}

	private buildEnrichedDepts(departments: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: departments.features.map((f) => {
				const code = (f.properties?.['code'] as string) ?? '';
				const pct = FAKE_PCT[code] ?? 0;
				return {
					...f,
					properties: { ...f.properties, pct, h3Visited: Math.round(pct * 0.4), h3Total: 30 },
				};
			}),
		};
	}
}
