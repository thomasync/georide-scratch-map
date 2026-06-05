import { GeoRidePosition } from '../services/georide-api';

export const CO2_KG_PER_L = 2.31; // kg CO2 par litre SP98/SP95/E10

/**
 * Estime la consommation en L/100km d'un trajet moto.
 * Base : modèle polynomial vitesse. Correction : accélérations/freinages brusques depuis les positions GPS.
 * @param avgSpeedKnots  vitesse moyenne du trajet en nœuds
 * @param positions      positions GPS du trajet (optionnel, améliore la précision)
 */
export function estimateConsumptionL100(avgSpeedKnots: number, positions?: GeoRidePosition[]): number {
	const avgKmh = avgSpeedKnots * 1.852;
	let conso = 3.2 + (avgKmh / 100) * 4.2;
	if (positions && positions.length > 1) {
		let aggressiveEvents = 0;
		for (let i = 1; i < positions.length; i++) {
			const dv = Math.abs((positions[i].speed - positions[i - 1].speed) * 1.852);
			if (dv > 15) aggressiveEvents++;
		}
		conso *= 1 + Math.min((aggressiveEvents / positions.length) * 2, 0.4);
	}
	return conso;
}

/**
 * Estime le nombre de litres consommés sur un trajet.
 */
export function estimateLiters(distanceM: number, avgSpeedKnots: number, positions?: GeoRidePosition[]): number {
	return (distanceM / 1000) * (estimateConsumptionL100(avgSpeedKnots, positions) / 100);
}

/**
 * Estime le coût en euros d'un trajet.
 * @param distanceM      distance en mètres
 * @param avgSpeedKnots  vitesse moyenne en nœuds
 * @param pricePerL      prix du carburant en €/L
 * @param positions      positions GPS (optionnel)
 */
/** Nombre de pleins estimés pour une quantité de litres et une taille de réservoir. */
export function estimateFillUps(liters: number, tankSizeL: number): number {
	return Math.ceil(liters / tankSizeL);
}

/** Émissions CO₂ estimées en kg. */
export function estimateCO2Kg(liters: number): number {
	return Math.round(liters * CO2_KG_PER_L);
}

/** Coût au km en €/km. */
export function costPerKm(totalCostEur: number, totalKm: number): number | null {
	if (totalKm <= 0) return null;
	return Math.round((totalCostEur / totalKm) * 100) / 100;
}

export function estimateCost(
	distanceM: number,
	avgSpeedKnots: number,
	pricePerL: number,
	positions?: GeoRidePosition[],
): number {
	return estimateLiters(distanceM, avgSpeedKnots, positions) * pricePerL;
}
