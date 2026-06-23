# Happy Hour Compass — Website Reuse Audit
**Phase 0 | Audit Date: June 2026**

---

## 1. Executive Summary

The existing HHC codebase is substantially more website-ready than a green-field project would be. The Discover Engine, rail components, venue detail pages, event detail pages, market infrastructure, search infrastructure, and business acquisition flows are all production-grade and directly portable. The most significant gaps are in SEO infrastructure (no OG tags, no structured data, no sitemap) and the consumer layout shell (currently a fixed 375 px phone frame that needs a responsive desktop layout for a public website).

**Overall reuse estimate:**
- ~35% reusable as-is
- ~40% reusable with meaningful adaptation (SEO wiring, layout changes, URL routing)
- ~25% net-new development (SEO infrastructure, guide/editorial pages, pricing page, desktop layout shell)

The recommended approach is to keep all existing logic in place and build the website as a new route group (`app/(website)/`) within the same Next.js project, sharing lib, data helpers, discover engine, and API routes wholesale.

---

## 2. Detailed Audit Findings

---

### 2.1 Consumer Homepage Audit

**Current implementation:**
`src/app/(consumer)/home/ConsumerHome.tsx` — client component, receives pre-filtered rail data from the server page and renders all rails.

#### Spotlight Venues Rail
| Item | Detail |
|------|--------|
| File | `src/app/(consumer)/home/ConsumerHome.tsx` (lines 217–227) |
| Data source | `getSpotlightVenues()` in `discoverEngine.ts` → `spotlight_eligible = true` venues, scored |
| Card component | `src/app/(consumer)/home/VenueRailCard.tsx` |
| Rail container | `src/app/(consumer)/home/RailSection.tsx` |
| Collection page | `src/app/(consumer)/home/collections/[collection]/page.tsx` (slug: `spotlight`) |
| Reusability | High — logic is pure, market-aware, override-aware |
| Modifications | Swap `RailSection` horizontal scroll for a website grid or wider horizontal scroll; strip `WelcomeGate` wrapper |

#### Patio Picks Rail
| Item | Detail |
|------|--------|
| File | `ConsumerHome.tsx` (lines 229–239) |
| Data source | `getPatioPicks()` — filters on `seededTags` or `searchTags` including `"Patio"` |
| Reusability | High — tag filter works across markets |
| Modifications | None on engine; card and container same as Spotlight |

#### Featured Nearby Rail
| Item | Detail |
|------|--------|
| File | `ConsumerHome.tsx` (lines 255–267) |
| Data source | `getFeaturedNearby()` — full geo pool, client-side sorted by `navigator.geolocation` |
| Client geo sort | Lives in `ConsumerHome.tsx` `useEffect` (lines 120–140) |
| Reusability | High — geo sort logic is self-contained |
| Modifications | Works as-is; for a website, consider server-side IP geolocation as fallback |

#### New This Week Rail
| Item | Detail |
|------|--------|
| File | `ConsumerHome.tsx` (lines 269–279) |
| Data source | `getNewThisWeek()` — 30-day recency window, recency-then-score sort |
| Reusability | High — pure function, no UI changes needed |

#### Featured Events Rail
| Item | Detail |
|------|--------|
| File | `ConsumerHome.tsx` (lines 281–293) |
| Card component | `src/app/(consumer)/home/EventRailCard.tsx` |
| Data source | `computeFeaturedEventRail()` in `featuredEventsEngine.ts` |
| Reusability | High — event engine is already separate from venue engine |
| Modifications | `EventRailCard` has no image URL — amber gradient placeholder is fine for now; plan to add event images |

#### Highly Rated Rail
| Item | Detail |
|------|--------|
| File | `ConsumerHome.tsx` (lines 242–253) |
| Data source | `getHighlyRated()` — primary ≥ 4.0 Google rating, fallback ≥ 3.5 |
| Reusability | High |

#### Browse Infrastructure (Hidden)
| Item | Detail |
|------|--------|
| Files | `BrowseSection.tsx`, `BrowseTile.tsx`, `browseCategories.ts`, `home/browse/[browse]/`, `home/collections/[collection]/` |
| Status | Intentionally hidden (`{false && ...}`) pending Browse Strategy V2 |
| Reusability | High — full infrastructure is preserved and functional |
| Website use | Re-enable for website browse pages (e.g. `/vancouver/patios`, `/vancouver/sports-bars`) |

