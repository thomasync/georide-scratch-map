import { Directive, HostListener, OnDestroy, ElementRef, inject, input } from '@angular/core';

const LONG_PRESS_MS = 500;

@Directive({ selector: '[tooltip]' })
export class TooltipDirective implements OnDestroy {
	readonly tooltip = input('');

	private el = inject(ElementRef<HTMLElement>);
	private longPressTimer: ReturnType<typeof setTimeout> | null = null;
	private longPressActive = false;

	private static tooltipEl: HTMLDivElement | null = null;

	private static getEl(): HTMLDivElement {
		if (!TooltipDirective.tooltipEl) {
			const div = document.createElement('div');
			div.className = 'app-tooltip';
			document.body.appendChild(div);
			TooltipDirective.tooltipEl = div;
		}
		return TooltipDirective.tooltipEl;
	}

	// ── Desktop ──────────────────────────────────────────────────────────────

	@HostListener('mouseenter', ['$event'])
	onMouseEnter(event: MouseEvent): void {
		if (!this.tooltip()) return;
		this.showTooltip(event.currentTarget as HTMLElement);
	}

	@HostListener('mouseleave')
	onMouseLeave(): void {
		this.hideTooltip();
	}

	// ── Mobile (long press) ───────────────────────────────────────────────────

	@HostListener('touchstart', ['$event'])
	onTouchStart(event: TouchEvent): void {
		if (!this.tooltip()) return;
		this.clearTimers();
		const anchor = this.el.nativeElement;
		this.longPressTimer = setTimeout(() => {
			anchor.style.userSelect = 'none';
			this.longPressActive = true;
			this.showTooltip(anchor);
		}, LONG_PRESS_MS);
		// Empêche le menu contextuel / sélection natifs du long press
		event.preventDefault();
	}

	@HostListener('touchend')
	onTouchEnd(): void {
		this.clearTimers();
		if (this.longPressActive) {
			this.longPressActive = false;
			this.hideTooltip();
			this.el.nativeElement.style.userSelect = '';
		}
	}

	@HostListener('touchmove')
	onTouchMove(): void {
		this.clearTimers();
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private showTooltip(anchor: HTMLElement): void {
		const el = TooltipDirective.getEl();
		el.textContent = this.tooltip();
		el.style.display = 'block';
		this.position(anchor);
	}

	private hideTooltip(): void {
		if (TooltipDirective.tooltipEl) TooltipDirective.tooltipEl.style.display = 'none';
	}

	private position(anchor: HTMLElement): void {
		const el = TooltipDirective.getEl();
		const rect = anchor.getBoundingClientRect();
		const gap = 4;
		el.style.top = `${rect.bottom + gap}px`;
		el.style.left = `${rect.left}px`;
		requestAnimationFrame(() => {
			const tipRect = el.getBoundingClientRect();
			// Clampage horizontal
			if (tipRect.right > window.innerWidth - 8) {
				el.style.left = `${Math.max(8, window.innerWidth - tipRect.width - 8)}px`;
			}
			// Flip vers le haut si ça dépasse en bas
			if (tipRect.bottom > window.innerHeight - 8) {
				el.style.top = `${rect.top - tipRect.height - gap}px`;
			}
		});
	}

	private clearTimers(): void {
		if (this.longPressTimer) {
			clearTimeout(this.longPressTimer);
			this.longPressTimer = null;
		}
	}

	ngOnDestroy(): void {
		this.clearTimers();
		this.hideTooltip();
		this.el.nativeElement.style.userSelect = '';
	}
}
