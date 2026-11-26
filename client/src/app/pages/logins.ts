import { DatePipe } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { Auth } from '../core/auth';
import { DevicePipe, UtcPipe, device, utc } from '../core/format';
import { LoginEvent, Paged } from '../core/models';
import { Pdf } from '../core/pdf';
import { Toast } from '../core/toast';

interface SessionRow { user_id: number; name: string; department: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; }

@Component({
  selector: 'crm-logins',
  imports: [FormsModule, RouterLink, DatePipe, UtcPipe, DevicePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="page-head">
      <div><h1>Login activity</h1><p class="muted">Every sign-in attempt, successful or not, with IP and device</p></div>
      <div class="actions"><button class="btn ghost" (click)="exportPdf()">Export PDF</button></div>
    </div>

    @if (auth.is('admin')) {
      <div class="card">
        <div class="card-head"><h2>Active sessions ({{ sessions().length }})</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Signed in</th><th>Last seen</th><th>IP</th><th>Device</th></tr></thead>
            <tbody>
              @for (s of sessions(); track $index) {
                <tr><td><a [routerLink]="['/employees', s.user_id]">{{ s.name }}</a> <span class="small muted">{{ s.department }}</span></td>
                  <td>{{ s.created_at | utc | date: 'MMM d, h:mm a' }}</td><td>{{ s.last_seen_at | utc | date: 'h:mm a' }}</td>
                  <td class="mono">{{ s.ip }}</td><td>{{ s.user_agent | device }}</td></tr>
              } @empty { <tr><td colspan="5" class="muted">No active sessions</td></tr> }
            </tbody>
          </table>
        </div>
      </div>
    }

    <div class="card filters">
      <input type="search" placeholder="Search name, email or IP…" [(ngModel)]="f.search" (ngModelChange)="debounced()" aria-label="Search" />
      <select [(ngModel)]="f.success" (ngModelChange)="reload()" aria-label="Result">
        <option value="">All attempts</option><option value="1">Successful</option><option value="0">Failed</option>
      </select>
      <label class="inline">From <input type="date" [(ngModel)]="f.from" (ngModelChange)="reload()" /></label>
      <label class="inline">To <input type="date" [(ngModel)]="f.to" (ngModelChange)="reload()" /></label>
    </div>

    <div class="card">
      <div class="card-head"><h2>{{ data()?.total ?? 0 }} events</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>When</th><th>User</th><th>Result</th><th>IP address</th><th>Device</th><th>Session length</th></tr></thead>
          <tbody>
            @for (l of data()?.rows ?? []; track l.id) {
              <tr [class.warn-row]="!l.success">
                <td class="nowrap">{{ l.created_at | utc | date: 'MMM d, y, h:mm a' }}</td>
                <td>@if (l.user_id) { <a [routerLink]="['/employees', l.user_id]">{{ l.name }}</a> } @else { <span class="muted">unknown</span> }
                  <div class="small muted">{{ l.email }}</div></td>
                <td><crm-badge [status]="l.success ? 'success' : (l.reason || 'failed')"></crm-badge></td>
                <td class="mono">{{ l.ip }}</td>
                <td>{{ l.user_agent | device }}</td>
                <td>{{ sessionText(l) }}</td>
              </tr>
            } @empty { <tr><td colspan="6" class="muted">No login events</td></tr> }
          </tbody>
        </table>
      </div>
      <div class="pager">
        <button class="btn ghost" [disabled]="page() <= 1" (click)="go(page() - 1)">← Prev</button>
        <span>Page {{ page() }} of {{ pages() }}</span>
        <button class="btn ghost" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next →</button>
      </div>
    </div>
  `,
})
export class Logins implements OnInit {
  readonly auth = inject(Auth);
  private api = inject(Api);
  private toast = inject(Toast);
  private pdf = inject(Pdf);
  readonly data = signal<Paged<LoginEvent> | null>(null);
  readonly sessions = signal<SessionRow[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  f = { search: '', success: '', from: '', to: '' };
  private timer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    if (this.auth.is('admin')) this.api.get<{ rows: SessionRow[] }>('/sessions').then((r) => this.sessions.set(r.rows));
    await this.load();
  }
  async load(): Promise<void> {
    try {
      const r = await this.api.get<Paged<LoginEvent>>('/login-events', { ...this.f, page: this.page(), limit: 30 });
      this.data.set(r);
      this.pages.set(Math.max(1, Math.ceil(r.total / r.limit)));
    } catch (e) { this.toast.error(errorMessage(e)); }
  }
  reload(): void { this.page.set(1); this.load(); }
  debounced(): void { clearTimeout(this.timer); this.timer = setTimeout(() => this.reload(), 250); }
  go(p: number): void { this.page.set(p); this.load(); }

  sessionText(l: LoginEvent): string {
    if (!l.success) return '';
    if (l.session_minutes == null) return 'No logout recorded';
    const m = l.session_minutes;
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  }

  async exportPdf(): Promise<void> {
    const r = await this.api.get<Paged<LoginEvent>>('/login-events', { ...this.f, limit: 500 });
    await this.pdf.table('Login activity', ['When', 'User', 'Email', 'Result', 'IP', 'Device', 'Session'],
      r.rows.map((l) => [utc(l.created_at)!.toLocaleString(), l.name ?? 'unknown', l.email, l.success ? 'success' : l.reason ?? 'failed',
        l.ip, device(l.user_agent), this.sessionText(l)]),
      'login-activity.pdf', `${r.total} events${r.total > 500 ? ' · latest 500 shown' : ''}`);
  }
}
