# Happy Hour Compass — Project Rules for Claude Code

## Product Architecture

### One engine, four presentation layers

HHC is a single product engine with multiple separate presentation layers. The engine is shared; the presentation layers must not be blended.

**Shared product engine** — lives in `src/lib/`, `src/app/api/`, `supabase/`. Reuse freely across all presentation layers:
- Discover Engine: `src/lib/discover/discoverEngine.ts`, `featuredEventsEngine.ts`
- Data helpers: `src/lib/data/venues.ts`, `events.ts`, `discoverOverrides.ts`, etc.
- Market infrastructure: `src/lib/markets.ts`, `src/lib/activeMarket.ts`
- Analytics: `src/app/api/track/*`, `src/lib/analytics.ts`, `src/lib/trackingSession.ts`
- Business rules: `src/lib/plans.ts`, `src/lib/subscriptions.ts`, `src/lib/venueSetupStatus.ts`
- Supabase clients: `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`
- Utilities: email, Slack, slugify, imageProcessing, seededTags, trustSignals
- Server Actions that write to shared tables (claim, operator submission, etc.)
- API routes: all `/api/*` routes are shared infrastructure

**The four presentation layers — each is separate. Do not blend them:**

#### 1. Public Website — `app/(website)/` ← does not exist yet; must be created
- SEO-first, responsive desktop layout, premium modern consumer experience
- Should feel like Airbnb, OpenTable, Resy, Spotify, or Apple
- Must NOT feel like admin software, a SaaS dashboard, or an app simulator
- Developed on the `website` branch → staging.happyhourcompass.com
- Eventually served at happyhourcompass.com
- Has its own layout, nav, footer — completely separate from the consumer app shell
- May reuse engine functions, data helpers, and individual UI components from `(consumer)` where they fit
- Must NOT use or modify `ConsumerLayout` (phone frame + `ConsumerNav`) as its shell

#### 2. Consumer App — `app/(consumer)/`
- App-like experience: 375px phone frame on desktop, full-screen on mobile, bottom nav
- Currently served at happy-hour-compass.vercel.app (from `main` branch)
- May later inform native iOS/Android direction
- **Do NOT modify during website development unless explicitly intended.** Accidental changes here affect the production app on main.

#### 3. Operator Admin — `app/admin/`
- Business/venue management for operators
- Admin/SaaS UI style is appropriate here
- Auth-gated via middleware; operators only
- Keep completely separate from public website styling and layout

#### 4. Founder Control Panel — `app/control-panel/`
- Internal platform management for the founder
- Admin/SaaS UI style is appropriate here
- CP-admin allowlist gated
- Keep completely separate from public website styling and layout

---

### Website branch rules

1. **Website work happens on the `website` branch only.** Never commit website-specific changes to `main`.
2. **Website UI goes in `app/(website)/`.** This route group does not exist yet — Phase 2 implementation creates it.
3. **The website has its own layout.** Do not add website routes or layout changes to `app/(consumer)/layout.tsx`, `app/(legal)/layout.tsx`, or `app/(standalone)/layout.tsx`.
4. **Reuse the engine.** Any function in `src/lib/` is fair game. Any API route is shared. Any data helper is shared.
5. **Components: import, don't modify.** If a `(consumer)` component fits the website, import it as-is. Adapt it in a wrapper or a new component in `(website)/`. Do not edit the `(consumer)` component to accommodate website needs.
6. **The temporary staging marker in `app/(consumer)/layout.tsx` must be removed** before any real website content is built in Phase 2. It was added only to confirm the deployment pipeline. See "Staging marker" note below.

---

### Staging and deployment

- `main` branch → Vercel Production → happy-hour-compass.vercel.app (the consumer app, operator admin, control panel)
- `website` branch → Vercel Preview → staging.happyhourcompass.com (the public website, in development)
- **No Vercel build config changes are needed.** Staging vs production behavior is controlled entirely through Next.js routing on the respective branches and the `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_NOINDEX` env vars already in place.
- When the website is ready for launch, the routing and domain assignment changes in Vercel dashboard — not in the codebase.

