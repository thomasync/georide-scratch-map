import {
	Component,
	Input,
	Output,
	EventEmitter,
	OnChanges,
	SimpleChanges,
	ViewChild,
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	OnDestroy,
	inject,
} from '@angular/core';
import { ChartData, ChartOptions, Chart, ActiveElement, ChartEvent } from 'chart.js';
import { LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { TripWithCoords } from '../map';
import { GeoRidePosition } from '../../../core/services/georide-api';
import { extractCity } from '../../../core/utils/address';
import { computeAltProfile, haversineKm } from '../../../core/utils/elevation';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

const MAX_CHART_POINTS = 400;
const COLOR_ALT = '#7986cb';
const COLOR_SPEED = '#4caf50';
const COLOR_ANGLE = '#e57373'; // déclinaison claire du rouge virages #ff1744
const MIN_CITIES = 3; // n'affiche la carte que si > 2 villes distinctes

interface CityEntry {
	name: string;
	time: string; // HH:MM
	lat: number;
	lon: number;
}

@Component({
	selector: 'app-trip-detail-panel',
	standalone: true,
	imports: [BaseChartDirective],
	templateUrl: './trip-detail-panel.html',
	styleUrl: './trip-detail-panel.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TripDetailPanelComponent implements OnChanges, OnDestroy {
	private cdr = inject(ChangeDetectorRef);

	@Input() trip: TripWithCoords | null = null;
	@Input() positions: GeoRidePosition[] | null = null;
	@Input() allTrips: TripWithCoords[] = [];

	@Output() hoverPosition = new EventEmitter<[number, number] | null>();
	@Output() closePanelEvent = new EventEmitter<void>();
	@Output() showFullDayEvent = new EventEmitter<TripWithCoords[]>();
	@Output() flyToPosition = new EventEmitter<[number, number]>();
	@Output() followPosition = new EventEmitter<[number, number] | null>();
	@Output() fitTripEvent = new EventEmitter<void>();
	@Output() selectTripEvent = new EventEmitter<TripWithCoords>();

	@ViewChild(BaseChartDirective) chartRef?: BaseChartDirective;

	// Stats
	distanceKm = 0;
	durationStr = '';
	avgSpeedKmh = 0;
	maxSpeedKmh = 0;
	altMin = 0;
	altMax = 0;
	elevGain = 0;
	maxAngleDelta = 0; // calculé depuis les positions (pour le hover)
	maxAngleTrip = 0; // depuis trip.maxAngle (pleine résolution GeoRide)
	startLabel = '';
	endLabel = '';
	dateLabel = '';
	startTimeLabel = '';
	endTimeLabel = '';
	totalDurationStr = '';
	cities: CityEntry[] = [];
	dayTrips: TripWithCoords[] = [];
	dayLabel = '';
	positionsLoading = true;

	// Internal sampled positions for chart hover → lat/lon lookup
	private sampledPositions: GeoRidePosition[] = [];
	private sampledKms: number[] = [];

	// Chart window (100 km max)
	private readonly WINDOW_KM = 50;
	private chartTotalKm = 0;
	private windowStartKm = 0;
	private touchStartX = 0;
	private touchStartWindowKm = 0;

	// Scroll continu via RAF
	private scrollRafId: number | null = null;
	private scrollVelocity = 0; // km/s (positif = droite, négatif = gauche)
	private lastRafTime = 0;

	// Charts
	combinedChartData: ChartData<'line'> = { datasets: [] };
	combinedChartOptions: ChartOptions<'line'> = {};
	hoverAlt: number | null = null;
	hoverSpeed: number | null = null;
	hoverAngle: number | null = null;
	hoverTime: string | null = null;
	hoverKm: string | null = null;
	followEnabled = false;
	isLoopActive = false;
	showTripsPopup = false;

	// Plugin ligne verticale rouge au survol
	readonly verticalLinePlugin = {
		id: 'verticalLine',
		afterDraw: (chart: any) => {
			const active = chart.tooltip?.getActiveElements?.();
			if (!active?.length) return;
			const x = active[0].element.x;
			const { top, bottom } = chart.chartArea;
			const ctx = chart.ctx;
			ctx.save();
			ctx.beginPath();
			ctx.moveTo(x, top);
			ctx.lineTo(x, bottom);
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(253, 179, 0, 0.85)';
			ctx.setLineDash([3, 3]);
			ctx.stroke();
			ctx.restore();
		},
	};

	ngOnChanges(changes: SimpleChanges): void {
		if (changes['trip'] && this.trip) {
			this.updateTripMeta();
			this.positionsLoading = true;
			this.sampledPositions = [];
			this.cities = [];
			this.altMin = 0;
			this.altMax = 0;
			this.elevGain = 0;
			this.maxAngleDelta = 0;
			this.hoverAlt = null;
			this.hoverSpeed = null;
			this.hoverAngle = null;
			this.hoverTime = null;
			this.hoverKm = null;
			this.combinedChartData = { datasets: [] };
			this.windowStartKm = 0;
			this.chartTotalKm = 0;
		}
		if (changes['positions'] || (changes['trip'] && this.positions)) {
			this.buildChartData();
		}
		if (changes['allTrips'] || changes['trip']) {
			this.updateDayTrips();
		}
	}

	private updateTripMeta(): void {
		const t = this.trip!;
		this.distanceKm = Math.round(t.distance / 1000);
		this.durationStr = formatDuration(t.duration);
		this.avgSpeedKmh = Math.round(t.averageSpeed);
		this.maxSpeedKmh = Math.round(t.maxSpeed);
		this.startLabel = extractCity(t.niceStartAddress ?? t.startAddress) ?? t.startAddress ?? '—';
		this.endLabel = extractCity(t.niceEndAddress ?? t.endAddress) ?? t.endAddress ?? '—';
		this.dateLabel = formatDate(t.startTime);
		this.startTimeLabel = formatTime(t.startTime);
		this.endTimeLabel = formatTime(t.endTime);
		// L'API stocke l'angle depuis l'horizontal (90° = moto verticale)
		// Inclinaison réelle = |maxAngle - 90|
		this.maxAngleTrip = t.maxAngle > 0 ? Math.round(Math.abs(t.maxAngle - 90)) : 0;
		const elapsedMs = new Date(t.endTime).getTime() - new Date(t.startTime).getTime();
		this.totalDurationStr = formatDuration(elapsedMs);
	}

	private buildChartData(): void {
		const positions = this.positions;
		// null = still loading; [] = loaded but no data
		if (!positions?.length) {
			this.positionsLoading = this.positions === null && this.trip != null;
			this.cdr.markForCheck();
			return;
		}

		this.positionsLoading = false;

		// Downsample
		const step = Math.max(1, Math.ceil(positions.length / MAX_CHART_POINTS));
		const sampled: GeoRidePosition[] = [];
		for (let i = 0; i < positions.length; i += step) sampled.push(positions[i]);
		if (sampled[sampled.length - 1] !== positions[positions.length - 1]) {
			sampled.push(positions[positions.length - 1]);
		}
		this.sampledPositions = sampled;

		// Cumulative distances en km (axe X réel)
		const kms: number[] = [0];
		for (let i = 1; i < sampled.length; i++) {
			kms.push(
				kms[i - 1] +
					haversineKm(
						sampled[i - 1].latitude,
						sampled[i - 1].longitude,
						sampled[i].latitude,
						sampled[i].longitude,
					),
			);
		}
		this.chartTotalKm = kms[kms.length - 1];
		this.sampledKms = kms;
		this.windowStartKm = 0;

		const toX = (i: number) => Math.round(kms[i] * 10) / 10;

		this.combinedChartData = {
			datasets: [
				{
					data: sampled.map((p, i) => ({ x: toX(i), y: p.altitude > 0 ? p.altitude : null })),
					yAxisID: 'yAlt',
					label: 'Altitude',
					borderColor: COLOR_ALT,
					backgroundColor: 'rgba(121,134,203,0.18)',
					fill: true,
					borderWidth: 1.5,
					pointRadius: 0,
					pointHoverRadius: 0,
					pointHitRadius: 0,
					tension: 0.3,
					spanGaps: true,
				},
				{
					data: sampled.map((p, i) => ({ x: toX(i), y: Math.round(p.speed * 1.852) })),
					yAxisID: 'ySpeed',
					label: 'Vitesse',
					borderColor: COLOR_SPEED,
					backgroundColor: 'rgba(76,175,80,0.12)',
					fill: false,
					borderWidth: 1.5,
					pointRadius: 0,
					pointHoverRadius: 0,
					pointHitRadius: 0,
					tension: 0.3,
				},
				{
					data: sampled.map((p, i) => ({ x: toX(i), y: Math.round(p.angle - 90) })),
					yAxisID: 'yAngle',
					label: 'Inclinaison',
					borderColor: COLOR_ANGLE,
					backgroundColor: 'rgba(229,115,115,0.08)',
					fill: false,
					borderWidth: 1,
					pointRadius: 0,
					pointHoverRadius: 0,
					pointHitRadius: 0,
					tension: 0.2,
				},
			],
		};

		// Max inclinaison calculé depuis les positions (valeur absolue)
		this.maxAngleDelta = sampled.reduce((max, p) => Math.max(max, Math.abs(Math.round(p.angle - 90))), 0);

		// Rebuild options with correct initial window
		this.combinedChartOptions = this.buildCombinedChartOptions();

		// Altitude stats from full positions
		const altProfile = computeAltProfile(positions);
		if (altProfile) {
			this.altMin = altProfile.minAlt;
			this.altMax = altProfile.maxAlt;
			this.elevGain = altProfile.gain;
		}

		// Cities — firstTime = arrivée (pour la 1ère ville = départ), lastTime = quand on quitte
		type CityAccum = { firstTime: string; lastTime: string; lat: number; lon: number };
		const cityMap = new Map<string, CityAccum>();
		const cityOrder: string[] = [];
		for (const p of positions) {
			if (!p.address) continue;
			const city = extractCity(p.address);
			if (!city) continue;
			if (!cityMap.has(city)) {
				cityMap.set(city, { firstTime: p.fixtime, lastTime: p.fixtime, lat: p.latitude, lon: p.longitude });
				cityOrder.push(city);
			} else {
				cityMap.get(city)!.lastTime = p.fixtime;
			}
		}
		this.cities = cityOrder.map((city, idx) => {
			const e = cityMap.get(city)!;
			// 1ère ville : heure de départ (firstTime), autres : heure à laquelle on quitte (lastTime)
			return { name: city, time: formatTime(idx === 0 ? e.firstTime : e.lastTime), lat: e.lat, lon: e.lon };
		});

		// Cas boucle : si la dernière position revient sur une ville déjà vue mais pas en fin de liste,
		// on l'ajoute à nouveau à la fin (ex: Béziers → … → Béziers).
		const lastPosWithAddr = [...positions].reverse().find((p) => p.address && extractCity(p.address));
		if (lastPosWithAddr) {
			const endCity = extractCity(lastPosWithAddr.address);
			const lastInList = this.cities[this.cities.length - 1]?.name;
			if (endCity && endCity !== lastInList) {
				const e = cityMap.get(endCity);
				if (e) this.cities.push({ name: endCity, time: formatTime(e.lastTime), lat: e.lat, lon: e.lon });
			}
		}

		// Fallback pour le header : si start/end n'ont pas de ville (API renvoie null),
		// on utilise la première/dernière ville trouvée dans les positions.
		if (this.startLabel === '—' && this.cities.length > 0) {
			this.startLabel = this.cities[0].name;
		}
		if (this.endLabel === '—' && this.cities.length > 0) {
			this.endLabel = this.cities[this.cities.length - 1].name;
		}

		this.cdr.markForCheck();
	}

	private updateDayTrips(): void {
		if (!this.trip) {
			this.dayTrips = [];
			return;
		}
		const date = this.trip.startTime.substring(0, 10);
		const tid = this.trip.trackerId;
		const sameDayTrips = this.allTrips.filter((t) => t.startTime.substring(0, 10) === date && t.trackerId === tid);
		// Garde le trajet sélectionné + ceux qui lui sont géographiquement et temporellement liés
		this.dayTrips = sameDayTrips.filter((t) => t.indexId === this.trip!.indexId || isLinkedTrip(this.trip!, t));
		if (this.dayTrips.length > 1) {
			this.dayLabel = 'Afficher la boucle';
		}
	}

	private buildCombinedChartOptions(): ChartOptions<'line'> {
		const self = this;
		return {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			interaction: { mode: 'index', intersect: false },
			onHover: (_event: ChartEvent, elements: ActiveElement[]) => {
				if (elements.length > 0) {
					const idx = elements[0].index;
					const pos = self.sampledPositions[idx];
					if (pos) {
						const latLon: [number, number] = [pos.latitude, pos.longitude];
						self.hoverPosition.emit(latLon);
						if (self.followEnabled) self.followPosition.emit(latLon);
						self.hoverAlt = pos.altitude > 0 ? pos.altitude : null;
						self.hoverSpeed = Math.round(pos.speed * 1.852);
						// On ne peut pas calculer le delta sans la position précédente dans sampledPositions,
						// on lit directement depuis le dataset angle
						self.hoverAngle = Math.round(pos.angle - 90);
						self.hoverTime = formatTime(pos.fixtime);
						const km = self.sampledKms[idx] ?? 0;
						self.hoverKm = km.toFixed(1);
						// Edge-scroll progressif si le trajet dépasse la fenêtre
						if (self.chartTotalKm > self.WINDOW_KM) {
							const windowEnd = self.windowStartKm + self.WINDOW_KM;
							const edgeZone = self.WINDOW_KM * 0.18;
							const maxSpeed = 70; // km/s à pleine vitesse
							if (km > windowEnd - edgeZone && self.windowStartKm + self.WINDOW_KM < self.chartTotalKm) {
								const depth = (km - (windowEnd - edgeZone)) / edgeZone;
								self.scrollVelocity = depth * depth * maxSpeed;
								self.startScrollLoop();
							} else if (km < self.windowStartKm + edgeZone && self.windowStartKm > 0) {
								const depth = (self.windowStartKm + edgeZone - km) / edgeZone;
								self.scrollVelocity = -(depth * depth * maxSpeed);
								self.startScrollLoop();
							} else {
								self.stopScrollLoop();
							}
						}
						self.cdr.markForCheck();
					}
				} else {
					self.hoverPosition.emit(null);
					if (self.followEnabled) self.followPosition.emit(null);
					self.hoverAlt = null;
					self.hoverSpeed = null;
					self.hoverAngle = null;
					self.hoverTime = null;
					self.hoverKm = null;
					self.cdr.markForCheck();
				}
			},
			plugins: {
				legend: { display: false },
				tooltip: { enabled: false },
			},
			scales: {
				x: {
					type: 'linear',
					min: 0,
					max: this.chartTotalKm > this.WINDOW_KM ? this.WINDOW_KM : Math.ceil(this.chartTotalKm),
					display: true,
					ticks: {
						color: 'rgba(255,255,255,0.4)',
						maxTicksLimit: 5,
						font: { size: 9 },
						callback: (val) => `${Math.round(val as number)} km`,
					},
					grid: { color: 'rgba(255,255,255,0.05)' },
					border: { display: false },
				},
				yAlt: {
					position: 'left',
					ticks: {
						color: COLOR_ALT,
						maxTicksLimit: 4,
						font: { size: 9 },
						callback: (val) => `${val}m`,
					},
					grid: { color: 'rgba(255,255,255,0.05)' },
					border: { display: false },
				},
				ySpeed: {
					position: 'right',
					ticks: {
						color: COLOR_SPEED,
						maxTicksLimit: 4,
						font: { size: 9 },
						callback: (val) => `${val}`,
					},
					grid: { drawOnChartArea: false },
					border: { display: false },
				},
				yAngle: {
					display: false, // pas d'axe visible, la valeur est dans les stats de hover
					position: 'right',
				},
			},
		};
	}

	ngOnDestroy(): void {
		this.stopScrollLoop();
	}

	onMouseLeaveChart(): void {
		this.hoverPosition.emit(null);
		if (this.followEnabled) this.followPosition.emit(null);
		this.stopScrollLoop();
	}

	onShowFullDay(): void {
		this.isLoopActive = true;
		this.showTripsPopup = false;
		this.showFullDayEvent.emit(this.dayTrips);
	}

	onToggleTripsPopup(e: Event): void {
		e.stopPropagation();
		this.showTripsPopup = !this.showTripsPopup;
	}

	onSelectTrip(trip: TripWithCoords, e: Event): void {
		e.stopPropagation();
		this.showTripsPopup = false;
		this.isLoopActive = false;
		this.selectTripEvent.emit(trip);
	}

	tripDate(trip: TripWithCoords): string {
		return new Date(trip.startTime).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
	}

	roundKm(distM: number): number {
		return Math.round(distM / 1000);
	}

	tripRoute(trip: TripWithCoords): string {
		const s =
			extractCity(trip.niceStartAddress ?? trip.startAddress) ??
			trip.startAddress?.split(',')[0]?.trim() ??
			this.inferCity(trip.startLat, trip.startLon) ??
			'—';
		const e =
			extractCity(trip.niceEndAddress ?? trip.endAddress) ??
			trip.endAddress?.split(',')[0]?.trim() ??
			this.inferCity(trip.endLat, trip.endLon) ??
			'—';
		return `${s} → ${e}`;
	}

	private inferCity(lat: number, lon: number): string | null {
		if (!lat || !lon) return null;
		let bestCity: string | null = null;
		let bestDist = 2; // km seuil
		for (const t of this.allTrips) {
			for (const [addr, alat, alon] of [
				[t.niceStartAddress ?? t.startAddress, t.startLat, t.startLon],
				[t.niceEndAddress ?? t.endAddress, t.endLat, t.endLon],
			] as [string | null | undefined, number, number][]) {
				const city = extractCity(addr);
				if (!city || !alat || !alon) continue;
				const dLat = (lat - alat) * 111;
				const dLon = (lon - alon) * 111 * Math.cos(lat * (Math.PI / 180));
				const d = Math.sqrt(dLat * dLat + dLon * dLon);
				if (d < bestDist) {
					bestDist = d;
					bestCity = city;
				}
			}
		}
		return bestCity;
	}

	onToggleFollow(): void {
		this.followEnabled = !this.followEnabled;
		if (!this.followEnabled) this.fitTripEvent.emit();
	}

	scrollChartTo(newStartKm: number): void {
		if (this.chartTotalKm <= this.WINDOW_KM) return;
		const clamped = Math.max(0, Math.min(newStartKm, this.chartTotalKm - this.WINDOW_KM));
		if (Math.abs(clamped - this.windowStartKm) < 0.01) return;
		this.windowStartKm = clamped;
		const chart = this.chartRef?.chart;
		if (!chart?.options?.scales?.['x']) return;
		(chart.options.scales['x'] as any).min = this.windowStartKm;
		(chart.options.scales['x'] as any).max = this.windowStartKm + this.WINDOW_KM;
		chart.update('none');
	}

	private startScrollLoop(): void {
		if (this.scrollRafId !== null) return;
		const loop = (time: number) => {
			if (this.scrollVelocity === 0) {
				this.scrollRafId = null;
				return;
			}
			if (this.lastRafTime > 0) {
				const dt = Math.min((time - this.lastRafTime) / 1000, 0.1); // cap à 100ms
				this.scrollChartTo(this.windowStartKm + this.scrollVelocity * dt);
			}
			this.lastRafTime = time;
			this.scrollRafId = requestAnimationFrame(loop);
		};
		this.lastRafTime = 0;
		this.scrollRafId = requestAnimationFrame(loop);
	}

	private stopScrollLoop(): void {
		if (this.scrollRafId !== null) {
			cancelAnimationFrame(this.scrollRafId);
			this.scrollRafId = null;
		}
		this.scrollVelocity = 0;
		this.lastRafTime = 0;
	}

	onChartTouchStart(e: TouchEvent): void {
		this.touchStartX = e.touches[0].clientX;
		this.touchStartWindowKm = this.windowStartKm;
		e.preventDefault();
	}

	onChartTouchMove(e: TouchEvent): void {
		if (!this.chartRef?.chart?.chartArea) return;
		const deltaX = e.touches[0].clientX - this.touchStartX;
		const chartWidth = this.chartRef.chart.chartArea.width;
		const kmPerPx = this.WINDOW_KM / chartWidth;
		this.scrollChartTo(this.touchStartWindowKm - deltaX * kmPerPx);
		e.preventDefault();
	}

	onCityEnter(city: CityEntry): void {
		this.hoverPosition.emit([city.lat, city.lon]);
	}

	onCityLeave(): void {
		this.hoverPosition.emit(null);
	}

	onCityClick(city: CityEntry): void {
		this.flyToPosition.emit([city.lat, city.lon]);
	}

	onClose(): void {
		this.closePanelEvent.emit();
	}
}

function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}`;
	return `${m} min`;
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Distance approx en km entre deux points GPS (formule plate, suffisante pour < 50km)
function roughDistKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const dLat = (lat2 - lat1) * 111;
	const dLon = (lon2 - lon1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
	return Math.sqrt(dLat * dLat + dLon * dLon);
}

// Deux trajets sont "liés" si un endpoint de B est proche d'un endpoint de A
// ET l'écart temporel entre eux est inférieur à MAX_GAP_H heures.
function isLinkedTrip(a: TripWithCoords, b: TripWithCoords): boolean {
	const DIST_KM = 3; // 3 km de tolérance GPS/parking
	const MAX_GAP_H = 2; // max 2h d'écart entre deux segments

	const aEnd = new Date(a.endTime).getTime();
	const bStart = new Date(b.startTime).getTime();
	const bEnd = new Date(b.endTime).getTime();
	const aStart = new Date(a.startTime).getTime();
	const gapMs = Math.min(Math.abs(aEnd - bStart), Math.abs(bEnd - aStart));
	if (gapMs > MAX_GAP_H * 3_600_000) return false;

	const pairs: [number, number, number, number][] = [
		[a.startLat, a.startLon, b.startLat, b.startLon],
		[a.startLat, a.startLon, b.endLat, b.endLon],
		[a.endLat, a.endLon, b.startLat, b.startLon],
		[a.endLat, a.endLon, b.endLat, b.endLon],
	];
	return pairs.some(([la1, lo1, la2, lo2]) => roughDistKm(la1, lo1, la2, lo2) <= DIST_KM);
}
