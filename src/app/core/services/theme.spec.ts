import { TestBed } from '@angular/core/testing';
import { MAP_STYLES, Theme, ThemeService } from './theme';
import { provideSilentLogger } from '../../../test/helpers/providers';

const STORAGE_KEY = 'georide_theme';

describe('ThemeService', () => {
	// L'état initial dépend de localStorage : on injecte par test, après avoir préparé le storage
	function createService(): ThemeService {
		const service = TestBed.inject(ThemeService);
		// Zoneless : TestBed.tick() flushe l'effect() du constructeur
		TestBed.tick();
		return service;
	}

	beforeEach(() => {
		localStorage.clear();
		document.body.removeAttribute('data-theme');
		TestBed.configureTestingModule({ providers: [provideSilentLogger()] });
	});

	afterEach(() => {
		localStorage.clear();
		document.body.removeAttribute('data-theme');
	});

	describe('initial state', () => {
		it('defaults to light when localStorage is empty', () => {
			const service = createService();

			expect(service.theme()).toBe('light');
			expect(service.isDark()).toBe(false);
		});

		it('restores the theme persisted in localStorage', () => {
			localStorage.setItem(STORAGE_KEY, 'dark');

			const service = createService();

			expect(service.theme()).toBe('dark');
			expect(service.isDark()).toBe(true);
		});

		it('trusts any stored value without validating it against the Theme union', () => {
			// Comportement réel : la valeur est castée telle quelle, sans garde
			localStorage.setItem(STORAGE_KEY, 'neon');

			const service = createService();

			expect(service.theme()).toBe('neon' as Theme);
			expect(service.isDark()).toBe(false);
			expect(document.body.getAttribute('data-theme')).toBe('neon');
		});
	});

	describe('effect', () => {
		it('applies data-theme on body and persists the theme after the initial flush', () => {
			createService();

			expect(document.body.getAttribute('data-theme')).toBe('light');
			expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
		});
	});

	describe('toggle', () => {
		it('switches from light to dark and synchronizes body and localStorage', () => {
			const service = createService();

			service.toggle();

			expect(service.theme()).toBe('dark');
			expect(service.isDark()).toBe(true);

			TestBed.tick();
			expect(document.body.getAttribute('data-theme')).toBe('dark');
			expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
		});

		it('switches back from dark to light', () => {
			localStorage.setItem(STORAGE_KEY, 'dark');
			const service = createService();

			service.toggle();
			TestBed.tick();

			expect(service.theme()).toBe('light');
			expect(service.isDark()).toBe(false);
			expect(document.body.getAttribute('data-theme')).toBe('light');
			expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
		});

		it('returns to the initial theme after two toggles', () => {
			const service = createService();

			service.toggle();
			service.toggle();
			TestBed.tick();

			expect(service.theme()).toBe('light');
			expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
		});
	});

	describe('MAP_STYLES', () => {
		it('exposes a Carto style URL for each theme', () => {
			expect(MAP_STYLES.dark).toBe('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json');
			expect(MAP_STYLES.light).toBe('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json');
		});
	});
});
