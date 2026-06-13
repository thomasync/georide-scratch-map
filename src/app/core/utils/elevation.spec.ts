import { computeAltProfile, haversineKm } from './elevation';
import { makePosition, makePositions } from '../../../test/fixtures/trips';

describe('computeAltProfile', () => {
	it('should return null for an empty positions array', () => {
		expect(computeAltProfile([])).toBeNull();
	});

	it('should return null when all altitudes are 0', () => {
		const positions = makePositions(3, { altitude: 0 });
		expect(computeAltProfile(positions)).toBeNull();
	});

	it('should return null when all altitudes are null', () => {
		// Le type déclare altitude: number, mais le code filtre défensivement les valeurs null venant de l'API
		const positions = makePositions(3, { altitude: null as unknown as number });
		expect(computeAltProfile(positions)).toBeNull();
	});

	it('should return null when all altitudes are negative', () => {
		const positions = makePositions(2, { altitude: -12 });
		expect(computeAltProfile(positions)).toBeNull();
	});

	it('should return min = max and gain 0 for a single valid altitude', () => {
		const positions = [makePosition({ altitude: 250 })];
		expect(computeAltProfile(positions)).toEqual({ minAlt: 250, maxAlt: 250, gain: 0 });
	});

	it('should accumulate gain only on ascending segments', () => {
		const positions = [100, 150, 120, 180, 180, 90].map((altitude) => makePosition({ altitude }));
		// Montées : 100→150 (+50) et 120→180 (+60) ; les descentes et plats sont ignorés
		expect(computeAltProfile(positions)).toEqual({ minAlt: 90, maxAlt: 180, gain: 110 });
	});

	it('should ignore null and 0 altitudes when computing gain between remaining points', () => {
		const positions = [
			makePosition({ altitude: 100 }),
			makePosition({ altitude: 0 }),
			makePosition({ altitude: null as unknown as number }),
			makePosition({ altitude: 200 }),
		];
		// Après filtrage il reste [100, 200] : le gain saute par-dessus les valeurs invalides
		expect(computeAltProfile(positions)).toEqual({ minAlt: 100, maxAlt: 200, gain: 100 });
	});

	it('should round minAlt, maxAlt and gain to the nearest integer', () => {
		const positions = [100.4, 150.6].map((altitude) => makePosition({ altitude }));
		expect(computeAltProfile(positions)).toEqual({ minAlt: 100, maxAlt: 151, gain: 50 });
	});

	it('should compute the profile from the default fixture altitudes', () => {
		// makePositions(6) → altitudes 150, 170, 190, 210, 230, 150 (cycle i % 5)
		const positions = makePositions(6);
		expect(computeAltProfile(positions)).toEqual({ minAlt: 150, maxAlt: 230, gain: 80 });
	});
});

describe('haversineKm', () => {
	it('should compute Paris-Lyon distance around 392 km (within 1%)', () => {
		const distance = haversineKm(48.8566, 2.3522, 45.764, 4.8357);
		// Valeur exacte de la formule avec R = 6371 : ~391.499 km
		expect(distance).toBeCloseTo(391.499, 2);
		expect(distance).toBeGreaterThan(392 * 0.99);
		expect(distance).toBeLessThan(392 * 1.01);
	});

	it('should return 0 for identical points', () => {
		expect(haversineKm(43.6045, 1.4442, 43.6045, 1.4442)).toBe(0);
	});

	it('should be symmetric', () => {
		const ab = haversineKm(48.8566, 2.3522, 45.764, 4.8357);
		const ba = haversineKm(45.764, 4.8357, 48.8566, 2.3522);
		expect(ab).toBeCloseTo(ba, 10);
	});

	it('should compute ~111.19 km for one degree of latitude', () => {
		// 1° de latitude = R * π / 180 = 6371 * π / 180 ≈ 111.1949 km
		expect(haversineKm(0, 0, 1, 0)).toBeCloseTo((6371 * Math.PI) / 180, 4);
	});

	it('should handle points across the equator and prime meridian', () => {
		// Antipodes approximatifs sur l'équateur : demi-circonférence = π * R
		expect(haversineKm(0, 0, 0, 180)).toBeCloseTo(Math.PI * 6371, 4);
	});
});
