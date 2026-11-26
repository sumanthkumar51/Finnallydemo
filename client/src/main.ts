import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import './app/elements/stat-card'; // registers the Lit custom elements

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
