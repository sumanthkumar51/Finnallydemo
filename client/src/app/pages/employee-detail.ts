import { DatePipe } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, inject, input, signal, viewChild, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { Auth } from '../core/auth';
import { DevicePipe, MoneyPipe, UtcPipe, money } from '../core/format';
import { ActivityRow, EmployeeRow, LoginEvent, Meta, Office, Paged, Transaction, User } from '../core/models';
import { Pdf } from '../core/pdf';
import { Toast } from '../core/toast';

interface Detail {
  employee: User;
  manager: { id: number; name: string } | null;
  office: Office | null;
  finance: { count: number; pending: number; spend: number; paid_out: number };
  loginStats: { total: number; ok: number; failed: number; last_login: string | null };
  transactions: Transaction[];
  logins: LoginEvent[];
  activity: ActivityRow[];
  reports: { id: number; name: string; title: string }[];
}

@Component({
  selector: 'crm-employee-detail',
  imports: [FormsModule, RouterLink, DatePipe, UtcPipe, MoneyPipe, DevicePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <a routerLink="/employees" class="back">← Employees</a>
    @if (d(); as d) {
      <div class="page-head">
        <div class="person">
          <div class="avatar" aria-hidden="true">{{ initials(d.employee.name) }}</div>
          <div>
            <h1>{{ d.employee.name }}</h1>
            <p class="muted">{{ d.employee.title }} · {{ d.employee.department }}
              <crm-badge [status]="d.employee.role"></crm-badge> <crm-badge [status]="d.employee.status"></crm-badge></p>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost" (click)="exportPdf()">Export PDF</button>
          @if (canEdit()) { <button class="btn ghost" (click)="openEdit()">Edit</button> }
          @if (auth.is('admin') && auth.user()?.id !== d.employee.id) { <button class="btn danger" (click)="remove()">Delete</button> }
        </div>
      </div>

      <section class="stats">
        <crm-stat-card label="Approved spend" [value]="d.finance.spend | money" [hint]="d.finance.count + ' transactions'"></crm-stat-card>
        <crm-stat-card label="Pending" [value]="d.finance.pending | money" tone="warn"></crm-stat-card>
        <crm-stat-card label="Salary & bonus paid" [value]="d.finance.paid_out | money" tone="good"></crm-stat-card>
        <crm-stat-card label="Logins" [value]="'' + (d.loginStats.ok || 0)" [hint]="(d.loginStats.failed || 0) + ' failed attempts'"
          [tone]="d.loginStats.failed > 3 ? 'bad' : 'default'"></crm-stat-card>
      </section>

      <section class="grid-2">
        <div class="card">
          <h2>Profile</h2>
          <dl class="kv">
            <dt>Email</dt><dd>{{ d.employee.email }}</dd>
            <dt>Phone</dt><dd>{{ d.employee.phone || '—' }}</dd>
            <dt>Manager</dt><dd>@if (d.manager) { <a [routerLink]="['/employees', d.manager.id]">{{ d.manager.name }}</a> } @else { — }</dd>
            <dt>Office</dt><dd>@if (d.office) { {{ d.office.name }}, {{ d.office.country }} <a routerLink="/map" class="small">map</a> } @else { — }</dd>
            <dt>Hire date</dt><dd>{{ d.employee.hire_date | date: 'mediumDate' }}</dd>
            @if (d.employee.salary !== null) { <dt>Salary</dt><dd>{{ d.employee.salary | money }} / year</dd> }
            <dt>Last login</dt><dd>{{ d.loginStats.last_login ? (d.loginStats.last_login | utc | date: 'medium') : 'Never' }}</dd>
          </dl>
          @if (d.reports.length) {
            <h3>Direct reports ({{ d.reports.length }})</h3>
            <ul class="chips">@for (r of d.reports; track r.id) { <li><a [routerLink]="['/employees', r.id]">{{ r.name }}</a></li> }</ul>
          }
        </div>
        <div class="card">
          <div class="card-head"><h2>Recent transactions</h2><a routerLink="/finances" [queryParams]="{ user_id: d.employee.id }">All →</a></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Category</th><th class="num">Amount</th><th>Status</th></tr></thead>
              <tbody>
                @for (t of d.transactions; track t.id) {
                  <tr><td class="nowrap">{{ t.date }}</td><td>{{ t.type }}</td><td>{{ t.category }}</td><td class="num">{{ t.amount | money }}</td>
                    <td><crm-badge [status]="t.status"></crm-badge></td></tr>
                } @empty { <tr><td colspan="5" class="muted">No transactions</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h2>Login history</h2>
          <div class="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Result</th><th>IP</th><th>Device</th><th>Session</th></tr></thead>
              <tbody>
                @for (l of d.logins; track l.id) {
                  <tr><td>{{ l.created_at | utc | date: 'MMM d, h:mm a' }}</td>
                    <td><crm-badge [status]="l.success ? 'success' : (l.reason || 'failed')"></crm-badge></td>
                    <td class="mono">{{ l.ip }}</td><td>{{ l.user_agent | device }}</td>
                    <td>{{ l.logout_at ? duration(l) : (l.success ? 'open' : '') }}</td></tr>
                } @empty { <tr><td colspan="5" class="muted">No logins</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h2>Recent activity</h2>
          <ul class="timeline">
            @for (a of d.activity; track a.id) {
              <li><span class="tag">{{ a.action.replace('_', ' ') }}</span> {{ a.entity ? a.entity + (a.entity_id ? ' #' + a.entity_id : '') : (a.details || '') }}
                <span class="muted small">{{ a.created_at | utc | date: 'MMM d, h:mm a' }}</span></li>
            } @empty { <li class="muted">No activity</li> }
          </ul>
        </div>
      </section>

      <dialog #dlg class="dialog">
        <form (ngSubmit)="save()">
          <h2>Edit {{ d.employee.name }}</h2>
          <div class="form-grid">
            <label>Full name<input name="name" [(ngModel)]="form.name" required /></label>
            <label>Phone<input name="phone" [(ngModel)]="form.phone" /></label>
            @if (auth.is('admin')) {
              <label>Email<input name="email" type="email" [(ngModel)]="form.email" /></label>
              <label>Job title<input name="title" [(ngModel)]="form.title" /></label>
              <label>Department<input name="department" [(ngModel)]="form.department" /></label>
              <label>Role<select name="role" [(ngModel)]="form.role">@for (r of meta()?.roles ?? []; track r) { <option [value]="r">{{ r }}</option> }</select></label>
              <label>Annual salary<input name="salary" type="number" min="0" [(ngModel)]="form.salary" /></label>
              <label>Status<select name="status" [(ngModel)]="form.status"><option value="active">active</option><option value="inactive">inactive</option></select></label>
              <label>Office<select name="office_id" [(ngModel)]="form.office_id"><option [ngValue]="null">—</option>
                @for (o of meta()?.offices ?? []; track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }</select></label>
              <label>Manager<select name="manager_id" [(ngModel)]="form.manager_id"><option [ngValue]="null">—</option>
                @for (m of managers(); track m.id) { <option [ngValue]="m.id">{{ m.name }}</option> }</select></label>
              <label>Hire date<input name="hire_date" type="date" [(ngModel)]="form.hire_date" /></label>
            }
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn ghost" (click)="dlg.close()">Cancel</button>
            <button type="submit" class="btn primary">Save</button>
          </div>
        </form>
      </dialog>
    } @else if (error()) {
      <div class="alert error">{{ error() }}</div>
    } @else { <div class="loading">Loading…</div> }
  `,
})
export class EmployeeDetail {
  readonly id = input.required<string>();
  readonly auth = inject(Auth);
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(Toast);
  private pdf = inject(Pdf);
  private dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  readonly d = signal<Detail | null>(null);
  readonly meta = signal<Meta | null>(null);
  readonly managers = signal<EmployeeRow[]>([]);
  readonly error = signal('');
  form: Partial<User> = {};

  constructor() {
    effect(() => { const id = this.id(); this.load(id); });
  }

  async load(id: string): Promise<void> {
    this.d.set(null); this.error.set('');
    try { this.d.set(await this.api.get<Detail>(`/employees/${id}`)); } catch (e) { this.error.set(errorMessage(e)); }
  }

  canEdit(): boolean {
    const d = this.d();
    return !!d && (this.auth.is('admin') || this.auth.user()?.id === d.employee.id);
  }

  initials(n: string): string { return n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase(); }
  duration(l: LoginEvent): string {
    const m = l.session_minutes ?? 0;
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  }

  async openEdit(): Promise<void> {
    const e = this.d()!.employee;
    this.form = { ...e };
    if (this.auth.is('admin')) {
      const [meta, mgrs] = await Promise.all([this.api.get<Meta>('/meta'), this.api.get<Paged<EmployeeRow>>('/employees', { role: 'manager', limit: 100 })]);
      this.meta.set(meta);
      this.managers.set([...mgrs.rows, ...(await this.api.get<Paged<EmployeeRow>>('/employees', { role: 'admin', limit: 20 })).rows]
        .filter((m) => m.id !== e.id));
    }
    this.dlg()?.nativeElement.showModal();
  }

  async save(): Promise<void> {
    try {
      const { employee } = await this.api.put<{ employee: User }>(`/employees/${this.d()!.employee.id}`, this.form);
      this.dlg()?.nativeElement.close();
      if (employee.id === this.auth.user()?.id) this.auth.refresh(employee);
      this.toast.ok('Saved');
      await this.load(this.id());
    } catch (e) { this.toast.error(errorMessage(e)); }
  }

  async remove(): Promise<void> {
    const e = this.d()!.employee;
    if (!confirm(`Delete ${e.name}? This also removes their transactions and login history.`)) return;
    try {
      await this.api.delete(`/employees/${e.id}`);
      this.toast.ok(`${e.name} deleted`);
      this.router.navigate(['/employees']);
    } catch (err) { this.toast.error(errorMessage(err)); }
  }

  async exportPdf(): Promise<void> {
    const d = this.d()!;
    await this.pdf.table(`${d.employee.name} — recent transactions`, ['Date', 'Type', 'Category', 'Description', 'Amount', 'Status'],
      d.transactions.map((t) => [t.date, t.type, t.category, t.description, money(t.amount), t.status]),
      `employee-${d.employee.id}.pdf`, `${d.employee.title} · ${d.employee.department} · ${d.employee.email}`);
  }
}
