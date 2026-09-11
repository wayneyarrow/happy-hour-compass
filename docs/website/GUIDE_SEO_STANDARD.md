# Guide SEO Standard

**Location note:** the audit task that produced this document suggested `docs/GUIDE_SEO_STANDARD.md` as a default location. It lives at `docs/website/` instead because every other SEO and Content Engine document already lives here (`SEO_ROADMAP.md`, `SEO_LAUNCH_CHECKLIST.md`, `CONTENT_ENGINE_PRODUCT_SPEC.md`) — keeping guide SEO guidance in the same place avoids fragmenting the existing documentation structure.

This is the permanent standard for creating, editing, and auditing Happy Hour Compass consumer guides (Content Engine guides — venue guides and event guides). Happy Hour Compass publishes new guides regularly (~1/week); this document is the checklist and the reasoning that should apply every time, not a one-off audit report.

It complements, and does not replace, `CONTENT_ENGINE_PRODUCT_SPEC.md` (the Content Engine's architecture and product intent) and `SEO_ROADMAP.md` (sitewide technical SEO status). Read this document specifically before creating, editing, reviewing, or auditing a guide's SEO/content fields.

---

## How guide SEO fields actually work (verified against the code)

This is the ground truth of what each field does, current as of the 2026-09 guide audit. Don't assume a field name describes its technical behavior — verify against `src/lib/data/contentGuides.ts`, `src/lib/seo/contentGuideSeo.ts`, and `app/(website)/[market]/guides/[slug]/page.tsx` if anything below looks like it may have changed.

| Field | What it actually does |
|---|---|
| **Page Title** | Becomes the literal `<title>` tag, verbatim, bypassing the root layout's `"%s — Happy Hour Compass"` template (`title: { absolute: pageTitle }` in `generateMetadata()`). This is the one field that controls what shows in the browser tab and (normally) the Google search result title. Include the full "— Happy Hour Compass" branding here yourself — the generator already does, and a manual value should too. |
| **Meta Title** | **Does not render anywhere on the page.** It is only used as the fallback source for OG Title when OG Title is blank (`ogTitle = guide.og_title \|\| metaTitle`). Every currently-published guide has its own OG Title set, so today Meta Title has zero live effect for any of them. Keep it accurate anyway (in case an OG Title is ever cleared, and because it's what the generator suggests as the keyword-led short title) — but do not confuse it with the actual `<title>` tag, and don't expect changing it to change search-result titles. The Guide editor's Page Title and Meta Title fields both carry inline helper text stating this distinction directly (added as a follow-up to the guide audit — `GuideForm.tsx`), so this is no longer only documented here. |
| **Meta Description** | Becomes `<meta name="description">` directly, and is also the fallback source for OG Description when that's blank. |
| **OG Title** | `og:title` / `twitter:title` directly. Defaults to Meta Title if left blank. |
| **OG Description** | `og:description` / `twitter:description` directly. Defaults to Meta Description if left blank. |
| **Canonical URL** | Used verbatim for `<link rel="canonical">`, `og:url`, and the Article JSON-LD's `url`/`@id` **only if it starts with `/`**; otherwise the page silently falls back to the generated `/{market-slug}/guides/{guide-slug}` path. Structure is locked — see "Don't touch" below. |
| **Hero Image alt text** | There is no separate hero image alt text field. The rendered `<img>` alt and the OG image alt both use the guide's **Title** verbatim. Write titles with this in mind — a good title is also a good alt text. |
| **FAQ "Related Content"** | The Content Engine's only per-guide curated cross-link is on each FAQ answer (`content_guide_faqs.related_guide_id` → "Read next: {title}"). It only renders when the linked guide is actually published and in its publish window. The "More Guides" section elsewhere on the page is automatic (same-market published guides), not curated — there is no other admin-controlled Related Content field yet. |

**Structured data:** every published guide emits `Article` JSON-LD (headline/url/publisher/description/image/dateModified; `datePublished` only if `publish_at` is set — most guides don't set it, which is expected, not a bug), a `BreadcrumbList`, and `FAQPage` JSON-LD for its FAQ section. Sitewide `Organization` + `WebSite` render once from the layout. No `Event` schema on event guides (deferred sitewide — see `SEO_ROADMAP.md`). No `author` (the data model has no byline field, and none is invented).

**Indexability / sitemap:** published, in-window guides (`isGuidePublicNow()`) are included in `sitemap.xml` and get a normal `<meta name="robots">` tag, unless `NEXT_PUBLIC_NOINDEX=true` (staging only — this is correct, expected behavior on staging, not a defect).

**Auto-generation is a starting point, not the final answer.** `generateGuideSeo()` (`src/lib/seo/contentGuideSeo.ts`) suggests Page Title / Meta Title / Meta Description / OG Title / OG Description / Canonical URL from the guide's title, keywords, content, and location as the editor types, and GuideForm applies each suggestion only until an editor manually edits that specific field ("Editing a field takes manual control of it — it stops updating until you regenerate"). This is by design, but it means a generated value can silently go stale if the editor changes an upstream input (title, primary keyword, location) after having already hand-edited a downstream field — always re-check the generated fields, or hit "Regenerate from guide inputs," after changing title/keyword/location on an existing guide.

As a follow-up to the guide audit, the SEO section of the Guide editor now shows a non-blocking amber warning naming exactly which SEO fields have gone stale, whenever an upstream input (title, primary keyword, secondary keywords, intro, editorial section 1 body, market/city/neighbourhood) changes after a given SEO field was manually set. Manual values are never read for this beyond comparing them to the live generator's suggestion, never auto-corrected, and never silently regenerated — the editor still has to review them or click "Regenerate from guide inputs" themselves. **Limitation:** this only catches drift that happens within the current edit session (the comparison baseline is captured when the form loads, not persisted). It cannot flag a guide whose SEO already drifted from its inputs before this session was opened — that would need a persisted signature of "the inputs a saved SEO value was last generated from," a schema change, not a UI one, and was intentionally left out of this follow-up as out of scope. Manual review against the checklist below remains the backstop for guides edited before this warning existed.

---

## Core Guide SEO Principles

- Guides are created for consumers first. SEO is considered from the beginning of guide creation, not bolted on after.
- Identify search intent before choosing keywords: what would a real person actually type into Google, and what planning problem are they trying to solve?
- Each guide targets **one** clear primary search concept. Secondary keywords are closely related natural search variations of that same concept — not a list of near-duplicate word-order permutations, and not unrelated topics stapled on for reach.
- Titles and H1s are natural and descriptive first, locally specific where that's genuinely useful. Never force awkward exact-match keyword grammar (`Late Night Happy Hour Kelowna`) when the natural phrasing (`Late-Night Happy Hours in Kelowna`) carries the same intent.
- Page Title, Meta Title, and OG fields follow their *verified* technical purpose (see the table above) — not what their names suggest.
- Meta descriptions are unique per guide, written to earn the click, and reflect the guide's actual content. Don't just truncate the intro — a truncated sentence that trails off mid-thought is worse than a purpose-written summary, and the auto-generated meta/OG description defaults to the intro text verbatim, so it needs a human look before publishing.
- Introductions establish usefulness and local relevance immediately. HHC's voice is local, helpful, conversational, and knowledgeable — never generic AI copy, content-farm keyword stuffing, or tourism-board boilerplate.
- Editorial content provides genuine value beyond a directory listing: concrete local context and situations (after a Rockets game, patio weather, date night, a downtown crawl) rather than manufactured claims.
- Featured venues/events must genuinely support the guide's promise — a Late-Night guide should feature venues that are actually good late at night, a Sports Bar guide should feature venues actually suited to watching a game.
- FAQs answer real consumer questions relevant to the guide. Never add an FAQ purely to insert a keyword.
- Related content / internal links (FAQ "Read next" cross-links) should create an obvious, logical next step for the reader — not an arbitrary cross-link for its own sake.
- Hero images support the topic without misleading the reader about what venue/location they'll find. Alt text is the guide Title (see table above) — so a strong, descriptive title also does the alt-text job.
- Published slugs stay stable. Canonical URL structure (`/{market-slug}/guides/{guide-slug}`) is not changed casually — see `SEO & Metadata` in the root `CLAUDE.md`.
- Auto-generated SEO fields are a starting point. Read them before publishing — don't assume "the generator filled it in" means it's optimal, and re-check them after changing title/keyword/location on an existing guide (see staleness note above).
- New guides get an SEO review before publication (see the checklist below).
- Guide SEO/content fields live in the `content_guides` record (and related tables — `content_guide_faqs`, `content_guide_venues`/`content_guide_events`) and stay editable through the Founder Control Panel. Never hard-code guide-specific metadata in application code, page components, or generator defaults as a substitute for editing the actual guide record.
- After creating or editing a guide, validate both the Founder Control Panel fields **and** the rendered public page (or preview) — they should always agree, since the CP is reading and writing the same row the public page renders.

---

## New Guide SEO Checklist

Work through this for every new guide before publishing, and whenever meaningfully editing an existing one.

1. **Search intent** — What would a real person type into Google? What planning problem does this guide solve? Confirm it's genuinely one clear intent, not two guides' worth.
2. **Primary keyword** — One natural phrase matching that intent. Check it isn't already the primary keyword of another published guide (keyword cannibalization) — grep the guide library or check the Content Engine list.
3. **Secondary keywords** — A handful (3–6) of genuinely distinct related search variants. No word-order permutations of the primary keyword, no unrelated topics.
4. **Guide Title / H1** — Natural, descriptive, locally specific where useful, unique across the library, no keyword stuffing.
5. **Slug** — Stable once published. Reasonable and readable at creation time, since it should not change later.
6. **Page Title** — The full literal `<title>` tag. Brand-suffixed, descriptive, not redundant (e.g. don't repeat the city name twice).
7. **Meta Title** — Keyword-led short version. Remember: it does not render unless OG Title is blank — keep it correct anyway.
8. **Meta Description** — Unique, written to earn the click, reflects the actual guide content. Don't leave a truncated intro sentence in place — read it as a searcher would see it.
9. **OG Title** — Usually the guide title as-is; check it reads well as a social card headline.
10. **OG Description** — More room than Meta Description (~200 chars) — check it isn't cut off mid-thought either.
11. **Introduction / Standfirst** — Establishes relevance and local context immediately, in HHC's voice.
12. **Editorial sections** — Genuine consumer value: when/why/how to use the guide, concrete local situations, no manufactured claims.
13. **Featured venues/events** — Actually support the guide's promise. Spot-check a few against the guide's stated theme.
14. **FAQs** — Real, relevant questions; no keyword-stuffing filler; consider one obvious "Read next" cross-link to a genuinely related published guide if one exists.
15. **Related content / internal links** — Same as above — obvious, low-risk, logically relevant only.
16. **Hero image** — Matches the topic, doesn't misrepresent a specific venue/location as generic.
17. **Hero image alt text** — There's no separate field; the guide Title is used. Make sure the Title itself reads well as alt text.
18. **Canonical** — Confirm it resolves to `/{market-slug}/guides/{guide-slug}` (generated) or, if manually overridden, that it's a real path starting with `/` that the route can actually resolve.
19. **Indexability** — Confirm `status = published` and (if set) the guide is inside its publish/expire window; confirm this isn't accidentally staging-only (`NEXT_PUBLIC_NOINDEX`).
20. **Metadata rendering** — Load the live/preview page and check `<title>`, meta description, OG tags, and canonical actually show what you expect (view source or "Copy Page" — don't trust the CP form alone).
21. **Founder Control Panel field verification** — Reopen the guide in the CP after saving; confirm every field you touched shows the value you expect there.
22. **Final rendered-page QA** — One more look at the live/preview page: correct H1, correct metadata, FAQ accordion renders, no unrelated content changed.