#### RailSection Container
`src/app/(consumer)/home/RailSection.tsx` — generic horizontal scroll container with title, subtitle, "See all" link, and scroll track. Pure presentational, zero coupling to data. **Directly reusable** as-is for both mobile and website rail contexts.

#### Page Orchestrator
`src/app/(consumer)/page.tsx` — calls all five data fetches in parallel, runs each engine function, and renders. The pattern (fetch once, distribute) is the correct architecture for the website home page as well. **Copy and adapt** to a new `app/(website)/page.tsx`.

---

### 2.2 Discover Engine Audit

**File:** `src/lib/discover/discoverEngine.ts` (519 lines)

#### Capabilities Inventory

| Function | Purpose | Website Ready |
|----------|---------|--------------|
| `getSpotlightVenues()` | Spotlight rail — `spotlight_eligible` + verified fallback | Yes |
| `getPatioPicks()` | Tag-filtered "Patio" venues | Yes |
| `getFeaturedNearby()` | All local venues, client geo-sorted | Yes |
| `getNewThisWeek()` | 30-day recency window | Yes |
| `getHighlyRated()` | Google rating ≥ 4.0 / ≥ 3.5 fallback | Yes |
| `getFeaturedEvents()` | Events from local eligible venues | Yes |
| `getTaggedVenues()` | Arbitrary tag filter for browse/collection pages | Yes |
| `filterBrowseCategories()` | Threshold-gated browse section visibility | Yes |
| `getRailVenuesByKey()` | Dispatch helper (used by CP Discover management) | Yes |
| `haversineKm()` | Geo distance — also used by client components | Yes |
| `isNearMarket()` | Market radius gate | Yes |
| `isDiscoverEligible()` | `exclude_from_discover` check | Yes |
| `scoreVenueForDiscover()` | Additive score: boost + plan + rating | Yes |

#### Pipeline
```
Geography → Eligibility → Rail filter → Overrides → Dedupe → Score sort
```
All gates are pure functions on `ConsumerVenue[]`. **Zero coupling to routing or rendering.**

#### Override System
`src/lib/data/discoverOverrides.ts` — `getAllRailOverrides()` returns include/exclude per rail key. Managed via `/control-panel/discover`. Works for website rails without modification.

#### Market Awareness
Every engine function accepts an optional `MarketConfig` param. The page orchestrator converts the active cookie market via `toMarketConfig()`. **Fully multi-market capable.**

#### Required Enhancements
- None for Phase 1 website launch.
- Phase 2: context-aware scoring (distance weight for nearby, time-of-day for HH Now rails), dynamic market config from DB.

---

### 2.3 Search Infrastructure Audit

**Primary file:** `src/app/(consumer)/VenueDiscovery.tsx` (625 lines)

#### Existing Functionality

| Feature | Implementation | Status |
|---------|---------------|--------|
| Text search | Client-side, filters on `v.name` and `v.searchTags` | Working |
| Quick filter chips | Happening Now, Near Me, Open Now, Sports Bars, Fine Dining, Under $10 | Working |
| Advanced tag panel | Grouped by Experience / Food / Drinks, OR logic | Working |
| Active tag badges | Inline dismissal, "Clear all" | Working |
| Map / List toggle | `VenueMapView` + `VenueList` | Working |
| Map viewport filtering | Filters list to map bounds on idle | Working |
| Scroll position restore | `sessionStorage` → `rAF` retry on return | Working |
| Market chip | `MarketChip` with auto-detect | Working |
| Search tracking | `trackEvent("search_used")` + `/api/track/search-tag` | Working |

#### Tag Catalog
`src/lib/searchTags.ts` — 30 tags across 3 groups:
- Venue Experience (15): Patio, Live Music, DJ, Sports Viewing, Trivia Nights, Date Night, Family Friendly, Group Friendly, Dog Friendly, Late Night, Waterfront, Rooftop, Lively, Casual, Bar Seating
- Food Highlights (10): Wings, Burgers, Pizza, Tacos, Seafood, Steak, Appetizers, Small Plates, Vegetarian Friendly, Gluten Friendly
- Drink Highlights (5): Craft Beer, Cocktails, Wine, Mocktails, Local Beer

#### Event Search
`src/app/(consumer)/EventsDiscovery.tsx` — basic event list, client-side filtered. Less mature than venue search.

#### Reusable Components
- `VenueDiscovery` — reusable with props; already receives `ConsumerVenue[]` + `Market`
- `VenueList` — exports `getOpenStatus`, `haversineKm`, `isHappeningNow` (reused across components)
- `VenueMapView` — Google Maps, reusable

