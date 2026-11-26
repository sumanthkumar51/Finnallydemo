import { LitElement, css, html, nothing } from 'lit';

/**
 * <crm-stat-card label="Pending" value="$1,200" hint="12 items" tone="warn">
 * A framework-agnostic KPI tile built with Lit. Angular binds to it as a regular custom element.
 */
export class CrmStatCard extends LitElement {
  static override properties = {
    label: { type: String },
    value: { type: String },
    hint: { type: String },
    tone: { type: String, reflect: true },
  };
  declare label: string;
  declare value: string;
  declare hint: string;
  declare tone: 'default' | 'good' | 'warn' | 'bad';

  constructor() {
    super();
    this.label = '';
    this.value = '';
    this.hint = '';
    this.tone = 'default';
  }

  static override styles = css`
    :host {
      display: block; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 16px 18px; border-top: 4px solid #2563eb; min-width: 0;
    }
    :host([tone='good']) { border-top-color: #16a34a; }
    :host([tone='warn']) { border-top-color: #f59e0b; }
    :host([tone='bad']) { border-top-color: #dc2626; }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; font-weight: 600; }
    .value { font-size: 26px; font-weight: 700; color: #111827; margin-top: 6px; font-variant-numeric: tabular-nums;
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hint { font-size: 12px; color: #6b7280; margin-top: 4px; }
  `;

  override render() {
    return html`
      <div class="label">${this.label}</div>
      <div class="value">${this.value}</div>
      ${this.hint ? html`<div class="hint">${this.hint}</div>` : nothing}
    `;
  }
}

/** <crm-badge status="pending"></crm-badge> - coloured status pill. */
export class CrmBadge extends LitElement {
  static override properties = { status: { type: String, reflect: true } };
  declare status: string;

  constructor() { super(); this.status = ''; }

  static override styles = css`
    :host { display: inline-block; }
    span { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;
           text-transform: capitalize; background: #e5e7eb; color: #374151; white-space: nowrap; }
    :host([status='pending']) span { background: #fef3c7; color: #92400e; }
    :host([status='approved']) span, :host([status='active']) span, :host([status='success']) span { background: #dcfce7; color: #166534; }
    :host([status='paid']) span { background: #dbeafe; color: #1e40af; }
    :host([status='rejected']) span, :host([status='failed']) span, :host([status='inactive']) span,
    :host([status='locked']) span { background: #fee2e2; color: #991b1b; }
    :host([status='admin']) span { background: #ede9fe; color: #5b21b6; }
    :host([status='manager']) span { background: #e0f2fe; color: #075985; }
  `;

  override render() { return html`<span>${this.status.replace(/_/g, ' ')}</span>`; }
}

for (const [tag, ctor] of [['crm-stat-card', CrmStatCard], ['crm-badge', CrmBadge]] as const) {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}
