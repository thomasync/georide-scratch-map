import { inject, Injectable, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';
import { DatabaseService } from './database';
import { GeorideApiService } from './georide-api';

const IDB_FIRSTNAME_KEY = 'georide_user_firstname';

@Injectable({ providedIn: 'root' })
export class UserService {
	private db = inject(DatabaseService);
	private api = inject(GeorideApiService);

	firstName = signal<string | null>(null);

	loadFromDb(): Observable<void> {
		return this.db.kvGet<string>(IDB_FIRSTNAME_KEY).pipe(
			tap((name) => {
				if (name) this.firstName.set(name);
			}),
			map(() => void 0),
			catchError(() => of(void 0)),
		);
	}

	fetchAndStore(): Observable<void> {
		return this.api.getUser().pipe(
			tap((user) => {
				this.firstName.set(user.firstName);
				this.db.kvSet(IDB_FIRSTNAME_KEY, user.firstName).subscribe();
			}),
			map(() => void 0),
			catchError(() => of(void 0)),
		);
	}

	clear(): void {
		this.firstName.set(null);
		this.db.kvDelete(IDB_FIRSTNAME_KEY).subscribe();
	}
}
