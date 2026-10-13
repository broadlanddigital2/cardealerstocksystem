# Car Dealer Stock Book

UK second-hand motor dealer stock book for accountants' motor-trade clients. Tracks vehicles from purchase to sale, applies the VAT Margin Scheme (Second-hand Goods) automatically, and produces branded margin-scheme invoices, reports and exports. Includes a public showroom website for the dealer.

**Stack:** Next.js 15 (App Router) on **Cloudflare Workers** (via OpenNext) · **Neon** (Postgres, London) · **Cloudflare R2** (files) · sign-in built in (emailed code) · Drizzle ORM · pnpm workspaces · GitHub Actions CI/CD.

## Layout

| Path | What |
|---|---|
| `apps/web/app/` | Next.js routes: dealer back office, `/showroom/*` public site, `/api/[[...path]]` API, `/api/cron/[job]` |
| `apps/web/src/views/` | Page components (Stock, VehicleDetail, Reports, Settings, Showroom, …) |
| `apps/web/server/` | API: route modules (`routes/`), business logic (`lib/`), auth (`middlewares/`), tests (`test/`) |
| `apps/web/server/http.ts` | Small Express-style router running on Web `Request`/`Response` |
| `apps/web/middleware.ts` | Customer-domain → showroom rewrite |
| `apps/web/src/lib/auth.tsx` | Session hooks (cookie session); 6-digit code sign-in in `src/components/auth`, server side in `server/lib/session.ts` + `server/routes/authCode.ts` |
| `apps/web/worker.ts` | Cloudflare entry: OpenNext worker + cron (`scheduled`) handler |
| `lib/db/` | Drizzle schema (source of truth), generated SQL `migrations/`, and `client.ts` — Drizzle over Neon's serverless driver (queries over HTTPS, transactions over a short-lived WebSocket) |
| `lib/api-spec/` | OpenAPI spec → generated `lib/api-zod` + `lib/api-client-react` (Orval) |
| `lib/report-calc/` | Pure VAT / report / Xero export maths (unit-tested) |

## Develop

```bash
corepack enable
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in values
pnpm dev                                         # http://localhost:3000
pnpm typecheck && pnpm test
pnpm --filter @workspace/web run preview         # run the real Workers build locally
```

After changing `lib/db/src/schema`, run `pnpm --filter @workspace/db run generate` (or let CI generate and commit the migration on your branch). After changing the OpenAPI spec, run `pnpm --filter @workspace/api-spec run codegen`.

## Pipeline

Two long-lived branches, each with its own site, database and file bucket:

| Branch | Site | Worker | Database | Files |
|---|---|---|---|---|
| `develop` | https://dev-cardealerstockbook.racecargraphics.uk | `cardealerstocksystem-dev` | Neon branch `dev` | R2 `cardealerstocksystem-files-dev` |
| `main` (live) | https://cardealerstockbook.racecargraphics.uk | `cardealerstocksystem` | Neon branch `main` | R2 `cardealerstocksystem-files` |

```
feature branch ──push──▶ CI: install → generate SQL migrations → migrations on empty Postgres → typecheck → tests → builds
       │                 (auto-commits lockfile / new migrations back to the branch)
       └─ pull request into develop (CI must pass)
merge to develop ──────▶ Workers Builds deploys the dev site · "Database migrations" updates the dev database
       └─ pull request develop → main when dev has been checked
merge to main ─────────▶ Workers Builds deploys the live site · "Database migrations" updates the live database
```

Schema changes should be additive (new tables/columns) so the app works whether the deploy or the migration lands first.

### One-time setup

**Cloudflare → Workers & Pages → cardealerstocksystem → Settings → Build** (Git repository: `broadlanddigital2/cardealerstocksystem`, branch `main`)

| Setting | Value |
|---|---|
| Root directory | `/` |
| Build command | *(leave blank)* |
| Deploy command | `pnpm run deploy` |
| Build variables | `NODE_VERSION` = `22` · `NEXT_PUBLIC_SHOWROOM_HOSTS` (optional) |

Leaving the build command blank keeps the OpenNext build and deploy in one step (as in our other Workers sites).

**GitHub → Settings → Secrets and variables → Actions**

