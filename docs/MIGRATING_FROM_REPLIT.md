# Moving the live stock book off Replit

The new Supabase database starts empty. To carry the dealer's existing data across:

## 1. Database

1. In Replit, open the Shell and dump the data only (the schema already exists in Supabase):
   ```bash
   pg_dump "$DATABASE_URL" --data-only --no-owner --no-privileges \
     --exclude-table=__drizzle_migrations -f stockbook-data.sql
   ```
2. Download `stockbook-data.sql` and load it into Supabase (session pooler URI from the dashboard **Connect** button):
   ```bash
   psql "postgresql://postgres.bvtqaehyqchyoaleiggw:PASSWORD@<pooler-host>:5432/postgres" -f stockbook-data.sql
   ```
3. Reset the id sequences so new rows don't collide:
   ```sql
   do $$ declare t text; begin
     foreach t in array array['vehicles','dealer_settings','invoices','sellers','deposit_refunds','cash_expenses','finance_companies','enquiries','app_users'] loop
       execute format('select setval(pg_get_serial_sequence(%L, ''id''), coalesce((select max(id) from %I), 0) + 1, false)', t, t);
     end loop;
   end $$;
   ```

Data is scoped by `SHARED_TENANT_ID` (a fixed string, not a live user id), so it stays visible after switching sign-in providers. Leave `SHARED_TENANT_ID` unset to keep the original value.

## 2. Files (logo, vehicle photos, feature icons)

1. In Replit's **Object Storage** pane, download everything under `.private/uploads/` (the `PRIVATE_OBJECT_DIR`).
2. Upload them to Supabase → Storage → bucket **stock-book**, folder **uploads/**, keeping each file name (a UUID) unchanged.
3. Run `lib/db/sql/backfill-stored-objects.sql` in the Supabase SQL editor to mark the referenced files as public, as they were on Replit.

## 3. Sign-in (now Supabase Auth)

The Replit app used a Clerk login run by Replit; the new app uses Supabase Auth in the same Supabase project. There are no passwords any more: staff go to `/sign-in`, enter the **same email address** as before, and type in the 6-digit code they're emailed. Their access and admin rights come from the `app_users` table, so they carry over automatically. Before telling staff, finish the Supabase Auth settings in the README (email templates, custom SMTP, URL configuration).

## 4. Domains

In Cloudflare → Workers & Pages → cardealerstocksystem → Settings → Domains & Routes, add the staff domain and the customer showroom domain(s). Set `NEXT_PUBLIC_SHOWROOM_HOSTS` (GitHub variable) to the customer domain(s) and redeploy.
