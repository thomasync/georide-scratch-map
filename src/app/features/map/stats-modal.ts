import { Component, Input, Output, EventEmitter, signal, ViewChild, ElementRef } from '@angular/core';

export interface StatsModalData {
	homeCity: string | null;
	depts: {
		code: string;
		name: string;
		pct: number;
		trips: number;
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
	private expandedKey = signal<string | null>(null);

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

	buildPrompt(): string {
		if (!this.data) return '';
		const lines: string[] = [];
		if (this.data.homeCity) {
			lines.push(
				`Je fais de la moto en France, je pars principalement de ${this.data.homeCity}. Nous sommes en ${this.currentSeason()}.`,
			);
			lines.push('');
		} else {
			lines.push(`Je fais de la moto en France. Nous sommes en ${this.currentSeason()}.`);
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
		lines.push(
			`Propose-moi des endroits beaux à découvrir ou des routes à faire en moto${this.data.homeCity ? ` depuis ${this.data.homeCity}` : ''}. Cols, routes panoramiques, villages pittoresques que je n'ai pas encore explorés.`,
		);
		return lines.join('\n');
	}

	toggleCity(deptCode: string, cityName: string): void {
		const key = `${deptCode}-${cityName}`;
		this.expandedKey.set(this.expandedKey() === key ? null : key);
	}
}
