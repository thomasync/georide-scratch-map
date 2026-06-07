import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DatabaseService } from './database';

const FUEL_IDS: Record<string, number> = { SP98: 6, SP95: 2, E10: 5 };
const API_BASE = 'https://api.prix-carburants.2aaz.fr';
const KV_PREFIX = 'fuel_price_';

@Injectable({ providedIn: 'root' })
export class FuelService {
	constructor(private db: DatabaseService) {}

	async getPrice(fuelType: string, month: string): Promise<number | null> {
		const currentMonth = new Date().toISOString().substring(0, 7);
		if (month >= currentMonth) return null;
		const key = `${KV_PREFIX}${fuelType}_${month}`;
		// Vérifier le cache dans le store fuels (TTL éternel pour les mois passés)
		const cached = await firstValueFrom(this.db.fuelGet(key));
		if (cached !== null) return cached;
		const fid = FUEL_IDS[fuelType];
		if (!fid) return null;
		try {
			const res = await fetch(`${API_BASE}/fuel/${fid}/price/${month}`);
			if (!res.ok) return null;
			const data = await res.json();
			const price: number | undefined = data?.PriceTTC?.value;
			if (typeof price !== 'number') return null;
			await firstValueFrom(this.db.fuelSet(key, price));
			return price;
		} catch {
			return null;
		}
	}

	async getPriceOrNearest(fuelType: string, month: string, availableMonths: string[]): Promise<number | null> {
		const price = await this.getPrice(fuelType, month);
		if (price !== null) return price;
		const sorted = [...availableMonths].filter((m) => m <= month).sort((a, b) => b.localeCompare(a));
		for (const m of sorted) {
			const p = await this.getPrice(fuelType, m);
			if (p !== null) return p;
		}
		return null;
	}

	async getMonthlyPrices(fuelType: string, months: string[]): Promise<Record<string, number | null>> {
		const results = await Promise.all(
			months.map((m) => this.getPrice(fuelType, m).then((p) => [m, p] as [string, number | null])),
		);
		return Object.fromEntries(results);
	}

	async loadCachedMonths(fuelType: string): Promise<string[]> {
		const now = new Date();
		const months: string[] = [];
		for (let i = 1; i <= 24; i++) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			const cached = await firstValueFrom(this.db.fuelGet(`${KV_PREFIX}${fuelType}_${m}`));
			if (cached !== null) months.push(m);
		}
		return months;
	}

	async getPrefs(): Promise<{ fuelType: string; tankSize: number }> {
		const [ft, ts] = await Promise.all([
			firstValueFrom(this.db.kvGet<string>('pref_fuelType')),
			firstValueFrom(this.db.kvGet<number>('pref_tankSize')),
		]);
		return {
			fuelType: ft ?? 'SP98',
			tankSize: ts ?? 15,
		};
	}

	async savePrefs(fuelType: string, tankSize: number): Promise<void> {
		await Promise.all([
			firstValueFrom(this.db.kvSet('pref_fuelType', fuelType)),
			firstValueFrom(this.db.kvSet('pref_tankSize', tankSize)),
		]);
	}
}
