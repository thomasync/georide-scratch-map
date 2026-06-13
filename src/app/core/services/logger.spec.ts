import { TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { LoggerService } from './logger';

// isDevMode() lit le global ngDevMode — on le force à false pour couvrir la branche prod
const globalWithNgDevMode = globalThis as typeof globalThis & { ngDevMode?: unknown };

describe('LoggerService', () => {
	let consoleLogSpy: MockInstance<typeof console.log>;
	let consoleWarnSpy: MockInstance<typeof console.warn>;
	let consoleErrorSpy: MockInstance<typeof console.error>;
	let nowSpy: MockInstance<typeof performance.now>;

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		nowSpy = vi.spyOn(performance, 'now');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** Crée un logger dont le t0 (capturé à la construction) est contrôlé. */
	function createLoggerAt(t0: number): LoggerService {
		nowSpy.mockReturnValue(t0);
		return new LoggerService();
	}

	describe('dependency injection', () => {
		it('should be provided in root as a singleton', () => {
			const first = TestBed.inject(LoggerService);
			const second = TestBed.inject(LoggerService);

			expect(first).toBeInstanceOf(LoggerService);
			expect(second).toBe(first);
		});
	});

	describe('prefix format', () => {
		it('should log with a "+0ms" prefix when no time has elapsed since creation', () => {
			const logger = createLoggerAt(1000);

			logger.log('Init');

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			expect(consoleLogSpy).toHaveBeenCalledWith('+0ms [Init]');
		});

		it('should include the elapsed milliseconds since service creation', () => {
			const logger = createLoggerAt(1000);

			nowSpy.mockReturnValue(1042);
			logger.log('Sync');

			expect(consoleLogSpy).toHaveBeenCalledWith('+42ms [Sync]');
		});

		it('should round the elapsed time down when the fraction is below .5', () => {
			const logger = createLoggerAt(0);

			nowSpy.mockReturnValue(42.4);
			logger.log('Ctx');

			expect(consoleLogSpy).toHaveBeenCalledWith('+42ms [Ctx]');
		});

		it('should round the elapsed time up when the fraction is .5 or above', () => {
			const logger = createLoggerAt(0);

			nowSpy.mockReturnValue(42.5);
			logger.log('Ctx');

			expect(consoleLogSpy).toHaveBeenCalledWith('+43ms [Ctx]');
		});

		it('should measure the elapsed time relative to each instance own creation time', () => {
			const early = createLoggerAt(500);
			const late = createLoggerAt(2000);

			nowSpy.mockReturnValue(2100);
			early.log('Early');
			late.log('Late');

			expect(consoleLogSpy).toHaveBeenNthCalledWith(1, '+1600ms [Early]');
			expect(consoleLogSpy).toHaveBeenNthCalledWith(2, '+100ms [Late]');
		});

		it('should reflect a growing offset across successive calls on the same instance', () => {
			const logger = createLoggerAt(0);

			nowSpy.mockReturnValue(10);
			logger.log('Step');
			nowSpy.mockReturnValue(250);
			logger.log('Step');

			expect(consoleLogSpy).toHaveBeenNthCalledWith(1, '+10ms [Step]');
			expect(consoleLogSpy).toHaveBeenNthCalledWith(2, '+250ms [Step]');
		});

		it('should wrap the context in square brackets without altering it', () => {
			const logger = createLoggerAt(0);

			logger.log('Trips.sync/worker-1');

			expect(consoleLogSpy).toHaveBeenCalledWith('+0ms [Trips.sync/worker-1]');
		});
	});

	describe('log', () => {
		it('should forward all additional arguments untouched to console.log', () => {
			const logger = createLoggerAt(0);
			const payload = { trips: 3 };
			const failure = new Error('boom');

			logger.log('Sync', 'done', payload, 42, failure);

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			expect(consoleLogSpy).toHaveBeenCalledWith('+0ms [Sync]', 'done', payload, 42, failure);
		});

		it('should only pass the prefix when called without extra arguments', () => {
			const logger = createLoggerAt(0);

			logger.log('Boot');

			expect(consoleLogSpy).toHaveBeenCalledWith('+0ms [Boot]');
			expect(consoleLogSpy.mock.calls[0]).toHaveLength(1);
		});

		it('should not touch console.warn nor console.error', () => {
			const logger = createLoggerAt(0);

			logger.log('Ctx', 'message');

			expect(consoleWarnSpy).not.toHaveBeenCalled();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});
	});

	describe('warn', () => {
		it('should forward the prefixed message and arguments to console.warn', () => {
			const logger = createLoggerAt(100);
			const details = { retry: true };

			nowSpy.mockReturnValue(175);
			logger.warn('Api', 'rate limited', details);

			expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
			expect(consoleWarnSpy).toHaveBeenCalledWith('+75ms [Api]', 'rate limited', details);
		});

		it('should not touch console.log nor console.error', () => {
			const logger = createLoggerAt(0);

			logger.warn('Ctx', 'message');

			expect(consoleLogSpy).not.toHaveBeenCalled();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});
	});

	describe('error', () => {
		it('should forward the prefixed message and arguments to console.error', () => {
			const logger = createLoggerAt(100);
			const failure = new Error('network down');

			nowSpy.mockReturnValue(350);
			logger.error('Api', 'request failed', failure);

			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
			expect(consoleErrorSpy).toHaveBeenCalledWith('+250ms [Api]', 'request failed', failure);
		});

		it('should not touch console.log nor console.warn', () => {
			const logger = createLoggerAt(0);

			logger.error('Ctx', 'message');

			expect(consoleLogSpy).not.toHaveBeenCalled();
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});
	});

	describe('isDevMode gating', () => {
		it('should log in test builds because isDevMode() is true', () => {
			const logger = createLoggerAt(0);

			logger.log('Dev');
			logger.warn('Dev');
			logger.error('Dev');

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		});

		it('should stay silent on log/warn/error when ngDevMode is disabled (prod mode)', () => {
			const logger = createLoggerAt(0);
			const originalNgDevMode = globalWithNgDevMode.ngDevMode;
			globalWithNgDevMode.ngDevMode = false;

			try {
				logger.log('Prod', 'message');
				logger.warn('Prod', 'message');
				logger.error('Prod', 'message');

				expect(consoleLogSpy).not.toHaveBeenCalled();
				expect(consoleWarnSpy).not.toHaveBeenCalled();
				expect(consoleErrorSpy).not.toHaveBeenCalled();
			} finally {
				globalWithNgDevMode.ngDevMode = originalNgDevMode;
			}
		});
	});
});
