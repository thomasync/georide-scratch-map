import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MapSettingsService, MapSettings, DEFAULT_MAP_SETTINGS } from '../../core/services/map-settings';

@Component({
	selector: 'app-dev-box',
	standalone: true,
	imports: [CommonModule, FormsModule],
	template: `
		<div class="dev-box" [class.collapsed]="!isExpanded">
			<div class="dev-box-header">
				<button (click)="toggleExpand()" class="btn-action toggle-btn" title="Toggle">
					{{ isExpanded ? '-' : '+' }}
				</button>
				<div class="dev-box-actions" *ngIf="isExpanded">
					<button (click)="reload()" class="btn-action">Reload</button>
					<button (click)="settings.resetAll()" class="btn-action">Reset</button>
				</div>
			</div>

			<div class="dev-box-content" *ngIf="isExpanded">
				<ng-container *ngFor="let item of controls">
					<div class="slider-group">
						<div class="slider-header">
							<label [title]="item.key">{{ item.label }}</label>
							<div class="slider-actions">
								<span class="value">{{ getValue(item.key) }}</span>
								<button
									(click)="settings.resetSetting(item.key)"
									class="btn-reset"
									title="Reset to default"
								>
									↺
								</button>
							</div>
						</div>
						<input
							type="range"
							[min]="item.min"
							[max]="item.max"
							[step]="item.step"
							[ngModel]="getValue(item.key)"
							(ngModelChange)="updateValue(item.key, $event)"
						/>
					</div>
				</ng-container>
			</div>
		</div>
	`,
	styles: [
		`
			.dev-box {
				position: fixed;
				top: 16px;
				right: 16px;
				z-index: 9999;
				background-color: white;
				color: #333;
				padding: 16px;
				border-radius: 8px;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
				width: 320px;
				font-size: 13px;
				font-family: inherit;
				max-height: 80vh;
				overflow-y: auto;
				transition: width 0.2s;
			}
			.dev-box.collapsed {
				width: auto;
			}
			.dev-box-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
			}
			.dev-box:not(.collapsed) .dev-box-header {
				margin-bottom: 12px;
			}
			.dev-box-actions {
				display: flex;
				gap: 8px;
				align-items: center;
			}
			.btn-action {
				background-color: #f3f4f6;
				color: #4b5563;
				border: 1px solid #e5e7eb;
				padding: 4px 8px;
				border-radius: 4px;
				cursor: pointer;
				transition: all 0.2s;
				font-size: 12px;
				display: flex;
				align-items: center;
				gap: 4px;
			}
			.btn-action:hover {
				background-color: #e5e7eb;
			}
			.dev-box-content {
				display: flex;
				flex-direction: column;
				gap: 16px;
			}
			.slider-group {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.slider-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
			}
			.slider-header label {
				font-weight: 500;
			}
			.slider-actions {
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.value {
				color: #fdb300;
				font-weight: 600;
				width: 32px;
				text-align: right;
			}
			.btn-reset {
				background: none;
				border: none;
				color: #9ca3af;
				cursor: pointer;
				padding: 2px;
				border-radius: 4px;
				transition: all 0.2s;
			}
			.btn-reset:hover {
				color: #4b5563;
				background-color: #f3f4f6;
			}
			input[type='range'] {
				width: 100%;
				accent-color: #fdb300;
				cursor: pointer;
				border: none;
				outline: none;
				box-shadow: none;
				background: transparent;
				-webkit-appearance: none;
			}
			input[type='range']::-webkit-slider-runnable-track {
				width: 100%;
				height: 4px;
				cursor: pointer;
				background: #e5e7eb;
				border-radius: 2px;
				border: none;
			}
			input[type='range']::-webkit-slider-thumb {
				border: none;
				height: 16px;
				width: 16px;
				border-radius: 50%;
				background: #fdb300;
				cursor: pointer;
				-webkit-appearance: none;
				margin-top: -6px;
			}
			/* Hide scrollbar */
			.dev-box::-webkit-scrollbar {
				display: none;
			}
			.dev-box {
				-ms-overflow-style: none;
				scrollbar-width: none;
			}
		`,
	],
})
export class DevBoxComponent {
	settings = inject(MapSettingsService);
	isExpanded = localStorage.getItem('georide_dev_box_expanded') !== 'false';

	toggleExpand(): void {
		this.isExpanded = !this.isExpanded;
		localStorage.setItem('georide_dev_box_expanded', String(this.isExpanded));
	}

	controls: { key: keyof MapSettings; label: string; min: number; max: number; step: number }[] = [
		{ key: 'fitToVisitedMaxZoom', label: 'Fit Visited Max Zoom', min: 4, max: 15, step: 0.1 },
		{ key: 'fitDeptMaxZoom', label: 'Fit Dept Max Zoom', min: 4, max: 15, step: 0.1 },
		{ key: 'minZoomDesk', label: 'Min Zoom (Desk)', min: 1, max: 20, step: 0.1 },
		{ key: 'minZoomMob', label: 'Min Zoom (Mob)', min: 1, max: 20, step: 0.1 },
		{ key: 'maxZoom', label: 'Max Zoom', min: 10, max: 24, step: 0.1 },
		{ key: 'deptModeZoomThresholdDesk', label: 'Dept Zoom Thresh (Desk)', min: 5, max: 10, step: 0.1 },
		{ key: 'deptModeZoomThresholdMob', label: 'Dept Zoom Thresh (Mob)', min: 5, max: 10, step: 0.1 },
		{ key: 'deptFocusExitDelta', label: 'Dept Focus Exit Delta', min: 0.1, max: 2, step: 0.1 },
		{ key: 'polylineModeZoomThresholdDesk', label: 'Polyline Zoom (Desk)', min: 10, max: 16, step: 0.5 },
		{ key: 'polylineModeZoomThresholdMob', label: 'Polyline Zoom (Mob)', min: 10, max: 16, step: 0.5 },
		{ key: 'deptResolution', label: 'H3 Resolution', min: 1, max: 10, step: 1 },
		{ key: 'cityLabelsFadeStart', label: 'City Labels Fade Start', min: 4, max: 10, step: 0.1 },
		{ key: 'cityLabelsFadeEnd', label: 'City Labels Fade End', min: 4, max: 10, step: 0.1 },
		{ key: 'doubleTapDelay', label: 'Double Tap Delay (ms)', min: 100, max: 1000, step: 50 },
		{ key: 'deptMaskOpacityDefault', label: 'Mask Opacity (Default)', min: 0, max: 1, step: 0.05 },
		{ key: 'deptMaskOpacityScreenshot', label: 'Mask Opacity (Screenshot)', min: 0, max: 1, step: 0.05 },
	];

	getValue(key: keyof MapSettings): number {
		// Because settings exposes signals
		return (this.settings as any)[key]();
	}

	updateValue(key: keyof MapSettings, value: string | number): void {
		this.settings.updateSetting(key, Number(value));
	}

	reload(): void {
		window.location.reload();
	}
}
