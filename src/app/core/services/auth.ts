import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, map, Observable, shareReplay, tap, throwError } from 'rxjs';
import { AuthLoginResponse } from '../models/user';
import { LoggerService } from './logger';
import { DatabaseService } from './database';

const TOKEN_KEY = 'georide_token';
const API_URL = 'https://api.georide.com';

@Injectable({
	providedIn: 'root',
})
export class AuthService {
	private http = inject(HttpClient);
	private logger = inject(LoggerService);
	private db = inject(DatabaseService);
	private refreshInProgress$: Observable<string> | null = null;

	private token: string | null = null;

	login(email: string, password: string): Observable<AuthLoginResponse> {
		this.logger.log('AuthService', 'login attempt', email);
		return this.http.post<AuthLoginResponse>(`${API_URL}/user/login`, { email, password }).pipe(
			tap((res) => {
				this.logger.log('AuthService', 'login success, storing token');
				this.storeToken(res.authToken);
			}),
		);
	}

	refreshToken(): Observable<string> {
		if (!this.refreshInProgress$) {
			this.logger.log('AuthService', 'starting token refresh');
			this.refreshInProgress$ = this.http.get<{ authToken: string }>(`${API_URL}/user/new-token`).pipe(
				tap((res) => {
					this.logger.log('AuthService', 'token refreshed successfully');
					this.storeToken(res.authToken);
					this.refreshInProgress$ = null;
				}),
				map((res) => res.authToken),
				catchError((err) => {
					this.logger.warn('AuthService', 'token refresh failed');
					this.refreshInProgress$ = null;
					return throwError(() => err);
				}),
				shareReplay(1),
			);
		}
		return this.refreshInProgress$;
	}

	logout(): void {
		this.logger.log('AuthService', 'logout');
		this.token = null;
		localStorage.removeItem(TOKEN_KEY);
		this.db.kvDelete(TOKEN_KEY).subscribe();
	}

	getToken(): string | null {
		return this.token;
	}

	setToken(token: string): void {
		this.logger.log('AuthService', 'setToken manually');
		this.storeToken(token);
	}

	isAuthenticated(): boolean {
		return !!this.token;
	}

	// Appelé par APP_INITIALIZER — charge le token depuis IDB,
	// avec fallback localStorage pour la transition (migré puis supprimé)
	async restoreFromDb(): Promise<void> {
		let token = await firstValueFrom(this.db.kvGet<string>(TOKEN_KEY));

		if (!token) {
			const lsToken = localStorage.getItem(TOKEN_KEY);
			if (lsToken) {
				this.logger.log('AuthService', 'migrating token from localStorage to IDB');
				token = lsToken;
				await firstValueFrom(this.db.kvSet(TOKEN_KEY, lsToken));
				localStorage.removeItem(TOKEN_KEY);
			}
		}

		this.token = token;
		this.logger.log('AuthService', 'restoreFromDb', token ? 'token loaded' : 'no token');
	}

	private storeToken(token: string): void {
		this.token = token;
		localStorage.removeItem(TOKEN_KEY);
		this.db.kvSet(TOKEN_KEY, token).subscribe();
	}
}
