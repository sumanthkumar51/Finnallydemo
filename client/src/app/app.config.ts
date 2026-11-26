import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { crmInterceptor } from './core/api';
import { Analytics } from './core/analytics';
import { Auth } from './core/auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zone.js-based change detection (zone.js is loaded via the polyfills in angular.json).
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([crmInterceptor])),
    provideAppInitializer(async () => {
      const analytics = inject(Analytics);
      const auth = inject(Auth);
      await analytics.init();
      const user = await auth.load();
      if (user) analytics.identify(user);
    }),
  ],
};
