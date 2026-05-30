import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, shareReplay, tap, throwError } from 'rxjs';
import { AuthLoginResponse } from '../models/user';
import { LoggerService } from './logger';

const TOKEN_KEY = 'georide_token';
const API_URL = 'https://api.georide.com';

@Injectable({
	providedIn: 'root',
})
export class AuthService {
	private http = inject(HttpClient);
	private logger = inject(LoggerService);
	private refreshInProgress$: Observable<string> | null = null;

	login(email: string, password: string): Observable<AuthLoginResponse> {
		this.logger.log('AuthService', 'login attempt', email);
		return this.http.post<AuthLoginResponse>(`${API_URL}/user/login`, { email, password }).pipe(
			tap((res) => {
				this.logger.log('AuthService', 'login success, storing token');
				localStorage.setItem(TOKEN_KEY, res.authToken);
			}),
		);
	}

	refreshToken(): Observable<string> {
		if (!this.refreshInProgress$) {
			this.logger.log('AuthService', 'starting token refresh');
			this.refreshInProgress$ = this.http.get<{ authToken: string }>(`${API_URL}/user/new-token`).pipe(
				tap((res) => {
					this.logger.log('AuthService', 'token refreshed successfully');
					localStorage.setItem(TOKEN_KEY, res.authToken);
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
		localStorage.removeItem(TOKEN_KEY);
	}

	getToken(): string | null {
		const token = localStorage.getItem(TOKEN_KEY);
		this.logger.log('AuthService', 'getToken', token ? 'token found' : 'no token');
		return token;
	}

	setToken(token: string): void {
		this.logger.log('AuthService', 'setToken manually');
		localStorage.setItem(TOKEN_KEY, token);
	}

	isAuthenticated(): boolean {
		const result = !!this.getToken();
		this.logger.log('AuthService', 'isAuthenticated', result);
		return result;
	}
}
