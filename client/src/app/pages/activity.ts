import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { FusionChartsModule } from 'angular-fusioncharts';
import { singleSeries } from '../core/charts';
import { UtcPipe, utc } from '../core/format';
import { ActivityRow, Paged } from '../core/models';
import { Pdf } from '../core/pdf';
import { Toast } from '../core/toast';

type ActivityPage = Paged<ActivityRow> & {
  topUsers: { id: number; name: string; n: number }[];
  byAction: { action: string; n: number }[];
  topPages: { page: string; n: number }[];
};

@Component({
  selector: 'crm-activity',
  imports: [FormsModule, RouterLink, DatePipe, UtcPipe, FusionChartsModule],
  template: `
    <div class="page-head">
      <div><h1>Usage & audit log</h1><p class="muted">What people do in the CRM — page views, changes, approvals and exports</p></div>
      <div class="actions"><button class="btn ghost" (click)="exportPdf()">Export PDF</button></div>
    </div>

    @if (data(); as d) {
      <section class="grid-3">
        <div class="card chart"><fusioncharts type="pie2d" width="100%" height="280" dataFormat="json" [dataSource]="charts().actions"></fusioncharts></div>
        <div class="card chart"><fusioncharts type="bar2d" width="100%" height="280" dataFormat="json" [dataSource]="charts().pages"></fusioncharts></div>
        <div class="card">
          <h2>Most active users <span class="muted small">(30 days)</span></h2>
          <ol class="ranked">
            @for (u of d.topUsers; track u.id) { <li><a [routerLink]="['/employees', u.id]">{{ u.name }}</a><span>{{ u.n }}</span></li> }
          </ol>
        </div>
      </section>
    }

    <div class="card filters">
      <input type="search" placeholder="Search user or details…" [(ngModel)]="f.search" (ngModelChange)="debounced()" aria-label="Search" />
      <select [(ngModel)]="f.action" (ngModelChange)="reload()" aria-label="Action">
        <option value="">All actions</option>
        @for (a of actions; track a) { <option [value]="a">{{ a.replace('_', ' ') }}</option> }
      </select>
    </div>

    <div class="card">
      <div class="card-head"><h2>{{ data()?.total ?? 0 }} events</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            @for (a of data()?.rows ?? []; track a.id) {
              <tr>
                <td class="nowrap">{{ a.created_at | utc | date: 'MMM d, h:mm:ss a' }}</td>
                <td><a [routerLink]="['/employees', a.user_id]">{{ a.name }}</a></td>
                <td><span class="tag">{{ a.action.replace('_', ' ') }}</span></td>
                <td>@if (a.entity === 'employee' && a.entity_id) { <a [routerLink]="['/employees', a.entity_id]">employee #{{ a.entity_id }}</a> }
                    @else { {{ a.entity ? a.entity + (a.entity_id ? ' #' + a.entity_id : '') : '' }} }</td>
                <td class="details">{{ a.details }}</td>
                <td class="mono">{{ a.ip }}</td>
              </tr>
            } @empty { <tr><td colspan="6" class="muted">No activity</td></tr> }
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
export class Activity implements OnInit {
  private api = inject(Api);
  private toast = inject(Toast);
  private pdf = inject(Pdf);
  readonly data = signal<ActivityPage | null>(null);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly actions = ['page_view', 'login', 'logout', 'view', 'create', 'update', 'delete', 'approved', 'rejected', 'paid', 'export', 'password_change'];
  f = { search: '', action: '' };
  private timer?: ReturnType<typeof setTimeout>;

  readonly charts = computed(() => {
    const d = this.data();
    return {
      actions: singleSeries('Actions (30 days)', (d?.byAction ?? []).map((a) => ({ label: a.action.replace('_', ' '), value: a.n }))),
      pages: singleSeries('Most visited pages', (d?.topPages ?? []).map((p) => ({ label: p.page, value: p.n }))),
    };
  });

  async ngOnInit(): Promise<void> { await this.load(); }
  async load(): Promise<void> {
    try {
      const r = await this.api.get<ActivityPage>('/activity', { ...this.f, page: this.page(), limit: 30 });
      this.data.set(r);
      this.pages.set(Math.max(1, Math.ceil(r.total / r.limit)));
    } catch (e) { this.toast.error(errorMessage(e)); }
  }
  reload(): void { this.page.set(1); this.load(); }
  debounced(): void { clearTimeout(this.timer); this.timer = setTimeout(() => this.reload(), 250); }
  go(p: number): void { this.page.set(p); this.load(); }

  async exportPdf(): Promise<void> {
    const r = await this.api.get<ActivityPage>('/activity', { ...this.f, limit: 500 });
    await this.pdf.table('Usage & audit log', ['When', 'User', 'Action', 'Target', 'Details', 'IP'],
      r.rows.map((a) => [utc(a.created_at)!.toLocaleString(), a.name, a.action, a.entity ? `${a.entity} #${a.entity_id ?? ''}` : '', a.details, a.ip]),
      'audit-log.pdf', `${r.total} events${r.total > 500 ? ' · latest 500 shown' : ''}`);
  }
}
