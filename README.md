# Car Dealer Stock Book

UK second-hand motor dealer stock book for accountants' motor-trade clients. Tracks vehicles from purchase to sale, applies the VAT Margin Scheme (Second-hand Goods) automatically, and produces branded margin-scheme invoices, reports and exports. Includes a public showroom website for the dealer.

**Stack:** Next.js 15 (App Router) on **Cloudflare Workers** (via OpenNext) · **Supabase** Postgres + Storage · Clerk auth · Drizzle ORM · pnpm workspaces · GitHub Actions CI/CD.

## Layout

| Path | What |
|---|---|
| `apps/web/app/` | Next.js routes: dealer back office, `/showroom/*` public site, `/api/[[...path]]` API, `/api/cron/[job]` |
| `apps/web/src/views/` | Page components (Stock, VehicleDetail, Reports, Settings, Showroom, …) |
| `apps/web/server/` | API: route modules (`routes/`), business logic (`lib/`), auth (`middlewares/`), tests (`test/`) |
| `apps/web/server/http.ts` | Small Express-style router running on Web `Request`/`Response` |
| `apps/web/middleware.ts` | Clerk + customer-domain → showroom rewrite |
| `apps/web/worker.ts` | Cloudflare entry: OpenNext worker + cron (`scheduled`) handler |
| `lib/db/` | Drizzle schema (source of truth) and generated SQL `migrations/` |
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

```
feature branch ──push──▶ CI: install → generate SQL migrations → typecheck → tests → next build → OpenNext build
                         (auto-commits lockfile / new migrations back to the branch)
pull request ───────────▶ CI must pass
merge to main ──────────▶ CI ──▶ Deploy: drizzle-kit push to Supabase ──▶ deploy Worker to Cloudflare
```

Deploy jobs skip themselves (with a notice) until their secrets exist.

### One-time setup

**GitHub → Settings → Secrets and variables → Actions**

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare token with *Edit Cloudflare Workers* |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |
| Secret | `DATABASE_URL` | Supabase **session pooler** URI (port 5432) |
| Variable | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_live_…`) |
| Variable | `NEXT_PUBLIC_SHOWROOM_HOSTS` | e.g. `manorgcs.co.uk,www.manorgcs.co.uk` (optional) |

**Cloudflare → Workers & Pages → cardealerstocksystem → Settings → Variables and secrets** (non-secret config is in `wrangler.jsonc`)

| Secret | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** URI (port 6543) |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `CLERK_PUBLISHABLE_KEY` | same as the public one |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → `service_role` / secret key |
| `CRON_SECRET` | any long random string |
| `SMTP_PASS` | dealer mailbox password |
| `RAPID_CAR_CHECK_API_KEY` | optional — registration lookup |
| `FIRECRAWL_API_KEY` | optional — Cazoo import fallback |
| `ALLOWED_EMAILS` / `ADMIN_EMAILS` | optional backstop allowlists (comma-separated) |

Supabase project: **Car Dealer Stock Book** (`bvtqaehyqchyoaleiggw`, eu-west-2). Tables, RLS and the private `stock-book` storage bucket (10 MB, images only) are already created.

## Notes

- **VAT Margin Scheme:** margin = sale − purchase; VAT due = ⅙ of margin when margin > 0, else £0.
- **Single-dealer mode:** every invited user works on one shared stock book (`SHARED_TENANT_ID`). Access is invite-only via the `app_users` table (Settings → Users) plus hardcoded operator emails.
- **Two web addresses, one deployment:** hosts in `NEXT_PUBLIC_SHOWROOM_HOSTS` only ever see the public showroom at `/`; other hosts get the dealer app with the showroom under `/showroom`.
- **Files:** uploads go straight from the browser to Supabase Storage via signed URLs; access policy lives in `stored_objects`; served via `/api/storage/objects/uploads/<id>`.
- **Scheduled jobs** (Cloudflare cron → `/api/cron/<job>`): showroom removal sweep (15 min), orphaned upload cleanup (30 min), Cazoo import health check (daily 06:00 UTC).
- Extras invoices and vehicle sales invoices always share the same invoice date (business rule).

See [`docs/MIGRATING_FROM_REPLIT.md`](docs/MIGRATING_FROM_REPLIT.md) for moving the live data across.
