import { extractCity } from '../../core/utils/address';
import { haversineKm } from '../../core/utils/elevation';
import {
	estimateLiters,
	estimateFillUps,
	estimateCO2Kg,
	costPerKm as fuelCostPerKm,
} from '../../core/utils/fuel-consumption';
import { buildSessions } from '../../core/utils/trip-session';
import { NEIGHBORING_COUNTRIES } from '../../core/data/countries';
import { TripWithCoords } from '../../core/services/database';
import { H3Data, H3Resolution } from '../../core/services/h3';
import {
	StatsModalData,
	DistanceStats,
	SpeedStats,
	Records,
	TopTrip,
	TurnStats,
	TurnDeptStat,
	TurnCityStat,
	PauseStats,
	FuelStats,
	MonthlyFuelCost,
	RecentStats,
	MonthSummary,
} from './stats-modal';

// Helpers géographiques purs — extraits de map.ts, partagés avec le composant via délégation.
export function tripSeason(year: number, month: number): string {
	if (month >= 3 && month <= 5) return `Printemps ${year}`;
	if (month >= 6 && month <= 8) return `Été ${year}`;
	if (month >= 9 && month <= 11) return `Automne ${year}`;
	return `Hiver ${month === 12 ? year : year - 1}`;
}

export function seasonSortKey(label: string): number {
	const m = label.match(/(\d{4})$/);
	if (!m) return 0;
	const year = parseInt(m[1]);
	if (label.startsWith('Printemps')) return year * 10 + 1;
	if (label.startsWith('Été')) return year * 10 + 2;
	if (label.startsWith('Automne')) return year * 10 + 3;
	return year * 10 + 4;
}

export function countryForCoords(lat: number, lon: number): string {
	// Trier par surface de bbox (plus petit d'abord) pour que Monaco passe avant France/Italie
	const sorted = [...NEIGHBORING_COUNTRIES].sort(
		(a, b) => (a.maxLat - a.minLat) * (a.maxLon - a.minLon) - (b.maxLat - b.minLat) * (b.maxLon - b.minLon),
	);
	for (const c of sorted) {
		if (lat >= c.minLat && lat <= c.maxLat && lon >= c.minLon && lon <= c.maxLon) return c.code;
	}
	return 'FR';
}

export function raycast(lng: number, lat: number, ring: [number, number][]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i],
			[xj, yj] = ring[j];
		if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

export function pointInFeature(lng: number, lat: number, feature: GeoJSON.Feature): boolean {
	const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
	const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
	return polys.some((rings) => {
		if (!raycast(lng, lat, rings[0] as [number, number][])) return false;
		for (let i = 1; i < rings.length; i++) {
			if (raycast(lng, lat, rings[i] as [number, number][])) return false;
		}
		return true;
	});
}

export function findDeptCodeForPoint(
	departments: GeoJSON.FeatureCollection | null,
	lng: number,
	lat: number,
): string | null {
	if (!departments) return null;
	for (const feature of departments.features) {
		if (pointInFeature(lng, lat, feature)) {
			return (feature.properties?.['code'] as string) ?? null;
		}
	}
	return null;
}

export interface BuildStatsInput {
	tripsWithCoords: TripWithCoords[];
	allTripsWithCoords: TripWithCoords[];
	departments: GeoJSON.FeatureCollection | null;
	cellsByResolution: Partial<Record<H3Resolution, H3Data>>;
	deptResolution: H3Resolution;
	enrichDepartments: (
		departments: GeoJSON.FeatureCollection,
		counts: Record<string, number>,
		resolution: H3Resolution,
		cellToIndices: Record<string, number[]>,
	) => GeoJSON.FeatureCollection;
	fuelPrices: Record<string, number | null>;
	fuelType: string;
	allR7Data: H3Data | null;
	now?: Date;
}

/**
 * Calcule l'ensemble des statistiques du Récapitulatif à partir des trajets et données dérivées.
 * Fonction pure (la date courante est injectable via `now`) extraite de MapComponent.computeStatsData.
 */
