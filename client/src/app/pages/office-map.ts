import { Component, OnInit, inject, signal } from '@angular/core';
import { GoogleMap, MapAdvancedMarker, MapInfoWindow } from '@angular/google-maps';
import { RouterLink } from '@angular/router';
import { Analytics } from '../core/analytics';
import { Api, errorMessage } from '../core/api';
import { MapsLoader } from '../core/maps';
import { Office } from '../core/models';

@Component({
  selector: 'crm-office-map',
  imports: [GoogleMap, MapAdvancedMarker, MapInfoWindow, RouterLink],
  template: `
    <div class="page-head">
      <div><h1>Offices map</h1><p class="muted">Where your people work</p></div>
    </div>
    @if (error()) { <div class="alert error">{{ error() }}</div> }

    @if (mapsReady()) {
      <div class="card map-card">
        <google-map width="100%" height="460px" [center]="center" [zoom]="2" [options]="{ mapId: 'DEMO_MAP_ID', streetViewControl: false }">
          @for (o of offices(); track o.id) {
            <map-advanced-marker #m="mapAdvancedMarker" [position]="{ lat: o.lat, lng: o.lng }" [title]="o.name + ' — ' + o.headcount + ' people'"
              (mapClick)="select(o); info.open(m)" />
          }
          <map-info-window #info="mapInfoWindow">
            @if (selected(); as s) {
              <div class="info"><strong>{{ s.name }}</strong><br />{{ s.address }}, {{ s.city }}, {{ s.country }}<br />{{ s.headcount }} active employees</div>
            }
          </map-info-window>
        </google-map>
      </div>
    } @else if (!hasKey()) {
      <div class="alert info">Interactive Google Map is off: set <code>GOOGLE_MAPS_API_KEY</code> on the server to enable it. Each office below links to Google Maps.</div>
    }

    <section class="office-grid">
      @for (o of offices(); track o.id) {
        <div class="card office">
          <h2>{{ o.name }}</h2>
          <p class="muted">{{ o.address }}<br />{{ o.city }}, {{ o.country }}</p>
          <p><strong>{{ o.headcount }}</strong> active employees</p>
          <div class="office-links">
            <a [href]="'https://www.google.com/maps/search/?api=1&query=' + o.lat + ',' + o.lng" target="_blank" rel="noopener">Open in Google Maps ↗</a>
            <a routerLink="/employees" [queryParams]="{ office_id: o.id }" (click)="filter(o)">View people →</a>
          </div>
        </div>
      }
    </section>
  `,
})
export class OfficeMap implements OnInit {
  private api = inject(Api);
  private analytics = inject(Analytics);
  private loader = inject(MapsLoader);
  readonly offices = signal<Office[]>([]);
  readonly selected = signal<Office | null>(null);
  readonly mapsReady = signal(false);
  readonly hasKey = signal(false);
  readonly error = signal('');
  readonly center = { lat: 25, lng: 40 };

  async ngOnInit(): Promise<void> {
    try { this.offices.set((await this.api.get<{ rows: Office[] }>('/offices')).rows); } catch (e) { this.error.set(errorMessage(e)); }
    const key = this.analytics.config.googleMapsApiKey;
    this.hasKey.set(!!key);
    if (key) {
      try { await this.loader.load(key); this.mapsReady.set(true); } catch (e) { this.error.set(errorMessage(e)); }
    }
  }
  select(o: Office): void { this.selected.set(o); this.analytics.event('office_marker_click', { office: o.name }); }
  filter(o: Office): void { this.analytics.event('office_people_click', { office: o.name }); }
}
