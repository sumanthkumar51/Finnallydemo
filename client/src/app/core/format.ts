import { Pipe, PipeTransform } from '@angular/core';

/** SQLite stores UTC timestamps as "YYYY-MM-DD HH:MM:SS"; convert to a Date so DatePipe shows local time. */
export function utc(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
}

@Pipe({ name: 'utc' })
export class UtcPipe implements PipeTransform {
  transform(v: string | null | undefined): Date | null { return utc(v); }
}

export function money(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

/** Summarises a user agent string as "Browser on OS". */
export function device(ua: string | null | undefined): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) || /AppleWebKit/.test(ua) ? 'Safari' : /python|curl|wget/i.test(ua) ? 'Script' : 'Other';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

@Pipe({ name: 'device' })
export class DevicePipe implements PipeTransform {
  transform(v: string | null | undefined): string { return device(v); }
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(v: number | null | undefined): string { return money(v); }
}
