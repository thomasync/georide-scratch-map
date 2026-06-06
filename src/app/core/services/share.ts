import { Injectable } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { cellToLatLng } from 'h3-js';

export interface ShareDeptPayload {
	depts: Array<[string, number, string]>;
}

export interface ShareHexPayload {
	res: 6 | 7;
	cells: string[];
	compact?: true;
	counts?: number[]; // parallel à cells, valeurs 1-3 ; absent = tout à 1
}

export interface ShareStats {
	t: number; // trips
	k: number; // km
	c?: number; // countries
	ci?: number; // cities
	r?: number; // regions
}

export type ShareData =
	| { v: 1; mode: 'dept'; dept: ShareDeptPayload; stats?: ShareStats; ts?: number }
	| { v: 1; mode: 'hex'; hex: ShareHexPayload; stats?: ShareStats; ts?: number };

export interface NeighboringCountryBounds {
	code: string;
	minLat: number;
	maxLat: number;
	minLon: number;
	maxLon: number;
}

@Injectable({ providedIn: 'root' })
export class ShareService {
	async encode(data: ShareData): Promise<string> {
		const json = JSON.stringify(data);
		const bytes = await this.compress(json);
		return this.toBase64url(bytes);
	}

	async decode(encoded: string): Promise<ShareData> {
		const bytes = this.fromBase64url(encoded);
		const json = await this.decompress(bytes);
		return JSON.parse(json) as ShareData;
	}

	async encodedLength(data: ShareData): Promise<number> {
		return (await this.encode(data)).length;
	}

	buildDeptPayload(enrichedDepts: GeoJSON.FeatureCollection): ShareDeptPayload {
		const depts: Array<[string, number, string]> = [];
		for (const f of enrichedDepts.features) {
			const pct = (f.properties?.['pct'] as number) ?? 0;
			if (pct <= 0) continue;
			const code = (f.properties?.['code'] as string) ?? '';
			const country = (f.properties?.['country'] as string) ?? 'FR';
			depts.push([code, Math.round(pct), country]);
		}
		return { depts };
	}

	buildHexPayload(counts: Record<string, number>, res: 6 | 7): ShareHexPayload {
		const cells = Object.keys(counts);
		const countValues = cells.map((c) => Math.min(3, Math.max(1, counts[c])));
		const allOnes = countValues.every((v) => v === 1);
		return allOnes ? { res, cells } : { res, cells, counts: countValues };
	}

	filterCellsByBounds(counts: Record<string, number>, bounds: maplibregl.LngLatBounds): Record<string, number> {
		const filtered: Record<string, number> = {};
		for (const cell of Object.keys(counts)) {
			const [lat, lng] = cellToLatLng(cell);
			if (bounds.contains([lng, lat])) {
				filtered[cell] = counts[cell];
			}
		}
		return filtered;
	}

	filterCellsByCountry(counts: Record<string, number>, country: NeighboringCountryBounds): Record<string, number> {
		const filtered: Record<string, number> = {};
		for (const cell of Object.keys(counts)) {
			const [lat, lng] = cellToLatLng(cell);
			if (lat >= country.minLat && lat <= country.maxLat && lng >= country.minLon && lng <= country.maxLon) {
				filtered[cell] = counts[cell];
			}
		}
		return filtered;
	}

	private async compress(input: string): Promise<Uint8Array> {
		const stream = new CompressionStream('deflate-raw');
		const writer = stream.writable.getWriter();
		const encoded = new TextEncoder().encode(input);
		writer.write(encoded.buffer.slice(0) as ArrayBuffer);
		writer.close();
		const chunks: Uint8Array[] = [];
		const reader = stream.readable.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			if (value) chunks.push(value);
		}
		const total = chunks.reduce((n, c) => n + c.length, 0);
		const result = new Uint8Array(total);
		let offset = 0;
		for (const c of chunks) {
			result.set(c, offset);
			offset += c.length;
		}
		return result;
	}

	private async decompress(bytes: Uint8Array): Promise<string> {
		const stream = new DecompressionStream('deflate-raw');
		const writer = stream.writable.getWriter();
		writer.write(bytes.buffer.slice(0) as ArrayBuffer);
		writer.close();
		const chunks: Uint8Array[] = [];
		const reader = stream.readable.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			if (value) chunks.push(value);
		}
		const total = chunks.reduce((n, c) => n + c.length, 0);
		const result = new Uint8Array(total);
		let offset = 0;
		for (const c of chunks) {
			result.set(c, offset);
			offset += c.length;
		}
		return new TextDecoder().decode(result);
	}

	private toBase64url(bytes: Uint8Array): string {
		let binary = '';
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
	}

	private fromBase64url(str: string): Uint8Array {
		const padded = str.replace(/-/g, '+').replace(/_/g, '/');
		const pad = (4 - (padded.length % 4)) % 4;
		const base64 = padded + '='.repeat(pad);
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}
}
