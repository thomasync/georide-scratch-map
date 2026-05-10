import { Component, Input, Output, EventEmitter, signal, ViewChild, ElementRef } from '@angular/core';

export interface StatsModalData {
	homeCity: string | null;
	depts: {
		code: string;
		name: string;
		pct: number;
		trips: number;
		country: string;
		cities: { name: string; count: number; dates: string[] }[];
	}[];
}

@Component({
	selector: 'app-stats-modal',
	imports: [],
	templateUrl: './stats-modal.html',
	styleUrl: './stats-modal.scss',
})
export class StatsModalComponent {
	@Input() data: StatsModalData | null = null;
	@Output() close = new EventEmitter<void>();

	@ViewChild('modalBody') modalBody?: ElementRef<HTMLElement>;
	@ViewChild('promptTextarea') promptTextarea?: ElementRef<HTMLTextAreaElement>;

	showPrompt = signal(false);
	tripDuration = signal(4);
	setDuration(event: Event): void {
		this.tripDuration.set(+(event.target as HTMLInputElement).value);
	}
	tripMealBreaks(): number {
		const h = this.tripDuration();
		return h > 7 ? 2 : h > 4 ? 1 : 0;
	}
	tripStops(): number {
		const remaining = this.tripDuration() - this.tripMealBreaks();
		return Math.floor(remaining / (1 + 15 / 60));
	}
	tripKm(): number {
		const ridingTime = this.tripDuration() - this.tripMealBreaks() - this.tripStops() * (15 / 60);
		return Math.round(ridingTime * 60);
	}
	private expandedKey = signal<string | null>(null);

	private static countryNames = new Intl.DisplayNames(['fr'], { type: 'region' });

	deptsByCountry(): { countryCode: string; countryName: string; depts: StatsModalData['depts'] }[] {
		if (!this.data) return [];
		const groups = new Map<string, StatsModalData['depts']>();
		for (const dept of this.data.depts) {
			const c = dept.country ?? 'FR';
			if (!groups.has(c)) groups.set(c, []);
			groups.get(c)!.push(dept);
		}
		return [...groups.entries()].map(([code, depts]) => ({
			countryCode: code,
			countryName: StatsModalComponent.countryNames.of(code) ?? code,
			depts,
		}));
	}

	isVisible(deptCode: string, cityName: string): boolean {
		return this.expandedKey() === `${deptCode}-${cityName}`;
	}

	togglePrompt(): void {
		this.showPrompt.set(!this.showPrompt());
		if (this.showPrompt()) {
			setTimeout(() => {
				if (this.modalBody) this.modalBody.nativeElement.scrollTop = 0;
				if (this.promptTextarea) this.promptTextarea.nativeElement.select();
			}, 0);
		}
	}

	private currentSeason(): string {
		const m = new Date().getMonth() + 1;
		const d = new Date().getDate();
		if ((m === 3 && d >= 20) || m === 4 || m === 5 || (m === 6 && d < 21)) return 'printemps';
		if ((m === 6 && d >= 21) || m === 7 || m === 8 || (m === 9 && d < 23)) return 'été';
		if ((m === 9 && d >= 23) || m === 10 || m === 11 || (m === 12 && d < 21)) return 'automne';
		return 'hiver';
	}

	private rideCountries(): string {
		if (!this.data) return '';
		const pctByCountry: Record<string, number> = {};
		for (const dept of this.data.depts) {
			if (dept.pct < 10) continue;
			const c = dept.country ?? 'FR';
			pctByCountry[c] = (pctByCountry[c] ?? 0) + dept.pct;
		}
		return Object.entries(pctByCountry)
			.sort((a, b) => b[1] - a[1])
			.map(([code]) => StatsModalComponent.countryNames.of(code) ?? code)
			.join(' et ');
	}

	buildPrompt(): string {
		if (!this.data) return '';
		const countries = this.rideCountries();
		const lines: string[] = [];
		if (this.data.homeCity) {
			lines.push(
				`Je fais de la moto en ${countries}, je pars principalement de ${this.data.homeCity}. Nous sommes en ${this.currentSeason()}.`,
			);
			lines.push('');
		} else {
			lines.push(`Je fais de la moto en ${countries}. Nous sommes en ${this.currentSeason()}.`);
			lines.push('');
		}
		lines.push('Voici les villes et villages où je me suis arrêté (pas juste traversé) par département :');
		for (const dept of this.data.depts) {
			if (dept.cities.length === 0) continue;
			const cityList = dept.cities
				.filter((c) => c.name !== this.data!.homeCity)
				.map((c) => `${c.name} (${c.count} fois, dernière visite : ${c.dates[0]})`)
				.join(', ');
			if (!cityList) continue;
			lines.push(`${dept.name} (${dept.pct}%) : ${cityList}`);
		}
		lines.push('');
		const hours = this.tripDuration();
		const stops = this.tripStops();
		const mealBreaks = this.tripMealBreaks();
		const km = this.tripKm();
		const pauseDetail = [
			stops > 0 ? `${stops} pause${stops > 1 ? 's' : ''} courte${stops > 1 ? 's' : ''} de 15 min` : '',
			mealBreaks > 0 ? `${mealBreaks} pause${mealBreaks > 1 ? 's' : ''} repas d'1h` : '',
		]
			.filter(Boolean)
			.join(' et ');
		lines.push(
			`Propose-moi une belle boucle à faire en moto${this.data.homeCity ? ` depuis ${this.data.homeCity}` : ''} que je n'ai pas encore explorée, d'une durée totale d'environ ${hours}h (≈ ${km} km de route, avec ${pauseDetail}). Cols, routes panoramiques, villages pittoresques. Découpe la boucle en ${stops} étapes courtes et${mealBreaks > 0 ? ` ${mealBreaks} étape${mealBreaks > 1 ? 's' : ''} repas,` : ''} avec une pause à chaque étape. Génère une image de mise en page suivante : sur le côté gauche un aperçu visuel de la boucle complète (tracé de l'itinéraire sur fond de carte ou illustration), et sur le reste de l'image toutes les étapes affichées sous forme de vignettes avec pour chacune une photo emblématique du lieu, le nom du lieu, la distance depuis l'étape précédente en km et la durée de route. Ambiance ${this.currentSeason()}, style photographique, lumière naturelle.`,
		);
		return lines.join('\n');
	}

	toggleCity(deptCode: string, cityName: string): void {
		const key = `${deptCode}-${cityName}`;
		this.expandedKey.set(this.expandedKey() === key ? null : key);
	}
}
