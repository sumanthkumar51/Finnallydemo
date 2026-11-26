# Finnally CRM

An internal CRM for a company of about 100 employees. It tracks:

- **People**: employee directory, roles, departments, managers, offices and salaries
- **Finances**: expenses, reimbursements, advances, salary and bonus payments, with an approve → pay workflow
- **Login activity**: every sign-in attempt (successful or failed), IP, device, session length, active sessions and account lockout
- **Usage and audit**: page views, record views, edits, approvals and exports, with who did what and when

## Tech stack

| Area | What's used |
|---|---|
| Frontend framework | **Angular 22** (standalone components, signals) with **Zone.js** change detection |
| Language | **TypeScript** (frontend) |
| Charts | **FusionCharts** via `angular-fusioncharts` (loaded only on pages that have charts) |
| Web components | **Lit** (`lit-html` + `LitElement`): `<crm-stat-card>` and `<crm-badge>` |
| JS libraries | **jQuery** (toast notifications), **Hammer.js** (swipe gestures for the mobile menu), **core-js** (targeted polyfills) |
| Maps | **Google Maps** via `@angular/google-maps` (offices map) |
| Analytics | **Google Analytics 4**, **Google Tag Manager**, **Microsoft Clarity**, **Pendo** |
| User onboarding | **Pendo** guides |
| PDF | **jsPDF** + `jspdf-autotable` (export any list as a PDF report) |
| Build | Angular CLI (esbuild + **Babel**) |
| Backend | Node.js 22 + Express 5, SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile) |

## Run it in your browser (no install)

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/sumanthkumar51/Finnallydemo?ref=claude/focused-sagan-y7j7q2)

Click the button, then **Create codespace**. The first time, it takes about 3–5 minutes to install and build. After that the CRM opens in a new browser tab. If the tab doesn't open, go to the **Ports** tab and click the globe icon next to port 3000.

## Quick start

Requires **Node.js 22.13 or newer**.

```bash
npm run setup      # installs server + client dependencies
npm run build      # builds the Angular app into client/dist
npm start          # http://localhost:3000
```

On first start the database is empty, so the server seeds demo data: 100 employees, about 6 months of transactions, and about 60 days of logins and usage.

| Account | Email | Password |
|---|---|---|
| Admin | `admin@acme.test` | `Admin@123` |
| Any other seeded user (managers, employees) | their email, shown in the Employees list | `Password@123` |

To reset the demo data, run `npm run seed`. This deletes `data/crm.db` and seeds it again.

### Development

```bash
npm run dev:api      # API on :3000 with auto-restart
npm run dev:client   # Angular dev server on :4200, proxies /api to :3000
npm test             # API integration tests
```

## Roles and permissions

| | Admin | Manager | Employee |
|---|---|---|---|
| See employees | everyone | own department | self only |
| See salaries | yes | own department | own only |
| Add, edit or delete employees | yes | no | edit own name and phone |
| Submit financial requests | for anyone, any type | for their department | own expenses, reimbursements and advances |
| Approve, reject or mark paid | yes | own department (not their own requests) | no |
| Login activity | everyone, including unknown-email attempts and active sessions | own department | own |
| Usage and audit log | everyone | own department | no |

Transaction status flow: `pending → approved → paid`, or `pending/approved → rejected`. Nobody can review their own request.

## Configuring analytics, onboarding and maps

All integrations are **off until you set an ID**. The server reads these from environment variables and exposes them to the browser through `GET /api/public-config` (see `.env.example`):

```bash
GA_MEASUREMENT_ID=G-XXXXXXX GTM_CONTAINER_ID=GTM-XXXXXX CLARITY_PROJECT_ID=abc123 \
PENDO_API_KEY=xxxxxxxx GOOGLE_MAPS_API_KEY=AIza... npm start
```

- **GA4 / GTM**: SPA route changes send `page_view` (GA4) and `virtual_page_view` (to the GTM `dataLayer`). Custom events such as `login`, `transaction_created`, `transaction_reviewed`, `export_pdf` and `export_csv` go to GA4, GTM, Clarity and Pendo.
- **Pendo**: visitors are identified as `crm-<id>` with `role`, `department` and `hireDate`, so you can target onboarding guides, for example "new employees in their first 30 days" or "managers with pending approvals". Navigation links have stable ids (`#nav-finances`, `#employees-add`, `#finances-new`, …) so you can anchor guides to them.
- **Privacy**: only the internal user id, role and department are sent to third parties. Names, emails and salaries are never sent. Tell your employees that usage is tracked, and check that your analytics setup meets your local privacy rules, such as GDPR or India's DPDP Act.
- **Google Maps**: without a key, the offices page shows cards with "Open in Google Maps" links. With a key, it shows an interactive map with markers (uses Google's `DEMO_MAP_ID`; replace it with your own Map ID in `office-map.ts` for production).
- **FusionCharts** is commercial software. Without a license it renders with a "FusionCharts Trial" watermark. Buy a license before using it in production.

## Project layout

```
src/                 Express API
  app.js             routes, auth, role scoping, audit logging
  db.js              SQLite schema + password hashing (scrypt)
  seed.js            demo data generator (100 employees)
  server.js          entry point
test/api.test.js     API integration tests (node:test)
client/              Angular app
  src/app/core/      api client, auth, analytics (GA/GTM/Clarity/Pendo), PDF, maps loader, jQuery toasts, FusionCharts setup
  src/app/elements/  Lit web components
  src/app/layout/    app shell + Hammer.js swipe menu
  src/app/pages/     dashboard, employees, employee detail, finances, logins, activity, map, profile
```

## Security notes

- Passwords are hashed with scrypt. Sessions use random 256-bit tokens (only their SHA-256 hash is stored) in an `HttpOnly`, `SameSite=Lax` cookie that expires after 12 hours.
- An account is locked for 15 minutes after 5 failed logins.
- State-changing requests must include the `X-Requested-With: crm` header (CSRF protection).
- CSV export escapes values that start with `=`, `+`, `-` or `@`, so the file can't inject spreadsheet formulas.
- In production, run behind HTTPS, set `SECURE_COOKIES=1`, and change the seeded passwords (or remove the demo data).
