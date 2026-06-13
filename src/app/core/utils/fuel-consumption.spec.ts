import {
	CO2_KG_PER_L,
	costPerKm,
	estimateCO2Kg,
	estimateConsumptionL100,
	estimateCost,
	estimateFillUps,
	estimateLiters,
} from './fuel-consumption';
import { GeoRidePosition } from '../services/georide-api';
import { makePositions } from '../../../test/fixtures/trips';

// Construit des positions dont seules les vitesses (en nœuds) nous intéressent
function withSpeeds(speeds: number[]): GeoRidePosition[] {
	return makePositions(speeds.length).map((p, i) => ({ ...p, speed: speeds[i] }));
}

// Base du modèle polynomial : 3.2 + (knots * 1.852 / 100) * 4.2
function baseConso(avgSpeedKnots: number): number {
	return 3.2 + ((avgSpeedKnots * 1.852) / 100) * 4.2;
}

describe('estimateConsumptionL100', () => {
	it('should return the base consumption of 3.2 L/100km at 0 knots', () => {
		expect(estimateConsumptionL100(0)).toBe(3.2);
	});

	it('should apply the polynomial speed formula without positions', () => {
		// 38 nœuds = 70.376 km/h → 3.2 + 0.70376 * 4.2 = 6.155792
		expect(estimateConsumptionL100(38)).toBeCloseTo(6.155792, 6);
	});

	it('should increase consumption with average speed', () => {
		// 100 nœuds = 185.2 km/h → 3.2 + 1.852 * 4.2 = 10.9784
		expect(estimateConsumptionL100(100)).toBeCloseTo(10.9784, 6);
		expect(estimateConsumptionL100(100)).toBeGreaterThan(estimateConsumptionL100(38));
	});

	it('should ignore an empty positions array', () => {
		expect(estimateConsumptionL100(38, [])).toBeCloseTo(baseConso(38), 6);
	});

	it('should ignore a single position', () => {
		expect(estimateConsumptionL100(38, makePositions(1))).toBeCloseTo(baseConso(38), 6);
	});

	it('should keep the base consumption for smooth riding (no aggressive events)', () => {
		// Vitesse constante → aucun delta > 15 km/h
		const positions = makePositions(10, { speed: 35 });
		expect(estimateConsumptionL100(38, positions)).toBeCloseTo(baseConso(38), 6);
	});

	it('should not count a speed delta of 15 km/h or less as aggressive', () => {
		// Δ 8 nœuds = 14.816 km/h ≤ 15 → pas d'événement
		const positions = withSpeeds([30, 38, 30, 38]);
		expect(estimateConsumptionL100(38, positions)).toBeCloseTo(baseConso(38), 6);
	});

	it('should count a speed delta above 15 km/h as aggressive', () => {
		// Δ 9 nœuds = 16.668 km/h > 15 → 1 événement / 2 positions → min(1, 0.4) → ×1.4
		const positions = withSpeeds([30, 39]);
		expect(estimateConsumptionL100(38, positions)).toBeCloseTo(baseConso(38) * 1.4, 6);
	});

	it('should count hard decelerations as aggressive (absolute delta)', () => {
		// Δ -20 nœuds = -37.04 km/h → 2 événements / 3 → ratio plafonné à 0.4
		const positions = withSpeeds([60, 40, 60]);
		expect(estimateConsumptionL100(38, positions)).toBeCloseTo(baseConso(38) * 1.4, 6);
	});

	it('should increase consumption proportionally to the aggressive ratio', () => {
		// 1 saut de 30 nœuds sur 20 positions → 1 événement / 20 → 1 + (1/20)*2 = ×1.1
		const speeds = [...Array.from({ length: 10 }, () => 30), ...Array.from({ length: 10 }, () => 60)];
		const positions = withSpeeds(speeds);
		expect(estimateConsumptionL100(38, positions)).toBeCloseTo(baseConso(38) * 1.1, 6);
	});

	it('should reach the +40% cap exactly when events/positions equals 0.2', () => {
		// 2 événements (i=3 et i=7) sur 10 positions → (2/10)*2 = 0.4 → ×1.4
		const positions = withSpeeds([30, 30, 30, 60, 60, 60, 60, 30, 30, 30]);
		expect(estimateConsumptionL100(38, positions)).toBeCloseTo(baseConso(38) * 1.4, 6);
	});

	it('should cap the aggressive correction at +40% even for very aggressive riding', () => {
		// Tous les deltas (4) sont agressifs → (4/5)*2 = 1.6 → plafonné à 0.4
		const positions = withSpeeds([30, 50, 30, 50, 30]);
		expect(estimateConsumptionL100(0, positions)).toBeCloseTo(3.2 * 1.4, 6);
	});
});

