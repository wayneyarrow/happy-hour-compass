# Greater San Diego Step 2 — cities, assigned-market browsing, pilot import

Follows Step 1 (`GREATER_SAN_DIEGO_ROLLOUT.md`). **Every database write needs Wayne's
explicit approval.** Staging and Production share one Supabase project, so each data
step is live in both the moment it runs.

## What ships

| Layer | Change |
|---|---|
| Code (`website` → `main`) | Roster + aliases (`src/lib/geo/rosters/greaterSanDiego.ts`); market-scoped aliases and duplicate-name guard in `venueGeographyResolver.ts`; website Happy Hours browsing and hero search scope by **assigned market** (`partitionVenuesByMarket`), so assigned venues beyond 60 km appear and coordinate-less venues never leak into another market; header names the region — **"Greater San Diego" from 640 px up, "San Diego" on phones** (same market; full name in the accessible label and dropdown); market-aware **draft-only** importer (`npm run import:market-venues`). |
| Data — cities (shared DB) | `greater-san-diego/step2-cities-apply.sql`: 41 new `cities` rows (17 cities + 24 submission-only communities). No market, venue or other-market change; Solana Beach and Encore untouched. |
| Data — venues (shared DB) | Pilot: `greater-san-diego/pilot/gsd-pilot.csv` — **3 eligible rows** (The Lion's Share, One Door North, Finca) → unpublished `source = 'seed'` drafts. Later: launch batches. |

Pilot and research inputs live in this repo (`greater-san-diego/pilot/`, `greater-san-diego/research/`). Run reports default to the gitignored `operator-admin/scripts/output/import-reports/`.

## Seed eligibility (enforced by the importer, dry run and apply alike)

A row is imported only if it has **complete, verified weekly business hours**: all seven days present in `business_hours` (open/close, or `null` = explicitly closed), `business_hours_verified = true`, a venue-owned `business_hours_source` URL, and every happy hour slot inside that day's opening hours. Missing, conflicting or inferred hours → `blocked` with the reason; apply never creates the row (or anything else — the importer only ever inserts the venue row). The dry run reports **business-hours eligibility separately from city assignment**. Pins need a `coordinates_source` and may not be a city centre.

Currently held (in `pilot/gsd-pilot-held.csv` and the research CSV — never applied):

| Venue | Hold reason | Recheck |
|---|---|---|
| Herb & Sea | Monday not stated by the venue; happy hour suspended for its holiday pop-up (Nov 11 – Jan 9) | ~2027-01-10: reconfirm HH resumed + get Monday |
| Roppongi | Only dinner hours (from 5 PM) published; HH starts 3 PM | Ask venue for bar/lounge hours |
| Stake Chophouse & Bar | Stated opening 4:30 PM; 4 PM bar opening only implied; HH starts 4 PM | Ask venue for bar hours |

Also on the research list, out of the pilot until HH times are verified: Rustic Root (Solana Beach), Harney Oceanside, Cross Street Chicken & Beer (Convoy), Common Theory.

## Order

1. **Review the uncommitted changes on `website`**, commit, push → staging.
2. **Staging checks that need no data change** (all read-only; tracking intercepted):
   - `BASE_URL=https://staging.happyhourcompass.com E2E_INTERCEPT_TRACKING=1 GSD_ENCORE_LIVE=1 npx playwright test e2e/website/greater-san-diego.spec.ts e2e/website/happy-hours-search.spec.ts --project=chromium --project=mobile-chrome`
     — header label/fit vs Central Okanagan, selector + cookie, cross-market name search, map panning, venue-local hours, Encore live URL. Central Okanagan Happy Hours still 65 venues. (The homepage Happy Hours/Events toggle test was already failing before Step 2.)
   - By hand: phone (≤639 px) header reads "San Diego", tablet/desktop "Greater San Diego"; Encore Sushi page `/greater-san-diego/solana-beach/solana-beach-encore-sushi` shows "Solana Beach"; a Kelowna venue never appears in Greater San Diego browsing and vice versa.
   - Importer dry run (read-only, from a laptop against the shared DB):
     `cd operator-admin && npm run import:market-venues -- --market=greater-san-diego --csv=../docs/operations/greater-san-diego/pilot/gsd-pilot.csv`
     Expect business hours **3 eligible**, city assignment **3 blocked** (`unresolved_city` — cities not applied yet). Repeat with `pilot/gsd-pilot-held.csv`: hours **3 ineligible** with reasons.
   - `supabase db query --linked -f docs/operations/greater-san-diego/step2-cities-preflight.sql` (read-only).
3. **Promote to `main`** (normal promotion) and repeat step 2 against Production.
4. **Cities — apply (approval):**
   `supabase db query --linked -f docs/operations/greater-san-diego/step2-cities-apply.sql`
   Verification row: 42 active cities, default `solana-beach`, Encore city `solana-beach`. Re-running refuses.
5. **Pilot dry run again** (step 2 command): expect **3 × INSERT**, hours eligible, city resolved.
6. **Pilot apply (approval):** same command with `--apply`. Re-run without `--apply`: expect 3 × SKIP.
7. **Review the drafts** in the Control Panel (venue page, preview): content, map pin, placeholder photo, hours, happy hour. Publish deliberately (Finca: Sunday HH omitted and flagged for review).
8. **Live submission test — PENDING, separate approval.** See side effects below.
9. **Scale to the launch batch (~90):** batches of ~15–25 by subregion from `research/gsd-research-candidates.csv`: verify complete weekly hours + offers on venue-owned sources → build CSV → dry run → fix flags → apply (approval) → review → publish. Rows without complete verified hours stay in the research CSV.

## Live Add Your Venue test — side effects (keep pending)

A real submission writes to the shared DB (Production) and triggers real notifications. For a Google-match-confirmed submission (`confirmed_auto`), immediately:
- creates an **unpublished venue** (`source = 'operator_submission'`, with market/city if resolved) and an `operator_submissions` row + Internal Notes;
- **provisions an operator**: Supabase Auth user, `operators` row, membership linking the venue;
- starts a **14-day activation lifecycle**; the Production reminder worker then sends reminder emails (deadline −11/−7/−2 days) and, on expiry, a `#customer-success` Slack post and a founder email — unless the lifecycle is released;
- emails the **submitter** (setup / verification code);
- emails the **founder** (`hello@happyhourcompass.com`) and posts to Slack **`#venue-submissions`**.

Non-confirmed matches skip provisioning but still send the submitter confirmation email, the founder email and the Slack post. Use a submitter address Wayne controls, tell the team the Slack post is a test, and afterwards **Release** the lifecycle and venue from the Control Panel (or reject the submission) so no reminders go out. The geography outcome it proves (La Jolla → San Diego, Cardiff → Encinitas, CA/California, zero-seed communities) is already covered by unit tests through the action's exact resolution chain.

## Rollback

- Code: redeploy the previous Production deployment.
- Pilot/batch drafts: unpublished `source = 'seed'` rows; the apply report lists their ids — delete by id with a reviewed statement.
- Cities: `step2-cities-rollback.sql` — refuses while any venue, neighbourhood, collection, homepage, guide or market default references a Step 2 city (remove the drafts first).

## Known limits

- Insert-only: corrections to an imported draft go through Operator/Control Panel or a reviewed SQL change.
- Places storage terms are unresolved: the importer refuses Google-derived columns; pins come from the US Census Geocoder. Don't run `refresh:seeded-venues --apply` for Greater San Diego until that's decided.
- Other surfaces still scope by radius (events listing, Discover-driven homepage rails, consumer app). Greater San Diego has no Homepage record yet (Step 3).
- The isolated QA harness (PGlite replica) used to prove the write paths is not part of this change; results are recorded in `greater-san-diego/GSD_SEED_COVERAGE_PLAN.md`.