---

### Staging marker — where to remove it

The bootstrap marker added in `app/(consumer)/layout.tsx` (lines 24–27) must be removed as the **first step of Phase 2** (website route group creation), replacing it with a real `app/(website)/` home page. Until that page exists, the marker confirms staging.happyhourcompass.com is live.

When removing: revert the two changes made to `app/(consumer)/layout.tsx`:
1. Remove the `<p>` element (the amber banner)
2. Remove `md:flex-col` from the wrapper `div` (restoring the original layout)

---

### Reference documents

- `operator-admin/WEBSITE_REUSE_AUDIT.md` — detailed audit of what to reuse, what to adapt, what to build new; recommended build sequence; key risks
- `docs/PHASE2-VENUE-COMPLETENESS.md` — venue completeness signals

---

## Website Vision & Playbook

Before any significant public-facing website functionality — UI, UX, layout, navigation, homepage, search, filters, maps, mobile experience, SEO, geographic or location architecture, content, or architecture decisions — review all three documents:

1. **[`docs/website/WEBSITE_VISION_AND_DESIGN_PRINCIPLES.md`](docs/website/WEBSITE_VISION_AND_DESIGN_PRINCIPLES.md)** — Website philosophy, UX principles, and design vision. Takes precedence over implementation convenience.
2. **[`docs/website/WEBSITE_PRODUCT_PLAYBOOK.md`](docs/website/WEBSITE_PRODUCT_PLAYBOOK.md)** — Engineering implementation guide and website build standards. Defines how to apply the philosophy during real implementation. Includes the **Geographic Information Architecture** — the authoritative reference for market, city, neighbourhood, URL structure, search origin priority, and all geographic decisions. Review this section before any geographic, URL, SEO, or location-related implementation.
3. **[`docs/website/CONSUMER_EXPERIENCE_PRD.md`](docs/website/CONSUMER_EXPERIENCE_PRD.md)** — Consumer product experience, customer journey, homepage philosophy, search framework, search results framework, filters, maps, mobile experience, and future consumer roadmap.

If a requested implementation conflicts with any of these documents, surface the conflict before writing code.

Key principles from both documents to carry into every website task:
- The website is the product, not a marketing website. Discovery always comes before explanation.
- Reveal and elevate the existing product engine — never rebuild what already exists.
- Every homepage section must earn its place by improving discovery; it should feel like the beginning of the product, not an introduction to it.
- Show the product instead of describing it. Real venues, real events, real content.
- The product should feel closer to Airbnb, Apple, OpenTable, Resy, or Spotify — never like SaaS or admin software.
- Desktop must feel immersive; mobile must feel native. Neither is an afterthought.
- Do not create UI backed by immature or inconsistently populated data.
- Preserve separation between Public Website, Consumer App, Operator Admin, and Founder Control Panel.

---

## Supabase migrations

### Every new public-schema table must have explicit GRANTs

Supabase removes automatic grants for `anon`, `authenticated`, and `service_role` on new public-schema tables starting **October 30 2026**. Any table created without explicit GRANTs will be silently inaccessible via the Supabase Data API.

**Rule:** Every migration that creates a `CREATE TABLE` in the `public` schema must end with a GRANT block.

**Template:** Copy `supabase/migrations/_template.sql` — the GRANT section is pre-filled with the correct structure and inline guidance.

**Reference:** `supabase/migrations/039_security_hardening.sql` documents the full grant philosophy:
- `anon` — public-facing intake forms only (no login gate required)
- `authenticated` — operator-facing tables accessed directly by the app
- `service_role` — all tables, always (bypasses RLS; required for `createAdminClient()`)
- Scope each role to the minimum operations it actually performs (`SELECT`, `INSERT`, `ALL`, etc.)
- Never grant `ALL` to `anon` or `authenticated`

### RLS must be enabled on every new table

Always include `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` even if no permissive policies are added yet. No permissive policy + RLS enabled = inaccessible to all non-service-role callers by default (safe baseline).
