# Greater San Diego rollout (Step 1) — runbook

Opens Greater San Diego as a selectable US market with Solana Beach, CA as
its first city, and assigns Encore Sushi's existing draft
(`4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840`, owned by operator
`29ba66da-96b5-47ec-831d-b2a22b8903c9`) so the owner can publish it himself
through Operator Admin.

**Database writes happen only with Wayne's explicit approval.** Staging and
Production share one Supabase project, so the data step is live in both the
moment it runs.

## What changes

| Layer | Change |
|---|---|
| Data (shared DB) | `markets` + `greater-san-diego` (CA, US, active, center 32.85,−117.15, 60 km); `cities` + `solana-beach`; `markets.default_city_id`; Encore Sushi `market_id`/`city_id` only. Nothing else. |
| Code (`website` branch → `main`) | `MARKETS` entry (active, US); US first-visit default; cross-market name search + map panning; venue-local Open Now / Happy Hour Now with converted, labelled hours for other-timezone visitors; BC permanent UTC−7 correction for stale runtimes; Kelowna newsletter (signup bands + header link) shown in Central Okanagan only. |

## Order

1. **Preflight (read-only, any time).**
   `supabase db query --linked -f docs/operations/greater-san-diego/preflight.sql`
   Expect: `existing_market_rows = 0`, `existing_city_rows = 0`,
   `venues_to_assign = ["4ecc0d2c-…"]`, `encore_before.market_id/city_id = null`,
   `is_published = false`, owner `29ba66da-…`; unassigned venues: Seattle 84,
   Toronto 52, Solana Beach 1; markets unchanged (4 rows).
2. **Apply data (approval required).**
   `supabase db query --linked -f docs/operations/greater-san-diego/apply.sql`
   One transaction; aborts unless exactly 1 market, 1 city and Encore change.
   The verification row must show `active`, `US`, default city
   `solana-beach`, Encore `is_published = false`, same owner, `venue_city =
   solana-beach`.
   - Production effect before the code ships: none visible to consumers
     (Production's `MARKETS` has no Greater San Diego, so its venue URL 404s
     and it is in no listing). Operator Admin's checklist item clears.
     **Don't tell Chris yet** — if he publishes before step 4, his link 404s.
3. **Phase A checks on staging** (below) — push `website`; needs step 2,
   since staging reads the same DB.
4. **Promote to `main` / Production deploy** (normal promotion).
5. **Phase A checks on Production** (the rows marked *Prod*), plus the
   runtime timezone check.
6. **Tell Chris to click Publish.** Only after 1–5 pass.
7. **Phase B checks** (require his live listing).

Rollback: code — redeploy the previous Production deployment. Data —
`docs/operations/greater-san-diego/rollback.sql` (refuses while Encore is
published or anything else references the market; unpublish first).

## Phase A — before inviting Chris to publish

Everything here works without Encore being public. Encore's own page is
reached through Operator Admin **preview** while impersonating Chris
(`canPreviewVenue` authorizes the impersonated owner) — never by publishing
it.

Automated, from a laptop (tracking intercepted; read-only):
`BASE_URL=https://staging.happyhourcompass.com E2E_INTERCEPT_TRACKING=1 npx playwright test e2e/website/greater-san-diego.spec.ts --project=chromium --project=mobile-chrome`
— expect the Encore-only tests and the mobile map tests to skip, and the
country-default tests to skip (the header can't be forged on a deployment;
they are covered by hand below). Note: the website e2e intercept doesn't
catch requests sent while a page unloads, so a run can still record a
handful of `staging`-environment analytics rows; they never count in
Production reporting.

