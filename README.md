# Brightloop — Subscription & Recurring Billing Cockpit

A fully offline-capable subscription management platform for Brightloop Software,
built as plain HTML/CSS/JS with **no build step, no backend, and no external
dependencies**. All data lives in the browser's `localStorage`, generated live
at first launch (not a static JSON fixture), and is read/written dynamically by
the app from then on.

## Run it

No install, no server required:

1. Open `index.html` directly in a browser (double-click it, or `file://…/index.html`).
2. Or, if you prefer serving it: `python3 -m http.server 8000` from this folder, then visit `http://localhost:8000`.

Either way the app works fully offline after the first load — it never calls out to a network.

### Demo logins (seeded on first run)

| Role     | Email                    | Password        |
|----------|---------------------------|------------------|
| Admin    | admin@brightloop.com      | `Admin#1234`     |
| Staff    | staff@brightloop.com      | `Staff#1234`     |
| Customer | priya@acme.com            | `Customer#1234`  |

Or sign up a brand-new customer account from the "Create account" tab.

## What's inside

- **Auth & access control** — signup/login, salted SHA-256 password hashing (via `SubtleCrypto`, fully offline), password-strength validation, forgot-password flow (offline-safe: shows the reset link in-app instead of emailing it), and role gating (admin / staff / customer) enforced both in the nav and in the engine layer. Only admins can add staff.
- **Products & Plans** — products with variants (e.g. brand adds a price delta), plans with billing frequency, minimum quantity, availability window, and per-plan auto-close / pause / renew rules.
- **Quotations → Subscriptions** — start from a reusable quotation template or build one from scratch; full lifecycle `Draft → Quotation → Confirmed → Active → Closed` (+ `Paused`), enforced by a state machine that rejects illegal transitions.
- **Billing engine** — a "Run Billing" action walks every active subscription and generates invoices for every elapsed billing period since it was last billed. It is **idempotent**: re-running it never double-bills a period (verified with automated tests — see below). Tax is computed automatically from an admin-defined rate.
- **Discounts** — fixed or percentage, scoped to a product or a whole subscription, with minimum purchase/quantity, a validity window and a usage cap. The engine auto-applies the best eligible discount to each invoice line as it's generated and stops once the usage cap is hit.
- **Payments** — record a payment by method, amount, date and note against an invoice; invoices move `Draft → Confirmed → Paid` automatically as payments land, and you can see outstanding/overdue balances at a glance.
- **Finance cockpit** — an SAP-Fiori-style dashboard: KPI tiles, a subscriptions-by-status donut, invoices-by-status donut, top products by revenue, an 8-month revenue trend, and a live, searchable/sortable/paginated grid of every subscription — styled after the reference SAP cockpit screenshot (flat navy/blue palette, no gradients).
- **Responsive, validated UI** — every form validates input before it reaches the engine (required fields, numeric ranges, date ordering, password rules) and surfaces inline errors; the shell collapses to a hamburger nav and the KPI grid reflows on mobile widths.

## Performance

The seed data ships with 180 subscriptions and the billing engine was load-tested
against ~1,000 synthetic subscriptions:

- Billing run for 1,000 subscriptions: **~30–135 ms**.
- The subscriptions/invoices tables only render the current page (default 10–15
  rows) to the DOM — sorting, search and filtering all operate on the in-memory
  array, so grids stay responsive even with thousands of rows, per the "under
  two seconds" requirement from the brief.

## Architecture

```
index.html        Shell markup: auth screen, top bar, side nav, modal, toasts
css/styles.css     Flat SAP-Fiori-style theme (no gradients), responsive rules
js/db.js           localStorage persistence layer + first-run data generator
js/engine.js       Auth, validation, catalog, discounts, subscriptions,
                   billing engine, payments, dashboard aggregates
js/charts.js       Dependency-free inline-SVG charts (donut, bar, combo, hbar)
js/views.js        DOM rendering: DataGrid component, every screen, all forms
js/app.js          Router, nav wiring, auth-screen wiring, boot sequence
```

All five scripts are plain `<script>` tags (no ES modules, no bundler) so the
app runs equally well from `file://` or any static host.

### Data model (in `localStorage['brightloop_db_v1']`)

`users`, `products`, `plans`, `taxRules`, `discounts`, `quotationTemplates`,
`subscriptions`, `invoices`, `payments`, `resetTokens`, `auditLog`.

### Why this counts as "dynamic data", not a static fixture

Nothing is shipped as a `.json` file read at runtime. The seed function in
`db.js` *generates* the starting dataset in code on first boot (including
~180 subscriptions with randomized dates/plans/customers), after which every
screen reads and writes the live `localStorage` store through the engine —
creating a product, confirming a quotation, running billing, or recording a
payment all mutate that store immediately and persist across reloads.

## Testing performed

- Node-level unit checks of the billing engine: repeated billing runs
  converge to zero new invoices, zero duplicate (subscription, period)
  invoice pairs, and invoice totals reconcile exactly against their line
  items.
- Full browser smoke test (Playwright/Chromium) covering: login, product
  creation, subscription creation, billing run, payment recording, discount
  creation, staff creation, customer signup, weak-password rejection, and
  customer-portal login — zero console/page errors across the run.
- Responsive check at 1440px and 390px widths.

## Security & multi-user

This is a client-only app — all data lives in one browser's `localStorage`,
so "auth" here is a UI convenience, not a real security boundary, and two
users on two devices never share data. See **[SECURITY.md](SECURITY.md)**
for specifics, what was hardened, and what a real multi-user/live deployment
needs (short version: a backend).

## Notes on the "Must have" checklist

- **Dynamic data, not static JSON** — see above; everything after first boot
  is live, mutated state in `localStorage`.
- **Responsive, consistent UI** — single CSS theme, flat SAP-style palette,
  mobile breakpoints for the nav/header/tiles.
- **Robust input validation** — centralized in `BL.Validate` and the engine's
  `create*` functions; every form shows field-level errors.
- **Intuitive navigation** — grouped side nav (Monitor / Sell / Bill / Master
  Data / Me), role-based visibility, breadcrumbs per page.
- **Version control** — this folder is a git repository (`git log` for
  history); commit as a team from here on rather than a single owner.
