# Threat Model

## Project Overview

Motor Dealer Stock Book is a publicly deployed single-dealer web application for UK used-motor stock, sales, invoices, VAT-margin reporting, finance records, customer enquiries, and a public vehicle showroom. It uses a React/Vite client, Express 5 API, Clerk authentication, PostgreSQL through Drizzle, SMTP, and Replit object storage.

All invited staff operate on one shared dealer record. `requireAuth` validates a Clerk session, resolves its primary email, checks the DB/env invite list, and then assigns the fixed `SHARED_TENANT_ID`. Roles are `admin` and `user`; reports, settings writes, and user management are admin-only. Settings reads are intentionally available to all invited staff because invoice creation needs dealer and bank details. A hardcoded permanent operator identity is intentionally always admitted as admin; the owner has accepted this support-access risk and it should not be re-proposed unless that trust model changes.

Production is public at `motormetric-mg.co.uk`, associated showroom domains, and the Replit deployment URL. `artifacts/mockup-sandbox/` is development-only.

## Assets

- **Staff identities and sessions** — Clerk sessions and the invite/admin lists control access to the entire shared dealer account.
- **Dealer and customer records** — purchases, sales, invoices, buyer/seller addresses, cash expenses, finance companies, reports, and enquiries include sensitive commercial and personal data.
- **Financial configuration** — dealer bank details, accounting codes, VAT settings, balances, invoice numbers, and report calculations affect payments and accounting accuracy.
- **Public showroom content** — vehicle details, photos, branding, reviews, and enquiries cross the public/private boundary.
- **Secrets and infrastructure capabilities** — database, Clerk, SMTP, object-storage, and upload-token signing credentials could expose or alter all dealer data.
- **Stored objects** — logos, feature icons, and vehicle photos are intentionally public after finalisation; unfinalised/private objects must remain restricted.

## Trust Boundaries

- **Public browser to public API** — showroom reads and enquiry creation accept unauthenticated input and must expose only an explicit public field set, bound resource consumption, and safely render/store text.
- **Clerk session to invited staff** — authentication alone is insufficient because Clerk signup may be open; every private route must enforce the email invite list.
- **User to admin** — reports, user/role management, and settings mutation require server-side `requireAdmin`; frontend route guards are not controls.
- **API to PostgreSQL** — queries must be parameterized and every private record operation scoped to `SHARED_TENANT_ID` despite attacker-controlled object IDs.
- **API to object storage** — upload tokens, object paths, ACL finalisation, and reads must enforce type/size/path constraints and prevent private objects or active content becoming public unintentionally.
- **API to external services** — Cazoo fetch targets and SMTP content cross external boundaries; URLs must remain constrained and attacker text must be escaped.

## Scan Anchors

- API topology: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`
- Authentication/roles: `artifacts/api-server/src/middlewares/requireAuth.ts`, `routes/access.ts`, `routes/users.ts`
- High-value private actions: `routes/vehicles.ts`, `invoices.ts`, `reports.ts`, `settings.ts`, `cashExpenses.ts`, `financeCompanies.ts`, `sellers.ts`
- Public surfaces: `routes/showroom.ts`, public handlers in `routes/storage.ts`, `routes/health.ts`
- Storage boundary: `routes/storage.ts`, `lib/objectStorage.ts`, `lib/objectAcl.ts`
- External fetch/email: `routes/cazooImport.ts`, `lib/cazoo.ts`, `lib/cazooHealth.ts`, `lib/email.ts`
- Ignore by default: `artifacts/mockup-sandbox/` and generated build output unless production reachability differs from source.

## Threat Categories

### Spoofing

A valid Clerk account must not imply dealer access. Every private API operation must validate the session's server-resolved primary email against the invite list, and admin operations must independently verify the admin role. Session identity and role may never come from client-supplied fields.

### Tampering

All mutations must be scoped to the shared dealer and enforce accounting/business invariants server-side. Client-supplied prices, sale state, invoice details, object paths, roles, and IDs are untrusted. Upload ACL finalisation must only publish intended objects, and enquiry/status changes must require invited staff.

### Information Disclosure

Public showroom serializers must use explicit allowlists and never expose purchase costs, customer details, internal notes, or private objects. Authenticated record lookups and lists must consistently use `SHARED_TENANT_ID`. Logs and errors must not disclose secrets or excessive personal data.

### Denial of Service

Public enquiry submission and object-serving routes require bounded request sizes and practical rate/resource controls. Authenticated imports, report generation, outbound fetches, and uploads must have size, count, timeout, and quota constraints suitable for a shared single-dealer deployment.

### Elevation of Privilege

The principal risks are bypassing invite enforcement, invoking admin routes as an ordinary invited user, raw-ID operations missing shared-dealer scope, SQL injection, SSRF through integration URLs, and publishing executable or private uploads. Enforcement must occur in API middleware, scoped database queries, constrained outbound-request helpers, and storage ACL/type checks—not only in the React UI.
