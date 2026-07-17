# SEO Roadmap

**Status:** Implementation complete for launch, with one known gap tracked below.

This document tracks the status of the public website's SEO and metadata implementation: what's done, what's deliberately deferred, what's genuinely still open, and what comes after launch. For the underlying rules and conventions (how to use `buildPageMetadata()`, title templating, canonical strategy, etc.), see the **SEO & Metadata** section of `CLAUDE.md` — this document is status, not a how-to guide. For the actions to take immediately before and after going live, see `docs/website/SEO_LAUNCH_CHECKLIST.md`.

---

## Completed

- **Metadata architecture** — `src/lib/siteUrl.ts` (absolute URL / noindex source of truth) and `src/lib/seo/metadata.ts` (`buildPageMetadata()`, `buildVenueMetadata()`, `buildEventMetadata()`) are in place and used consistently across every public page type.
- **Structured data** — JSON-LD builders exist for Organization, WebSite (sitewide), BreadcrumbList, LocalBusiness (venue), Article (guide), CollectionPage, AboutPage, and FAQPage, all rendered through the shared `<JsonLd>` component. Verified live and correctly typed on real pages.
- **Sitemap** — `src/app/sitemap.ts` aggregates static pages, per-market guide-library indexes, venues, events, collections, and guides from the same data layer the pages themselves use, with `Promise.allSettled` isolating one failing source from breaking the rest. Deliberately excludes admin/auth/account/saved/search-results/legacy-redirect routes.
- **Robots** — `src/app/robots.ts` correctly serves the production allow-list in production and a full `Disallow: /` under `NEXT_PUBLIC_NOINDEX=true` (staging). Verified with a real production build in both modes.
- **Google Analytics** — GA4 is wired into the public website layout (`(website)/layout.tsx`, `@next/third-parties/google`, gated on `NEXT_PUBLIC_GA_MEASUREMENT_ID`), additive to the existing first-party analytics pipeline and scoped to the website only (never sent from Operator Admin or the Control Panel).
- **Search Console** — not yet verifiable from the codebase (no verification meta tag or file present). Analytics infrastructure is in place, but Search Console property setup/verification is an external, operational step — tracked as a **Before Launch** item in `SEO_LAUNCH_CHECKLIST.md` rather than claimed as done here.
- **Metadata consistency audit** — a full audit of every public page type's title, description, canonical, Open Graph, Twitter, robots, and structured data, completed and used to drive all the fixes below.
- **Open Graph / Twitter completeness** — every page using `buildPageMetadata()` now emits full OG + Twitter Card metadata, including the Homepage (previously missing entirely) and every Collection/Event page that has no image of its own (previously pointing at a nonexistent `/og-default.png`; now falls back to the real `/logo.png` asset).
- **Title double-branding cleanup** — the root layout's `"%s — Happy Hour Compass"` template was being double-applied on Event detail, Account, Welcome, Saved, Events search, Happy Hours search, and several 404/invalid-route fallbacks. All confirmed fixed and verified live to render the brand exactly once.
- **Static-page metadata consistency** — About, Business, Careers, Claim Your Venue, the guide index, Privacy, and Terms were all missing canonical tags and Open Graph/Twitter metadata entirely (plain title/description objects, no shared helper). All now go through `buildPageMetadata()`.
- **Private-page noindex handling** — `/account` and `/welcome` now carry the same `robots: { index: false }` pattern already used by `/saved`, `/website-events`, and `/website-happy-hours`.
- **Homepage canonical fix** — the homepage previously asserted a per-market/city canonical (`/{market}/{city}`) that has no corresponding route. It now always resolves to `/`, the one URL the homepage is actually served at. See **Intentional Deferrals** below for why the per-geography canonical isn't wired back in yet.
- **Final SEO completion review** — a second, independent pass re-validating the entire implementation against a real production build (not prior summaries), covering every area above plus environment-aware indexing, route consistency, and duplicate/contradictory metadata. See **Known Gaps** below for what it surfaced that wasn't already tracked.

---

## Intentional Deferrals

These are deliberate product/engineering decisions, not oversights. Do not silently reverse them — each has a stated condition for revisiting.

