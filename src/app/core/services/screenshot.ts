import { Injectable } from '@angular/core';
import maplibregl from 'maplibre-gl';
import { buildRouteLabel } from '../utils/route-label';

export interface ScreenshotStats {
	items: { value: string; label: string }[];
}

export interface WrappedCardData {
	mode: 'dept' | 'hex' | 'trip';
	// dept + hex
	totalKm: number;
	totalTrips: number;
	ridingDays: number;
	longestStreak: number;
	topDaysOfWeek: string[];
	departureHour: number | null;
	bestMonth: { km: number; label: string } | null;
	topDepts: { name: string; pct: number }[];
	countryCount: number;
	fullRegionCount: number;
	filterLabel: string;
	maxSpeedAllKmh?: number;
	bestDayKm?: number;
	totalRidingHours?: number;
	longestTripKm?: number;
	// trip
	distanceKm?: number;
	durationStr?: string;
	avgSpeedKmh?: number;
	maxSpeedKmh?: number;
	maxAngle?: number;
	pauseCount?: number;
	pauseTotalMin?: number;
	pctInTurn?: number | null;
	avgSpeedInTurnsKmh?: number | null;
	maxSpeedInTurnsKmh?: number | null;
	fromCity?: string | null;
	toCity?: string | null;
	pauseCities?: string[];
	altMax?: number;
	// Angles API (sans positions)
	maxAngleFromApiDeg?: number | null;
	maxLeftAngleDeg?: number | null;
	maxRightAngleDeg?: number | null;
	tripDateLabel?: string | null;
	totalElapsedStr?: string | null;
}

interface BentoTile {
	value: string;
	label: string;
	accent?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ScreenshotService {
	async capture(map: maplibregl.Map, stats: ScreenshotStats): Promise<void> {
		const mapCanvas = await new Promise<HTMLCanvasElement>((resolve) => {
			map.once('render', () => resolve(map.getCanvas()));
			map.triggerRepaint();
		});

		const w = mapCanvas.width;
		const h = mapCanvas.height;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(mapCanvas, 0, 0);

		await this.drawStatsOverlay(ctx, w, h, mapCanvas.getBoundingClientRect(), stats);

		canvas.toBlob((blob) => {
			if (!blob) return;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'georide-scratch-map.png';
			a.click();
			URL.revokeObjectURL(url);
		});
	}

	cropSquare(mapCanvas: HTMLCanvasElement): HTMLCanvasElement {
		const w = mapCanvas.width;
		const h = mapCanvas.height;
		const size = Math.min(w, h);
		const offsetX = Math.floor((w - size) / 2);
		const offsetY = Math.floor((h - size) / 2);
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(mapCanvas, offsetX, offsetY, size, size, 0, 0, size, size);
		return canvas;
	}

	renderWrappedToCanvas(
		sourceCanvas: HTMLCanvasElement,
		data: WrappedCardData,
		showStats: boolean,
		outputSize = 600,
		blurPx = 1,
	): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvas.width = outputSize;
		canvas.height = outputSize;
		const ctx = canvas.getContext('2d')!;

		// Map as full-bleed background
		const src = sourceCanvas;
		const srcSize = Math.min(src.width, src.height);
		const srcX = Math.floor((src.width - srcSize) / 2);
		const srcY = Math.floor((src.height - srcSize) / 2);
		ctx.drawImage(src, srcX, srcY, srcSize, srcSize, 0, 0, outputSize, outputSize);

		if (!showStats) return canvas;

		const s = outputSize / 600;

		// Overlay orange (#eec459) pour les modes hex et trip
		if (data.mode !== 'dept') {
			ctx.fillStyle = 'rgba(238, 196, 89, 0.30)';
			ctx.fillRect(0, 0, outputSize, outputSize);
		}

		const tiles = this.buildBentoTiles(data);

		// Layout constants (base 600)
		const GAP = 9 * s;
		const HERO_H = 100 * s;
		const HERO_GAP = 14 * s;
		const ROW_H = 82 * s;
		const HOSTNAME_RESERVE = 28 * s;
		const TILE_PAD_H = 30 * s; // padding horizontal interne à chaque tuile
		const MIN_TILE_W = 80 * s;

		// Mesure la largeur de chaque colonne d'après le contenu
		const colWidths = this.measureColWidths(ctx, tiles, s, TILE_PAD_H, MIN_TILE_W);
		const gridW = colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * GAP;
		const gridX = (outputSize - gridW) / 2;

		const numRows = Math.ceil(tiles.length / 3);
		const contentH = HERO_H + HERO_GAP + numRows * ROW_H + (numRows - 1) * GAP;
		const usableH = outputSize - HOSTNAME_RESERVE;
		const topY = (usableH - contentH) / 2;

		// Hero : même largeur que la grille
		this.renderHeroTile(ctx, gridX, topY, gridW, HERO_H, data, s, src, outputSize, blurPx);

		// Regular tiles
		for (let i = 0; i < tiles.length; i++) {
			const row = Math.floor(i / 3);
			const col = i % 3;
			const x = gridX + colWidths.slice(0, col).reduce((a, b) => a + b, 0) + col * GAP;
			const y = topY + HERO_H + HERO_GAP + row * (ROW_H + GAP);
			this.renderBentoTile(ctx, x, y, colWidths[col], ROW_H, tiles[i], s, src, outputSize, blurPx);
		}

		// Hostname
		const hostname = window.location.hostname;
		if (!/^[\d.]+$/.test(hostname) && hostname !== 'localhost') {
			ctx.font = `${Math.round(11 * s)}px system-ui,sans-serif`;
			ctx.fillStyle = 'rgba(255,255,255,0.30)';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'alphabetic';
			ctx.fillText(hostname, outputSize / 2, outputSize - 10 * s);
		}

		return canvas;
	}