| # | Check | Where | How / expected |
|---|---|---|---|
| A1 | Operator checklist | Staging, *Prod* | Control Panel → impersonate Chris → Encore Sushi in Operator Admin: "Market & city assignment" ticked, no other required item open. **Don't press Publish.** |
| A2 | Encore page in preview | Staging | From Operator Admin (impersonating), open the venue preview: URL `/greater-san-diego/solana-beach/solana-beach-encore-sushi`, photo, specials, hours, map pin at Solana Beach. Logged-out visitors still get 404 (correct until published). |
| A3 | US first-visit default | Staging, *Prod* | Private window, US connection (or US VPN), no cookies: header "📍 Solana Beach", Happy Hours shows Greater San Diego. |
| A4 | Canadian first-visit default | Staging, *Prod* | Private window, Canadian connection, no cookies: header "📍 Kelowna". (Elsewhere/unknown country: also Kelowna.) |
| A5 | Saved choice beats country | Staging, *Prod* | On the US connection, choose Central Okanagan in the selector; close the window, reopen the site in the same profile: still Kelowna. Then choose Greater San Diego on a Canadian connection: stays San Diego on return. |
| A6 | Switching, desktop + mobile | Staging | Selector lists Central Okanagan and Greater San Diego under Active regions; switching updates the header label, Happy Hours listing and map start position together; refresh and a new tab keep it. Greater San Diego shows "No venues found" until Phase B. |
| A7 | Newsletter scoped | Staging, *Prod* | Greater San Diego homepage: no "Your Happy Hour Plans" band, no Kelowna copy, no header/mobile-menu "Newsletter" link. Central Okanagan homepage: band + link present. |
| A8 | Cross-market search | Staging | From Greater San Diego, search a Kelowna venue by name (listing and hero suggestions): found, labelled "Kelowna, BC". Search "wings": nothing from Kelowna. |
| A9 | Map panning keeps the choice | Staging | From Greater San Diego, Ctrl/pinch-zoom out to Kelowna: Kelowna pins and cards appear; header and saved market unchanged. |
| A10 | Winter hours — converted | Staging | Chrome DevTools → Sensors → Location timezone `America/Los_Angeles`; open a Kelowna venue: caption "Times shown in your time (PST) · Venue local time: PDT", hours one hour earlier than listed. With `America/Vancouver`: no caption, hours as listed. |
| A11 | Winter hours — Encore in preview | Staging | A2's preview with timezone `America/Vancouver`: happy hour "4 PM–6:30 PM PDT" (3–5:30 PM Pacific), business hours one hour later, caption shown; with `America/Los_Angeles`: 3 PM–5:30 PM, no caption. On a Tue–Sun between 23:00 and 01:30 UTC, "Happy Hour On Now" must agree in both timezones. |
| A12 | Central Okanagan unchanged | Staging, *Prod* | Kelowna homepage sections, a venue page, Happy Hours map/list (65 venues), search, hours and Open Now as before for a Kelowna visitor. |
| A13 | Runtime timezone data | *Prod* | Confirm `process.versions.tz` of the Production function runtime (Vercel setting: Node.js 22.x). `≥ 2026b`: BC correction idle; older: correction active. Both give Kelowna UTC−7 this winter — A10/A11 are the user-visible proof. |

## Phase B — requires Chris's live listing

After Chris clicks Publish himself:

| # | Check | Expected |
|---|---|---|
| B1 | Publish succeeded | Operator Admin shows Encore published; no error. |
| B2 | Logged-out page | `https://happyhourcompass.com/greater-san-diego/solana-beach/solana-beach-encore-sushi` returns 200 in a private window; photo, hours, specials. |
| B3 | Greater San Diego browsing | Happy Hours lists Encore Sushi; the map opens on Solana Beach with its pin. |
| B4 | Found by name from Central Okanagan | With Central Okanagan selected, search "Encore Sushi" (listing and hero): found, labelled "Solana Beach, CA"; not in Central Okanagan browsing otherwise. |
| B5 | Pan from Kelowna to Solana Beach | Central Okanagan selected, zoom out from Kelowna and in on Solana Beach: Encore's pin and card appear, list shows only Encore, header still Kelowna. |
| B6 | Winter hours, live | Kelowna browser: "4 PM–6:30 PM PDT" with caption; San Diego browser: "3 PM–5:30 PM", no caption. |
| B7 | Automated | `GSD_ENCORE_LIVE=1 BASE_URL=https://happyhourcompass.com E2E_INTERCEPT_TRACKING=1 npx playwright test e2e/website/greater-san-diego.spec.ts --project=chromium` |
| B8 | Sitemap | `sitemap.xml` includes the Encore URL (Greater San Diego is active). |

## Known limits (Step 2+)

- New submissions from other San Diego-area cities (Del Mar, Encinitas,
  Carlsbad, San Diego…) still get no market until those cities are seeded —
  same blocker Chris hit. Seed cities before inviting other venues.
- No Greater San Diego Homepage record: hero only until Step 3 (the
  newsletter band is hidden there).
- While a Central Okanagan visitor pans to Solana Beach, the listing's
  context header still reads "Central Okanagan · 1 venue" (the saved market
  is deliberately unchanged).
- Other-market venues are sent with the listing page and revealed by map
  bounds; fine at today's ~65 + 1 venues, move to a bounds query when San
  Diego is seeded at scale.
- Internal tools that hard-code `America/Vancouver` (Control Panel dates,
  Customer Success send slots, plan-grant dates, Scout Report, giveaway
  window) are not corrected for stale runtimes — see A13.
