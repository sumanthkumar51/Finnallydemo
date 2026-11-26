import { Injectable } from '@angular/core';

/** Loads the Google Maps JavaScript API once, on demand. */
@Injectable({ providedIn: 'root' })
export class MapsLoader {
  private loading?: Promise<void>;

  load(apiKey: string): Promise<void> {
    if (typeof google !== 'undefined' && google.maps?.Map) return Promise.resolve();
    this.loading ??= new Promise<void>((resolve, reject) => {
      const cb = '__crmMapsReady';
      (window as unknown as Record<string, () => void>)[cb] = () => resolve();
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker&loading=async&callback=${cb}`;
      s.onerror = () => { this.loading = undefined; reject(new Error('Google Maps failed to load')); };
      document.head.appendChild(s);
    });
    return this.loading;
  }
}