	private measureColWidths(
		ctx: CanvasRenderingContext2D,
		tiles: BentoTile[],
		s: number,
		padH: number,
		minW: number,
	): number[] {
		const cols = Math.min(tiles.length, 3);
		const widths = new Array(cols).fill(minW);
		for (let i = 0; i < tiles.length; i++) {
			const col = i % 3;
			const tile = tiles[i];
			ctx.font = `bold ${Math.round(22 * s)}px system-ui,sans-serif`;
			const valueW = ctx.measureText(tile.value).width;
			ctx.font = `${Math.round(10 * s)}px system-ui,sans-serif`;
			const labelW = ctx.measureText(tile.label.toUpperCase()).width;
			widths[col] = Math.max(widths[col], Math.max(valueW, labelW) + 2 * padH);
		}
		return widths;
	}

	private drawFrostedGlass(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		r: number,
		src: HTMLCanvasElement,
		outputSize: number,
		s: number,
		blurPx: number,
	): void {
		ctx.save();
		this.roundRect(ctx, x, y, w, h, r);
		ctx.clip();

		// Redessiner la carte floutée dans la zone de la tuile
		ctx.filter = `blur(${Math.round(blurPx * s)}px)`;
		ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, outputSize, outputSize);
		ctx.filter = 'none';

		// Légère teinte orange plus claire
		ctx.fillStyle = 'rgba(255, 200, 80, 0.18)';
		ctx.fillRect(x, y, w, h);

