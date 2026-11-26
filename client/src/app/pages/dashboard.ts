import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { Auth } from '../core/auth';
import { FusionChartsModule } from 'angular-fusioncharts';
import { multiSeries, singleSeries } from '../core/charts';
import { MoneyPipe, UtcPipe, money } from '../core/format';

interface DashboardData {
  people: { total: number; active: number; payroll: number };
  money: { pending_count: number; pending_amount: number; spend_this_month: number };
  logins: { ok_24h: number; failed_24h: number; active_users_7d: number };
  spendByCategory: { category: string; total: number }[];
  spendByMonth: { month: string; total: number }[];
  loginsByDay: { day: string; ok: number; failed: number }[];
  headcountByDept: { department: string; n: number }[];
  recentLogins: { id: number; name: string; email: string; success: number; reason: string | null; ip: string; created_at: string }[];
  inactive: { id: number; name: string; department: string; last_login: string | null }[];
}

@Component({
  selector: 'crm-dashboard',
  imports: [FusionChartsModule, RouterLink, DatePipe, DecimalPipe, UtcPipe, MoneyPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
        <p class="muted">{{ scopeLabel() }}</p>
      </div>
    </div>
    @if (error()) { <div class="alert error">{{ error() }}</div> }
    @if (d(); as d) {
      <section class="stats" id="dashboard-stats">
        <crm-stat-card label="Active employees" [value]="(d.people.active | number) ?? ''" [hint]="d.people.total + ' total records'"></crm-stat-card>
        <crm-stat-card label="Annual payroll" [value]="d.people.payroll | money" hint="Active employees" tone="good"></crm-stat-card>
        <crm-stat-card label="Pending approvals" [value]="d.money.pending_amount | money" [hint]="(d.money.pending_count || 0) + ' requests'" tone="warn"></crm-stat-card>
        <crm-stat-card label="Spend this month" [value]="d.money.spend_this_month | money" hint="Approved expenses"></crm-stat-card>
        <crm-stat-card label="Logins (24h)" [value]="'' + (d.logins.ok_24h || 0)" [hint]="(d.logins.active_users_7d || 0) + ' active users this week'" tone="good"></crm-stat-card>
        <crm-stat-card label="Failed logins (24h)" [value]="'' + (d.logins.failed_24h || 0)" hint="Wrong password / locked" [tone]="d.logins.failed_24h ? 'bad' : 'default'"></crm-stat-card>
      </section>

      <section class="grid-2">
        <div class="card chart"><fusioncharts type="column2d" width="100%" height="300" dataFormat="json" [dataSource]="charts().spendByMonth"></fusioncharts></div>
        <div class="card chart"><fusioncharts type="doughnut2d" width="100%" height="300" dataFormat="json" [dataSource]="charts().spendByCategory"></fusioncharts></div>
        <div class="card chart"><fusioncharts type="mscolumn2d" width="100%" height="300" dataFormat="json" [dataSource]="charts().logins"></fusioncharts></div>
        <div class="card chart"><fusioncharts type="bar2d" width="100%" height="300" dataFormat="json" [dataSource]="charts().headcount"></fusioncharts></div>
      </section>

      <section class="grid-2">
        <div class="card">
          <div class="card-head"><h2>Recent logins</h2><a routerLink="/logins">View all →</a></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Result</th><th>IP</th><th>When</th></tr></thead>
              <tbody>
                @for (l of d.recentLogins; track l.id) {
                  <tr>
                    <td>{{ l.name }}</td>
                    <td><crm-badge [status]="l.success ? 'success' : (l.reason || 'failed')"></crm-badge></td>
                    <td class="mono">{{ l.ip }}</td>
                    <td>{{ l.created_at | utc | date: 'MMM d, h:mm a' }}</td>
                  </tr>
                } @empty { <tr><td colspan="4" class="muted">No logins yet</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Dormant accounts</h2><span class="muted small">Active, no login in 14+ days</span></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Department</th><th>Last login</th></tr></thead>
              <tbody>
                @for (u of d.inactive; track u.id) {
                  <tr>
                    <td><a [routerLink]="['/employees', u.id]">{{ u.name }}</a></td>
                    <td>{{ u.department }}</td>
                    <td>{{ u.last_login ? (u.last_login | utc | date: 'MMM d, y') : 'Never' }}</td>
                  </tr>
                } @empty { <tr><td colspan="3" class="muted">Everyone has logged in recently</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      </section>
    } @else if (!error()) {
      <div class="loading">Loading dashboard…</div>
    }
  `,
})
export class Dashboard implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  readonly d = signal<DashboardData | null>(null);
  readonly error = signal('');

  readonly scopeLabel = computed(() => {
    const u = this.auth.user();
    if (!u) return '';
    if (u.role === 'admin') return 'Company-wide overview';
    if (u.role === 'manager') return `Overview for the ${u.department} department`;
    return 'Your personal overview';
  });

  readonly charts = computed(() => {
    const d = this.d();
    if (!d) return { spendByMonth: {}, spendByCategory: {}, logins: {}, headcount: {} };
    const monthLabel = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    return {
      spendByMonth: singleSeries('Approved spend by month',
        d.spendByMonth.map((r) => ({ label: monthLabel(r.month), value: r.total })), { numberPrefix: '$', subCaption: 'Last 6 months' }),
      spendByCategory: singleSeries('Spend by category',
        d.spendByCategory.map((r) => ({ label: r.category, value: r.total })),
        { numberPrefix: '$', subCaption: `Last 90 days · ${money(d.spendByCategory.reduce((a, b) => a + b.total, 0))} total`, showLabels: 0, legendPosition: 'right' }),
      logins: multiSeries('Logins per day', d.loginsByDay.map((r) => r.day.slice(5)), [
        { name: 'Successful', values: d.loginsByDay.map((r) => r.ok), color: '#16a34a' },
        { name: 'Failed', values: d.loginsByDay.map((r) => r.failed), color: '#dc2626' },
      ], { subCaption: 'Last 14 days' }),
      headcount: singleSeries('Headcount by department', d.headcountByDept.map((r) => ({ label: r.department, value: r.n }))),
    };
  });

  async ngOnInit(): Promise<void> {
    try { this.d.set(await this.api.get<DashboardData>('/dashboard')); } catch (e) { this.error.set(errorMessage(e)); }
  }
}
