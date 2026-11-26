import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';

type Params = Record<string, string | number | boolean | null | undefined>;

/** Adds the CSRF header the API requires and redirects to /login when the session expires. */
export const crmInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const isApi = req.url.startsWith('/api');
  const r = isApi ? req.clone({ setHeaders: { 'X-Requested-With': 'crm' }, withCredentials: true }) : req;
  return next(r).pipe(
    catchError((err: HttpErrorResponse) => {
      if (isApi && err.status === 401 && !req.url.includes('/api/auth/')) router.navigate(['/login']);
      return throwError(() => err);
    }),
  );
};

export function toParams(p?: Params): HttpParams {
  let params = new HttpParams();
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
  }
  return params;
}

export function errorMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) return e.error?.error || e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  get<T>(url: string, params?: Params): Promise<T> {
    return firstValueFrom(this.http.get<T>('/api' + url, { params: toParams(params) }));
  }
  post<T>(url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>('/api' + url, body));
  }
  put<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>('/api' + url, body));
  }
  patch<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>('/api' + url, body));
  }
  delete<T>(url: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>('/api' + url));
  }
  /** Builds a same-origin URL for downloads (e.g. CSV export) carrying the current filters. */
  url(path: string, params?: Params): string {
    const qs = toParams(params).toString();
    return '/api' + path + (qs ? `?${qs}` : '');
  }
}