#### Missing for Website Architecture
- URL-based filter state (e.g. `?tags=Patio,Wings`) — currently all in-memory React state
- Server-side search / DB full-text search for large inventories
- Pagination / infinite scroll (currently loads all venues client-side)
- Keyword search for events
- Distance-based sort as a primary filter (not just "Near Me" binary)
- Saved search / recent searches

---

### 2.4 Venue Detail Audit

**File:** `src/app/(consumer)/venue/[id]/page.tsx`

#### Existing Components

| Component | File | Purpose |
|-----------|------|---------|
| `VenueImageGallery` | `venue/[id]/VenueImageGallery.tsx` | Hero + thumbnail strip |
| `VenueJumpChips` | `venue/[id]/VenueJumpChips.tsx` | Sticky section nav (Happy Hour / Info) |
| `VenueDetailMeta` | `venue/[id]/VenueDetailMeta.tsx` | Status badge, distance, establishment type |
| `HappyHourTimesCard` | `venue/[id]/HappyHourTimesCard.tsx` | Weekly HH schedule + specials |
| `BusinessHoursRow` | `event/[id]/BusinessHoursRow.tsx` | Business hours expandable |
| `VenueInfoRows` | `venue/[id]/VenueInfoRows.tsx` | Address, phone, website, menu, payment rows |
| `GoogleRatingBadge` | `venue/[id]/GoogleRatingBadge.tsx` | ★ X.X (N reviews) badge |
| `BackButton` | `venue/[id]/BackButton.tsx` | `router.back()` |
| `BookmarkButton` | `BookmarkButton.tsx` | Bookmark toggle |
| `ShareButton` | `event/[id]/ShareButton.tsx` | Web Share API |
| `VenueViewTracker` | `venue/[id]/VenueViewTracker.tsx` | Fires POST /api/track/venue-view on mount |

#### Data Query
`getVenueWithEventsForConsumerById()` in `src/lib/data/venues.ts`:
- Slug-first lookup, UUID fallback
- Fetches images in parallel with events
- Preview mode (unpublished) via `?preview=true`
- Returns full `ConsumerVenue` with `images[]` and `events[]`

#### Analytics Tracking
- `VenueViewTracker` → POST `/api/track/venue-view` → `venue_view_events` table (venue_id, session_id, city)
- `VenueInfoRows` → POST `/api/track/venue-click` on address/phone/website/maps/menu taps

#### SEO Assessment
| Item | Current State |
|------|-------------|
| `generateMetadata` | Yes — returns `{ title: venue.name }` only |
| Description meta | None |
| Open Graph title | None |
| Open Graph image | None |
| Twitter card | None |
| JSON-LD (LocalBusiness schema) | None |
| Canonical URL | None |
| Slug-based URL | Yes — `/venue/[slug]` e.g. `/venue/kelowna-the-keg` |

#### Routing Assessment
Current: `/venue/[id]` where id is slug or UUID.
Website target: `/[market]/[slug]` (e.g. `/kelowna/the-keg`) or `/venue/[slug]`.
Market-scoped routing is a new pattern; slug is already in the DB.

#### Required Modifications
1. `generateMetadata` → add description, OG title, OG image, twitter:card
2. Add `LocalBusiness` + `FoodEstablishment` JSON-LD
3. Add canonical `<link>` tag
4. Adapt layout from 375px phone frame to responsive desktop layout
5. Optionally: market-scoped URL (`/vancouver/venue-slug`)
6. `BackButton` uses `router.back()` — replace with explicit href for direct-access users

---

### 2.5 Event Detail Audit

**File:** `src/app/(consumer)/event/[id]/page.tsx`

#### Existing Components

| Component | Purpose |
|-----------|---------|
| `EventBackButton` | `router.back()` |
| `EventBookmarkButton` | Bookmark toggle |
| `ShareButton` | Web Share API (shared with venue) |
| `JumpChips` | Sticky nav (Event / Venue sections) |
| `BusinessHoursRow` | Venue hours on event page |
| `VenueInfoRows` | Venue address/phone/website (shared with venue detail) |
| `EventViewTracker` | POST /api/track/event-view on mount |
| `EventActionButtons` | Call, website CTA buttons |

#### Data Query
`getEventForConsumerById()` in `src/lib/data/events.ts` — returns `ConsumerEventDetail` with full venue context (address, hours, phone, website, menu, payment).

#### Analytics Tracking
- `EventViewTracker` → POST `/api/track/event-view` → `event_view_events` table

