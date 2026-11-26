import { DatePipe } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, OnInit, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Analytics } from '../core/analytics';
import { Api, errorMessage } from '../core/api';
import { Auth } from '../core/auth';
import { MoneyPipe, UtcPipe, money, utc } from '../core/format';
import { EmployeeRow, Meta, Paged, User } from '../core/models';
import { Pdf } from '../core/pdf';
import { Toast } from '../core/toast';

const BLANK = () => ({ name: '', email: '', password: '', role: 'employee', department: '', title: '', phone: '', salary: 0, office_id: '', manager_id: '', hire_date: '' });

@Component({
  selector: 'crm-employees',
  imports: [FormsModule, RouterLink, DatePipe, UtcPipe, MoneyPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="page-head">
      <div><h1>Employees</h1><p class="muted">{{ data()?.total ?? 0 }} people</p></div>
      <div class="actions">
        <button class="btn ghost" (click)="exportPdf()" id="employees-export-pdf">Export PDF</button>
        @if (auth.is('admin')) { <button class="btn primary" (click)="openCreate()" id="employees-add">+ Add employee</button> }
      </div>
    </div>

    <div class="card filters">
      <input type="search" placeholder="Search name, email, title…" [(ngModel)]="f.search" (ngModelChange)="debounced()" aria-label="Search" />
      <select [(ngModel)]="f.department" (ngModelChange)="reload()" aria-label="Department">
        <option value="">All departments</option>
        @for (d of meta()?.departments ?? []; track d) { <option [value]="d">{{ d }}</option> }
      </select>
      <select [(ngModel)]="f.role" (ngModelChange)="reload()" aria-label="Role">
        <option value="">All roles</option>
        @for (r of meta()?.roles ?? []; track r) { <option [value]="r">{{ r }}</option> }
      </select>
      <select [(ngModel)]="f.office_id" (ngModelChange)="reload()" aria-label="Office">
        <option value="">All offices</option>
        @for (o of meta()?.offices ?? []; track o.id) { <option [value]="o.id">{{ o.name }}</option> }
      </select>
      <select [(ngModel)]="f.status" (ngModelChange)="reload()" aria-label="Status">
        <option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option>
      </select>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><button class="sort" (click)="sortBy('name')">Name {{ arrow('name') }}</button></th>
              <th><button class="sort" (click)="sortBy('department')">Department {{ arrow('department') }}</button></th>
              <th>Role</th><th>Office</th>
              @if (!auth.is('employee')) { <th class="num"><button class="sort" (click)="sortBy('salary')">Salary {{ arrow('salary') }}</button></th> }
              <th><button class="sort" (click)="sortBy('last_login')">Last login {{ arrow('last_login') }}</button></th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (e of data()?.rows ?? []; track e.id) {
              <tr class="clickable" (click)="open(e)">
                <td><a [routerLink]="['/employees', e.id]" (click)="$event.stopPropagation()">{{ e.name }}</a><div class="small muted">{{ e.title }} · {{ e.email }}</div></td>
                <td>{{ e.department }}</td>
                <td><crm-badge [status]="e.role"></crm-badge></td>
                <td>{{ e.office_name || '—' }}</td>
                @if (!auth.is('employee')) { <td class="num">{{ e.salary | money }}</td> }
                <td>{{ e.last_login ? (e.last_login | utc | date: 'MMM d, h:mm a') : 'Never' }}</td>
                <td><crm-badge [status]="e.status"></crm-badge></td>
              </tr>
            } @empty { <tr><td colspan="7" class="muted">No employees match these filters</td></tr> }
          </tbody>
        </table>
      </div>
      <div class="pager">
        <button class="btn ghost" [disabled]="page() <= 1" (click)="go(page() - 1)">← Prev</button>
        <span>Page {{ page() }} of {{ pages() }}</span>
        <button class="btn ghost" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next →</button>
      </div>
    </div>

    <dialog #dlg class="dialog">
      <form (ngSubmit)="create()" #cf="ngForm">
        <h2>Add employee</h2>
        <div class="form-grid">
          <label>Full name<input name="name" [(ngModel)]="form.name" required /></label>
          <label>Email<input name="email" type="email" [(ngModel)]="form.email" required /></label>
          <label>Initial password<input name="password" type="password" [(ngModel)]="form.password" required minlength="8" autocomplete="new-password" /></label>
          <label>Role
            <select name="role" [(ngModel)]="form.role">@for (r of meta()?.roles ?? []; track r) { <option [value]="r">{{ r }}</option> }</select>
          </label>
          <label>Department<input name="department" [(ngModel)]="form.department" list="dept-list" required /></label>
          <label>Job title<input name="title" [(ngModel)]="form.title" /></label>
          <label>Phone<input name="phone" [(ngModel)]="form.phone" /></label>
          <label>Annual salary<input name="salary" type="number" min="0" [(ngModel)]="form.salary" /></label>
          <label>Office
            <select name="office_id" [(ngModel)]="form.office_id"><option value="">—</option>
              @for (o of meta()?.offices ?? []; track o.id) { <option [value]="o.id">{{ o.name }}</option> }</select>
          </label>
          <label>Manager
            <select name="manager_id" [(ngModel)]="form.manager_id"><option value="">—</option>
              @for (m of managers(); track m.id) { <option [value]="m.id">{{ m.name }} ({{ m.department }})</option> }</select>
          </label>
          <label>Hire date<input name="hire_date" type="date" [(ngModel)]="form.hire_date" /></label>
        </div>
        <datalist id="dept-list">@for (d of meta()?.departments ?? []; track d) { <option [value]="d"></option> }</datalist>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" (click)="dlg.close()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="cf.invalid || saving()">Create</button>
        </div>
      </form>
    </dialog>
  `,
})
export class Employees implements OnInit {
  readonly office_id = input<string>(); // ?office_id= query param (from the offices map)
  readonly auth = inject(Auth);
  private api = inject(Api);
  private router = inject(Router);
  private toast = inject(Toast);
  private pdf = inject(Pdf);
  private analytics = inject(Analytics);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly data = signal<Paged<EmployeeRow> | null>(null);
  readonly meta = signal<Meta | null>(null);
  readonly managers = signal<EmployeeRow[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly saving = signal(false);
  f = { search: '', department: '', role: '', status: '', office_id: '' };
  sort = { key: 'name', dir: 'asc' as 'asc' | 'desc' };
  form = BLANK();
  private timer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    this.f.office_id = this.office_id() ?? '';
    this.meta.set(await this.api.get<Meta>('/meta'));
    await this.load();
  }

  async load(): Promise<void> {
    try {
      const r = await this.api.get<Paged<EmployeeRow>>('/employees', { ...this.f, sort: this.sort.key, dir: this.sort.dir, page: this.page(), limit: 20 });
      this.data.set(r);
      this.pages.set(Math.max(1, Math.ceil(r.total / r.limit)));
    } catch (e) { this.toast.error(errorMessage(e)); }
  }

  reload(): void { this.page.set(1); this.load(); }
  debounced(): void { clearTimeout(this.timer); this.timer = setTimeout(() => this.reload(), 250); }
  go(p: number): void { this.page.set(p); this.load(); }
  open(e: EmployeeRow): void { this.router.navigate(['/employees', e.id]); }
  arrow(k: string): string { return this.sort.key === k ? (this.sort.dir === 'asc' ? '▲' : '▼') : ''; }
  sortBy(k: string): void {
    this.sort = { key: k, dir: this.sort.key === k && this.sort.dir === 'asc' ? 'desc' : 'asc' };
    this.load();
  }

  async openCreate(): Promise<void> {
    this.form = BLANK();
    const r = await this.api.get<Paged<EmployeeRow>>('/employees', { role: 'manager', limit: 100 });
    this.managers.set(r.rows);
    this.dlg().nativeElement.showModal();
  }

  async create(): Promise<void> {
    this.saving.set(true);
    try {
      const { employee } = await this.api.post<{ employee: User }>('/employees', this.form);
      this.dlg().nativeElement.close();
      this.toast.ok(`${employee.name} added`);
      this.analytics.event('employee_created');
      this.router.navigate(['/employees', employee.id]);
    } catch (e) { this.toast.error(errorMessage(e)); } finally { this.saving.set(false); }
  }

  async exportPdf(): Promise<void> {
    const r = await this.api.get<Paged<EmployeeRow>>('/employees', { ...this.f, sort: this.sort.key, dir: this.sort.dir, limit: 500 });
    const showSalary = !this.auth.is('employee');
    const cols = ['Name', 'Email', 'Department', 'Title', 'Role', 'Office', ...(showSalary ? ['Salary'] : []), 'Status', 'Last login'];
    const rows = r.rows.map((e) => [e.name, e.email, e.department, e.title, e.role, e.office_name, ...(showSalary ? [money(e.salary)] : []),
      e.status, e.last_login ? utc(e.last_login)!.toLocaleString() : 'Never']);
    await this.pdf.table('Employee directory', cols, rows, 'employees.pdf');
    this.analytics.event('export_pdf', { report: 'employees' });
  }
}
