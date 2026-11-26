import { DatePipe } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { Auth } from '../core/auth';
import { MoneyPipe } from '../core/format';
import { User } from '../core/models';
import { Toast } from '../core/toast';

@Component({
  selector: 'crm-profile',
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (auth.user(); as u) {
      <div class="page-head">
        <div><h1>My profile</h1><p class="muted">{{ u.email }}</p></div>
        <div class="actions"><a class="btn ghost" [routerLink]="['/employees', u.id]">View my activity →</a></div>
      </div>
      <section class="grid-2">
        <form class="card" (ngSubmit)="save()">
          <h2>Contact details</h2>
          <label>Full name<input name="name" [(ngModel)]="name" required /></label>
          <label>Phone<input name="phone" [(ngModel)]="phone" /></label>
          <dl class="kv">
            <dt>Role</dt><dd><crm-badge [status]="u.role"></crm-badge></dd>
            <dt>Department</dt><dd>{{ u.department }}</dd>
            <dt>Title</dt><dd>{{ u.title }}</dd>
            <dt>Salary</dt><dd>{{ u.salary | money }}</dd>
            <dt>Hire date</dt><dd>{{ u.hire_date | date: 'mediumDate' }}</dd>
          </dl>
          <button class="btn primary" type="submit">Save</button>
        </form>
        <form class="card" (ngSubmit)="changePassword()" #pf="ngForm">
          <h2>Change password</h2>
          <label>Current password<input type="password" name="current" [(ngModel)]="pw.current" required autocomplete="current-password" /></label>
          <label>New password<input type="password" name="next" [(ngModel)]="pw.next" required minlength="8" autocomplete="new-password" /></label>
          <label>Confirm new password<input type="password" name="confirm" [(ngModel)]="pw.confirm" required autocomplete="new-password" /></label>
          <p class="small muted">Changing your password signs you out on all other devices.</p>
          <button class="btn primary" type="submit" [disabled]="pf.invalid">Update password</button>
        </form>
      </section>
    }
  `,
})
export class Profile {
  readonly auth = inject(Auth);
  private api = inject(Api);
  private toast = inject(Toast);
  name = this.auth.user()?.name ?? '';
  phone = this.auth.user()?.phone ?? '';
  pw = { current: '', next: '', confirm: '' };

  async save(): Promise<void> {
    try {
      const { employee } = await this.api.put<{ employee: User }>(`/employees/${this.auth.user()!.id}`, { name: this.name, phone: this.phone });
      this.auth.refresh(employee);
      this.toast.ok('Profile updated');
    } catch (e) { this.toast.error(errorMessage(e)); }
  }

  async changePassword(): Promise<void> {
    if (this.pw.next !== this.pw.confirm) { this.toast.error('New passwords do not match'); return; }
    try {
      await this.api.post('/auth/password', { current: this.pw.current, next: this.pw.next });
      this.pw = { current: '', next: '', confirm: '' };
      this.toast.ok('Password changed');
    } catch (e) { this.toast.error(errorMessage(e)); }
  }
}
