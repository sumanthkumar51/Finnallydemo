import { Injectable, NgZone, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from './api';
import { PublicConfig, User } from './models';

type Fn = (...args: unknown[]) => void;
interface PendoAgent {
  initialize: Fn; identify: Fn; track: Fn; pageLoad: Fn; clearSession?: () => void; _q?: unknown[];
  [k: string]: unknown;
}
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: Fn;
    clarity?: Fn & { q?: unknown[] };
    pendo?: PendoAgent;
  }
}

const EMPTY: PublicConfig = { gaMeasurementId: '', gtmContainerId: '', clarityProjectId: '', pendoApiKey: '', googleMapsApiKey: '' };

function addScript(src: string): void {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/**
 * Third-party analytics + onboarding: Google Tag Manager, Google Analytics 4, Microsoft Clarity and Pendo.
 * Each is only loaded when its ID is configured on the server (see /api/public-config).
 * Only the internal user id, role and department are sent to these vendors - never names, emails or salaries.
 */
@Injectable({ providedIn: 'root' })
export class Analytics {
  private api = inject(Api);
  private zone = inject(NgZone);
  private router = inject(Router);
  config: PublicConfig = EMPTY;
  private pendoInitialized = false;
  private user: User | null = null;

  async init(): Promise<void> {
    try { this.config = await this.api.get<PublicConfig>('/public-config'); } catch { this.config = EMPTY; }
    // Load vendor scripts outside Angular's zone so their timers/listeners don't trigger change detection.
    this.zone.runOutsideAngular(() => {
      window.dataLayer = window.dataLayer || [];
      const c = this.config;
      if (c.gtmContainerId) {
        window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
        addScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(c.gtmContainerId)}`);
      }
      if (c.gaMeasurementId) {
        addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(c.gaMeasurementId)}`);
        // eslint-disable-next-line prefer-rest-params
        window.gtag = function gtag() { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', c.gaMeasurementId, { send_page_view: false, anonymize_ip: true });
      }
      if (c.clarityProjectId) {
        const clarity = function (...args: unknown[]) { (clarity.q = clarity.q || []).push(args); } as Fn & { q?: unknown[] };
        window.clarity = window.clarity || clarity;
        addScript(`https://www.clarity.ms/tag/${encodeURIComponent(c.clarityProjectId)}`);
      }
      if (c.pendoApiKey) {
        const queue: unknown[] = [];
        const agent = { _q: queue } as unknown as PendoAgent;
        for (const m of ['initialize', 'identify', 'updateOptions', 'pageLoad', 'track']) {
          agent[m] = (...args: unknown[]) => { m === 'initialize' ? queue.unshift([m, ...args]) : queue.push([m, ...args]); };
        }
        window.pendo = window.pendo || agent;
        addScript(`https://cdn.pendo.io/agent/static/${encodeURIComponent(c.pendoApiKey)}/pendo.js`);
      }
    });

    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => this.pageView(e.urlAfterRedirects));
  }

  identify(user: User): void {
    this.user = user;
    const traits = { role: user.role, department: user.department };
    this.zone.runOutsideAngular(() => {
      window.gtag?.('set', { user_id: String(user.id), user_properties: traits });
      window.dataLayer?.push({ event: 'crm_login', user_id: String(user.id), ...traits });
      window.clarity?.('identify', String(user.id));
      window.clarity?.('set', 'role', user.role);
      if (window.pendo) {
        // Pendo powers in-app onboarding guides; guides are authored in the Pendo dashboard and target these fields.
        const payload = { visitor: { id: `crm-${user.id}`, ...traits, hireDate: user.hire_date }, account: { id: 'crm' } };
        if (this.pendoInitialized) window.pendo.identify(payload);
        else window.pendo.initialize(payload);
        this.pendoInitialized = true;
      }
    });
  }

  pageView(path: string): void {
    const page = path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');
    this.zone.runOutsideAngular(() => {
      window.gtag?.('event', 'page_view', { page_path: page, page_title: document.title });
      window.dataLayer?.push({ event: 'virtual_page_view', page_path: page });
      window.pendo?.pageLoad?.();
    });
    // First-party usage tracking stored in the CRM's own activity log.
    if (this.user && page !== '/login') this.api.post('/track', { page }).catch(() => undefined);
  }

  event(name: string, params: Record<string, string | number> = {}): void {
    this.zone.runOutsideAngular(() => {
      window.gtag?.('event', name, params);
      window.dataLayer?.push({ event: name, ...params });
      window.clarity?.('event', name);
      window.pendo?.track(name, params);
    });
  }

  reset(): void {
    this.user = null;
    window.pendo?.clearSession?.();
  }
}
