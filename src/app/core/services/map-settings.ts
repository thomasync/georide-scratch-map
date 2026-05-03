import { Injectable, signal, effect, isDevMode } from '@angular/core';

export interface MapSettings {
	fitToVisitedMaxZoom: number;
	fitDeptMaxZoom: number;
	minZoomDesk: number;
	minZoomMob: number;
	maxZoom: number;
	deptModeZoomThresholdDesk: number;
	deptModeZoomThresholdMob: number;
	deptFocusExitDelta: number;
	polylineModeZoomThresholdDesk: number;
	polylineModeZoomThresholdMob: number;
	deptResolution: number; // H3Resolution is 0-15
	cityLabelsFadeStart: number;
	cityLabelsFadeEnd: number;
	doubleTapDelay: number;
	deptMaskOpacityDefault: number;
	deptMaskOpacityScreenshot: number;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
	fitToVisitedMaxZoom: 8,
	fitDeptMaxZoom: 10,
	minZoomDesk: 6,
	minZoomMob: 5,
	maxZoom: 20,
	deptModeZoomThresholdDesk: 7.5,
	deptModeZoomThresholdMob: 6.8,
	deptFocusExitDelta: 0.5,
	polylineModeZoomThresholdDesk: 13,
	polylineModeZoomThresholdMob: 12,
	deptResolution: 6,
	cityLabelsFadeStart: 6.5,
	cityLabelsFadeEnd: 7.0,
	doubleTapDelay: 350,
	deptMaskOpacityDefault: 0.2,
	deptMaskOpacityScreenshot: 0.07,
};

@Injectable({
	providedIn: 'root',
})
export class MapSettingsService {
	private readonly STORAGE_KEY = 'georide_map_settings';

	// Define signals for each setting
	readonly minZoomDesk = signal(DEFAULT_MAP_SETTINGS.minZoomDesk);
	readonly minZoomMob = signal(DEFAULT_MAP_SETTINGS.minZoomMob);
	readonly maxZoom = signal(DEFAULT_MAP_SETTINGS.maxZoom);

	readonly fitToVisitedMaxZoom = signal(DEFAULT_MAP_SETTINGS.fitToVisitedMaxZoom);
	readonly fitDeptMaxZoom = signal(DEFAULT_MAP_SETTINGS.fitDeptMaxZoom);

	readonly deptModeZoomThresholdDesk = signal(DEFAULT_MAP_SETTINGS.deptModeZoomThresholdDesk);
	readonly deptModeZoomThresholdMob = signal(DEFAULT_MAP_SETTINGS.deptModeZoomThresholdMob);
	readonly deptFocusExitDelta = signal(DEFAULT_MAP_SETTINGS.deptFocusExitDelta);
	readonly polylineModeZoomThresholdDesk = signal(DEFAULT_MAP_SETTINGS.polylineModeZoomThresholdDesk);
	readonly polylineModeZoomThresholdMob = signal(DEFAULT_MAP_SETTINGS.polylineModeZoomThresholdMob);
	readonly deptResolution = signal(DEFAULT_MAP_SETTINGS.deptResolution);
	readonly cityLabelsFadeStart = signal(DEFAULT_MAP_SETTINGS.cityLabelsFadeStart);
	readonly cityLabelsFadeEnd = signal(DEFAULT_MAP_SETTINGS.cityLabelsFadeEnd);
	readonly doubleTapDelay = signal(DEFAULT_MAP_SETTINGS.doubleTapDelay);
	readonly deptMaskOpacityDefault = signal(DEFAULT_MAP_SETTINGS.deptMaskOpacityDefault);
	readonly deptMaskOpacityScreenshot = signal(DEFAULT_MAP_SETTINGS.deptMaskOpacityScreenshot);

