import { inject, Injectable } from '@angular/core';
import { LoggerService } from './logger';

@Injectable({
	providedIn: 'root',
})
export class PolylineService {
	private logger = inject(LoggerService);

	decode(encoded: string): [number, number][] {
		const result: [number, number][] = [];
		let index = 0;
		let lat = 0;
		let lon = 0;

		while (index < encoded.length) {
			lat += this.decodeValue(encoded, index);
			index += this.chunkSize(encoded, index);
			lon += this.decodeValue(encoded, index);
			index += this.chunkSize(encoded, index);
			result.push([lat / 1e5, lon / 1e5]);
		}

		return result;
	}

	extractFromStaticImage(staticImageUrl: string): [number, number][] {
		const match = staticImageUrl.match(/path-[^(]+\(([^)]+)\)/);
		if (!match) {
			this.logger.warn('Polyline', 'no polyline found in staticImage URL');
			return [];
		}
		const encoded = decodeURIComponent(match[1]);
		return this.decode(encoded);
	}

	private decodeValue(encoded: string, startIndex: number): number {
		let shift = 0;
		let result = 0;
		let index = startIndex;

		let byte: number;
		do {
			byte = encoded.charCodeAt(index++) - 63;
			result |= (byte & 0x1f) << shift;
			shift += 5;
		} while (byte >= 0x20);

		return result & 1 ? ~(result >> 1) : result >> 1;
	}

	private chunkSize(encoded: string, startIndex: number): number {
		let size = 0;
		let byte: number;
		do {
			byte = encoded.charCodeAt(startIndex + size) - 63;
			size++;
		} while (byte >= 0x20);
		return size;
	}
}
