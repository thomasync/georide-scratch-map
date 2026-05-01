import { Injectable, isDevMode } from '@angular/core';

@Injectable({
	providedIn: 'root',
})
export class LoggerService {
	private readonly t0 = performance.now();

	private ts(): string {
		return `+${Math.round(performance.now() - this.t0)}ms`;
	}

	log(context: string, ...args: unknown[]): void {
		if (isDevMode()) console.log(`${this.ts()} [${context}]`, ...args);
	}

	warn(context: string, ...args: unknown[]): void {
		if (isDevMode()) console.warn(`${this.ts()} [${context}]`, ...args);
	}

	error(context: string, ...args: unknown[]): void {
		if (isDevMode()) console.error(`${this.ts()} [${context}]`, ...args);
	}
}
