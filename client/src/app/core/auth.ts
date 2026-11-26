import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Api } from './api';
import { Role, User } from './models';

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  readonly user = signal<User | null>(null);
  private loaded = false;

  async load(): Promise<User | null> {
    if (this.loaded) return this.user();
    try {
      this.user.set((await this.api.get<{ user: User }>('/auth/me')).user);
    } catch {
      this.user.set(null);
    }
    this.loaded = true;
    return this.user();
  }

  async login(email: string, password: string): Promise<User> {
    const { user } = await this.api.post<{ user: User }>('/auth/login', { email, password });
    this.user.set(user);
    this.loaded = true;
    return user;
  }

  async logout(): Promise<void> {
    try { await this.api.post('/auth/logout'); } finally { this.user.set(null); }
  }

  refresh(user: User): void { this.user.set(user); }

  is(...roles: Role[]): boolean {
    const u = this.user();
    return !!u && roles.includes(u.role);
  }
}

/** Requires a signed-in user; optional `data.roles` restricts the route further. */
export const authGuard: CanActivateFn = async (route) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const user = await auth.load();
  if (!user) return router.createUrlTree(['/login']);
  const roles = route.data['roles'] as Role[] | undefined;
  if (roles && !roles.includes(user.role)) return router.createUrlTree(['/dashboard']);
  return true;
};
