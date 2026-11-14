# Greater San Diego — coverage plan (revision 3, 2026-11-13)

**Status: prepared for staging review. Nothing has been applied, imported, published, committed or pushed.**
All shared-database access was read-only. Draft insertion was tested only in an
isolated in-memory Postgres (PGlite 16.4) built from the live schema.

Revision 3: every seed row now needs **complete, verified weekly business hours**
(enforced by the importer in dry run and apply). The pilot is **2 eligible rows**;
4 pilot candidates are held (Finca's Sunday happy hour is unresolved — revision 4, 2026-11-14). Rollout steps: `../GREATER_SAN_DIEGO_STEP2_ROLLOUT.md`.

## Files (tracked unless noted)

| File | What it is |
|---|---|
| `pilot/gsd-pilot.csv` | The 2 eligible pilot rows — importer input |
| `pilot/gsd-pilot-held.csv` | The 3 held candidates (same schema, `business_hours_verified=false`) — used only to prove the dry run blocks them |
| `pilot/gsd-pilot-review.csv` | All 6: eligibility, hold reason, business-hours / HH / offers sources, map-pin source and precision |
| `research/gsd-research-candidates.csv` | All candidates by subregion/city with venue-owned evidence and status |
| `step2-cities-{preflight,apply,rollback}.sql` | Generated from the roster by `operator-admin/scripts/buildGreaterSanDiegoCitiesSql.ts` |
| `operator-admin/scripts/output/greater-san-diego-seed-plan-2026-11-13/` (gitignored) | Run evidence: shared-DB dry-run reports, isolated-DB QA (`gsd-pilot.isolated-db-qa.json`, 20/20), revision-1 sample |

## 1. Targets — 90 venues by geography

One consumer-facing market (Greater San Diego). Each listing keeps its real city
(Google `locality`); subregions and neighbourhoods are internal tracking tags only.

| Subregion | City | Target | Internal split |
|---|---|---:|---|
| **City of San Diego** | San Diego | **48** | Downtown/Gaslamp/East Village/Little Italy/Marina 12 · Uptown & Mid-City (Hillcrest, North Park, South Park, Golden Hill, Normal Heights, University Heights, Kensington) 11 · Beaches (PB, Mission Beach, OB, Point Loma, Shelter Island) 10 · La Jolla/UTC 6 · Mission Valley/Kearny Mesa/Convoy/Clairemont 5 · North SD (Carmel Valley, Sorrento, Rancho Bernardo, Scripps Ranch, Mira Mesa) 4 |
| **North County Coastal** | Oceanside 5 · Carlsbad 4 · Encinitas 4 · Solana Beach 2 (incl. Encore) · Del Mar 1 | **16** | Leucadia/Cardiff/Olivenhain tracked under Encinitas |
| **North County Inland** | Escondido 4 · San Marcos 2 · Vista 2 · Poway 1 | **9** | |
| **South Bay** | Chula Vista 6 · Coronado 2 · National City 1 · Imperial Beach 0 | **9** | |
| **East County** | La Mesa 3 · El Cajon 3 · Santee 2 · Lemon Grove 0 | **8** | |
| **Total** | | **90** | ~150 later: deepen San Diego, Chula Vista, Oceanside, Escondido |

Weighting: City of San Diego ≈42% of county population → 53% of venues (nightlife and visitor density); North County Coastal 11% → 18% (coastal nightlife); North County Inland 12% → 10%; South Bay 11% → 10%; East County 8% → 9%. Unincorporated communities (~16% of population) are submission-only at launch.

## 2. City and alias roster (Step 2)

Verified against how addresses resolve: read-only Places probes (2026-11-13) of ~70 county places recorded the `locality` Google returns. Centres are US Census 2024 Gazetteer internal points (public domain), so no Google coordinates are stored.

- **18 incorporated cities** — San Diego, Chula Vista, Oceanside, Escondido, Carlsbad, El Cajon, Vista, San Marcos, Encinitas, National City, La Mesa, Santee, Poway, Imperial Beach, Lemon Grove, Coronado, Del Mar, Solana Beach (existing, untouched).
- **24 communities, zero planned seeds (submissions only)** — Rancho Santa Fe, Fallbrook, Bonsall, Valley Center, Pala, Pauma Valley, Ramona, Bonita, Spring Valley, Lakeside, Alpine, Jamul, Julian, Borrego Springs, Descanso, Pine Valley*, Mount Laguna, Campo, Potrero*, Dulzura, Boulevard*, Jacumba Hot Springs, Warner Springs, Santa Ysabel. (*Census place; Google locality not confirmed by the probe — harmless if unused.)
- **Aliases (typed/postal/neighbourhood → city), market-scoped:**
  - → San Diego: La Jolla, Pacific Beach, Mission Beach, Ocean Beach, Point Loma, Little Italy, Gaslamp (Quarter), East Village, Downtown San Diego, Marina, Barrio Logan, Hillcrest, Mission Hills, Middletown, North Park, South Park, Golden Hill, Normal Heights, University Heights, Mission Valley, Kearny Mesa, Convoy, University City, UTC, Carmel Valley, Carmel Mountain (Ranch), Rancho Bernardo, 4S Ranch, Scripps Ranch, Rancho Peñasquitos, Sorrento Valley/Mesa, San Ysidro, Otay Mesa
  - → Encinitas: Cardiff, Cardiff by the Sea, Cardiff-by-the-Sea, Leucadia, Olivenhain
  - → Carlsbad: La Costa, Carlsbad Village · → Oceanside: Camp Pendleton · → Escondido: Elfin Forest, Harmony Grove · → Chula Vista: Eastlake, Otay Ranch · → El Cajon: Rancho San Diego, Bostonia, Crest, Harbison Canyon · → Spring Valley: La Presa · → Lakeside: Winter Gardens, Granite Hills · → Fallbrook: Rainbow · → Mount Laguna: Mt Laguna · → Jacumba Hot Springs: Jacumba
- Aliases only apply to the typed-city fallback (a Google-matched submission already arrives with the parent city). They are scoped to Greater San Diego and subject to the CA province veto, so "North Park" or "Hillcrest" typed with BC/AB never lands here. A city name shared by two markets now resolves by province or not at all (previously the later row silently won).
- Not covered: Temecula, Tijuana (outside the county) — stay unassigned for founder review.

## 3. Pilot — eligibility, pins, dry runs

Venue-owned pages re-read twice on 2026-11-13. Only `place_id` comes from Google.

| Venue | Status | Weekly hours (venue-owned source) | Happy hour | Shared-DB dry run (read-only) | Isolated DB |
|---|---|---|---|---|---|
| The Lion's Share | **ELIGIBLE** | All 7 days, bar hours — lionssharesd.com | Tue–Sun 4–6 PM | hours ELIGIBLE · city BLOCKED (cities not applied) | inserted draft; re-run skip |
| One Door North | **ELIGIBLE** | All 7 days — onedoornorthsd.com | Mon–Fri 4–6 PM | hours ELIGIBLE · city BLOCKED | inserted draft; re-run skip |
| Finca | **HELD** (2026-11-14) | All 7 days incl. "Closed Monday" — fincanorthpark.com/contact/ (complete & verified) | Updated: Tue–Wed 5–6; Thu 5–9 (open–close); Fri–Sun 3–6; bar & patio only. **Sunday conflicts** between Finca's menu page ("every day from opening until 6 PM") and its homepage/contact list (Tue–Sat) | hours ELIGIBLE (all HH windows inside opening hours) · city BLOCKED · held for Sunday | — |
| Herb & Sea | **HELD** | Monday not stated by the venue | paused for holiday pop-up Nov 11 – Jan 9 | hours INELIGIBLE (`hours_not_verified`) · city BLOCKED | skipped, no venue created |
| Roppongi | **HELD** | Dinner only (from 5 PM); no bar hours | from 3 PM | hours INELIGIBLE (`hours_not_verified`, `hh_outside_business_hours` ×7) · city BLOCKED | skipped |
| Stake Chophouse & Bar | **HELD** | Restaurant from 4:30 PM; 4 PM bar opening only implied | from 4 PM | hours INELIGIBLE (`hours_not_verified`, `hh_outside_business_hours` ×7) · city BLOCKED | skipped |

**Map pins:** all from the US Census Geocoder (`Public_AR_Current`, public domain) — exact house-number match, interpolated along the street segment (address-level, not rooftop). Eligible pins: Lion's Share 23 m, One Door North 33 m, Finca 13 m from Google's own location for the venue (cross-check only, nothing stored); 7.5–12 km from the San Diego city centre, so none is a city-centre placeholder. No pilot row needs a new pin; a rooftop check in the Control Panel preview is part of draft review.

**Isolated QA (20/20):** Step 2 SQL applies 42 cities once and refuses a re-run; eligible rows insert as unpublished `seed` drafts with no Google-derived fields; hours-ineligible rows are blocked in the plan and skipped by apply with no venue row created; re-running the batch inserts nothing; the unique index rejects a forced duplicate Place ID; Encore Sushi's row is byte-identical; city rollback refuses while drafts exist and succeeds once they're gone.

## 4. Research status (`research/gsd-research-candidates.csv`)

| City | Target | Pilot (eligible) / live | Verified HH (priced) | HH schedule only | Partial | Hold | Leads |
|---|---:|---:|---:|---:|---:|---:|---:|
| San Diego | 48 | 2 | 30 | 11 | 7 | 6 | 5 |
| Oceanside | 5 | 0 | 2 | 2 | 0 | 1 | 1 |
| Carlsbad | 4 | 0 | 2 | 2 | 0 | 1 | 0 |
| Encinitas | 4 | 0 | 3 | 1 | 0 | 1 | 1 |
| Solana Beach | 2 | 1 | 1 | 0 | 0 | 1 | 0 |
| Del Mar | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| Escondido | 4 | 0 | 2 | 1 | 0 | 0 | 0 |
| San Marcos | 2 | 0 | 2 | 0 | 0 | 0 | 1 |
| Vista | 2 | 0 | 1 | 0 | 0 | 0 | 0 |
| Poway | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| Chula Vista | 6 | 0 | 1 | 3 | 0 | 1 | 2 |
| Coronado | 2 | 0 | 0 | 3 | 0 | 1 | 0 |
| National City | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| La Mesa | 3 | 0 | 2 | 1 | 0 | 1 | 0 |
| El Cajon | 3 | 0 | 3 | 0 | 0 | 0 | 2 |
| Santee | 2 | 0 | 0 | 1 | 0 | 0 | 1 |
| Imperial Beach | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| Lemon Grove | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| **Total** | 90 | 3 | 50 | 28 | 7 | 13 | 15 |

- 'Verified' here means venue-owned happy hour days/times (and priced offers). **Business hours are verified per batch** — every row also needs complete, venue-owned weekly hours before it can be imported (the rule held 3 of the 6 pilot candidates).
- 50 verified-with-offers candidates + 4 pilot/live; 28 more have a confirmed schedule but need offers. Most of these schedule-only rows sit in Coronado, Chula Vista and the Brigantine group.
- Gaps against the targets: Chula Vista (−2), Santee (−1), Vista (−1), Escondido (−1), Oceanside (−1), plus within San Diego: UTC, Clairemont/Bay Park, Golden Hill, Kensington, Carmel Valley.
- Research findings to act on: Sea 180 (Imperial Beach) appears replaced by Sammy's Woodfired Pizza at the same address; Masters Kitchen (Oceanside) is closed; several domains have lapsed into spam (closure signals: Border X, Monkey King, Small Bar, Bar Pink, Sbicca's old domain).
- Held from the pilot: Finca (Sunday happy hour conflict on its own pages; hours verified), Herb & Sea (Monday hours; HH paused until ~Jan 9 — recheck ~2027-01-10), Roppongi and Stake (no venue-stated bar hours).
- The four round-1 rows without verified HH times (Rustic Root Solana Beach, Harney Oceanside, Cross Street Convoy, Common Theory) stay on the research list and out of the pilot.

## 5. Places terms

Unchanged from revision 1 and still unresolved. The importer refuses any Google-derived column (rating, review count, types, Google hours, maps URI, amenity flags, price level, editorial summary, seeded tags); only `place_id` is stored. Coordinates for the pilot come from the US Census Geocoder. Existing seeded venues still hold Google-derived fields — a decision for Wayne, ideally with legal input.

## 6. Still unverified

- **The real write paths against the shared DB**: Step 2 SQL apply/rollback and `--apply` inserts ran only on the isolated replica (same columns, constraints, unique indexes; update-only triggers omitted; RLS/grants not replicated — the importer uses the service key, which bypasses both).
- **A live Add Your Venue submission** outside Solana Beach: proven through the exact resolution chain the action runs (Places response → `parsePlace` → resolver with the action's arguments → readiness), plus a wiring test pinning those arguments; the server action itself wasn't run (it writes to the shared DB, sends email/Slack and needs Turnstile).
- **Deployed staging**: all browser QA ran on a local dev server.
- Red Tail Bar & Grill (92019 Dehesa) — expected Google locality El Cajon; not probed.
