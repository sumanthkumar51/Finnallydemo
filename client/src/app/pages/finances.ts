import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, OnInit, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Analytics } from '../core/analytics';
import { Api, errorMessage } from '../core/api';
import { Auth } from '../core/auth';
import { MoneyPipe, money } from '../core/format';
import { EmployeeRow, Meta, Paged, Transaction } from '../core/models';
import { Pdf } from '../core/pdf';
import { Toast } from '../core/toast';

type TxPage = Paged<Transaction> & { sum: number };
const CATEGORIES = ['Travel', 'Meals', 'Software', 'Hardware', 'Training', 'Office Supplies', 'Client Entertainment', 'Internet & Phone', 'Other'];

@Component({
  selector: 'crm-finances',
  imports: [FormsModule, RouterLink, MoneyPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="page-head">
      <div><h1>Finances</h1><p class="muted">Expenses, reimbursements, payroll and approvals</p></div>
      <div class="actions">
        <a class="btn ghost" [href]="csvUrl()" download (click)="track('export_csv')">Export CSV</a>
        <button class="btn ghost" (click)="exportPdf()">Export PDF</button>
        <button class="btn primary" (click)="openNew()" id="finances-new">+ New request</button>
      </div>
    </div>

    <div class="card filters">
      <input type="search" placeholder="Search description or employee…" [(ngModel)]="f.search" (ngModelChange)="debounced()" aria-label="Search" />
      <select [(ngModel)]="f.status" (ngModelChange)="reload()" aria-label="Status">
        <option value="">Any status</option>@for (s of meta()?.txStatuses ?? []; track s) { <option [value]="s">{{ s }}</option> }
      </select>
      <select [(ngModel)]="f.type" (ngModelChange)="reload()" aria-label="Type">
        <option value="">Any type</option>@for (t of meta()?.txTypes ?? []; track t) { <option [value]="t">{{ t }}</option> }
      </select>
      <select [(ngModel)]="f.category" (ngModelChange)="reload()" aria-label="Category">
        <option value="">Any category</option>@for (c of meta()?.categories ?? []; track c) { <option [value]="c">{{ c }}</option> }
      </select>
      @if (auth.is('admin')) {
        <select [(ngModel)]="f.department" (ngModelChange)="reload()" aria-label="Department">
          <option value="">All departments</option>@for (d of meta()?.departments ?? []; track d) { <option [value]="d">{{ d }}</option> }
        </select>
      }
      <label class="inline">From <input type="date" [(ngModel)]="f.from" (ngModelChange)="reload()" /></label>
      <label class="inline">To <input type="date" [(ngModel)]="f.to" (ngModelChange)="reload()" /></label>
      @if (f.user_id) { <button class="btn ghost small" (click)="f.user_id = ''; reload()">Clear employee filter ✕</button> }
    </div>

    <div class="card">
      <div class="card-head"><h2>{{ data()?.total ?? 0 }} transactions</h2><strong>Total {{ data()?.sum | money }}</strong></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>Category</th><th>Description</th><th class="num">Amount</th><th>Status</th>
            @if (canReview()) { <th>Actions</th> }</tr></thead>
          <tbody>
            @for (t of data()?.rows ?? []; track t.id) {
              <tr>
                <td class="nowrap">{{ t.date }}</td>
                <td><a [routerLink]="['/employees', t.user_id]">{{ t.employee_name }}</a><div class="small muted">{{ t.department }}</div></td>
                <td>{{ t.type }}</td><td>{{ t.category }}</td>
                <td>{{ t.description }}@if (t.review_note) { <div class="small muted">Note: {{ t.review_note }}</div> }</td>
                <td class="num">{{ t.amount | money }}</td>
                <td><crm-badge [status]="t.status"></crm-badge>@if (t.reviewer_name) { <div class="small muted">by {{ t.reviewer_name }}</div> }</td>
                @if (canReview()) {
                  <td class="nowrap">
                    @if (t.user_id !== auth.user()?.id) {
                      @if (t.status === 'pending') {
                        <button class="btn small good" (click)="review(t, 'approved')">Approve</button>
                        <button class="btn small danger" (click)="review(t, 'rejected')">Reject</button>
                      } @else if (t.status === 'approved') {
                        <button class="btn small" (click)="review(t, 'paid')">Mark paid</button>
                      }
                    }
                  </td>
                }
              </tr>
            } @empty { <tr><td colspan="8" class="muted">No transactions match these filters</td></tr> }
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
      <form (ngSubmit)="submit()" #nf="ngForm">
        <h2>New financial request</h2>
        <div class="form-grid">
          @if (!auth.is('employee')) {
            <label>Employee
              <select name="user_id" [(ngModel)]="form.user_id" required>
                @for (e of people(); track e.id) { <option [ngValue]="e.id">{{ e.name }} — {{ e.department }}</option> }
              </select>
            </label>
          }
          <label>Type
            <select name="type" [(ngModel)]="form.type">@for (t of allowedTypes(); track t) { <option [value]="t">{{ t }}</option> }</select>
          </label>
          <label>Category<input name="category" [(ngModel)]="form.category" list="cat-list" required /></label>
          <label>Amount (USD)<input name="amount" type="number" min="0.01" step="0.01" [(ngModel)]="form.amount" required /></label>
          <label>Date<input name="date" type="date" [(ngModel)]="form.date" required /></label>
          <label class="span-2">Description<textarea name="description" rows="2" [(ngModel)]="form.description"></textarea></label>
        </div>
        <datalist id="cat-list">@for (c of categories; track c) { <option [value]="c"></option> }</datalist>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" (click)="dlg.close()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="nf.invalid">Submit</button>
        </div>
      </form>
    </dialog>
  `,
})
export class Finances implements OnInit {
  readonly user_id = input<string>(); // ?user_id= query param
  readonly auth = inject(Auth);
  private api = inject(Api);
  private toast = inject(Toast);
  private pdf = inject(Pdf);
  private analytics = inject(Analytics);
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  readonly data = signal<TxPage | null>(null);
  readonly meta = signal<Meta | null>(null);
  readonly people = signal<EmployeeRow[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly categories = CATEGORIES;
  f = { search: '', status: '', type: '', category: '', department: '', from: '', to: '', user_id: '' };
  form = this.blank();
  private timer?: ReturnType<typeof setTimeout>;

  blank() {
    return { user_id: this.auth.user()?.id ?? 0, type: 'expense', category: 'Travel', amount: null as number | null, date: new Date().toISOString().slice(0, 10), description: '' };
  }

  async ngOnInit(): Promise<void> {
    this.f.user_id = this.user_id() ?? '';
    this.meta.set(await this.api.get<Meta>('/meta'));
    await this.load();
  }

  canReview(): boolean { return this.auth.is('admin', 'manager'); }
  allowedTypes(): string[] {
    return this.auth.is('employee') ? ['expense', 'reimbursement', 'advance'] : (this.meta()?.txTypes ?? []);
  }

  async load(): Promise<void> {
    try {
      const r = await this.api.get<TxPage>('/transactions', { ...this.f, page: this.page(), limit: 25 });
      this.data.set(r);
      this.pages.set(Math.max(1, Math.ceil(r.total / r.limit)));
    } catch (e) { this.toast.error(errorMessage(e)); }
  }
  reload(): void { this.page.set(1); this.load(); }
  debounced(): void { clearTimeout(this.timer); this.timer = setTimeout(() => this.reload(), 250); }
  go(p: number): void { this.page.set(p); this.load(); }
  csvUrl(): string { return this.api.url('/transactions.csv', this.f); }
  track(name: string): void { this.analytics.event(name, { report: 'transactions' }); }

  async review(t: Transaction, status: 'approved' | 'rejected' | 'paid'): Promise<void> {
    let note: string | null = null;
    if (status === 'rejected') {
      note = prompt('Reason for rejection (optional):');
      if (note === null) return;
    }
    try {
      await this.api.patch(`/transactions/${t.id}/status`, { status, note });
      this.toast.ok(`${money(t.amount)} for ${t.employee_name} ${status}`);
      this.analytics.event('transaction_reviewed', { status });
      await this.load();
    } catch (e) { this.toast.error(errorMessage(e)); }
  }

  async openNew(): Promise<void> {
    this.form = this.blank();
    if (!this.auth.is('employee') && !this.people().length) {
      this.people.set((await this.api.get<Paged<EmployeeRow>>('/employees', { status: 'active', limit: 500 })).rows);
    }
    this.dlg().nativeElement.showModal();
  }

  async submit(): Promise<void> {
    try {
      await this.api.post('/transactions', this.form);
      this.dlg().nativeElement.close();
      this.toast.ok('Request submitted');
      this.analytics.event('transaction_created', { type: this.form.type });
      this.reload();
    } catch (e) { this.toast.error(errorMessage(e)); }
  }

  async exportPdf(): Promise<void> {
    const r = await this.api.get<TxPage>('/transactions', { ...this.f, limit: 500 });
    await this.pdf.table('Financial transactions', ['Date', 'Employee', 'Department', 'Type', 'Category', 'Amount', 'Status', 'Reviewer'],
      r.rows.map((t) => [t.date, t.employee_name, t.department, t.type, t.category, money(t.amount), t.status, t.reviewer_name]),
      'transactions.pdf', `${r.total} matching · total ${money(r.sum)}${r.total > 500 ? ' · first 500 shown' : ''}`);
    this.track('export_pdf');
  }
}