| Kind | Name | Value |
|---|---|---|
| Secret | `NEON_DATABASE_URL` | Neon connection string, `main` branch (live) |
| Secret | `NEON_DEV_DATABASE_URL` | Neon connection string, `dev` branch |

**Cloudflare → Workers & Pages → cardealerstocksystem → Settings → Variables and secrets** (non-secret config is in `wrangler.jsonc`)

| Secret | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (same as `NEON_DATABASE_URL`) |
| `CRON_SECRET` | any long random string |
| `SENDGRID_API_KEY` | SendGrid API key (Mail Send) — used for enquiry alerts, staff invites, Cazoo alerts |
| `RAPID_CAR_CHECK_API_KEY` | optional — registration lookup |
| `FIRECRAWL_API_KEY` | optional — Cazoo import fallback |
| `ALLOWED_EMAILS` / `ADMIN_EMAILS` | optional backstop allowlists (comma-separated) |
| `PLATFORM_SECRET` | optional — 32+ character secret that lets Broadland Digital (later the console) set which modules this dealer has via `PUT /api/platform/modules` |

Live URL (temporary): **https://cardealerstockbook.racecargraphics.uk** — set in `apps/web/wrangler.jsonc` → `routes`.

Database: Neon project in London (`aws-eu-west-2`), branches `production` (live) and `dev`.

**SendGrid:** authenticate the `racecargraphics.uk` domain (testing; switch to the dealer domain for go-live) (Settings → Sender Authentication) by adding the CNAME records it gives you in Cloudflare DNS, then create an API key with *Mail Send* access. The app uses SendGrid's HTTPS API (works on Workers); SMTP via `SMTP_*` remains as a fallback.

## Notes

- **Modules and roles:** optional parts of the app are modules (`src/lib/modules.ts`): reports, cash sheet, saved contacts, finance sales, showroom website, leads, Cazoo import, spreadsheet import, registration lookup. A dealer has a set of modules (`PUT /api/platform/modules`, Bearer `PLATFORM_SECRET`; default all). Admins can use all of them plus Settings/Users. Other roles live in the `roles` table: **Staff** (key `user`, the default, can be renamed but not deleted) plus any the dealer's admin adds in **Settings → Roles** (e.g. Sales, Accounts), each with its own modules (Staff default: all but Reports). People get a role in **Settings → Users**; deleting a role moves its people to Staff. Menus hide what a user can't use and the matching API endpoints return 403.

- **VAT Margin Scheme:** margin = sale − purchase; VAT due = ⅙ of margin when margin > 0, else £0.
- **Sign-in:** passwordless and handled by the site itself — `POST /api/auth/send-code` emails a 6-digit code through SendGrid (invited emails only; 10 minutes, 5 tries, single use, only a salted hash is stored), `POST /api/auth/verify-code` creates a 30-day session and sets an HttpOnly `stockbook_session` cookie (only its SHA-256 is stored, in `auth_sessions`). `/api/*` changes from other websites are refused (Origin check).
- **Single-dealer mode:** every invited user works on one shared stock book (`SHARED_TENANT_ID`). Codes are only sent to emails in the `app_users` table (Settings → Users), the `ALLOWED_EMAILS`/`ADMIN_EMAILS` backstops, or the hardcoded operator list.
- **Two web addresses, one deployment:** hosts in `NEXT_PUBLIC_SHOWROOM_HOSTS` only ever see the public showroom at `/`; other hosts get the dealer app with the showroom under `/showroom`.
- **Files:** stored in Cloudflare R2 (bucket `cardealerstocksystem-files`, binding `FILES`). The browser uploads to `/api/storage/uploads/direct/<id>` with a short-lived signed token; access policy lives in `stored_objects`; files are served via `/api/storage/objects/uploads/<id>`.
- **Scheduled jobs** (Cloudflare cron → `/api/cron/<job>`): showroom removal sweep (15 min), orphaned upload cleanup (30 min), Cazoo import health check (daily 06:00 UTC).
- Extras invoices and vehicle sales invoices always share the same invoice date (business rule).

See [`docs/MIGRATING_FROM_REPLIT.md`](docs/MIGRATING_FROM_REPLIT.md) for moving the live data across.