#### SEO Assessment
| Item | Current State |
|------|-------------|
| `generateMetadata` | **None** — no metadata exported at all |
| JSON-LD (Event schema) | None |
| OG image | None |
| Canonical URL | None |

Event pages have zero SEO metadata — highest priority gap for website launch.

#### Required Modifications
1. Add `generateMetadata` with title, description, OG, twitter:card
2. Add `Event` JSON-LD schema (startDate, location, organizer)
3. Add canonical tag
4. Adapt layout from phone frame to desktop
5. `EventBackButton` → explicit back href

---

### 2.6 Market Infrastructure Audit

**Files:**
- `src/lib/markets.ts` — market config registry
- `src/lib/activeMarket.ts` — cookie reader
- `src/app/(consumer)/MarketChip.tsx` — geo-detect + modal trigger
- `src/app/(consumer)/MarketModal.tsx` — market selection modal
- `src/app/(consumer)/marketActions.ts` — server action to set cookie

#### Market Registry
```
Central Okanagan — active  — radius 50km
Greater Vancouver — active  — radius 50km
Victoria          — coming_soon — radius 25km
Calgary           — coming_soon — radius 40km
```

`getMarketById()`, `getDefaultMarket()`, `findNearestActiveMarket()`, `toMarketConfig()` are all production-ready.

#### Cookie-Based Active Market
`getActiveMarket()` reads `hhc_market` cookie (server-only), validates against active markets, falls back to `central-okanagan`. Clean, works as-is.

#### Auto-Detection
`MarketChip` runs `navigator.geolocation` on first visit (when no cookie), calls `findNearestActiveMarket()`, sets cookie via `setMarketAction()`, and refreshes if market changed. This pattern transfers to the website without changes.

#### Market Modal
`MarketModal.tsx` — lists active markets, highlights current, sets cookie on select. Works as-is.

#### Website Suitability Assessment
The cookie model works well for a single-domain multi-market website. For the website, consider adding URL-based market routing (`/vancouver/...`) as the canonical path — the cookie becomes a persistence mechanism, not the routing authority. The Discover Engine already accepts a `MarketConfig` param, making URL-to-market routing straightforward to wire.

**Required Enhancements:**
- URL-based market segment (e.g. `/[market]/`) as website canonical routing
- Market landing pages (`/vancouver`, `/kelowna`)
- Redirect: root `/` → nearest active market based on geo or cookie

---

### 2.7 Analytics Foundation Audit

#### Existing Tracking Infrastructure

| Layer | Implementation |
|-------|---------------|
| Page-level analytics | Vercel Analytics (`@vercel/analytics`) — injected in root layout |
| Performance monitoring | Vercel Speed Insights (`@vercel/speed-insights`) — injected in root layout |
| Anonymous session ID | `src/lib/trackingSession.ts` — `sessionStorage`-based UUID |
| Client event tracking | `src/lib/analytics.ts` → `trackEvent()` wrapper for Vercel Analytics |
| Custom Supabase events | API routes → DB inserts |

#### API Route Tracking Events

| Route | Event | DB Table |
|-------|-------|---------|
| `/api/track/venue-view` | Venue detail page open | `venue_view_events` |
| `/api/track/venue-discover` | Rail impression + click | (discover events table) |
| `/api/track/venue-click` | Info row tap (address/phone/website/menu) | (venue_click_events) |
| `/api/track/venue-save` | Bookmark save/unsave | (venue_save_events) |
| `/api/track/event-view` | Event detail page open | `event_view_events` |
| `/api/track/search-tag` | Tag filter used | (search_tag_events) |

#### Client-Side `trackEvent()` Calls (Vercel Analytics)
- `search_used` — first character typed in search
- `filter_used` — quick chip filter activated
- `tag_filter_used` — tag selected from advanced panel
- `map_view_opened` / `list_view_opened` — view toggle
- `bookmark_*` — save/unsave actions

#### Operator Analytics
`src/lib/data/operatorAnalyticsV2.ts` — per-operator stats (venue views, event views, discover impressions/clicks). Powers `/admin/analytics`.

#### Founder Analytics
`src/lib/data/founderDashboard.ts` — platform-wide KPIs: venue counts, operator counts, plan distribution, conversion rates. Powers `/control-panel/analytics`.

#### Already Covered for Website
- Venue page views (Supabase)
- Event page views (Supabase)
- Discover impressions and clicks (Supabase)
- Search and filter usage (Vercel Analytics)
- Bookmark saves (Supabase)

