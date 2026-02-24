# Operator Admin — Happy Hour Compass

A Next.js 15 admin portal for Happy Hour Compass operators to manage venues, events, media, and claims.

Runs independently from the consumer-facing app in the parent directory.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS v3 |
| Backend / Auth | Supabase (JS client via `@supabase/ssr`) |
| Deployment | Any platform that supports Node.js (Vercel, Railway, etc.) |

---

## Prerequisites

- **Node.js 18+**
- A Supabase project (create one at [supabase.com](https://supabase.com))
- The SQL schema applied to your Supabase project (see [Applying the Schema](#applying-the-schema) below)

---

## Environment Variables

Create a file called **`.env.local`** inside this `operator-admin/` directory.
Use `.env.local.example` as your template — copy it and fill in your real values:

```bash
cp .env.local.example .env.local
# Then open .env.local and replace the placeholder values
```

| Variable | Where to find it | Used where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL | Browser + Server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → Settings → API → publishable key (`sb_publishable_...`) | Browser + Server |
| `SUPABASE_SECRET_KEY` | Supabase dashboard → Settings → API → secret key (`sb_secret_...`) | Server only — **never expose to browser** |

> **Security note:** `.env.local` is listed in `.gitignore` and will never be committed.
> Only `.env.local.example` (with placeholder values) is tracked in git.

---

## Running Locally

```bash
# From the repo root:
cd operator-admin

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app runs at **http://localhost:3000**.

Other commands:

```bash
npm run build    # Production build
npm run start    # Serve the production build
npm run lint     # Run ESLint
```

---

## Routes

| Route | Access | Description |
|---|---|---|
| `/` | Any | Redirects to `/dashboard` |
| `/login` | Public | Sign in or create an operator account |
| `/dashboard` | Authenticated | Protected admin dashboard |

Authentication is enforced by Next.js middleware (`src/middleware.ts`).
Unauthenticated requests to `/dashboard` are redirected to `/login`.

---

## Applying the Schema

The SQL schema lives at:

```
/supabase/migrations/001_initial_schema.sql
```

(relative to the repository root — one level up from this `operator-admin/` folder)

### Option A — Supabase Dashboard (recommended for initial setup)

1. Open your [Supabase project dashboard](https://app.supabase.com).
2. Navigate to **SQL Editor**.
3. Click **New query**.
4. Paste the full contents of `supabase/migrations/001_initial_schema.sql`.
5. Click **Run**.

### Option B — Supabase CLI

```bash
# From the repo root (one level up from operator-admin/)
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

> If you need to reset and re-run the schema, drop the tables first via the Supabase dashboard
> (Table Editor → right-click table → Delete table), then re-run the migration.

---

## Project Structure

```
operator-admin/
├── .env.local.example        # Env var template — copy to .env.local
├── next.config.ts
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── src/
    ├── app/
    │   ├── globals.css
    │   ├── layout.tsx
    │   ├── page.tsx              # Redirects / → /dashboard
    │   ├── login/
    │   │   └── page.tsx          # Sign in / Create account
    │   └── dashboard/
    │       ├── page.tsx          # Protected dashboard (Server Component)
    │       └── SignOutButton.tsx  # Client Component
    ├── lib/
    │   └── supabase/
    │       ├── browser.ts        # Supabase client for Client Components
    │       └── server.ts         # Supabase client for Server Components + admin client
    └── middleware.ts             # Auth guard — protects /dashboard/*
```

---

## Auth Flow

1. User visits `/dashboard` → middleware checks for a valid Supabase session.
2. If not authenticated → redirected to `/login`.
3. On `/login`, user signs up or signs in with email + password.
   - Sign-up sends a confirmation email (configured in Supabase Auth settings).
   - Sign-in sets a session cookie and redirects to `/dashboard`.
4. Sign-out clears the session cookie and redirects to `/login`.

---

## Database Tables

| Table | Description |
|---|---|
| `operators` | Registered operator accounts (linked to Supabase Auth via email) |
| `venues` | Venue listings with happy-hour details |
| `events` | Recurring or one-off events attached to a venue |
| `media` | Images/assets for a venue |
| `claims` | Operator requests to claim ownership of a venue listing |

All tables have Row Level Security (RLS) enabled.
See `supabase/migrations/001_initial_schema.sql` for full schema and policy definitions.