export function buildStatsData(input: BuildStatsInput): StatsModalData {
	const {
		tripsWithCoords,
		allTripsWithCoords,
		departments,
		cellsByResolution,
		deptResolution,
		enrichDepartments,
		fuelPrices,
		fuelType,
		allR7Data,
		now = new Date(),
	} = input;
	// Précomputer dept code + name par trip (évite O(n × depts) répété pour chaque lookup)
	const tripDeptCode: Record<string, string | null> = {};
	const tripDeptName: Record<string, string | null> = {};
	const tripCountryCode: Record<string, string> = {};
	const tripStartCountryCode: Record<string, string> = {};
	for (const trip of tripsWithCoords) {
		// Pays de destination (end)
		const code = findDeptCodeForPoint(departments, trip.endLon, trip.endLat);
		tripDeptCode[trip.indexId] = code;
		const feat = code ? departments?.features.find((f) => f.properties?.['code'] === code) : null;
		tripDeptName[trip.indexId] = feat ? ((feat.properties?.['nom'] as string) ?? code) : null;
		const deptCountry = feat?.properties?.['country'] as string | undefined;
		tripCountryCode[trip.indexId] = deptCountry ?? countryForCoords(trip.endLat, trip.endLon);
		// Pays de départ (start) — même logique dept-first
		const startCode = findDeptCodeForPoint(departments, trip.startLon, trip.startLat);
		const startFeat = startCode ? departments?.features.find((f) => f.properties?.['code'] === startCode) : null;
		const startDeptCountry = startFeat?.properties?.['country'] as string | undefined;
		tripStartCountryCode[trip.indexId] = startDeptCountry ?? countryForCoords(trip.startLat, trip.startLon);
	}

	const startCityCount: Record<string, number> = {};
	for (const trip of tripsWithCoords) {
		const city = extractCity(trip.niceStartAddress ?? trip.startAddress);
		if (city) startCityCount[city] = (startCityCount[city] ?? 0) + 1;
	}
	const homeCity = Object.entries(startCityCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

	// Villes par département (point-in-polygon sur les coords GPS de chaque trajet)
	const deptCities: Record<string, Record<string, { count: number; dates: string[] }>> = {};
	for (const trip of tripsWithCoords) {
		const startCity = extractCity(trip.niceStartAddress ?? trip.startAddress);
		const endCity = extractCity(trip.niceEndAddress ?? trip.endAddress);
		if (!endCity || endCity === startCity || endCity === homeCity) continue;
		const code = tripDeptCode[trip.indexId] ?? null;
		if (!code) continue;
		if (!deptCities[code]) deptCities[code] = {};
		if (!deptCities[code][endCity]) deptCities[code][endCity] = { count: 0, dates: [] };
		deptCities[code][endCity].count++;
		deptCities[code][endCity].dates.push(trip.startTime.substring(0, 10));
	}

	const depts: StatsModalData['depts'] = [];
	if (departments) {
		const data = cellsByResolution[deptResolution as H3Resolution];
		if (data) {
			const enriched = enrichDepartments(
				departments,
				data.counts,
				deptResolution as H3Resolution,
				data.cellToIndices,
			);
			for (const f of enriched.features) {
				const pct = (f.properties?.['pct'] as number) ?? 0;
				if (pct === 0) continue;
				const code = (f.properties?.['code'] as string) ?? '';
				const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
				const cities = Object.entries(deptCities[code] ?? {})
					.map(([name, { count, dates }]) => {
						const sorted = dates
							.filter((d, i, arr) => arr.indexOf(d) === i)
							.sort((a, b) => b.localeCompare(a));
						return {
							name,
							count,
							latestRaw: sorted[0] ?? '',
							dates: sorted.slice(0, 4).map((d) => fmt.format(new Date(d))),
						};
					})
					.sort(
						(a, b) =>
							b.count - a.count ||
							b.latestRaw.localeCompare(a.latestRaw) ||
							a.name.localeCompare(b.name, 'fr'),
					)
					.map(({ name, count, dates }) => ({ name, count, dates }));
				depts.push({
					code,
					name: (f.properties?.['nom'] as string) ?? '',
					pct,
					trips: (f.properties?.['tripCount'] as number) ?? 0,
					country: (f.properties?.['country'] as string) ?? 'FR',
					cities,
				});
			}
			depts.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'fr'));
		}
	}

	// DistanceStats
	const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
	const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
	const kmByDay: Record<string, { km: number; trips: number; indexIds: string[] }> = {};
	const kmByMonth: Record<string, { km: number; trips: number }> = {};
	for (const trip of tripsWithCoords) {
		const day = trip.startTime.substring(0, 10);
		const month = trip.startTime.substring(0, 7);
		const km = trip.distance / 1000;
		if (!kmByDay[day]) kmByDay[day] = { km: 0, trips: 0, indexIds: [] };
		kmByDay[day].km += km;
		kmByDay[day].trips++;
		kmByDay[day].indexIds.push(trip.indexId);
		if (!kmByMonth[month]) kmByMonth[month] = { km: 0, trips: 0 };
		kmByMonth[month].km += km;
		kmByMonth[month].trips++;
	}
	const topDays = Object.entries(kmByDay)
		.sort(([, a], [, b]) => b.km - a.km)
		.slice(0, 10)
		.map(([date, s]) => ({
			date,
			dateLabel: fmt.format(new Date(date + 'T12:00:00')),
			km: Math.round(s.km),
			tripCount: s.trips,
			indexIds: s.indexIds,
		}));
	const byMonth = Object.entries(kmByMonth)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, s]) => ({
			key,
			label: fmtMonth.format(new Date(key + '-15')),
			km: Math.round(s.km),
			tripCount: s.trips,
		}));
	const kmBySeason: Record<string, { km: number; trips: number }> = {};
	for (const { key, km, tripCount } of byMonth) {
		const [year, mon] = key.split('-').map(Number);
		const seasonLabel = tripSeason(year, mon);
		if (!kmBySeason[seasonLabel]) kmBySeason[seasonLabel] = { km: 0, trips: 0 };
		kmBySeason[seasonLabel].km += km;
		kmBySeason[seasonLabel].trips += tripCount;
	}
	const bySeason = Object.entries(kmBySeason)
		.sort(([a], [b]) => seasonSortKey(a) - seasonSortKey(b))
		.map(([label, s]) => ({ label, km: s.km, tripCount: s.trips }));
	// Top trajets point-à-point (pas des boucles : start/end > 10 km)
	const topTrips: TopTrip[] = [...tripsWithCoords]
		.filter((t) => t.distance > 0 && haversineKm(t.startLat, t.startLon, t.endLat, t.endLon) > 10)
		.sort((a, b) => b.distance - a.distance)
		.slice(0, 10)
		.map((t) => ({
			indexId: t.indexId,
			date: t.startTime.substring(0, 10),
			dateLabel: fmt.format(new Date(t.startTime.substring(0, 10) + 'T12:00:00')),
			km: Math.round(t.distance / 1000),
			from: extractCity(t.niceStartAddress ?? t.startAddress),
			to: extractCity(t.niceEndAddress ?? t.endAddress),
			fromCountryCode: tripStartCountryCode[t.indexId] ?? 'FR',
			toCountryCode: tripCountryCode[t.indexId] ?? 'FR',
		}));
	const distanceStats: DistanceStats = { topDays, byMonth, bySeason, topTrips };

	// SpeedStats
	const validTrips = tripsWithCoords.filter((t) => t.maxSpeed > 0);
	const globalMaxKmh = validTrips.length > 0 ? Math.round(Math.max(...validTrips.map((t) => t.maxSpeed)) * 1.852) : 0;
	const totalDist = validTrips.reduce((s, t) => s + t.distance, 0);
	const globalAvgKmh =
		totalDist > 0
			? Math.round((validTrips.reduce((s, t) => s + t.averageSpeed * t.distance, 0) / totalDist) * 1.852)
			: 0;
	const maxSpeedTripRaw =
		validTrips.length > 0 ? validTrips.reduce((best, t) => (t.maxSpeed > best.maxSpeed ? t : best)) : null;
	const topByMax = [...validTrips]
		.sort((a, b) => b.maxSpeed - a.maxSpeed)
		.slice(0, 10)
		.map((t) => ({
			indexId: t.indexId,
			date: t.startTime.substring(0, 10),
			dateLabel: fmt.format(new Date(t.startTime.substring(0, 10) + 'T12:00:00')),
			maxKmh: Math.round(t.maxSpeed * 1.852),
			avgKmh: Math.round(t.averageSpeed * 1.852),
			km: Math.round(t.distance / 1000),
			from: extractCity(t.niceStartAddress ?? t.startAddress),
			to: extractCity(t.niceEndAddress ?? t.endAddress),
			fromCountryCode: tripStartCountryCode[t.indexId] ?? 'FR',
			toCountryCode: tripCountryCode[t.indexId] ?? 'FR',
		}));
	const tripsWithAngle = tripsWithCoords.filter((t) => t.maxAngle != null && t.maxAngle !== 0);
	const maxLeanAngle =
		tripsWithAngle.length > 0
			? Math.round(Math.max(...tripsWithAngle.map((t) => Math.abs(t.maxAngle - 90))))
			: null;
	const maxLeanTripRaw =
		tripsWithAngle.length > 0
			? tripsWithAngle.reduce((best, t) => (Math.abs(t.maxAngle - 90) > Math.abs(best.maxAngle - 90) ? t : best))
			: null;
	const sportPct =
		tripsWithAngle.length > 0
			? Math.round(
					(tripsWithAngle.filter((t) => Math.abs(t.maxAngle - 90) > 30).length / tripsWithAngle.length) * 100,
				)
			: null;
	const speedStats: SpeedStats = {
		globalMaxKmh,
		globalAvgKmh,
		maxSpeedTripIndexId: maxSpeedTripRaw?.indexId ?? null,
		topByMax,
	};

	// TurnStats (positions requises)
	const TURN_DEG = 15;
	const tripsWithPos = tripsWithCoords.filter((t) => t.positions && t.positions.length > 0);
	let avgSpeedKmh: number | null = null;
	let maxSpeedKmh: number | null = null;
	let avgPctInTurns: number | null = null;
	const deptTurnMap: Record<
		string,
		{
			speeds: number[];
			leans: number[];
			maxKmh: number;
			maxKmhIndexId: string | null;
			maxLeanDeg: number;
			maxLeanIndexId: string | null;
		}
	> = {};
	if (tripsWithPos.length > 0) {
		const allTurnSpeeds: number[] = [];
		const perTripPcts: number[] = [];
		let globalMaxInTurns = 0;
		for (const trip of tripsWithPos) {
			const positions = trip.positions!;
			const inTurn = positions.filter((p) => Math.abs(p.angle - 90) > TURN_DEG && p.speed * 1.852 > 10);
			if (inTurn.length > 0) {
				allTurnSpeeds.push(...inTurn.map((p) => p.speed));
				const tripMax = Math.max(...inTurn.map((p) => p.speed));
				if (tripMax > globalMaxInTurns) globalMaxInTurns = tripMax;
				const deptName = tripDeptName[trip.indexId] ?? null;
				if (deptName) {
					if (!deptTurnMap[deptName])
						deptTurnMap[deptName] = {
							speeds: [],
							leans: [],
							maxKmh: 0,
							maxKmhIndexId: null,
							maxLeanDeg: 0,
							maxLeanIndexId: null,
						};
					deptTurnMap[deptName].speeds.push(...inTurn.map((p) => p.speed * 1.852));
					const turnLeans = inTurn.map((p) => Math.abs(p.angle - 90));
					deptTurnMap[deptName].leans.push(...turnLeans);
					const deptMax = tripMax * 1.852;
					if (deptMax > deptTurnMap[deptName].maxKmh) {
						deptTurnMap[deptName].maxKmh = deptMax;
						deptTurnMap[deptName].maxKmhIndexId = trip.indexId;
					}
					const tripMaxLean = Math.max(...turnLeans);
					if (tripMaxLean > deptTurnMap[deptName].maxLeanDeg) {
						deptTurnMap[deptName].maxLeanDeg = tripMaxLean;
						deptTurnMap[deptName].maxLeanIndexId = trip.indexId;
					}
				}
			}
			perTripPcts.push(Math.round((inTurn.length / positions.length) * 100));
		}
		if (allTurnSpeeds.length > 0) {
			avgSpeedKmh = Math.round((allTurnSpeeds.reduce((s, v) => s + v, 0) / allTurnSpeeds.length) * 1.852);
			maxSpeedKmh = Math.round(globalMaxInTurns * 1.852);
		}
		avgPctInTurns = Math.round(perTripPcts.reduce((s, v) => s + v, 0) / perTripPcts.length);
	}
	const topDepts: TurnDeptStat[] = Object.entries(deptTurnMap)
		.map(([deptName, { speeds, leans, maxKmh, maxKmhIndexId, maxLeanDeg, maxLeanIndexId }]) => {
			const tripInDept = tripsWithPos.filter((t) => tripDeptName[t.indexId] === deptName);
			const countryCode = tripInDept[0] ? (tripCountryCode[tripInDept[0].indexId] ?? 'FR') : 'FR';
			return {
				deptName,
				countryCode,
				avgKmh: Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length),
				maxKmh: Math.round(maxKmh),
				maxKmhTripIndexId: maxKmhIndexId,
				avgLeanDeg: leans.length > 0 ? Math.round(leans.reduce((s, v) => s + v, 0) / leans.length) : 0,
				maxLeanDeg: Math.round(maxLeanDeg),
				maxLeanTripIndexId: maxLeanIndexId,
				tripCount: tripInDept.length,
			};
		})
		.sort((a, b) => b.avgKmh - a.avgKmh)
		.slice(0, 8);

	// Villes proches des virages : pour chaque trajet avec positions, trouver le centre des virages
	// et le matcher à la ville la plus proche parmi les endpoints connus
	const uniqueCityEndpoints: { city: string; deptName: string; countryCode: string; lat: number; lon: number }[] = [];
	const seenCities = new Set<string>();
	for (const t of tripsWithCoords) {
		for (const [addr, lat, lon] of [
			[t.niceStartAddress ?? t.startAddress, t.startLat, t.startLon] as [string | null, number, number],
			[t.niceEndAddress ?? t.endAddress, t.endLat, t.endLon] as [string | null, number, number],
		]) {
			const city = extractCity(addr);
			if (!city || seenCities.has(city)) continue;
			seenCities.add(city);
			const deptName = tripDeptName[t.indexId] ?? '';
			const bboxCountry = countryForCoords(lat, lon);
			// Pour les petits pays à bbox très précise (Monaco, Andorre…), la bbox prime sur le dept
			// Pour les grands pays (Espagne…), le dept prime (leurs bbox couvrent la France)
			const bboxArea =
				bboxCountry !== 'FR'
					? (() => {
							const c = NEIGHBORING_COUNTRIES.find((x) => x.code === bboxCountry);
							return c ? (c.maxLat - c.minLat) * (c.maxLon - c.minLon) : 999;
						})()
					: 999;
			const countryCode =
				bboxCountry !== 'FR' && bboxArea < 0.5 ? bboxCountry : (tripCountryCode[t.indexId] ?? 'FR');
			uniqueCityEndpoints.push({ city, deptName, countryCode, lat, lon });
		}
	}
	const cityTurnMap: Record<
		string,
		{
			speeds: number[];
			leans: number[];
			maxKmh: number;
			maxKmhIndexId: string | null;
			maxLeanDeg: number;
			maxLeanIndexId: string | null;
			deptName: string;
			countryCode: string;
		}
	> = {};
	for (const trip of tripsWithPos) {
		const positions = trip.positions!;
		const inTurn = positions.filter((p) => Math.abs(p.angle - 90) > TURN_DEG && p.speed * 1.852 > 10);
		if (inTurn.length === 0) continue;
		const centerLat = inTurn.reduce((s, p) => s + p.latitude, 0) / inTurn.length;
		const centerLon = inTurn.reduce((s, p) => s + p.longitude, 0) / inTurn.length;
		let nearestCity = '';
		let nearestDept = '';
		let nearestCountry = 'FR';
		let nearestDist = 40;
		for (const ep of uniqueCityEndpoints) {
			const d = haversineKm(centerLat, centerLon, ep.lat, ep.lon);
			if (d < nearestDist) {
				nearestDist = d;
				nearestCity = ep.city;
				nearestDept = ep.deptName;
				nearestCountry = ep.countryCode;
			}
		}
		if (!nearestCity) continue;
		if (!cityTurnMap[nearestCity])
			cityTurnMap[nearestCity] = {
				speeds: [],
				leans: [],
				maxKmh: 0,
				maxKmhIndexId: null,
				maxLeanDeg: 0,
				maxLeanIndexId: null,
				deptName: nearestDept,
				countryCode: nearestCountry,
			};
		const citySpeeds = inTurn.map((p) => p.speed * 1.852);
		cityTurnMap[nearestCity].speeds.push(...citySpeeds);
		const cityMaxKmh = Math.max(...citySpeeds);
		if (cityMaxKmh > cityTurnMap[nearestCity].maxKmh) {
			cityTurnMap[nearestCity].maxKmh = cityMaxKmh;
			cityTurnMap[nearestCity].maxKmhIndexId = trip.indexId;
		}
		const cityLeans = inTurn.map((p) => Math.abs(p.angle - 90));
		cityTurnMap[nearestCity].leans.push(...cityLeans);
		const cityMaxLean = Math.max(...cityLeans);
		if (cityMaxLean > cityTurnMap[nearestCity].maxLeanDeg) {
			cityTurnMap[nearestCity].maxLeanDeg = cityMaxLean;
			cityTurnMap[nearestCity].maxLeanIndexId = trip.indexId;
		}
	}
	const topCities: TurnCityStat[] = Object.entries(cityTurnMap)
		.map(
			([
				cityName,
				{ speeds, leans, maxKmh, maxKmhIndexId, maxLeanDeg, maxLeanIndexId, deptName, countryCode },
			]) => ({
				cityName,
				deptName,
				countryCode,
				avgKmh: Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length),
				maxKmh: Math.round(maxKmh),
				maxKmhTripIndexId: maxKmhIndexId,
				avgLeanDeg: leans.length > 0 ? Math.round(leans.reduce((s, v) => s + v, 0) / leans.length) : 0,
				maxLeanDeg: Math.round(maxLeanDeg),
				maxLeanTripIndexId: maxLeanIndexId,
				tripCount: speeds.length,
			}),
		)
		.sort((a, b) => b.avgKmh - a.avgKmh)
		.slice(0, 8);

	// Lean angle distribution from all trips (no positions needed)
	const leanBuckets = [
		{ label: '< 15°', min: 0, max: 15 },
		{ label: '15 – 30°', min: 15, max: 30 },
		{ label: '30 – 45°', min: 30, max: 45 },
		{ label: '> 45°', min: 45, max: 90 },
	];
	const leanDistribution = leanBuckets.map(({ label, min, max }) => {
		const count = tripsWithAngle.filter((t) => {
			const lean = Math.abs(t.maxAngle - 90);
			return lean >= min && lean < max;
		}).length;
		return {
			label,
			pct: tripsWithAngle.length > 0 ? Math.round((count / tripsWithAngle.length) * 100) : 0,
			count,
		};
	});
	const avgLeanAngle =
		tripsWithAngle.length > 0
			? Math.round(tripsWithAngle.reduce((s, t) => s + Math.abs(t.maxAngle - 90), 0) / tripsWithAngle.length)
			: null;
	const turnStats: TurnStats = {
		maxLeanAngle,
		maxLeanTripIndexId: maxLeanTripRaw?.indexId ?? null,
		sportPct,
		avgSpeedKmh,
		maxSpeedKmh,
		avgPctInTurns,
		tripsWithPositions: tripsWithPos.length,
		topDepts,
		topCities,
		leanDistribution,
		avgLeanAngle,
	};

	// Records
	const longestTripRaw =
		tripsWithCoords.length > 0
			? tripsWithCoords.reduce((best, t) => (t.distance > best.distance ? t : best))
			: null;
	const longestTrip = longestTripRaw
		? {
				km: Math.round(longestTripRaw.distance / 1000),
				dateLabel: fmt.format(new Date(longestTripRaw.startTime.substring(0, 10) + 'T12:00:00')),
				from: extractCity(longestTripRaw.niceStartAddress ?? longestTripRaw.startAddress),
				to: extractCity(longestTripRaw.niceEndAddress ?? longestTripRaw.endAddress),
				indexId: longestTripRaw.indexId,
			}
		: null;
	const longestDayEntry = Object.entries(kmByDay).sort(([, a], [, b]) => b.km - a.km)[0] ?? null;
	const longestDay = longestDayEntry
		? {
				km: Math.round(longestDayEntry[1].km),
				dateLabel: fmt.format(new Date(longestDayEntry[0] + 'T12:00:00')),
				tripCount: longestDayEntry[1].trips,
			}
		: null;
	const bestMonthEntry = Object.entries(kmByMonth).sort(([, a], [, b]) => b.km - a.km)[0] ?? null;
	const bestMonth = bestMonthEntry
		? { km: Math.round(bestMonthEntry[1].km), label: fmtMonth.format(new Date(bestMonthEntry[0] + '-15')) }
		: null;
	const firstTripRaw =
		tripsWithCoords.length > 0
			? tripsWithCoords.reduce((oldest, t) => (t.startTime < oldest.startTime ? t : oldest))
			: null;
	const firstTripDate = firstTripRaw
		? fmt.format(new Date(firstTripRaw.startTime.substring(0, 10) + 'T12:00:00'))
		: null;
	const ridingDays = Object.keys(kmByDay).length;
	const sortedDays = Object.keys(kmByDay).sort();
	let maxStreak = sortedDays.length > 0 ? 1 : 0;
	let currentStreak = 1;
	let currentStreakStartIdx = 0;
	let maxStreakStartIdx = 0;
	let maxStreakEndIdx = 0;
	for (let i = 1; i < sortedDays.length; i++) {
		const prev = new Date(sortedDays[i - 1] + 'T12:00:00');
		const curr = new Date(sortedDays[i] + 'T12:00:00');
		const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
		if (diff === 1) {
			currentStreak++;
			if (currentStreak > maxStreak) {
				maxStreak = currentStreak;
				maxStreakStartIdx = currentStreakStartIdx;
				maxStreakEndIdx = i;
			}
		} else {
			currentStreak = 1;
			currentStreakStartIdx = i;
		}
	}
	const longestStreakFrom =
		sortedDays.length > 0 ? fmt.format(new Date(sortedDays[maxStreakStartIdx] + 'T12:00:00')) : null;
	const longestStreakTo =
		sortedDays.length > 0 ? fmt.format(new Date(sortedDays[maxStreakEndIdx] + 'T12:00:00')) : null;
	// Plus longue période sans rouler
	let longestBreak: Records['longestBreak'] = null;
	for (let i = 1; i < sortedDays.length; i++) {
		const prev = new Date(sortedDays[i - 1] + 'T12:00:00');
		const curr = new Date(sortedDays[i] + 'T12:00:00');
		const gap = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)) - 1;
		if (gap > 0 && (!longestBreak || gap > longestBreak.days)) {
			longestBreak = {
				days: gap,
				from: fmt.format(new Date(prev.getTime() + 1000 * 60 * 60 * 24)),
				to: fmt.format(curr),
			};
		}
	}
	// Stats uniques — non visibles ailleurs dans l'app
	const totalKm = Math.round(tripsWithCoords.reduce((s, t) => s + t.distance, 0) / 1000);
	const totalTrips = tripsWithCoords.length;
	const avgKmPerTrip = totalTrips > 0 ? Math.round(totalKm / totalTrips) : 0;
	const totalDurationMs = tripsWithCoords.reduce((s, t) => s + t.duration, 0);
	const totalRidingHours = Math.round(totalDurationMs / (1000 * 60 * 60));
	const avgTripDurationMin = totalTrips > 0 ? Math.round(totalDurationMs / totalTrips / (1000 * 60)) : 0;
	const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
	const dayOfWeekCount: Record<number, number> = {};
	const startHourCount: Record<number, number> = {};
	const endHourCount: Record<number, number> = {};
	for (const trip of tripsWithCoords) {
		const d = new Date(trip.startTime);
		const e = new Date(trip.endTime);
		dayOfWeekCount[d.getDay()] = (dayOfWeekCount[d.getDay()] ?? 0) + 1;
		startHourCount[d.getHours()] = (startHourCount[d.getHours()] ?? 0) + 1;
		endHourCount[e.getHours()] = (endHourCount[e.getHours()] ?? 0) + 1;
	}
	const topDaysOfWeek = Object.entries(dayOfWeekCount)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 3)
		.map(([dow]) => DAY_NAMES[Number(dow)]);
	const mostCommonHour = (hourCount: Record<number, number>): number | null =>
		Object.entries(hourCount).sort(([, a], [, b]) => b - a)[0]?.[0] != null
			? Number(Object.entries(hourCount).sort(([, a], [, b]) => b - a)[0][0])
			: null;
	const departureHour = mostCommonHour(startHourCount);
	const arrivalHour = mostCommonHour(endHourCount);
	const pauseHour =
		departureHour !== null && arrivalHour !== null ? Math.round((departureHour + arrivalHour) / 2) : null;
	const records: Records = {
		longestTrip,
		longestDay,
		bestMonth,
		firstTripDate,
		totalKm,
		totalTrips,
		ridingDays,
		longestStreak: maxStreak,
		longestStreakFrom,
		longestStreakTo,
		longestBreak,
		avgKmPerTrip,
		totalRidingHours,
		avgTripDurationMin,
		topDaysOfWeek,
		departureHour,
		pauseHour,
		arrivalHour,
	};

	// PauseStats — basé sur les sessions (boucles) détectées par buildSessions
	// Pauses = intra-trajet (depuis positions GPS) + inter-trajets (gap entre trajets d'une même session)
	const PAUSE_MS = 5 * 60 * 1000;
	const MERGE_KM = 0.2;
	const KM_RANGES: [number, number][] = [
		[0, 50],
		[50, 100],
		[100, 150],
		[150, 200],
		[200, Infinity],
	];
	const kmRangeLabel = (min: number, max: number) => (max === Infinity ? `> ${min} km` : `${min} – ${max} km`);
	const rangeData: { pauseCounts: number[]; durations: number[] }[] = KM_RANGES.map(() => ({
		pauseCounts: [],
		durations: [],
	}));
	let totalPauseCount = 0,
		totalPauseDuration = 0,
		totalSessionCount = 0;
	let maxPauseDuration = 0,
		maxPauseDateLabel: string | null = null,
		maxPauseTripIndexId: string | null = null;
	let totalKmBeforeFirst = 0,
		kmBeforeFirstCount = 0;
	let longestSessionKm = 0,
		longestSessionTripIndexId: string | null = null;

	const sessions = buildSessions(tripsWithCoords);
	for (const session of sessions) {
		const sessionKm = session.reduce((s, t) => s + t.distance / 1000, 0);
		const sessionPauses: { durationMin: number; afterKm: number; tripIndexId: string; date: string }[] = [];
		let cumKm = 0;

		for (let si = 0; si < session.length; si++) {
			const trip = session[si];

			// Pauses intra-trajet (depuis les positions GPS si disponibles)
			if (trip.positions && trip.positions.length > 0) {
				const positions = trip.positions;
				const raw: { durationMin: number; lat: number; lon: number; startKm: number }[] = [];
				let tripCumKm = 0;
				for (let i = 1; i < positions.length; i++) {
					const dt = new Date(positions[i].fixtime).getTime() - new Date(positions[i - 1].fixtime).getTime();
					const segKm = haversineKm(
						positions[i - 1].latitude,
						positions[i - 1].longitude,
						positions[i].latitude,
						positions[i].longitude,
					);
					tripCumKm += segKm;
					if (dt > PAUSE_MS) {
						raw.push({
							durationMin: Math.round(dt / 60000),
							lat: positions[i - 1].latitude,
							lon: positions[i - 1].longitude,
							startKm: tripCumKm,
						});
					}
				}
				// Fusionner les pauses proches (< 200m)
				const merged: typeof raw = [];
				for (const z of raw) {
					const nearby = merged.find((m) => haversineKm(m.lat, m.lon, z.lat, z.lon) < MERGE_KM);
					if (nearby) nearby.durationMin += z.durationMin;
					else merged.push({ ...z });
				}
				for (const p of merged.filter((z) => cumKm + z.startKm >= 5)) {
					sessionPauses.push({
						durationMin: p.durationMin,
						afterKm: cumKm + p.startKm,
						tripIndexId: trip.indexId,
						date: trip.startTime.substring(0, 10),
					});
				}
			}

			cumKm += trip.distance / 1000;

			// Pause inter-trajet : 3+ trajets seulement, et gap >= 10 min (évite les micro-coupures GPS)
			if (session.length >= 3 && si < session.length - 1) {
				const next = session[si + 1];
				const gapMs = new Date(next.startTime).getTime() - new Date(trip.endTime).getTime();
				const gapMin = Math.round(gapMs / 60000);
				if (gapMin >= 10) {
					sessionPauses.push({
						durationMin: gapMin,
						afterKm: cumKm,
						tripIndexId: trip.indexId,
						date: trip.startTime.substring(0, 10),
					});
				}
			}
		}

		// Agréger les stats de la session
		totalSessionCount++;
		totalPauseCount += sessionPauses.length;
		for (const p of sessionPauses) {
			totalPauseDuration += p.durationMin;
			if (p.durationMin > maxPauseDuration) {
				maxPauseDuration = p.durationMin;
				maxPauseDateLabel = fmt.format(new Date(p.date + 'T12:00:00'));
				maxPauseTripIndexId = p.tripIndexId;
			}
		}
		const firstPause = sessionPauses[0];
		if (firstPause) {
			totalKmBeforeFirst += firstPause.afterKm;
			kmBeforeFirstCount++;
		}
		if (sessionPauses.length === 0 && sessionKm > longestSessionKm) {
			longestSessionKm = sessionKm;
			longestSessionTripIndexId = session[0].indexId;
		}
		const rangeIdx = KM_RANGES.findIndex(([min, max]) => sessionKm >= min && sessionKm < max);
		if (rangeIdx >= 0) {
			rangeData[rangeIdx].pauseCounts.push(sessionPauses.length);
			if (sessionPauses.length > 0)
				rangeData[rangeIdx].durations.push(...sessionPauses.map((p) => p.durationMin));
		}
	}

	const pauseStats: PauseStats = {
		tripsWithPositions: tripsWithPos.length,
		avgPausesPerTrip: totalSessionCount > 0 ? Math.round((totalPauseCount / totalSessionCount) * 10) / 10 : null,
		avgPauseDurationMin: totalPauseCount > 0 ? Math.round(totalPauseDuration / totalPauseCount) : null,
		maxPauseDurationMin: maxPauseDuration > 0 ? maxPauseDuration : null,
		maxPauseDateLabel,
		maxPauseTripIndexId,
		avgKmBeforeFirstPause: kmBeforeFirstCount > 0 ? Math.round(totalKmBeforeFirst / kmBeforeFirstCount) : null,
		longestSessionKm: longestSessionKm > 0 ? Math.round(longestSessionKm) : null,
		longestSessionTripIndexId,
		byKmRange: KM_RANGES.map(([min, max], i) => {
			const { pauseCounts, durations } = rangeData[i];
			return {
				label: kmRangeLabel(min, max),
				avgPauses:
					pauseCounts.length > 0
						? Math.round((pauseCounts.reduce((s, v) => s + v, 0) / pauseCounts.length) * 10) / 10
						: 0,
				minPauses: pauseCounts.length > 0 ? Math.min(...pauseCounts) : 0,
				maxPauses: pauseCounts.length > 0 ? Math.max(...pauseCounts) : 0,
				avgDurationMin:
					durations.length > 0 ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length) : 0,
				minDurationMin: durations.length > 0 ? Math.min(...durations) : 0,
				maxDurationMin: durations.length > 0 ? Math.max(...durations) : 0,
				tripCount: pauseCounts.length,
			};
		}).filter((r) => r.tripCount > 0),
	};

	// FuelStats
	const TANK_L = 15;
	let totalLiters = 0;
	// Initialiser les 12 derniers mois (même si 0 trajet)
	const fuelByMonth: Record<string, { liters: number }> = {};
	const nowDate = now;
	for (let i = 11; i >= 0; i--) {
		const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		fuelByMonth[key] = { liters: 0 };
	}
	for (const trip of tripsWithCoords) {
		const liters = estimateLiters(trip.distance, trip.averageSpeed, trip.positions);
		totalLiters += liters;
		const month = trip.startTime.substring(0, 7);
		if (fuelByMonth[month] !== undefined) fuelByMonth[month].liters += liters;
	}
	const prices = fuelPrices;
	const totalKmAll = tripsWithCoords.reduce((s, t) => s + t.distance / 1000, 0);
	let totalCost: number | null = null;
	const fuelByMonthStats: MonthlyFuelCost[] = Object.entries(fuelByMonth)
		.sort(([a], [b]) => a.localeCompare(b))
		.filter(([, { liters }]) => liters > 0)
		.map(([key, { liters }]) => {
			const pricePerL = prices[key] ?? null;
			const cost = pricePerL !== null ? liters * pricePerL : null;
			if (cost !== null) totalCost = (totalCost ?? 0) + cost;
			return {
				key,
				label: fmtMonth.format(new Date(key + '-15')),
				pricePerL: pricePerL !== null ? Math.round(pricePerL * 1000) / 1000 : null,
				litersConsumed: Math.round(liters * 10) / 10,
				cost: cost !== null ? Math.round(cost) : null,
				fillUps: estimateFillUps(liters, TANK_L),
			};
		});
	const fuelStats: FuelStats = {
		fuelType: fuelType,
		tankSizeL: TANK_L,
		totalLiters: Math.round(totalLiters * 10) / 10,
		totalCost: totalCost !== null ? Math.round(totalCost) : null,
		avgConsumptionL100: totalKmAll > 0 ? Math.round((totalLiters / totalKmAll) * 1000) / 10 : 0,
		totalFillUps: fuelByMonthStats.reduce((s, m) => s + m.fillUps, 0),
		co2KgTotal: estimateCO2Kg(totalLiters),
		costPerKm: totalCost !== null ? fuelCostPerKm(totalCost, totalKmAll) : null,
		byMonth: fuelByMonthStats,
	};

	// RecentStats — tableau de mois (12 derniers avec données)
	const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const fmtShortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

	// Première date par dept et par pays (nécessaire pour les discoveries)
	const deptFirstDate: Record<string, string> = {};
	const countryFirstDate: Record<string, string> = {};
	for (const trip of tripsWithCoords) {
		const deptCode = tripDeptCode[trip.indexId];
		const country = tripCountryCode[trip.indexId];
		const date = trip.startTime.substring(0, 10);
		if (deptCode && (!deptFirstDate[deptCode] || date < deptFirstDate[deptCode])) {
			deptFirstDate[deptCode] = date;
		}
		if (country && (!countryFirstDate[country] || date < countryFirstDate[country])) {
			countryFirstDate[country] = date;
		}
	}

	// Première visite par ville de destination : date + tripIndexId (homeCity incluse)
	const cityFirstData: Record<string, Record<string, { date: string; tripIndexId: string }>> = {};
	const destinationCities = new Set<string>();
	for (const trip of tripsWithCoords) {
		const endCity = extractCity(trip.niceEndAddress ?? trip.endAddress);
		if (!endCity) continue;
		const code = tripDeptCode[trip.indexId];
		if (!code) continue;
		const date = trip.startTime.substring(0, 10);
		destinationCities.add(endCity);
		if (!cityFirstData[code]) cityFirstData[code] = {};
		const existing = cityFirstData[code][endCity];
		if (!existing || date < existing.date) {
			cityFirstData[code][endCity] = { date, tripIndexId: trip.indexId };
		}
	}

	// Première date + pays + tripIndexId par ville de passage
	const passingCityFirstDate: Record<string, { date: string; country: string; tripIndexId: string }> = {};
	for (const trip of tripsWithCoords) {
		if (!trip.positions) continue;
		const date = trip.startTime.substring(0, 10);
		const country = tripCountryCode[trip.indexId] ?? 'FR';
		for (const p of trip.positions) {
			if (!p.address) continue;
			const city = extractCity(p.address);
			if (!city || destinationCities.has(city)) continue;
			const existing = passingCityFirstDate[city];
			if (!existing || date < existing.date) {
				passingCityFirstDate[city] = { date, country, tripIndexId: trip.indexId };
			}
		}
	}

	// Première date par cellule H3 R7 (pour compter les lieux débloqués par mois)
	const cellFirstDate: Record<string, string> = {};
	if (allR7Data) {
		for (const [cell, indices] of Object.entries(allR7Data.cellToIndices)) {
			for (const idx of indices) {
				const trip = allTripsWithCoords[idx];
				if (!trip) continue;
				const date = trip.startTime.substring(0, 10);
				if (!cellFirstDate[cell] || date < cellFirstDate[cell]) {
					cellFirstDate[cell] = date;
				}
			}
		}
	}

	const buildMonthSummary = (prefix: string): MonthSummary | null => {
		const monthTrips = tripsWithCoords.filter((t) => t.startTime.substring(0, 7) === prefix);
		if (monthTrips.length === 0) return null;
		const maxSpeedRaw = Math.max(...monthTrips.map((t) => t.maxSpeed));
		const kmByDay: Record<string, number> = {};
		for (const t of monthTrips) {
			const day = t.startTime.substring(0, 10);
			kmByDay[day] = (kmByDay[day] ?? 0) + t.distance / 1000;
		}
		const bestDayEntry = Object.entries(kmByDay).sort(([, a], [, b]) => b - a)[0] ?? null;
		const rawLabel = fmtMonth.format(new Date(prefix + '-15'));

		// Nouvelles villes : première visite all-time dans ce mois-ci
		const newCities: MonthSummary['newCities'] = [];
		for (const [deptCode, cities] of Object.entries(cityFirstData)) {
			const dept = depts.find((d) => d.code === deptCode);
			if (!dept) continue;
			for (const [cityName, { date: fd, tripIndexId }] of Object.entries(cities)) {
				if (fd.substring(0, 7) === prefix) {
					newCities.push({ name: cityName, deptName: dept.name, country: dept.country, tripIndexId });
				}
			}
		}
		newCities.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

		// Nouveaux depts
		const newDepts: MonthSummary['newDepts'] = [];
		for (const dept of depts) {
			const fd = deptFirstDate[dept.code];
			if (fd && fd.substring(0, 7) === prefix) {
				newDepts.push({ name: dept.name, country: dept.country });
			}
		}

		// Nouveaux pays
		const newCountries: MonthSummary['newCountries'] = [];
		for (const [code, fd] of Object.entries(countryFirstDate)) {
			if (fd.substring(0, 7) === prefix) {
				newCountries.push({ code });
			}
		}

		// Nouvelles villes de passage (positions GPS, hors destinations)
		const newPassingCities: MonthSummary['newPassingCities'] = [];
		for (const [city, { date: fd, country, tripIndexId }] of Object.entries(passingCityFirstDate)) {
			if (fd.substring(0, 7) === prefix) {
				newPassingCities.push({ name: city, country, tripIndexId });
			}
		}
		newPassingCities.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

		// Lieux débloqués (cellules H3 visitées pour la première fois ce mois)
		let newHexCount = 0;
		for (const fd of Object.values(cellFirstDate)) {
			if (fd.substring(0, 7) === prefix) newHexCount++;
		}

		return {
			key: prefix,
			label: rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1),
			shortLabel: fmtShortMonth.format(new Date(prefix + '-15')),
			km: Math.round(monthTrips.reduce((s, t) => s + t.distance / 1000, 0)),
			trips: monthTrips.length,
			ridingDays: new Set(monthTrips.map((t) => t.startTime.substring(0, 10))).size,
			maxSpeedKmh: maxSpeedRaw > 0 ? Math.round(maxSpeedRaw * 1.852) : null,
			bestDayKm: bestDayEntry ? Math.round(bestDayEntry[1]) : null,
			bestDayDateLabel: bestDayEntry ? fmt.format(new Date(bestDayEntry[0] + 'T12:00:00')) : null,
			newCities,
			newPassingCities,
			newDepts,
			newCountries,
			newHexCount,
		};
	};

	const months: MonthSummary[] = [];
	for (let i = 0; i < 12; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const summary = buildMonthSummary(prefix);
		if (summary) months.push(summary);
	}

	// Streak actuel (jours consécutifs jusqu'à aujourd'hui ou hier)
	let currentStreakDays = 0;
	let currentStreakSince: string | null = null;
	if (sortedDays.length > 0) {
		const todayStr = now.toISOString().substring(0, 10);
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 1);
		const yesterdayStr = yesterday.toISOString().substring(0, 10);
		const lastDay = sortedDays[sortedDays.length - 1];
		if (lastDay === todayStr || lastDay === yesterdayStr) {
			currentStreakDays = 1;
			currentStreakSince = lastDay;
			for (let i = sortedDays.length - 2; i >= 0; i--) {
				const prevDate = new Date(sortedDays[i] + 'T12:00:00');
				const nextDate = new Date(sortedDays[i + 1] + 'T12:00:00');
				const diffDays = Math.round((nextDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
				if (diffDays === 1) {
					currentStreakDays++;
					currentStreakSince = sortedDays[i];
				} else {
					break;
				}
			}
		}
	}

	// Dates des records all-time
	const tripByIndexId: Record<string, TripWithCoords> = {};
	for (const t of tripsWithCoords) tripByIndexId[t.indexId] = t;
	const speedRecordDate = speedStats.maxSpeedTripIndexId
		? (tripByIndexId[speedStats.maxSpeedTripIndexId]?.startTime.substring(0, 10) ?? null)
		: null;
	const leanRecordDate = turnStats.maxLeanTripIndexId
		? (tripByIndexId[turnStats.maxLeanTripIndexId]?.startTime.substring(0, 10) ?? null)
		: null;
	const longestTripDate = longestTripRaw?.startTime.substring(0, 10) ?? null;
	const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	const recentStats: RecentStats = {
		months,
		currentStreakDays,
		currentStreakSince,
		speedRecordDate,
		leanRecordDate,
		longestTripDate,
		bestMonthIsCurrent: bestMonthEntry?.[0] === currentMonthKey,
	};

	return { homeCity, depts, distanceStats, speedStats, turnStats, pauseStats, fuelStats, records, recentStats };
}
