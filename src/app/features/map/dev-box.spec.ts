import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { of } from 'rxjs';
import { DevBoxComponent } from './dev-box';
import { MapSettingsService, DEFAULT_MAP_SETTINGS, MapSettings } from '../../core/services/map-settings';
import {
	createDatabaseServiceMock,
	provideDatabaseServiceMock,
	provideSilentLogger,
	DatabaseServiceMock,
} from '../../../test/helpers/providers';

const EXPANDED_KEY = 'dev_box_expanded';

describe('DevBoxComponent', () => {
	let dbMock: DatabaseServiceMock;

	// Le constructeur du composant lit kvGet('dev_box_expanded') et MapSettingsService lit
	// kvGet('map_settings'). On configure le retour AVANT createComponent.
	function setupExpanded(stored: boolean | null): void {
		dbMock.kvGet.mockImplementation((key: string) => {
			if (key === EXPANDED_KEY) return of(stored);
			return of(null);
		});
	}

	function create(): {
		fixture: ComponentFixture<DevBoxComponent>;
		cmp: DevBoxComponent;
	} {
		const fixture = TestBed.createComponent(DevBoxComponent);
		const cmp = fixture.componentInstance;
		fixture.detectChanges();
		return { fixture, cmp };
	}

	beforeEach(() => {
		dbMock = createDatabaseServiceMock();
		setupExpanded(null);
		TestBed.configureTestingModule({
			imports: [DevBoxComponent],
			providers: [MapSettingsService, provideDatabaseServiceMock(dbMock), provideSilentLogger()],
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('construction', () => {
		it('creates the component', () => {
			const { cmp } = create();

			expect(cmp).toBeTruthy();
		});

		it('reads the dev_box_expanded key from the database at construction', () => {
			create();

			expect(dbMock.kvGet).toHaveBeenCalledWith(EXPANDED_KEY);
		});

		it('defaults isExpanded to false when nothing is stored', () => {
			setupExpanded(null);

			const { cmp } = create();

			expect(cmp.isExpanded).toBe(false);
		});

		it('restores isExpanded to true from a stored value', () => {
			setupExpanded(true);

			const { cmp } = create();

			expect(cmp.isExpanded).toBe(true);
		});

		it('restores isExpanded to false from a stored false value', () => {
			setupExpanded(false);

			const { cmp } = create();

			expect(cmp.isExpanded).toBe(false);
		});

		it('does not persist the expanded state at construction', () => {
			create();

			expect(dbMock.kvSet).not.toHaveBeenCalledWith(EXPANDED_KEY, expect.anything());
		});
	});

	describe('toggleExpand', () => {
		it('flips isExpanded from false to true', () => {
			const { cmp } = create();
			expect(cmp.isExpanded).toBe(false);

			cmp.toggleExpand();

			expect(cmp.isExpanded).toBe(true);
		});

		it('flips isExpanded from true back to false', () => {
			const { cmp } = create();

			cmp.toggleExpand();
			cmp.toggleExpand();

			expect(cmp.isExpanded).toBe(false);
		});

		it('persists the new expanded state through kvSet', () => {
			const { cmp } = create();

			cmp.toggleExpand();

			expect(dbMock.kvSet).toHaveBeenCalledWith(EXPANDED_KEY, true);
		});

		it('persists the collapsed state when toggled off again', () => {
			const { cmp } = create();

			cmp.toggleExpand();
			cmp.toggleExpand();

			expect(dbMock.kvSet).toHaveBeenLastCalledWith(EXPANDED_KEY, false);
		});

		it('is triggered when the toggle button is clicked', async () => {
			const { fixture, cmp } = create();
			const toggleBtn = fixture.nativeElement.querySelector('.toggle-btn') as HTMLButtonElement;

			toggleBtn.click();
			await fixture.whenStable();

			expect(cmp.isExpanded).toBe(true);
			expect(dbMock.kvSet).toHaveBeenCalledWith(EXPANDED_KEY, true);
		});
	});

	describe('rendering', () => {
		it('hides the content and actions when collapsed', () => {
			setupExpanded(false);

			const { fixture } = create();

			expect(fixture.nativeElement.querySelector('.dev-box-content')).toBeNull();
			expect(fixture.nativeElement.querySelector('.dev-box-actions')).toBeNull();
		});

		it('shows the content and one slider per control when expanded', () => {
			setupExpanded(true);

			const { fixture, cmp } = create();

			expect(fixture.nativeElement.querySelector('.dev-box-content')).not.toBeNull();
			const sliders = fixture.nativeElement.querySelectorAll('.slider-group');
			expect(sliders.length).toBe(cmp.controls.length);
		});

		it('renders the simulate button only when expanded', () => {
			setupExpanded(true);

			const { fixture } = create();

			expect(fixture.nativeElement.querySelector('.btn-debug')).not.toBeNull();
		});

		it('applies the collapsed class when not expanded', () => {
			setupExpanded(false);

			const { fixture } = create();

			expect(fixture.nativeElement.querySelector('.dev-box')?.classList.contains('collapsed')).toBe(true);
		});
	});

	describe('getValue', () => {
		it('reads the current value from the matching MapSettings signal', () => {
			const { cmp } = create();

			expect(cmp.getValue('maxZoom')).toBe(DEFAULT_MAP_SETTINGS.maxZoom);
			expect(cmp.getValue('deptResolution')).toBe(DEFAULT_MAP_SETTINGS.deptResolution);
		});

		it('reflects a value updated through the service', () => {
			const { cmp } = create();
			const settings = TestBed.inject(MapSettingsService);

			settings.updateSetting('maxZoom', 17);

			expect(cmp.getValue('maxZoom')).toBe(17);
		});

		it('exposes a value for every declared control', () => {
			const { cmp } = create();

			for (const item of cmp.controls) {
				expect(typeof cmp.getValue(item.key)).toBe('number');
			}
		});
	});

	describe('updateValue', () => {
		it('propagates a numeric value to the MapSettings signal', () => {
			const { cmp } = create();
			const settings = TestBed.inject(MapSettingsService);

			cmp.updateValue('maxZoom', 18);

			expect(settings.maxZoom()).toBe(18);
		});

		it('coerces a string value to a number before storing it', () => {
			const { cmp } = create();
			const settings = TestBed.inject(MapSettingsService);

			cmp.updateValue('deptResolution', '9');

			expect(settings.deptResolution()).toBe(9);
			expect(settings.deptResolution()).not.toBe('9' as unknown as number);
		});

		it('updates each control key independently', () => {
			const { cmp } = create();
			const settings = TestBed.inject(MapSettingsService);

			cmp.updateValue('minZoomDesk', 3);
			cmp.updateValue('minZoomMob', 4);

			expect(settings.minZoomDesk()).toBe(3);
			expect(settings.minZoomMob()).toBe(4);
		});

		it('is reflected back through getValue', () => {
			const { cmp } = create();

			cmp.updateValue('doubleTapDelay', 500);

			expect(cmp.getValue('doubleTapDelay')).toBe(500);
		});
	});

	describe('reset actions via the service', () => {
		it('resetSetting restores a single setting to its default', () => {
			const { cmp } = create();
			const settings = TestBed.inject(MapSettingsService);
			cmp.updateValue('maxZoom', 5);

			settings.resetSetting('maxZoom');

			expect(cmp.getValue('maxZoom')).toBe(DEFAULT_MAP_SETTINGS.maxZoom);
		});

		it('resetAll restores every setting to its default', () => {
			const { cmp } = create();
			const settings = TestBed.inject(MapSettingsService);
			for (const item of cmp.controls) {
				cmp.updateValue(item.key, DEFAULT_MAP_SETTINGS[item.key] + 1);
			}

			settings.resetAll();

			for (const item of cmp.controls) {
				expect(cmp.getValue(item.key)).toBe(DEFAULT_MAP_SETTINGS[item.key]);
			}
		});
	});

	describe('simulateNewTrip output', () => {
		it('emits when the output is triggered programmatically', () => {
			const { cmp } = create();
			const spy = vi.fn();
			cmp.simulateNewTrip.subscribe(spy);

			cmp.simulateNewTrip.emit();

			expect(spy).toHaveBeenCalledTimes(1);
		});

		it('emits when the New cells button is clicked', async () => {
			setupExpanded(true);
			const { fixture, cmp } = create();
			const spy = vi.fn();
			cmp.simulateNewTrip.subscribe(spy);

			const btn = fixture.nativeElement.querySelector('.btn-debug') as HTMLButtonElement;
			btn.click();
			await fixture.whenStable();

			expect(spy).toHaveBeenCalledTimes(1);
		});
	});

	describe('controls definition', () => {
		it('declares only valid MapSettings keys', () => {
			const { cmp } = create();
			const validKeys = Object.keys(DEFAULT_MAP_SETTINGS) as (keyof MapSettings)[];

			for (const item of cmp.controls) {
				expect(validKeys).toContain(item.key);
			}
		});

		it('declares a coherent min/max/step for every control', () => {
			const { cmp } = create();

			for (const item of cmp.controls) {
				expect(item.min).toBeLessThan(item.max);
				expect(item.step).toBeGreaterThan(0);
			}
		});
	});
});
