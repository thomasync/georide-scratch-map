import type { FeatureCollection } from 'geojson';

/**
 * Deux "départements" carrés pour les tests point-in-polygon :
 * - D1 : carré [0,0] → [1,1] (code 01)
 * - D2 : carré [2,2] → [3,3] (code 02)
 * Coordonnées GeoJSON en [lon, lat].
 */
export function makeDepartments(): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: { code: '01', nom: 'Carré Un', country: 'FR' },
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[0, 0],
							[1, 0],
							[1, 1],
							[0, 1],
							[0, 0],
						],
					],
				},
			},
			{
				type: 'Feature',
				properties: { code: '02', nom: 'Carré Deux', country: 'FR' },
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[2, 2],
							[3, 2],
							[3, 3],
							[2, 3],
							[2, 2],
						],
					],
				},
			},
		],
	};
}