#### Additional Website Analytics Required
- Search query text logging (currently only tracks that search was used, not what was typed)
- Outbound click tracking: phone call, Google Maps, website, menu link (VenueInfoRows has click events, but need to confirm DB persistence)
- Claim CTA click tracking on venue pages
- Market selection analytics
- Event action button clicks (Call / Website on event pages)
- Page-level UTM / referral attribution
- Conversion funnel: discover → venue view → claim submit → activation

---

### 2.8 Authentication Audit

#### Consumer Routes
All consumer routes (`/`, `/venue/*`, `/event/*`, `/home/*`, `/explore`, `/events`, `/saved`, `/suggest/*`) are **completely public** — no auth required.

#### Operator Routes
`/admin/*` — guarded by `src/middleware.ts`:
- Uses `supabase.auth.getUser()` (network-validated, not just cookie-read)
- Unauthenticated → redirect `/login`
- Authenticated at `/login` → redirect `/admin/venue`

#### Control Panel Routes
`/control-panel/*` — guarded by layout (`app/control-panel/layout.tsx`):
- Auth check via `supabase.auth.getUser()`
- CP-admin allowlist check via `isControlPanelAdmin(email)` against `CONTROL_PANEL_ADMIN_EMAILS` env var
- Unauthorized-but-authenticated → redirect `/`

#### Consumer Auth (Website Implications)
There is currently no consumer login. Bookmarks and saves appear to use client-side state (no user account required). For the public website:
- Consumer login is a future feature, not a Phase 1 blocker
- Operator login (`/login`) is already built and would be the same entry point for operators reaching `/admin/*`
- No changes needed to auth middleware for website Phase 1

#### Claim Flow Auth
The venue claim flow (`/venue/[id]/claim`) is unauthenticated — operators submit a form, the CP reviews, and an activation email triggers account creation. This flow already handles the "add your business" acquisition path without requiring pre-existing auth.

---

### 2.9 API and Service Audit

#### Reusable API Routes

| Route | Purpose | Website Reuse |
|-------|---------|--------------|
| `/api/track/venue-view` | Track detail page opens | Yes — same endpoint |
| `/api/track/event-view` | Track event page opens | Yes — same endpoint |
| `/api/track/venue-discover` | Rail impressions + clicks | Yes — same endpoint |
| `/api/track/venue-click` | Info row taps | Yes — same endpoint |
| `/api/track/venue-save` | Bookmark events | Yes — same endpoint |
| `/api/track/search-tag` | Tag filter usage | Yes — same endpoint |
| `/api/health` | Health check | Yes |
| `/api/webhooks/stripe` | Billing webhooks | Yes — shared |
| `/auth/callback` | Supabase OAuth callback | Yes — shared |

#### Reusable Services / Utilities

| Module | Purpose | Reuse |
|--------|---------|-------|
| `src/lib/supabase/server.ts` | `createServerClient()` + `createAdminClient()` | Yes |
| `src/lib/supabase/browser.ts` | `createBrowserClient()` | Yes |
| `src/lib/email.ts` | Resend email sending | Yes |
| `src/lib/slack.ts` | Slack notifications | Yes |
| `src/lib/slugify.ts` | URL slug generation | Yes |
| `src/lib/imageProcessing.ts` | Image optimization | Yes |
| `src/lib/seededTags.ts` | Platform-generated tag inference | Yes |
| `src/lib/trackingSession.ts` | Anonymous session ID | Yes |
| `src/lib/analytics.ts` | `trackEvent()` wrapper | Yes |
| `src/lib/plans.ts` | Plan tier types | Yes |
| `src/lib/subscriptions.ts` | Subscription helpers | Yes |
| `src/lib/venueSetupStatus.ts` | Venue completeness | Operator-only |
| `src/lib/trustSignals.ts` | Claim trust scoring | CP-only |
| `src/lib/impersonation.ts` | Operator impersonation | CP-only |

#### Data Helpers — Consumer-Relevant