- **Event structured data (`schema.org/Event`)** — deferred because the current event data model cannot produce a truthful, timezone-aware occurrence datetime, which `Event` schema requires. Revisit once that data gap is closed.
- **AggregateRating / Review structured data on venues** — Google-sourced rating/review-count data is already fetched and displayed (`GoogleRatingBadge`), but not yet marked up. Deferred as a scoped follow-up, not a data-availability blocker.
- **Dedicated Open Graph social card** — the shared default OG image is `/logo.png`, a 1024×1024 square brand logo, not a purpose-built 1200×630 landscape social card. Functionally correct (renders in every previewer), but a dedicated image would look better in link previews. No new image assets were created as part of this phase by design.
- **Market/city homepage routing (`/{market}`, `/{market}/{city}`)** — the Geographic Information Architecture in `WEBSITE_PRODUCT_PLAYBOOK.md` documents this as the target canonical URL shape, and the Homepage CMS's `canonicalUrl` field is already built against it. The routes themselves don't exist yet; this is a future expansion feature, not part of the current SEO implementation. The homepage canonical intentionally stays `/` until these ship.
- **Venue opening-hours structured data (`openingHoursSpecification`)** — `venues.business_hours` is reliable, structured data, but by the time it reaches the public venue page it's already been converted to a display string ("9:00 AM – 5:00 PM"), and the raw 24-hour values are discarded before reaching the schema layer. Re-parsing the display string would mean reimplementing fragile parsing logic; exposing the raw hours would mean changing shared, widely-used data-loading code (`src/lib/data/venues.ts`). Deferred as a deliberate, separate change rather than guessed at.
- **Venue address enrichment (region, postal code, country in structured data)** — the venue page's own data-loading query only selects `address_line1` and `city`; region/postal code/country columns exist on the table but aren't fetched by that query today. The venue LocalBusiness node ships a valid, partial `PostalAddress` with what's available rather than blocking on a data-loading change.

---

## Known Gaps (Tracked for Launch)

Unlike the deferrals above, this is not a deliberate decision — it's a real gap the final SEO completion review surfaced, and it should be resolved (or explicitly accepted) before launch.

- **Market rollout status doesn't gate sitemap inclusion or indexability.** `sitemap.ts` only filters one thing by `MARKETS[].status === "active"` — the per-market guide-library index page. Venue pages, event pages, individual guides, and collections are included purely by publish status in the database, with no awareness of which market is supposed to be live. Verified live: Greater Vancouver currently has ~190 sitemapped URLs (more than Central Okanagan's ~67), and a `coming_soon`-market (Calgary) test venue is already live and sitemapped. If Central Okanagan is meant to be the only publicly discoverable market at launch, this needs a decision and a fix — likely filtering each sitemap section by the owning content's market against `status === "active"`, plus deciding whether non-active-market content should also be `noindex`ed at the page level for anyone who reaches it by direct link. See `SEO_LAUNCH_CHECKLIST.md`'s "Verify only intended markets are public" item.

---

## Future Expansion

Not scoped for the current phase or the launch checklist. Documented here as approved future direction.

- **Localized market landing pages** — once `/{market}` and `/{market}/{city}` routes exist (see Intentional Deferrals), extend them with real SEO landing-page treatment (unique copy, local structured data, city-specific internal linking) rather than just a bare canonical target.
- **Market-specific social cards** — once a dedicated OG image is prioritized, consider per-market variants rather than one sitewide default.
- **Additional structured data enhancements** — Event schema, AggregateRating/Review, and opening-hours schema (see Intentional Deferrals) once their respective data gaps are closed, plus any new entity types introduced by future Content Engine guide types (Neighbourhood Guides, Seasonal Guides, etc., per `CONTENT_ENGINE_PRODUCT_SPEC.md`'s roadmap) should get their own schema builder following the existing pattern in `src/lib/seo/schema/`.

---

## Reference

- `CLAUDE.md`'s **SEO & Metadata** section — the implementation rules and conventions every new public page should follow.
- `docs/website/SEO_LAUNCH_CHECKLIST.md` — actions to take immediately before and after launch.
- `docs/website/WEBSITE_PRODUCT_PLAYBOOK.md` — Geographic Information Architecture (canonical URL structure, market/city/neighbourhood model).
- `docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md` — SEO Automation (Section 11) for how guide metadata is generated and overridden.
- `docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md` — "Anything with a public URL requires SEO" and the Homepage/Collection ownership model.