	constructor() {
		this.loadSettings();

		// Auto-save to localStorage when any setting changes (only in dev mode to avoid overhead in prod)
		if (isDevMode()) {
			effect(() => {
				const settings: MapSettings = {
					fitToVisitedMaxZoom: this.fitToVisitedMaxZoom(),
					fitDeptMaxZoom: this.fitDeptMaxZoom(),
					minZoomDesk: this.minZoomDesk(),
					minZoomMob: this.minZoomMob(),
					maxZoom: this.maxZoom(),
					deptModeZoomThresholdDesk: this.deptModeZoomThresholdDesk(),
					deptModeZoomThresholdMob: this.deptModeZoomThresholdMob(),
					deptFocusExitDelta: this.deptFocusExitDelta(),
					polylineModeZoomThresholdDesk: this.polylineModeZoomThresholdDesk(),
					polylineModeZoomThresholdMob: this.polylineModeZoomThresholdMob(),
					deptResolution: this.deptResolution(),
					cityLabelsFadeStart: this.cityLabelsFadeStart(),
					cityLabelsFadeEnd: this.cityLabelsFadeEnd(),
					doubleTapDelay: this.doubleTapDelay(),
					deptMaskOpacityDefault: this.deptMaskOpacityDefault(),
					deptMaskOpacityScreenshot: this.deptMaskOpacityScreenshot(),
				};
				localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
			});
		}
	}

	private loadSettings(): void {
		if (!isDevMode()) return; // Don't load overrides in prod
		try {
			const stored = localStorage.getItem(this.STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored) as Partial<MapSettings>;
				if (parsed.minZoomDesk !== undefined) this.minZoomDesk.set(parsed.minZoomDesk);
				if (parsed.minZoomMob !== undefined) this.minZoomMob.set(parsed.minZoomMob);
				if (parsed.maxZoom !== undefined) this.maxZoom.set(parsed.maxZoom);
				if (parsed.fitToVisitedMaxZoom !== undefined) this.fitToVisitedMaxZoom.set(parsed.fitToVisitedMaxZoom);
				if (parsed.fitDeptMaxZoom !== undefined) this.fitDeptMaxZoom.set(parsed.fitDeptMaxZoom);
				if (parsed.deptModeZoomThresholdDesk !== undefined)
					this.deptModeZoomThresholdDesk.set(parsed.deptModeZoomThresholdDesk);
				if (parsed.deptModeZoomThresholdMob !== undefined)
					this.deptModeZoomThresholdMob.set(parsed.deptModeZoomThresholdMob);
				if (parsed.deptFocusExitDelta !== undefined) this.deptFocusExitDelta.set(parsed.deptFocusExitDelta);
				if (parsed.polylineModeZoomThresholdDesk !== undefined)
					this.polylineModeZoomThresholdDesk.set(parsed.polylineModeZoomThresholdDesk);
				if (parsed.polylineModeZoomThresholdMob !== undefined)
					this.polylineModeZoomThresholdMob.set(parsed.polylineModeZoomThresholdMob);
				if (parsed.deptResolution !== undefined) this.deptResolution.set(parsed.deptResolution);
				if (parsed.cityLabelsFadeStart !== undefined) this.cityLabelsFadeStart.set(parsed.cityLabelsFadeStart);
				if (parsed.cityLabelsFadeEnd !== undefined) this.cityLabelsFadeEnd.set(parsed.cityLabelsFadeEnd);
				if (parsed.doubleTapDelay !== undefined) this.doubleTapDelay.set(parsed.doubleTapDelay);
				if (parsed.deptMaskOpacityDefault !== undefined)
					this.deptMaskOpacityDefault.set(parsed.deptMaskOpacityDefault);
				if (parsed.deptMaskOpacityScreenshot !== undefined)
					this.deptMaskOpacityScreenshot.set(parsed.deptMaskOpacityScreenshot);
			}
		} catch (e) {
			console.error('Failed to load map settings', e);
		}
	}

	updateSetting<K extends keyof MapSettings>(key: K, value: MapSettings[K]): void {
		// Use type assertion because TypeScript can't match K perfectly with signal property name
		(this as any)[key].set(value);
	}

	resetSetting<K extends keyof MapSettings>(key: K): void {
		this.updateSetting(key, DEFAULT_MAP_SETTINGS[key]);
	}

	resetAll(): void {
		Object.keys(DEFAULT_MAP_SETTINGS).forEach((key) => {
			this.resetSetting(key as keyof MapSettings);
		});
	}
}
