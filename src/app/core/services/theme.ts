import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { LoggerService } from './logger';

export type Theme = 'dark' | 'light';

export const MAP_STYLES: Record<Theme, string> = {
	dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
	light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

const STORAGE_KEY = 'georide_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
	private logger = inject(LoggerService);

	theme = signal<Theme>((localStorage.getItem(STORAGE_KEY) as Theme) ?? 'light');
	isDark = computed(() => this.theme() === 'dark');

	constructor() {
		effect(() => {
			const t = this.theme();
			document.body.setAttribute('data-theme', t);
			localStorage.setItem(STORAGE_KEY, t);
			this.logger.log('ThemeService', 'theme changed to', t);
		});
	}

	toggle(): void {
		this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
	}
}
