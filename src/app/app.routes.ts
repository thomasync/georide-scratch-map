import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';

export const routes: Routes = [
	{ path: '', redirectTo: 'map', pathMatch: 'full' },
	{
		path: 'login',
		loadComponent: () => import('./features/login/login').then((m) => m.Login),
	},
	{
		path: 'map',
		loadComponent: () => import('./features/map/map').then((m) => m.Map),
		canActivate: [authGuard],
	},
	{
		path: 'demo',
		loadComponent: () => import('./features/map/map').then((m) => m.Map),
	},
];
