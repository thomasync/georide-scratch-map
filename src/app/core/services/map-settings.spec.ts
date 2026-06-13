import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DEFAULT_MAP_SETTINGS, MapSettings, MapSettingsService } from './map-settings';
import {
	createDatabaseServiceMock,
	provideDatabaseServiceMock,
	DatabaseServiceMock,
} from '../../../test/helpers/providers';

const STORAGE_KEY = 'map_settings';
const SETTING_KEYS = Object.keys(DEFAULT_MAP_SETTINGS) as (keyof MapSettings)[];

// Les noms des signaux du service correspondent exactement aux clés de MapSettings
function readSignal(service: MapSettingsService, key: keyof MapSettings): number {
	return service[key]();
}

function snapshot(overrides: Partial<MapSettings> = {}): MapSettings {
	return { ...DEFAULT_MAP_SETTINGS, ...overrides };
}

describe('MapSettingsService', () => {
	let dbMock: DatabaseServiceMock;

	// Le constructeur lit l'IDB : le retour de kvGet doit être configuré AVANT l'injection
	function createService(stored: Partial<MapSettings> | null = null): MapSettingsService {
		dbMock.kvGet.mockReturnValue(of(stored));
		return TestBed.inject(MapSettingsService);
	}

	beforeEach(() => {
		dbMock = createDatabaseServiceMock();
		TestBed.configureTestingModule({ providers: [provideDatabaseServiceMock(dbMock)] });
	});

	describe('default values', () => {
		it('exposes one signal per MapSettings key, initialized to DEFAULT_MAP_SETTINGS', () => {
			const service = createService();

			for (const key of SETTING_KEYS) {
				expect(readSignal(service, key)).toBe(DEFAULT_MAP_SETTINGS[key]);
			}
		});

		it('keeps the defaults when nothing is stored in IDB', () => {
			const service = createService(null);

			expect(service.maxZoom()).toBe(20);
			expect(service.minZoomDesk()).toBe(6);
			expect(service.minZoomMob()).toBe(5);
			expect(service.deptResolution()).toBe(6);
			expect(service.doubleTapDelay()).toBe(350);
		});
	});

	describe('loadSettings', () => {
		it('reads the map_settings key from the database at construction', () => {
			createService();

			expect(dbMock.kvGet).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY);
		});

		it('applies every stored value when the full settings object is present', () => {
			const stored: MapSettings = {
				fitToVisitedMaxZoom: 1,
				fitDeptMaxZoom: 2,
				minZoomDesk: 3,
				minZoomMob: 4,
				maxZoom: 5,
				deptModeZoomThresholdDesk: 6,
				deptModeZoomThresholdMob: 7,
				deptFocusExitDelta: 8,
				polylineModeZoomThresholdDesk: 9,
				polylineModeZoomThresholdMob: 10,
				deptResolution: 11,
				cityLabelsFadeStart: 12,
				cityLabelsFadeEnd: 13,
				doubleTapDelay: 14,
				deptMaskOpacityDefault: 15,
				deptMaskOpacityScreenshot: 16,
			};

			const service = createService(stored);

			for (const key of SETTING_KEYS) {
				expect(readSignal(service, key)).toBe(stored[key]);
			}
		});

		it('only overrides the keys present in IDB on a partial load', () => {
			const service = createService({ maxZoom: 12, deptResolution: 9 });

			expect(service.maxZoom()).toBe(12);
			expect(service.deptResolution()).toBe(9);
			// Toutes les autres clés gardent leur valeur par défaut
			for (const key of SETTING_KEYS) {
				if (key === 'maxZoom' || key === 'deptResolution') continue;
				expect(readSignal(service, key)).toBe(DEFAULT_MAP_SETTINGS[key]);
			}
		});

		it('applies stored values that are falsy but defined (0)', () => {
			const service = createService({ doubleTapDelay: 0, deptMaskOpacityDefault: 0 });

			expect(service.doubleTapDelay()).toBe(0);
			expect(service.deptMaskOpacityDefault()).toBe(0);
		});

		it('ignores an empty stored object and keeps the defaults', () => {
			const service = createService({});

			for (const key of SETTING_KEYS) {
				expect(readSignal(service, key)).toBe(DEFAULT_MAP_SETTINGS[key]);
			}
		});
	});

	describe('auto-save effect (dev mode)', () => {
		it('does not persist synchronously at construction', () => {
			createService();

			expect(dbMock.kvSet).not.toHaveBeenCalled();
		});

		it('persists the full settings snapshot once the effect is flushed', () => {
			createService();

			// Zoneless : TestBed.tick() flushe l'effect() du constructeur
			TestBed.tick();

			expect(dbMock.kvSet).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY, snapshot());
		});

		it('includes the values loaded from IDB in the first persisted snapshot', () => {
			createService({ maxZoom: 14, cityLabelsFadeStart: 5.5 });

			TestBed.tick();

			expect(dbMock.kvSet).toHaveBeenCalledExactlyOnceWith(
				STORAGE_KEY,
				snapshot({ maxZoom: 14, cityLabelsFadeStart: 5.5 }),
			);
		});

		it('persists again after a setting changes', () => {
			const service = createService();
			TestBed.tick();

			service.updateSetting('maxZoom', 15);
			TestBed.tick();

			expect(dbMock.kvSet).toHaveBeenCalledTimes(2);
			expect(dbMock.kvSet).toHaveBeenLastCalledWith(STORAGE_KEY, snapshot({ maxZoom: 15 }));
		});

		it('does not persist when a setting is set to its current value', () => {
			const service = createService();
			TestBed.tick();

			// Égalité Object.is : le signal ne notifie pas, l'effect n'est pas re-planifié
			service.updateSetting('maxZoom', DEFAULT_MAP_SETTINGS.maxZoom);
			TestBed.tick();

			expect(dbMock.kvSet).toHaveBeenCalledTimes(1);
		});

		it('coalesces multiple changes into a single persistence per flush', () => {
			const service = createService();
			TestBed.tick();

			service.updateSetting('minZoomDesk', 1);
			service.updateSetting('minZoomMob', 2);
			service.updateSetting('maxZoom', 18);
			TestBed.tick();

			expect(dbMock.kvSet).toHaveBeenCalledTimes(2);
			expect(dbMock.kvSet).toHaveBeenLastCalledWith(
				STORAGE_KEY,
				snapshot({ minZoomDesk: 1, minZoomMob: 2, maxZoom: 18 }),
			);
		});
	});

	describe('updateSetting', () => {
		it('updates the matching signal for every MapSettings key', () => {
			const service = createService();

			for (const key of SETTING_KEYS) {
				const newValue = DEFAULT_MAP_SETTINGS[key] + 1;
				service.updateSetting(key, newValue);
				expect(readSignal(service, key)).toBe(newValue);
			}
		});

		it('does not touch the other signals', () => {
			const service = createService();

			service.updateSetting('deptFocusExitDelta', 2.5);

			expect(service.deptFocusExitDelta()).toBe(2.5);
			for (const key of SETTING_KEYS) {
				if (key === 'deptFocusExitDelta') continue;
				expect(readSignal(service, key)).toBe(DEFAULT_MAP_SETTINGS[key]);
			}
		});
	});

	describe('resetSetting', () => {
		it('restores a modified setting to its default value', () => {
			const service = createService();
			service.updateSetting('maxZoom', 99);

			service.resetSetting('maxZoom');

			expect(service.maxZoom()).toBe(DEFAULT_MAP_SETTINGS.maxZoom);
		});

		it('restores a value loaded from IDB to its default, not the stored one', () => {
			const service = createService({ deptResolution: 12 });
			expect(service.deptResolution()).toBe(12);

			service.resetSetting('deptResolution');

			expect(service.deptResolution()).toBe(DEFAULT_MAP_SETTINGS.deptResolution);
		});

		it('leaves the other settings untouched', () => {
			const service = createService();
			service.updateSetting('maxZoom', 99);
			service.updateSetting('minZoomDesk', 2);

			service.resetSetting('maxZoom');

			expect(service.minZoomDesk()).toBe(2);
		});

		it('persists the reset through the auto-save effect', () => {
			const service = createService();
			service.updateSetting('maxZoom', 99);
			TestBed.tick();

			service.resetSetting('maxZoom');
			TestBed.tick();

			expect(dbMock.kvSet).toHaveBeenLastCalledWith(STORAGE_KEY, snapshot());
		});
	});

	describe('resetAll', () => {
		it('restores every setting to its default value', () => {
			const service = createService();
			for (const key of SETTING_KEYS) {
				service.updateSetting(key, DEFAULT_MAP_SETTINGS[key] + 10);
			}

			service.resetAll();

			for (const key of SETTING_KEYS) {
				expect(readSignal(service, key)).toBe(DEFAULT_MAP_SETTINGS[key]);
			}
		});

		it('also wipes the values that were loaded from IDB', () => {
			const service = createService({ maxZoom: 17, doubleTapDelay: 500 });

			service.resetAll();

			expect(service.maxZoom()).toBe(DEFAULT_MAP_SETTINGS.maxZoom);
			expect(service.doubleTapDelay()).toBe(DEFAULT_MAP_SETTINGS.doubleTapDelay);
		});

		it('persists the defaults once after the flush', () => {
			const service = createService();
			for (const key of SETTING_KEYS) {
				service.updateSetting(key, DEFAULT_MAP_SETTINGS[key] + 10);
			}
			TestBed.tick();
			const callsBefore = dbMock.kvSet.mock.calls.length;

			service.resetAll();
			TestBed.tick();

			expect(dbMock.kvSet).toHaveBeenCalledTimes(callsBefore + 1);
			expect(dbMock.kvSet).toHaveBeenLastCalledWith(STORAGE_KEY, snapshot());
		});

		it('is a no-op for the signals when everything is already at default', () => {
			const service = createService();

			service.resetAll();

			for (const key of SETTING_KEYS) {
				expect(readSignal(service, key)).toBe(DEFAULT_MAP_SETTINGS[key]);
			}
		});
	});
});
