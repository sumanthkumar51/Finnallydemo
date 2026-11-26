import { AfterViewInit, Component, CUSTOM_ELEMENTS_SCHEMA, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import Hammer from 'hammerjs';
import { Analytics } from '../core/analytics';
import { Auth } from '../core/auth';
import { Role } from '../core/models';

interface NavItem { path: string; label: string; icon: string; roles?: Role[]; }

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: '▦' },
  { path: '/employees', label: 'Employees', icon: '👥' },
  { path: '/finances', label: 'Finances', icon: '💳' },
  { path: '/logins', label: 'Login activity', icon: '🔐' },
  { path: '/activity', label: 'Usage & audit', icon: '📈', roles: ['admin', 'manager'] },
  { path: '/map', label: 'Offices map', icon: '📍' },
  { path: '/profile', label: 'My profile', icon: '👤' },
];

@Component({
  selector: 'crm-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="shell" [class.nav-open]="open()">
      <aside class="sidebar" id="crm-sidebar">
        <div class="brand">Finnally <span>CRM</span></div>
        <nav>
          @for (item of nav(); track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [id]="'nav' + item.path.replace('/', '-')" (click)="open.set(false)">
              <span class="ico" aria-hidden="true">{{ item.icon }}</span>{{ item.label }}
            </a>
          }
        </nav>
        <div class="sidebar-foot">Swipe left/right on mobile to toggle menu</div>
      </aside>
      <div class="scrim" (click)="open.set(false)"></div>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" (click)="open.set(!open())" aria-label="Toggle menu" aria-controls="crm-sidebar">☰</button>
          <div class="grow"></div>
          @if (auth.user(); as u) {
            <div class="whoami">
              <div class="who-name">{{ u.name }}</div>
              <div class="who-meta"><crm-badge [status]="u.role"></crm-badge> {{ u.department }}</div>
            </div>
            <button class="btn ghost" id="logout-btn" (click)="logout()">Sign out</button>
          }
        </header>
        <main class="content"><router-outlet /></main>
      </div>
    </div>
  `,
})
export class Shell implements AfterViewInit, OnDestroy {
  readonly auth = inject(Auth);
  private router = inject(Router);
  private zone = inject(NgZone);
  private analytics = inject(Analytics);
  readonly open = signal(false);
  readonly nav = computed(() => NAV.filter((n) => !n.roles || this.auth.is(...n.roles)));
  private hammer?: HammerManager;

  constructor() {
    this.router.events.subscribe((e) => { if (e instanceof NavigationEnd) this.open.set(false); });
  }

  ngAfterViewInit(): void {
    // Hammer.js touch gestures: swipe right from the left edge opens the menu, swipe left closes it.
    // Registered outside Angular's zone; only state changes re-enter it.
    this.zone.runOutsideAngular(() => {
      this.hammer = new Hammer.Manager(document.body, {
        inputClass: Hammer.TouchInput,
        touchAction: 'pan-y',
        recognizers: [[Hammer.Swipe, { direction: Hammer.DIRECTION_HORIZONTAL, threshold: 40 }]],
      });
      this.hammer.on('swiperight', (e) => {
        if (e.center.x - e.deltaX < 60) this.zone.run(() => this.open.set(true));
      });
      this.hammer.on('swipeleft', () => this.zone.run(() => this.open.set(false)));
    });
  }

  ngOnDestroy(): void { this.hammer?.destroy(); }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.analytics.reset();
    this.router.navigate(['/login']);
  }
}
