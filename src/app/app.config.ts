import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth-interceptor';
import { cacheInterceptor } from './core/interceptors/cache-interceptor';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { AuthService } from './core/services/auth';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideRouter(routes),
		provideHttpClient(withInterceptors([authInterceptor, cacheInterceptor])),
		provideCharts(withDefaultRegisterables()),
		provideAppInitializer(() => inject(AuthService).restoreFromDb()),
	],
};
