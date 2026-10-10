# Motor Dealer Stock Book

A UK second-hand motor dealer stock book web app for accountants' motor-trade clients. Tracks vehicles from purchase to sale and automatically applies the VAT Margin Scheme (Second-hand Goods) calculations, with branded margin-scheme sales invoices, reports, and exports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/stock-book run dev` — run the web frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`; Clerk publishable key for the frontend; object storage env (`PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`)
- Optional registration lookup: server-only secret `RAPID_CAR_CHECK_API_KEY` and `RAPID_CAR_CHECK_DOMAIN` (the domain authorised by Rapid Car Check, currently `motormetric-mg.co.uk`). Lookup fills stock forms only; it never saves or publishes vehicles. If unconfigured/unavailable, staff can still enter details manually.
- Email env (notifications + staff invites, sent directly via the dealer's mailbox over SMTP): `SMTP_HOST` (Fasthosts standard mailbox = `smtp.livemail.co.uk`), `SMTP_PORT` (default 587; 465 for SSL), `SMTP_SECURE` (`true` forces implicit TLS; auto-true on port 465), `SMTP_USER` (full mailbox address / login), `SMTP_PASS` (secret), and optional `ENQUIRY_EMAIL_FROM` (visible from-address; defaults to `SMTP_USER`). All optional — email no-ops with a warn log if unset, never blocking enquiry submission.
- Optional frontend env: `VITE_SHOWROOM_HOSTS` — comma-separated list of the dealership's public/customer hostname(s) (e.g. `manorgarage.co.uk,www.manorgarage.co.uk`). When a visitor's hostname matches, the app serves ONLY the public showroom mounted at the site root (no Clerk, no back office). Unset (default) keeps the single combined domain (dealer app at root, showroom under `/showroom`). www/apex variants are matched interchangeably; matching is exact otherwise.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; Auth: Clerk. Single-dealer mode: all signed-in users share ONE dealer tenant; access is invite-only via an email allowlist
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite + wouter + TanStack Query; client-side PDF (jsPDF), XLSX (xlsx), CSV (papaparse)
- Object storage for dealer logo uploads (Uppy + `@workspace/object-storage-web`)

## Where things live

- DB schema (source of truth): `lib/db/src/schema/` — `vehicles.ts`, `dealerSettings.ts`, `invoices.ts`
- API contract (source of truth): OpenAPI spec in `lib/api-spec/`; generated hooks/schemas in `lib/api-client-react` and `@workspace/api-zod`
- Backend routes: `artifacts/api-server/src/routes/` — `vehicles.ts`, `invoices.ts`, `reports.ts`, `settings.ts`, `storage.ts`
- VAT/margin calc: `artifacts/api-server/src/lib/` serializer + compute helpers
- Report/export maths (shared, pure, unit-tested): `lib/report-calc/` — margin calc, dashboard VAT box summary, Xero journal/purchases CSV builders; tests in `artifacts/api-server/test/` (`pnpm --filter @workspace/api-server run test`)
- Frontend pages: `artifacts/stock-book/src/pages/` — Dashboard, AddVehicle, Stock, VehicleDetail (record sale + invoice PDF), Reports, Settings, Import

## Architecture decisions

- VAT Margin Scheme: margin = sale − purchase; VAT due = one-sixth (16.67%) of margin only when margin > 0, else £0; net margin = margin − VAT.
- Single-dealer (standalone) mode: `requireAuth` overrides `req.userId` with `SHARED_TENANT_ID` (defaults to the existing "Manor Garage Car Sales Ltd" Clerk user id; override via `SHARED_TENANT_ID` env). Every route reads `req.userId`, so this one override scopes the whole API to one shared stock book — no per-route changes, no data migration.
- Invite-only access (DB-backed): the `app_users` table is the runtime source of truth for who may sign in and at what level. `requireAuth` checks the signed-in user's Clerk primary email (case-insensitive) against the DB list PLUS a hardcoded `ALWAYS_ALLOWED_EMAILS` set and the `ALLOWED_EMAILS` env var (both kept only as backstops). Empty list = deny everyone except the always-allowed/admin operator set. DB lookups are cached ~30s in-memory (stale-on-error); `bustUserCache()` clears it after a write. `GET /api/access` (session-only) powers the frontend `AccessGate` "not invited" screen. Admins add staff from the Settings → Users tab (no email is sent; the invited person just signs in with that email).
- Roles (admin vs user): two access levels. Role is read from `app_users.role` (`admin`|`user`), with `ADMIN_EMAILS` env + a hardcoded `ALWAYS_ADMIN_EMAILS` operator set as backstops. Admins get everything; non-admin invited users get everything EXCEPT the admin-only areas Reports and Settings. Admins are implicitly allowed even if absent from the allow list. `requireAdmin` (like `requireAuth` plus an admin check, 403 `forbidden` otherwise) guards the whole `/reports` router, `PUT /settings`, and the whole `/users` router. `GET /settings` stays `requireAuth` on purpose — all invited users read settings (sidebar logo/business name, invoice generation business/bank details, VAT/account codes), so only the Settings *page* (editing) is admin-restricted, not settings reads. `GET /api/access` returns `isAdmin`; the frontend stores it in an `AccessContext`, an `AdminOnly` route wrapper redirects non-admins from `/reports`/`/settings` to `/stock`, and the sidebar hides those two nav items for non-admins.
- Users management: `/users` CRUD (`requireAdmin`) — GET lists `app_users` rows plus a synthesised locked operator row (sorted admins-first then alphabetically), POST invites (email lowercased), PATCH changes role, DELETE removes access. Two server-enforced guards (not client-bypassable): the permanent operator (`chris.swinton@swintonaccountants.co.uk`, in `PERMANENT_ADMIN_EMAILS`/`ALWAYS_ADMIN_EMAILS`) can never be edited or removed and is always an admin even after a remix; you cannot change or remove your own row. Emails are unique case-insensitively via a `lower(email)` unique index. Frontend lives in `artifacts/stock-book/src/components/settings/UsersTab.tsx`.
- Business rules enforced on both `POST /vehicles/:id/sale` and `PATCH /vehicles/:id` using effective (existing + incoming) values: cannot mark sold without sale date + invoice no + buyer name/address + sale price; sale date ≥ purchase date; no duplicate registration for in-stock vehicles.
- Stock numbers are unique per user and auto-sequential; a DB unique index `(user_id, stock_number)` is the backstop against races. A partial unique index enforces one in-stock registration per user.
- Dealer logos are stored public-read (they appear on customer-facing invoices); the private objects route enforces an ACL check so objects without a policy are denied.
- Invoice PDFs show only the dealer's optional custom wording (`defaultInvoiceWording`); the fixed "Margin Scheme – Second-hand Goods / No VAT is separately charged or reclaimable" lines were removed at the user's request.
- Cookie consent + policies (public showroom only): a localStorage-backed consent store (`artifacts/stock-book/src/components/showroom/CookieConsent.tsx`, `useSyncExternalStore` with a cached snapshot for stable identity) records accept/reject. The fixed `CookieBanner` is mounted at the showroom router shell in `App.tsx` (not in the footer) so it appears on every showroom route AND transient loading/error states; on the combined staff domain it is gated to `/showroom*` paths so it never overlays the authenticated dealer app. The banner uses neutral slate styling because it sits outside any page's `--accent` scope. The Contact page's Google Maps embed (and the Nominatim geocode that feeds it) only load after consent === "accepted"; before that a placeholder offers "Accept cookies & load map" / "Get directions". `ShowroomPrivacy`/`ShowroomCookies` (UK GDPR/PECR template pages, `ShowroomPolicies.tsx`) are routed in both layouts (`/privacy`,`/cookies` and `/showroom/privacy`,`/showroom/cookies`) and linked from the footer along with a "Cookie settings" button (`reopenConsent`). Consent only affects non-essential third-party content; staff Clerk auth cookies are on the back-office domain only.
- Cazoo import health check (site-redesign canary): a daily server-side check (`artifacts/api-server/src/lib/cazooHealth.ts`, started from `index.ts`, first run 60s after boot then every 24h) re-fetches the dealer's live Cazoo dealer page and runs the same `parseDealerPage` the import uses. The page URL is remembered automatically in `dealer_settings.cazoo_dealer_url` whenever a dealer preview succeeds. `evaluateParsedStock` (in `cazoo.ts`, pure/testable) flags zero rows or a majority (>50%) of rows missing title/price/mileage/photo prefix. On failure: loud error log + alert email to the dealer's Settings notification email (deduped by failure signature so a persistent failure emails once, not daily; resets on recovery) + a warning banner on the Import page (`GET /api/cazoo/health`, admin-only; `POST /api/cazoo/health/check` runs it on demand). Fetch errors (Cazoo blocking) are logged/inconclusive — amber banner, no email. The check never blocks or affects normal imports.
- Two web addresses, one deployment: `artifacts/stock-book/src/lib/showroomHost.ts` reads `VITE_SHOWROOM_HOSTS` (build-time) to decide if the current hostname is a customer/showroom domain. On a match, `App.tsx` renders `ShowroomOnlyApp` (showroom mounted at root `/`, `/stock`, `/contact`, numeric `/:id`, catch-all → home) and never mounts Clerk; the missing-pubkey throw is gated behind `!isShowroomHost`. Otherwise the existing combined behaviour (dealer app at root + showroom under `/showroom`) is unchanged. Showroom internal links go through `showroomHref()` so the same pages work at both root (customer) and `/showroom` (staff). Backend (`/api/showroom/*`) is same-origin on both domains — no backend change. Attaching real domains/DNS is a deploy-time action done in the Replit UI.

## Product

Dealers add vehicles at purchase, record sales (generating a branded margin-scheme sales invoice PDF), view a dashboard and stock book, run stock/purchases/sales reports with CSV/XLSX/PDF exports, manage their dealer profile and logo, and import opening stock via CSV. All figures GBP, dates DD/MM/YYYY, British English.

## User preferences

- Extras invoices and vehicle sales invoices always share the SAME invoice date (business rule, stated 02/07/2026). The app enforces this by construction: one `invoices` record per sale holds both documents, and the frontend always sets `invoiceDate = saleDate`. Don't build features that let the two documents carry different dates.

## Gotchas

- The API server uses build-then-start (not watch) — restart the `artifacts/api-server: API Server` workflow after backend changes.
- After changing the OpenAPI spec, run codegen before relying on new hooks/schemas.
- After DB schema changes, run `pnpm --filter @workspace/db run push`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