| Helper | Purpose |
|--------|---------|
| `src/lib/data/venues.ts` — `getPublishedVenuesForConsumer()` | Full venue list for discover |
| `src/lib/data/venues.ts` — `getVenueWithEventsForConsumerById()` | Single venue detail |
| `src/lib/data/events.ts` — `getEventsForConsumerVenues()` | Events for venue batch |
| `src/lib/data/events.ts` — `getEventForConsumerById()` | Single event detail |
| `src/lib/data/events.ts` — `getCPFeaturedEventCandidates()` | Featured events pool |
| `src/lib/data/discoverOverrides.ts` — `getAllRailOverrides()` | Rail curation overrides |
| `src/lib/data/discoverEventOverrides.ts` — `getEventOverridesForRail()` | Event rail overrides |
| `src/lib/discover/discoverEngine.ts` — all functions | Rail selection |
| `src/lib/discover/featuredEventsEngine.ts` — `computeFeaturedEventRail()` | Events rail |
| `src/lib/markets.ts` + `src/lib/activeMarket.ts` | Market routing |

All of these work within a new `app/(website)/` route group without modification.

---

### 2.10 SEO Readiness Audit

#### Current State

| Capability | Status | Detail |
|-----------|--------|--------|
| Title template | Partial | Root layout has `%s — Happy Hour Compass`; few pages implement it |
| Page descriptions | Minimal | Root layout has one generic description only |
| Open Graph | None | No `openGraph` in any metadata export |
| Twitter card | None | No `twitter` in any metadata export |
| JSON-LD structured data | None | No JSON-LD anywhere |
| Canonical URLs | None | No `<link rel="canonical">` |
| Sitemap | None | No `sitemap.ts` or `sitemap.xml` |
| `robots.txt` | None | No `robots.ts` or `robots.txt` |
| Slug-based URLs | Yes | Venues have slugs (e.g. `kelowna-the-keg`); used in routing |
| `generateMetadata` on venue pages | Partial | Returns title only; no description/OG |
| `generateMetadata` on event pages | None | Completely absent |
| `generateMetadata` on collection pages | Partial | Returns dynamic title only |
| Image `alt` attributes | Partial | Present on venue images; missing on some UI images |
| Semantic HTML | Partial | `<h1>`, `<h2>`, `<h3>` used in detail pages; most consumer nav is `<div>` |

#### SEO Work Required for Website

1. **`generateMetadata` for every page**: title, description, OG title, OG description, OG image, twitter:card
2. **Venue JSON-LD**: `LocalBusiness` + `FoodEstablishment` schema with name, address, telephone, url, openingHoursSpecification, aggregateRating
3. **Event JSON-LD**: `Event` schema with name, startDate, location, organizer
4. **`sitemap.ts`**: dynamic sitemap covering all published venue slugs + event IDs
5. **`robots.ts`**: allow consumer pages; disallow `/admin/*`, `/control-panel/*`
6. **Canonical tags**: especially needed if venue is accessible at multiple URL patterns
7. **OG images**: either static asset or dynamic generation via Next.js `ImageResponse`
8. **`lang="en"`**: already set in root layout

---

### 2.11 Business Acquisition Audit

#### Existing Operator Acquisition Flows

##### Add Your Business (`/suggest/owner`)
**File:** `src/app/(consumer)/suggest/owner/` (4 files)
- 7-step state machine: form → looking-up → match | no-match → reject-form → confirmed | rejected
- Google Places API (New) Text Search with confidence gate
- Static map + Street View thumbnail
- DB write: `operator_submissions` table (migration 015)
- CP review at `/control-panel/operator-submissions/[id]`
- Approval email via Resend with activation token
- **Maps directly to `/for-businesses/add-your-business`** — adapt heading/copy, keep all logic

##### Claim Your Business (`/venue/[id]/claim`)
**File:** `src/app/(consumer)/venue/[id]/claim/` (3 files)
- Unauthenticated claim form: first/last name, role, phone, email
- Submission → `venue_claims` table → CP review
- CP review at `/control-panel/claims/[id]`
- Approval flow: token → activation email → account creation
- Trust signals: `src/lib/trustSignals.ts` (email domain, public email, role, phone match, IP, prior claims)
- **Maps directly to `/for-businesses/claim-your-business`** — currently accessible from each venue page, needs a standalone entry page

##### Pricing Page (`/for-businesses/pricing`)
**No existing implementation.** Net-new page. Subscription tiers and prices exist in `src/lib/plans.ts` and Stripe integration exists (`src/lib/stripe.ts`). The page itself must be built.

##### Reusable from Acquisition Flows
- `OwnerSubmissionFlow.tsx` — adapt copy and route
- `ClaimForm.tsx` — works as-is; needs standalone entry page
- `submitClaimAction` server action — reuse directly
- `saveOperatorSubmissionAction` server action — reuse directly
- Google Places lookup action — reuse directly
- All email flows via Resend — reuse directly

---

## 3. Reuse Matrix

