import { Provider } from '@angular/core';
import { of } from 'rxjs';
import { LoggerService } from '../../app/core/services/logger';
import { DatabaseService } from '../../app/core/services/database';

/** Logger silencieux : pas de bruit console dans les tests. */
export function provideSilentLogger(): Provider {
	const silent = {
		log: () => {},
		warn: () => {},
		error: () => {},
	};
	return { provide: LoggerService, useValue: silent };
}

export type DatabaseServiceMock = {
	[K in keyof Pick<
		DatabaseService,
		| 'kvGet'
		| 'kvSet'
		| 'kvDelete'
		| 'fuelGet'
		| 'fuelSet'
		| 'getTripPositions'
		| 'getAllTrips'
		| 'upsertTripPositions'
		| 'upsertTrips'
	>]: ReturnType<typeof vi.fn>;
};

/** DatabaseService mocké : tout renvoie of(null)/of(void 0)/of([]) par défaut, surchargeable. */
export function createDatabaseServiceMock(): DatabaseServiceMock {
	return {
		kvGet: vi.fn(() => of(null)),
		kvSet: vi.fn(() => of(void 0)),
		kvDelete: vi.fn(() => of(void 0)),
		fuelGet: vi.fn(() => of(null)),
		fuelSet: vi.fn(() => of(void 0)),
		getTripPositions: vi.fn(() => of(null)),
		getAllTrips: vi.fn(() => of([])),
		upsertTripPositions: vi.fn(() => of(void 0)),
		upsertTrips: vi.fn(() => of(void 0)),
	};
}

export function provideDatabaseServiceMock(mock: DatabaseServiceMock = createDatabaseServiceMock()): Provider {
	return { provide: DatabaseService, useValue: mock };
}
