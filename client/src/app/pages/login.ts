import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Analytics } from '../core/analytics';
import { errorMessage } from '../core/api';
import { Auth } from '../core/auth';

@Component({
  selector: 'crm-login',
  imports: [FormsModule],
  template: `
    <div class="login-wrap">
      <form class="card login-card" (ngSubmit)="submit()" #f="ngForm">
        <div class="brand big">Finnally <span>CRM</span></div>
        <p class="muted">Sign in to manage people, finances and activity.</p>
        <label>Email
          <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" autofocus />
        </label>
        <label>Password
          <input type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" />
        </label>
        @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
        <button class="btn primary block" type="submit" [disabled]="busy() || f.invalid">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
        <details class="demo">
          <summary>Demo accounts</summary>
          <p>Admin: <code>admin&#64;acme.test</code> / <code>Admin&#64;123</code></p>
          <p>Any other seeded user: their email / <code>Password&#64;123</code></p>
        </details>
      </form>
    </div>
  `,
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);
  private analytics = inject(Analytics);
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const user = await this.auth.login(this.email, this.password);
      this.analytics.identify(user);
      this.analytics.event('login', { role: user.role });
      await this.router.navigate(['/dashboard']);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.analytics.event('login_failed');
    } finally {
      this.busy.set(false);
    }
  }
}