| Category | Existing | Adapt | Build New |
|----------|----------|-------|-----------|
| **Homepage Rails** | Discover Engine + Rail data (all 6 rails) | Layout shell (phone → desktop), `WelcomeGate` removal | — |
| **Rail Components** | `RailSection`, `VenueRailCard`, `EventRailCard` | Sizing for wider viewports | — |
| **Discover Engine** | All functions in `discoverEngine.ts` + `featuredEventsEngine.ts` | — | — |
| **Override System** | `discoverOverrides.ts`, `discoverEventOverrides.ts` | — | — |
| **Venue Pages** | All detail components, data queries, analytics tracking | `generateMetadata` (add OG/schema), layout shell, `BackButton` href | JSON-LD LocalBusiness schema |
| **Event Pages** | All detail components, data queries, analytics tracking | Add `generateMetadata` from scratch, layout shell, `BackButton` href | JSON-LD Event schema |
| **Market Selector** | `MarketChip`, `MarketModal`, `activeMarket.ts`, `markets.ts` | URL-based market routing | Market landing pages |
| **Search** | `VenueDiscovery`, `VenueList`, `VenueMapView`, tag catalog | URL-based filter state | Pagination, DB full-text search |
| **Analytics Events** | All 6 tracking API routes + Vercel Analytics | — | Outbound click events, UTM attribution |
| **Auth (Operator)** | Middleware, login page, activation flow | — | — |
| **Auth (Consumer)** | — | — | Consumer accounts (future, not Phase 1) |
| **Business Acquisition** | `OwnerSubmissionFlow`, `ClaimForm`, server actions, email flows | Copy/heading updates, standalone entry pages | Pricing page |
| **Browse / Collections** | `BrowseSection`, `BrowseTile`, `[browse]`, `[collection]` routes | Re-enable (currently hidden) | Market-scoped browse URLs |
| **SEO Infrastructure** | Title template | `generateMetadata` on every page, OG images | `sitemap.ts`, `robots.ts`, JSON-LD, canonicals |
| **Guides / Editorial** | — | — | Full build (no existing content system) |
| **Consumer Layout Shell** | 375px phone frame, `ConsumerNav` | Responsive desktop layout | Desktop nav, footer |
| **Contact Form** | `src/app/(consumer)/contact/` | Copy only | — |
| **Legal Pages** | `app/(legal)/privacy`, `app/(legal)/terms` | Content updates | — |

---

## 4. Recommended Build Sequence

### Phase 1A — Foundation (enable website architecture)
1. Create `app/(website)/layout.tsx` — responsive desktop layout with nav and footer (new shell, not phone frame)
2. Wire market routing: URL segment `[market]` + cookie fallback
3. Market landing pages: `/[market]` → discover home per market

### Phase 1B — Homepage
4. Port `app/(consumer)/page.tsx` logic → `app/(website)/[market]/page.tsx`
5. Adapt `ConsumerHome` for desktop (or build `WebsiteHome` using same `RailSection`/`VenueRailCard`)
6. Add SEO metadata to homepage

### Phase 1C — Discovery and Search
7. Port `/explore` → website explore/search page with URL-based filter state
8. Re-enable browse categories (`BrowseSection`) for website browse pages

### Phase 1D — Venue and Event Pages
9. Port venue detail components → `app/(website)/[market]/venue/[slug]/page.tsx`
10. Add full `generateMetadata` (description, OG, twitter:card)
11. Add `LocalBusiness` JSON-LD
12. Port event detail → `app/(website)/[market]/event/[id]/page.tsx`
13. Add `generateMetadata` and `Event` JSON-LD

### Phase 1E — SEO Infrastructure
14. `app/sitemap.ts` — dynamic, covers all published venues + events
15. `app/robots.ts` — allow consumer, disallow admin/cp
16. OG image generation (static or dynamic via `ImageResponse`)

### Phase 1F — Business Acquisition
17. `/for-businesses/add-your-business` — adapt `OwnerSubmissionFlow`
18. `/for-businesses/claim-your-business` — standalone entry + venue claim
19. `/for-businesses/pricing` — net-new pricing page

### Phase 2 — Enhancement
- Consumer accounts + saved venues
- URL-based filter state
- DB full-text search
- Editorial guides system
- UTM attribution
- Advanced structured data (breadcrumbs, FAQ)

---

## 5. Key Risks

