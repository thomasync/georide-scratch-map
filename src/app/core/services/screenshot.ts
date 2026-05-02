import { Injectable } from '@angular/core';
import maplibregl from 'maplibre-gl';

export interface ScreenshotStats {
	items: { value: string; label: string }[];
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

		const valSize = 20,
			lblSize = 13,
			lineGap = 5,
			padX = 41,
			padY = 14,
			itemGap = 14;
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
