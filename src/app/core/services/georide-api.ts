import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { User } from '../models/user';
import { Tracker } from '../models/tracker';
import { Trip } from '../models/trip';
import { Position, PositionsLink } from '../models/position';
import { LoggerService } from './logger';

const API_URL = 'https://api.georide.com';

@Injectable({
	providedIn: 'root',
})
export class GeorideApiService {
	private http = inject(HttpClient);
	private logger = inject(LoggerService);

	getUser(): Observable<User> {
		this.logger.log('GeorideApi', 'GET /user');
		return this.http
			.get<User>(`${API_URL}/user`)
			.pipe(tap((u) => this.logger.log('GeorideApi', 'GET /user response', u)));
	}

	getTrackers(): Observable<Tracker[]> {
		this.logger.log('GeorideApi', 'GET /user/trackers');
		return this.http
			.get<Tracker[]>(`${API_URL}/user/trackers`)
			.pipe(tap((t) => this.logger.log('GeorideApi', `GET /user/trackers response — ${t.length} tracker(s)`, t)));
	}

	getTrips(trackerId: number, from: Date, to: Date): Observable<Trip[]> {
		const params = { from: from.toISOString(), to: to.toISOString() };
		this.logger.log('GeorideApi', `GET /tracker/${trackerId}/trips`, params);
		return this.http
			.get<Trip[]>(`${API_URL}/tracker/${trackerId}/trips`, { params })
			.pipe(
				tap((trips) =>
					this.logger.log('GeorideApi', `GET /tracker/${trackerId}/trips response — ${trips.length} trip(s)`),
				),
			);
	}

	getTripPositionsLink(trackerId: number, from: string, to: string): Observable<PositionsLink> {
		const params = { from, to };
		this.logger.log('GeorideApi', `GET /tracker/${trackerId}/trips/positions/link`, params);
		return this.http
			.get<PositionsLink>(`${API_URL}/tracker/${trackerId}/trips/positions/link`, { params })
			.pipe(tap((link) => this.logger.log('GeorideApi', 'positions link response', link)));
	}

	getTripPositions(url: string): Observable<Position[]> {
		this.logger.log('GeorideApi', 'GET S3 positions', url);
		return this.http
			.get<Position[]>(url)
			.pipe(tap((p) => this.logger.log('GeorideApi', `S3 response — ${p.length} position(s)`)));
	}
}