describe('estimateLiters', () => {
	it('should compute liters from distance and base consumption', () => {
		// 90 km à 6.155792 L/100km → 5.5402128 L
		expect(estimateLiters(90_000, 38)).toBeCloseTo(5.5402128, 6);
	});

	it('should return 0 for a zero distance', () => {
		expect(estimateLiters(0, 38)).toBe(0);
	});

	it('should apply the aggressive riding correction from positions', () => {
		// 100 km à 0 nœuds avec plafond agressif → 100 * (3.2 * 1.4) / 100 = 4.48 L
		const positions = withSpeeds([30, 50, 30, 50, 30]);
		expect(estimateLiters(100_000, 0, positions)).toBeCloseTo(4.48, 6);
	});
});

describe('estimateFillUps', () => {
	it('should round up partial tanks', () => {
		expect(estimateFillUps(15.01, 15)).toBe(2);
		expect(estimateFillUps(10, 15)).toBe(1);
	});

	it('should not round up an exact multiple of the tank size', () => {
		expect(estimateFillUps(15, 15)).toBe(1);
		expect(estimateFillUps(45, 15)).toBe(3);
	});

	it('should return 0 for zero liters', () => {
		expect(estimateFillUps(0, 15)).toBe(0);
	});
});

describe('estimateCO2Kg', () => {
	it('should expose the CO2 emission factor of 2.31 kg/L', () => {
		expect(CO2_KG_PER_L).toBe(2.31);
	});

	it('should multiply liters by 2.31 and round to the nearest kg', () => {
		expect(estimateCO2Kg(10)).toBe(23); // 23.1 → 23
		expect(estimateCO2Kg(3)).toBe(7); // 6.93 → 7
		expect(estimateCO2Kg(100)).toBe(231);
	});

	it('should return 0 for zero liters', () => {
		expect(estimateCO2Kg(0)).toBe(0);
	});
});

describe('costPerKm', () => {
	it('should return null when total distance is 0', () => {
		expect(costPerKm(10, 0)).toBeNull();
	});

	it('should return null when total distance is negative', () => {
		expect(costPerKm(10, -5)).toBeNull();
	});

	it('should round the result to 2 decimals', () => {
		expect(costPerKm(10, 3)).toBe(3.33);
		expect(costPerKm(1, 8)).toBe(0.13); // 0.125 → arrondi à 0.13
	});

	it('should return 0 when total cost is 0', () => {
		expect(costPerKm(0, 100)).toBe(0);
	});
});

describe('estimateCost', () => {
	it('should multiply estimated liters by the fuel price', () => {
		// 100 km à 0 nœuds → 3.2 L ; 3.2 * 1.8 = 5.76 €
		expect(estimateCost(100_000, 0, 1.8)).toBeCloseTo(5.76, 6);
	});

	it('should apply the aggressive riding correction from positions', () => {
		// 100 km à 0 nœuds plafonné → 4.48 L ; 4.48 * 2 = 8.96 €
		const positions = withSpeeds([30, 50, 30, 50, 30]);
		expect(estimateCost(100_000, 0, 2, positions)).toBeCloseTo(8.96, 6);
	});

	it('should return 0 for a zero distance or a zero price', () => {
		expect(estimateCost(0, 38, 1.8)).toBe(0);
		expect(estimateCost(100_000, 38, 0)).toBe(0);
	});
});
