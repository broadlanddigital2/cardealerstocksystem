# Car Dealer Stock Book

UK second-hand motor dealer stock book for accountants' motor-trade clients. Tracks vehicles from purchase to sale, applies the VAT Margin Scheme (Second-hand Goods) automatically, and produces branded margin-scheme invoices, reports and exports. Includes a public showroom website for the dealer.

**Stack:** Next.js 15 (App Router) on **Cloudflare Workers** (via OpenNext) · **Supabase** Postgres + Storage · Supabase Auth · Drizzle ORM · pnpm workspaces · GitHub Actions CI/CD.

## Layout

| Path | What |
|---|---|
| `apps/web/app/` | Next.js routes: dealer back office, `/showroom/*` public site, `/api/[[...path]]` API, `/api/cron/[job]` |
| `apps/web/src/views/` | Page components (Stock, VehicleDetail, Reports, Settings, Showroom, …) |
| `apps/web/server/` | API: route modules (`routes/`), business logic (`lib/`), auth (`middlewares/`), tests (`test/`) |
| `apps/web/server/http.ts` | Small Express-style router running on Web `Request`/`Response` |
| `apps/web/middleware.ts` | Customer-domain → showroom rewrite |
| `apps/web/src/lib/auth.tsx` | Supabase Auth client + hooks; 6-digit code sign-in in `src/components/auth` |
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
feature branch ──push──▶ GitHub Actions CI: install → generate SQL migrations → typecheck → tests → next build → OpenNext build
                         (auto-commits lockfile / new migrations back to the branch)
pull request ───────────▶ CI must pass
merge to main ──────────▶ Cloudflare Workers Builds: build + deploy the Worker (same as our other sites)
                └───────▶ GitHub Actions: CI ──▶ "Database migrations" applies new lib/db/migrations to Supabase
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
| Secret | `DATABASE_URL` | Supabase **session pooler** URI (port 5432) |

**Cloudflare → Workers & Pages → cardealerstocksystem → Settings → Variables and secrets** (non-secret config is in `wrangler.jsonc`)

| Secret | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** URI (port 6543) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → `service_role` / secret key |
| `CRON_SECRET` | any long random string |
| `SENDGRID_API_KEY` | SendGrid API key (Mail Send) — used for enquiry alerts, staff invites, Cazoo alerts |
| `RAPID_CAR_CHECK_API_KEY` | optional — registration lookup |
| `FIRECRAWL_API_KEY` | optional — Cazoo import fallback |
| `ALLOWED_EMAILS` / `ADMIN_EMAILS` | optional backstop allowlists (comma-separated) |

Live URL (temporary): **https://cardealerstockbook.racecargraphics.uk** — set in `apps/web/wrangler.jsonc` → `routes`.

Supabase project: **Car Dealer Stock Book** (`bvtqaehyqchyoaleiggw`, eu-west-2). Tables, RLS and the private `stock-book` storage bucket (10 MB, images only) are already created.

**Supabase Auth settings** (dashboard → Authentication):
- **Emails → Templates:** set the **Magic Link** and **Confirm signup** templates to [`docs/supabase-email/sign-in-code.html`](docs/supabase-email/sign-in-code.html) (subject "Your MotorMetric sign-in code"). It shows the 6-digit `{{ .Token }}` instead of a link.
- **Sign In / Providers → Email:** keep Email enabled; *Email OTP length* = 6.
- **URL Configuration:** Site URL = `https://cardealerstockbook.racecargraphics.uk`; Redirect URLs = `https://cardealerstockbook.racecargraphics.uk/**` and `http://localhost:3000/**`.
- **Emails → SMTP Settings:** enable custom SMTP with SendGrid — host `smtp.sendgrid.net`, port `587`, username `apikey`, password = a SendGrid API key, sender `noreply@racecargraphics.uk`, sender name `MotorMetric`. Supabase's built-in sender only delivers to your own team and is heavily rate-limited, so sign-in codes need this. Also raise *Rate Limits → emails per hour*.

**SendGrid:** authenticate the `racecargraphics.uk` domain (testing; switch to the dealer domain for go-live) (Settings → Sender Authentication) by adding the CNAME records it gives you in Cloudflare DNS, then create an API key with *Mail Send* access. The app uses SendGrid's HTTPS API (works on Workers); SMTP via `SMTP_*` remains as a fallback.

## Notes

- **VAT Margin Scheme:** margin = sale − purchase; VAT due = ⅙ of margin when margin > 0, else £0.
- **Sign-in:** passwordless — staff enter their email, `POST /api/auth/send-code` asks Supabase Auth to email a 6-digit code (only for invited emails), and the browser verifies it with `supabase.auth.verifyOtp`. The browser then sends its access token to `/api/*`, which verifies it with Supabase.
- **Single-dealer mode:** every invited user works on one shared stock book (`SHARED_TENANT_ID`). Codes are only sent to emails in the `app_users` table (Settings → Users), the `ALLOWED_EMAILS`/`ADMIN_EMAILS` backstops, or the hardcoded operator list.
- **Two web addresses, one deployment:** hosts in `NEXT_PUBLIC_SHOWROOM_HOSTS` only ever see the public showroom at `/`; other hosts get the dealer app with the showroom under `/showroom`.
- **Files:** uploads go straight from the browser to Supabase Storage via signed URLs; access policy lives in `stored_objects`; served via `/api/storage/objects/uploads/<id>`.
- **Scheduled jobs** (Cloudflare cron → `/api/cron/<job>`): showroom removal sweep (15 min), orphaned upload cleanup (30 min), Cazoo import health check (daily 06:00 UTC).
- Extras invoices and vehicle sales invoices always share the same invoice date (business rule).

See [`docs/MIGRATING_FROM_REPLIT.md`](docs/MIGRATING_FROM_REPLIT.md) for moving the live data across.
