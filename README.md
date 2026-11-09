# NEXORA Business OS — Core MVP

Multi-tenant ERP for field services, construction, and installation businesses.

**Stack:** Next.js 14 (App Router) · TypeScript · Supabase Auth + PostgreSQL RLS · Tailwind CSS · Vercel-ready

## Features

- Tenant isolation via `tenant_id` + Supabase Row Level Security
- Roles: `super_admin`, `employer`, `employee`
- Projects CRUD (employer)
- Time clock / entries with employee self-edit of pending rows and employer approval
- Project photo uploads to private Storage with signed URLs
- Employer team invites via Supabase Auth Admin API
- Quotes (Offertes) with line items, VAT totals, and convert-to-project
- Invoices (Facturatie) from approved hours, status workflow, and print-ready view

## Setup

### Instant demo (no Supabase required)

```bash
npm install
echo 'NEXT_PUBLIC_DEMO_MODE=true' > .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — demo mode auto-seeds clients, quotes, invoices and weekly planning. Use **Seed demo data** on the Klanten page to reload sample data.

### Production / Supabase

1. Create a Supabase project.
2. Run migrations in order from `supabase/migrations/` (SQL Editor or CLI), including CRM/planning.
3. Copy `.env.example` → `.env.local` and fill in keys (`NEXT_PUBLIC_DEMO_MODE=false`).
4. In Supabase Auth → URL configuration, allow `NEXT_PUBLIC_SITE_URL` and `/auth/callback`.
5. Install and run:

```bash
npm install
npm run dev
```

## Deploy (Vercel)

1. Import the repo in Vercel.
2. Set the same env vars as `.env.example`.
3. Deploy. Apply the SQL migration against your production Supabase project before first login.

## First users

1. Sign up as **Employer**, then create an organization on `/onboarding/create-organization`.
2. From **Team**, invite employees by email (service role required).
3. Create a `super_admin` manually in SQL if needed:

```sql
-- After the auth user exists:
update public.profiles
set role = 'super_admin', tenant_id = null
where id = '<auth-user-uuid>';
```

## Scripts

| Command           | Description                |
| ----------------- | -------------------------- |
| `npm run dev`     | Local development server   |
| `npm run build`   | Production build           |
| `npm run lint`    | ESLint                     |
| `npm run typecheck` | `tsc --noEmit`           |