### R1 — Layout Shell (High Impact)
The current consumer layout is a 375px phone frame (intentional). A public website requires a responsive desktop layout. All consumer components use inline styles with mobile-first sizing. Adapting to desktop will touch the visual presentation of every consumer component — not logic, but non-trivial visual work.

### R2 — SEO Gap (High Impact)
Zero Open Graph, zero structured data, no sitemap, no robots. For a public website targeting organic search, this is a launch blocker. The gaps are well-defined and addressable but require systematic work across every page type.

### R3 — Client-Side Search Scalability (Medium Impact)
`VenueDiscovery` loads all published venues into the browser, then filters client-side. This is fine for beta inventory (dozens to low hundreds of venues per market). At several hundred venues per market across multiple markets, the initial payload will become a user experience concern. Plan a DB-level search solution before inventory grows substantially.

### R4 — Market URL Routing (Medium Impact)
Cookie-based market selection works for the current app but conflicts with website SEO needs. Venue pages need market-scoped canonical URLs (`/vancouver/venue/the-keg`) to avoid duplicate-content indexing across markets. Designing this routing model early prevents painful redirects later.

### R5 — Event SEO (Medium Impact)
Event pages have no metadata at all. They are the most time-sensitive content type (events expire) and have the highest potential for search traffic ("happy hour trivia wednesday kelowna"). These need metadata before launch.

### R6 — No Consumer Auth for Saved/Bookmarks (Low Impact for Phase 1)
Bookmarks currently appear to be client-side or session-scoped. This is acceptable for Phase 1, but consumers expect saved venues to persist across devices. Plan a logged-in consumer model before bookmarks become a marketing talking point.

### R7 — `BackButton` Assumes Navigation History
Both `BackButton` (`venue/[id]`) and `EventBackButton` use `router.back()`. On the website, users arriving directly from Google will have no history — `router.back()` will send them away from the site. Replace with explicit `href` pointing to the market discovery page.

---

## 6. Estimated Reuse Percentage

| Bucket | Percentage | Examples |
|--------|-----------|---------|
| Reusable as-is | **35%** | Discover Engine, all tracking API routes, market infrastructure, data helpers, search tags catalog, email/Resend services, Supabase clients, analytics wrapper, `VenueInfoRows`, `BusinessHoursRow`, `HappyHourTimesCard`, `GoogleRatingBadge`, acquisition server actions |
| Reusable with modification | **40%** | `VenueRailCard`, `EventRailCard`, `RailSection`, venue detail components (add metadata/schema), event detail components (add metadata/schema), `VenueDiscovery` (add URL state), `MarketChip`/`MarketModal` (add URL routing), consumer layout (replace phone frame), `BackButton` (add explicit href), browse infrastructure (re-enable) |
| Net-new development | **25%** | Desktop layout shell + nav + footer, `sitemap.ts`, `robots.ts`, JSON-LD schemas, OG image generation, market landing pages, pricing page, editorial/guides system, consumer accounts, URL-based filter state, DB full-text search |

---

## 7. Recommended Phase 1 Scope

The following scope delivers a public website with strong SEO fundamentals while maximizing reuse of existing infrastructure:

### In Scope
- Market routing + market landing pages (Central Okanagan, Greater Vancouver)
- Responsive desktop homepage with all 6 rails
- Venue detail pages with full SEO metadata + `LocalBusiness` JSON-LD
- Event detail pages with full SEO metadata + `Event` JSON-LD
- Explore/search page (adapt `VenueDiscovery`, add URL-based filter state)
- `sitemap.ts` covering all published venues and events
- `robots.ts`
- `/for-businesses/add-your-business` (adapt `OwnerSubmissionFlow`)
- `/for-businesses/claim-your-business` (standalone entry + claim flow)
- `/for-businesses/pricing` (new page)
- Desktop nav + footer (new)

### Deferred to Phase 2
- Consumer accounts + authenticated bookmarks
- DB full-text search
- Editorial guides / blog
- OG image dynamic generation (static placeholder acceptable for Phase 1)
- Browse categories (infrastructure exists; content/UX validation needed first)
- UTM attribution tracking
- Victoria and Calgary market pages (coming-soon state in markets.ts)

### Key Decision Required Before Build Starts
**URL structure for venue/event pages:** choose between:
- `/[market]/venue/[slug]` (e.g. `/vancouver/venue/the-keg`) — strongest SEO, cleanest market scope
- `/venue/[slug]` (no market in URL) — simpler routing, shared canonical, market implicit from venue data

The market-scoped approach is recommended for long-term SEO but requires the routing architecture decision to be made before Phase 1A begins.
