import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { UserService } from './user.service';
import { GeorideApiService } from './georide-api';
import { User } from '../models/user';
import {
	createDatabaseServiceMock,
	provideDatabaseServiceMock,
	DatabaseServiceMock,
} from '../../../test/helpers/providers';

const IDB_FIRSTNAME_KEY = 'georide_user_firstname';

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 1,
		email: 'jane@example.com',
		firstName: 'Jane',
		createdAt: '2026-01-01T00:00:00.000Z',
		phoneNumber: '+33600000000',
		pushUserToken: null,
		legal: true,
		legalSocial: false,
		dateOfBirth: '1990-05-12',
		isDemo: false,
		helpCenterType: 'default',
		region: 'EU',
		...overrides,
	};
}

type GeorideApiMock = { getUser: ReturnType<typeof vi.fn<() => Observable<User>>> };

describe('UserService', () => {
	let service: UserService;
	let dbMock: DatabaseServiceMock;
	let apiMock: GeorideApiMock;

	beforeEach(() => {
		dbMock = createDatabaseServiceMock();
		apiMock = { getUser: vi.fn<() => Observable<User>>(() => of(makeUser())) };
		TestBed.configureTestingModule({
			providers: [provideDatabaseServiceMock(dbMock), { provide: GeorideApiService, useValue: apiMock }],
		});
		service = TestBed.inject(UserService);
	});

	it('starts with a null firstName', () => {
		expect(service.firstName()).toBeNull();
	});

	describe('loadFromDb', () => {
		it('sets the firstName signal from the value stored in IndexedDB and emits void', async () => {
			dbMock.kvGet.mockReturnValue(of('Jane'));

			const result = await firstValueFrom(service.loadFromDb());

			expect(result).toBeUndefined();
			expect(service.firstName()).toBe('Jane');
			expect(dbMock.kvGet).toHaveBeenCalledExactlyOnceWith(IDB_FIRSTNAME_KEY);
		});

		it('leaves the signal null when nothing is stored', async () => {
			const result = await firstValueFrom(service.loadFromDb());

			expect(result).toBeUndefined();
			expect(service.firstName()).toBeNull();
		});

		it('does not overwrite the current value when the stored name is an empty string', async () => {
			service.firstName.set('Existing');
			dbMock.kvGet.mockReturnValue(of(''));

			await firstValueFrom(service.loadFromDb());

			// Chaîne vide falsy : le signal n'est pas touché
			expect(service.firstName()).toBe('Existing');
		});

		it('swallows database errors and still emits void', async () => {
			dbMock.kvGet.mockReturnValue(throwError(() => new Error('idb down')));

			const result = await firstValueFrom(service.loadFromDb());

			expect(result).toBeUndefined();
			expect(service.firstName()).toBeNull();
		});
	});

	describe('fetchAndStore', () => {
		it('fetches the user, sets the signal and persists the first name in the kv store', async () => {
			apiMock.getUser.mockReturnValue(of(makeUser({ firstName: 'Thomas' })));

			const result = await firstValueFrom(service.fetchAndStore());

			expect(result).toBeUndefined();
			expect(apiMock.getUser).toHaveBeenCalledTimes(1);
			expect(service.firstName()).toBe('Thomas');
			expect(dbMock.kvSet).toHaveBeenCalledExactlyOnceWith(IDB_FIRSTNAME_KEY, 'Thomas');
		});

		it('overwrites a previously loaded first name', async () => {
			service.firstName.set('Old');
			apiMock.getUser.mockReturnValue(of(makeUser({ firstName: 'New' })));

			await firstValueFrom(service.fetchAndStore());

			expect(service.firstName()).toBe('New');
		});

		it('swallows API errors, emits void and does not touch the signal nor the kv store', async () => {
			service.firstName.set('Kept');
			apiMock.getUser.mockReturnValue(throwError(() => new Error('401')));

			const result = await firstValueFrom(service.fetchAndStore());

			expect(result).toBeUndefined();
			expect(service.firstName()).toBe('Kept');
			expect(dbMock.kvSet).not.toHaveBeenCalled();
		});
	});

	describe('clear', () => {
		it('resets the signal and deletes the stored first name', () => {
			service.firstName.set('Jane');

			service.clear();

			expect(service.firstName()).toBeNull();
			expect(dbMock.kvDelete).toHaveBeenCalledExactlyOnceWith(IDB_FIRSTNAME_KEY);
		});

		it('is a no-op on the signal when it is already null, but still issues the delete', () => {
			service.clear();

			expect(service.firstName()).toBeNull();
			expect(dbMock.kvDelete).toHaveBeenCalledExactlyOnceWith(IDB_FIRSTNAME_KEY);
		});
	});
});