		ctx.restore();
	}

	private renderHeroTile(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		data: WrappedCardData,
		s: number,
		src: HTMLCanvasElement,
		outputSize: number,
		blurPx: number,
	): void {
		// Frosted glass
		this.drawFrostedGlass(ctx, x, y, w, h, 14 * s, src, outputSize, s, blurPx);

		// Bordure dorée subtile
		ctx.strokeStyle = 'rgba(253,179,0,0.30)';
		ctx.lineWidth = 1 * s;
		this.roundRect(ctx, x, y, w, h, 14 * s);
		ctx.stroke();

		const cx = x + w / 2;

		let heroValue: string;
		let heroLabel: string;
		let subtitle: string | null = null;

		if (data.mode === 'trip') {
			heroValue = this.formatKm(data.distanceKm ?? 0);
			heroLabel = 'km parcourus';
			subtitle = buildRouteLabel(data.fromCity, data.toCity, data.pauseCities ?? []);
		} else {
			heroValue = this.formatKm(data.totalKm);
			heroLabel = 'km parcourus';
			if (data.filterLabel && data.filterLabel !== 'Tout') {
				subtitle = data.filterLabel;
			}
		}

		const hasSubtitle = subtitle != null;
		const valueY = hasSubtitle ? y + h * 0.3 : y + h * 0.4;
		const labelY = hasSubtitle ? y + h * 0.57 : y + h * 0.7;
		const subtitleY = y + h * 0.82;

		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = `bold ${Math.round(42 * s)}px system-ui,sans-serif`;
		ctx.fillStyle = '#fdb300';
		ctx.fillText(heroValue, cx, valueY);

		ctx.font = `${Math.round(13 * s)}px system-ui,sans-serif`;
		ctx.fillStyle = 'rgba(0,0,0,0.55)';
		ctx.fillText(heroLabel.toUpperCase(), cx, labelY);

		if (hasSubtitle) {
			ctx.font = `${Math.round(11 * s)}px system-ui,sans-serif`;
			ctx.fillStyle = 'rgba(0,0,0,0.38)';
			ctx.fillText(this.fitSubtitle(ctx, subtitle!, data, w - 32 * s), cx, subtitleY);
		}

		ctx.textBaseline = 'alphabetic';
	}

	private fitSubtitle(ctx: CanvasRenderingContext2D, full: string, data: WrappedCardData, maxW: number): string {
		if (ctx.measureText(full).width <= maxW) return full;
		const from = data.fromCity;
		const to = data.toCity ?? data.fromCity;
		if (!from) return full;
		const pauses = data.pauseCities ?? [];
		for (let total = pauses.length - 1; total >= 1; total--) {
			const fromSide = Math.ceil(total / 2);
			const toSide = Math.floor(total / 2);
			const kept = [...pauses.slice(0, fromSide), '…', ...(toSide > 0 ? pauses.slice(-toSide) : [])];
			const candidate = [from, ...kept, to].join(' → ');
			if (ctx.measureText(candidate).width <= maxW) return candidate;
		}
		return to && to !== from ? `${from} → … → ${to}` : `${from} → …`;
	}

	private buildBentoTiles(data: WrappedCardData): BentoTile[] {
		return data.mode === 'trip' ? this.buildTripTiles(data) : this.buildGlobalTiles(data);
	}

	private buildGlobalTiles(data: WrappedCardData): BentoTile[] {
		const tiles: BentoTile[] = [];

		// Row 1 : volume
		tiles.push({ value: String(data.totalTrips), label: data.totalTrips === 1 ? 'trajet' : 'trajets' });
		tiles.push({
			value: data.longestTripKm ? `${this.formatKm(data.longestTripKm)} km` : '—',
			label: 'trajet sans pause',
		});
		tiles.push({ value: String(data.countryCount), label: 'pays' });

		// Row 2 : performance / exploration (avec fallbacks intelligents)

		// Streak ou jour favori si pas de streak
		const streakSlotUsedDay = data.longestStreak === 0;
		if (data.longestStreak > 0) {
			tiles.push({ value: `${data.longestStreak}j`, label: 'streak max' });
		} else if (data.topDaysOfWeek?.[0]) {
			tiles.push({ value: data.topDaysOfWeek[0], label: 'jour favori' });
		} else {
			tiles.push({ value: '—', label: 'streak max' });
		}

		// Meilleur mois
		if (data.bestMonth) {
			tiles.push({ value: this.formatKm(data.bestMonth.km), label: `km en ${data.bestMonth.label}` });
		} else {
			tiles.push({ value: '—', label: 'meilleur mois' });
		}

		// Régions complètes ou jour favori (en évitant de répéter le même jour que le slot streak)
		if (data.fullRegionCount > 0) {
			tiles.push({
				value: String(data.fullRegionCount),
				label: data.fullRegionCount === 1 ? 'région complète' : 'régions complètes',
			});
		} else {
			const dayIdx = streakSlotUsedDay ? 1 : 0;
			const fallbackDay = data.topDaysOfWeek?.[dayIdx];
			tiles.push({ value: fallbackDay ?? '—', label: 'jour favori' });
		}

		// Row 3 : records
		tiles.push({
			value: data.maxSpeedAllKmh && data.maxSpeedAllKmh > 0 ? `${data.maxSpeedAllKmh}` : '—',
			label: 'km/h max',
		});
		tiles.push({
			value: data.bestDayKm && data.bestDayKm > 0 ? this.formatKm(data.bestDayKm) : '—',
			label: 'km meilleur jour',
		});
		const rideHours = data.totalRidingHours ?? 0;
		let rideValue = '—';
		if (rideHours > 0) {
			if (rideHours >= 24) {
				const d = Math.floor(rideHours / 24);
				const h = rideHours % 24;
				rideValue = h > 0 ? `${d}j ${h}h` : `${d}j`;
			} else {
				rideValue = `${rideHours}h`;
			}
		}
		tiles.push({ value: rideValue, label: 'en moto' });

		return tiles;
	}

	private buildTripTiles(data: WrappedCardData): BentoTile[] {
		// Row 1 — toujours depuis l'API
		const tiles: BentoTile[] = [
			{ value: data.durationStr ?? '—', label: 'durée' },
			{ value: data.avgSpeedKmh != null ? `${data.avgSpeedKmh}` : '—', label: 'km/h moyen' },
			{ value: data.maxSpeedKmh != null ? `${data.maxSpeedKmh}` : '—', label: 'km/h max' },
		];

		const hasComputed = data.pauseCount != null;

		if (hasComputed) {
			// Rows 2 & 3 → toujours 6 tiles supplémentaires = 9 au total
			// Row 2 : stats de conduite (computed)
			tiles.push({
				value: data.maxAngle != null && data.maxAngle > 0 ? `${Math.round(data.maxAngle)}°` : '0°',
				label: 'inclinaison max',
			});
			tiles.push({ value: String(data.pauseCount), label: 'pauses' });
			tiles.push({
				value: data.pctInTurn != null ? `${Math.round(data.pctInTurn)}` : '0',
				label: '% en virage',
			});

			// Row 3 : vitesses virage + secours si pas de virages, date toujours en 9e
			const hasTurnSpeeds = data.avgSpeedInTurnsKmh != null;
			tiles.push({
				value: hasTurnSpeeds ? `${data.avgSpeedInTurnsKmh}` : data.altMax != null ? `${data.altMax}m` : '—',
				label: hasTurnSpeeds ? 'km/h moy virage' : 'altitude max',
			});
			const hasPauseTime = data.pauseTotalMin != null && data.pauseTotalMin > 0;
			tiles.push({
				value: hasTurnSpeeds
					? `${data.maxSpeedInTurnsKmh}`
					: hasPauseTime
						? this.formatMinutes(data.pauseTotalMin!)
						: (data.totalElapsedStr ?? '—'),
				label: hasTurnSpeeds ? 'km/h max virage' : hasPauseTime ? 'temps de pause' : 'durée totale',
			});
			// 9e tile : date du trajet — toujours
			tiles.push({
				value: data.tripDateLabel ?? '—',
				label: 'date du trajet',
			});
		} else {
			// Positions non chargées → row 2 avec angles API (6 tiles max)
			if (data.maxAngleFromApiDeg != null) {
				tiles.push({ value: `${data.maxAngleFromApiDeg}°`, label: 'inclinaison max' });
			}
			if (data.maxLeftAngleDeg != null) {
				tiles.push({ value: `${data.maxLeftAngleDeg}°`, label: 'virage gauche' });
			}
			if (data.maxRightAngleDeg != null) {
				tiles.push({ value: `${data.maxRightAngleDeg}°`, label: 'virage droit' });
			}
			// Date toujours présente
			if (data.tripDateLabel) {
				tiles.push({ value: data.tripDateLabel, label: 'date du trajet' });
			}
		}

		return tiles;
	}

	private formatMinutes(min: number): string {
		const h = Math.floor(min / 60);
		const m = Math.round(min % 60);
		return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
	}

	private renderBentoTile(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		tile: BentoTile,
		s: number,
		src: HTMLCanvasElement,
		outputSize: number,
		blurPx: number,
	): void {
		// Frosted glass
		this.drawFrostedGlass(ctx, x, y, w, h, 12 * s, src, outputSize, s, blurPx);

		ctx.strokeStyle = 'rgba(255,255,255,0.18)';
		ctx.lineWidth = 1 * s;
		this.roundRect(ctx, x, y, w, h, 12 * s);
		ctx.stroke();

		const cx = x + w / 2;

		ctx.font = `bold ${Math.round(22 * s)}px system-ui,sans-serif`;
		ctx.fillStyle = tile.accent ? '#b85c00' : 'rgba(0,0,0,0.85)';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(tile.value, cx, y + h * 0.38);

		ctx.font = `${Math.round(10 * s)}px system-ui,sans-serif`;
		ctx.fillStyle = 'rgba(0,0,0,0.45)';
		ctx.fillText(tile.label.toUpperCase(), cx, y + h * 0.7);

		ctx.textBaseline = 'alphabetic';
	}

	private formatKm(km: number): string {
		if (km >= 1000) {
			return `${(km / 1000).toFixed(1).replace('.', ',')}k`;
		}
		return String(km);
	}

	private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.lineTo(x + w - r, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + r);
		ctx.lineTo(x + w, y + h - r);
		ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
		ctx.lineTo(x + r, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - r);
		ctx.lineTo(x, y + r);
		ctx.quadraticCurveTo(x, y, x + r, y);
		ctx.closePath();
	}

	private async drawStatsOverlay(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		mapRect: DOMRect,
		stats: ScreenshotStats,
	): Promise<void> {
		const statsEl = document.querySelector<HTMLElement>('.stats-panel');
		if (!statsEl) return;

		const rect = statsEl.getBoundingClientRect();
		const xScale = w / mapRect.width;
		const yScale = h / mapRect.height;

		const valSize = 15,
			lblSize = 10,
			lineGap = 3,
			padX = 28,
			padY = 10,
			itemGap = 10;
		const mc = document.createElement('canvas').getContext('2d')!;
		mc.font = `bold ${valSize}px system-ui,sans-serif`;
		const valWidths = stats.items.map((i) => mc.measureText(i.value).width);
		mc.font = `${lblSize}px system-ui,sans-serif`;
		const lblWidths = stats.items.map((i) => mc.measureText(i.label).width);
		mc.font = `${valSize}px system-ui,sans-serif`;
		const sepW = mc.measureText('·').width;

		const itemWidths = stats.items.map((_, i) => Math.max(valWidths[i], lblWidths[i]));
		const svgW = itemWidths.reduce((a, b) => a + b, 0) + (stats.items.length - 1) * (itemGap * 2 + sepW) + padX * 2;
		const svgH = valSize + lineGap + lblSize + padY * 2;
		const radius = svgH / 2;

		let els = '';
		let x = padX;
		stats.items.forEach((item, i) => {
			const iw = itemWidths[i];
			const cx = x + iw / 2;
			els += `<text x="${cx}" y="${padY}" font-size="${valSize}" font-weight="bold" fill="#fdb300" text-anchor="middle" dominant-baseline="hanging" font-family="system-ui,sans-serif">${item.value}</text>`;
			els += `<text x="${cx}" y="${padY + valSize + lineGap}" font-size="${lblSize}" fill="rgba(255,255,255,0.55)" text-anchor="middle" dominant-baseline="hanging" font-family="system-ui,sans-serif">${item.label.toUpperCase()}</text>`;
			x += iw;
			if (i < stats.items.length - 1) {
				x += itemGap;
				els += `<text x="${x + sepW / 2}" y="${padY}" font-size="${valSize}" fill="rgba(255,255,255,0.2)" text-anchor="middle" dominant-baseline="hanging" font-family="system-ui,sans-serif">·</text>`;
				x += sepW + itemGap;
			}
		});

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}"><rect x="0.5" y="0.5" width="${svgW - 1}" height="${svgH - 1}" rx="${radius}" fill="rgba(0,0,0,0.65)" stroke="rgba(253,179,0,0.25)"/>${els}</svg>`;
		const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
		await new Promise<void>((resolve) => {
			const img = new Image();
			img.onload = () => {
				const canvasX = (w - svgW * xScale) / 2;
				const canvasY = h - (mapRect.bottom - rect.bottom) * yScale - svgH * yScale;
				ctx.drawImage(img, canvasX, canvasY, svgW * xScale, svgH * yScale);
				URL.revokeObjectURL(blobUrl);
				resolve();
			};
			img.src = blobUrl;
		});
	}
}
