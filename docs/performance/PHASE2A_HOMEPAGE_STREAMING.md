# Phase 2A — Homepage hero streaming (local validation, 2026-10-27)

**Change:** the homepage now waits only for the Homepage record (market → city → homepage → section list) before sending the header and hero. Section content resolves inside a Suspense boundary and streams in behind a quiet placeholder (`(website)/homepage/HomepageSectionsPlaceholder.tsx`). Metadata reads the record only and no longer resolves Sections.

**Status:** validated on local production builds only. Not yet deployed. Staging and Production comparisons are still to be done.

Data: [`phase2a-local-2026-10-27/`](phase2a-local-2026-10-27/). Method: [`README.md`](README.md).

## Conditions

- **Builds:**
  - before = `5592a2e` (the code staging and Production run);
  - after = `5592a2e` plus the Phase 2A change.
  - Both are `next build` + `next start` on the same machine, with `NEXT_PUBLIC_SENTRY_DSN=` empty, against the shared Supabase project (reads only).
- **Ordering:** before and after were measured alternately, run by run.
- **Network:** the local server is much closer to the database than Vercel's iad1, so these absolute times are only comparable with each other.
- **Tracking:** all tracking was blocked, and every audit reported no unblocked tracking requests.

## Hero arrival (`scripts/perf/heroTiming.cjs`, 10 alternating runs, ms from request)

| | Hero in HTML (median) | Full document (median) | Hero, per run |
|---|---|---|---|
| Before | 1316 | 1323 | 1590 1240 1297 1209 1335 1355 1414 1291 1318 1313 |
| After | **494** | 1328 | 466 483 472 571 518 611 520 505 472 474 |

- **Total server time is unchanged:** the full document takes the same time.
- **Bots:** Facebook and Googlebot user agents (3 runs each) get the same early hero: before 1466 / 1368 ms, after 449 / 461 ms.
- **Current staging for reference:** `dpl_3setZQaeikwRZvNhDM8whj5AoAsV`, iad1, 10 runs. The hero and the full document arrive together, median 2743 / 2764 ms.

## Lighthouse, homepage (mobile, DevTools throttling 150 ms / 1.6 Mbps / 4x CPU, 3 alternating rounds)

| | FCP = LCP per run | Median | CLS | Score (median) | HTML complete (median) |
|---|---|---|---|---|---|
| Before, cold | 2689 2912 2820 | 2820 ms | 0 | 90 | 2044 ms |
| After, cold | 1649 1585 1843 | **1649 ms** | 0 | 98 | 2457 ms |
| Before, warm | 1928 1723 1703 (LCP) | 1723 ms | 0 | 98 | 1837 ms |
| After, warm | 940 766 827 | **827 ms** | 0 | 98 | 2082 ms |

- **LCP element:** the hero headline in every run.
- **TBT (median):**
  - Cold: 122 → 147 ms.
  - Warm: 70 → 161 ms.
- **Why HTML complete rises under throttling:** once the shell arrives early, the browser fetches 12 CSS/JS/font files (276 KB) while the document is still streaming, instead of 5 (198 KB), and they share the 1.6 Mbps link. Unthrottled, the full document time is unchanged (table above).

## Placeholder

Light grey (`bg-gray-100`) and static, with no shimmer:
- A heading bar, then a row of 300 px cards with 200 px images and two text lines. It uses the same section padding as the first rail, so the real rail replaces it in place.
- The container is `min-h-[1200px]`, so the footer can't show through and then jump.
- Accessibility: `aria-busy` on the container, a screen-reader "Loading happy hours and events" label, and the shapes are `aria-hidden`.

Screenshots: [placeholder-mobile.png](phase2a-local-2026-10-27/screens/placeholder-mobile.png), [placeholder-desktop.png](phase2a-local-2026-10-27/screens/placeholder-desktop.png), and the finished page [final-mobile.png](phase2a-local-2026-10-27/screens/final-mobile.png).

- **Layout shift:** CLS 0 on mobile (390×844) and desktop (1440×900), measured with a layout-shift observer across the whole load and scroll.
- **Refresh:** the placeholder doesn't reappear when the page refreshes after a market change.

## Functional checks (before vs after, mobile and desktop)

- **Identical after loading:**
  - every section heading, every link in order, each section's discovery placement and subtitle (including Today's Specials);
  - both Weekly Picks placements (`homepage_main`, `homepage_bottom`);
  - title, description, canonical, robots, and Open Graph/Twitter tags.
- **Discovery tracking:** identical (payloads captured, then blocked). Same homepage id, 8 section exposures, identical impression sets (14 mobile, 29 desktop) and an identical click payload.
- **Market switching:**
  - "Use my location" switches the market and refreshes the page, the same in both versions.
  - Coming-soon regions show their message.
  - Only Central Okanagan is active, so other market cookies fall back to it, as before.
- **Database requests per render:** 49 → 48. A `venue_view_counts` call was made twice before, once for metadata and once for the page.

## Grants and paused content

- **New test** (`tests/unit/homepage/homepageStreamingGrants.test.ts`): drives the streamed section path against stubbed database responses, so it makes no database calls. It shows:
  - an expired-trial recipient's recurring event is not shown, while its one-off event is;
  - an active comp's recurring event and a no-grant venue's event are shown, in saved order;
  - a failed read, or a row missing the grant data, drops only that section.
- **Mutation check:** with the grant removed from the fixture, the test fails, so it isn't passing trivially.
- **Existing grant tests:** 51/51 pass.
- **Live data** (read-only queries):
  - The two grants are open-ended Premium comps: Erica Jane (from 2026-10-15) and O'Bryan's Kelowna (from 2026-10-22).
  - O'Bryan's has 2 recurring events and 8 weekly Daily Specials, which Free would pause and Premium allows. Erica Jane has 3 weekly specials.
  - Both venues appear on the homepage, identically before and after.
  - No live venue currently has paused content, so paused content was checked by test only.

## Failure behaviour, first version (simulated, local build) — superseded by v2 below

A switch controlled by an environment variable was temporarily added to the compiled local build, then removed. It made one middle section ("Featured Kelowna Events") throw. For comparison, a second switch made the homepage record lookup throw instead, before anything is sent, which is how every section failure behaved before this change.

| | HTTP | What the HTML contains | What a visitor sees |
|---|---|---|---|
| Section throws, after streaming starts (new) | **200** | header, hero, placeholder and an error marker; **no section content**; no `noindex` | the global "Something went wrong" page replaces the whole page once the script runs |
| Throw before streaming (= the old behaviour for any section throw) | 500 | the error page with `<meta name="robots" content="noindex">` | the same "Something went wrong" page |

[Screenshot of the error page](phase2a-local-2026-10-27/screens/v1-section-failure-global-error.png).

- **One failure blanks every section.** Sections resolve together (`Promise.all`), so one throwing section blanks them all. The old page behaved the same way, except it returned a 500.
- **How likely a throw is:** section readers don't throw on database errors. They log the error and return empty, which drops only that section (covered by the test above). A throw needs an unexpected exception, such as a code bug or malformed data.

## Crawlers and previews, first version — superseded by v2 below

- **Previews** (Facebook and similar):
  - The full `<head>` arrives first (4 KB) for every user agent tested.
  - It holds the title, description, canonical, and Open Graph/Twitter title, description and image (1200×630), identical to before.
  - Not verified: Facebook's Sharing Debugger, which needs a public, indexable URL.
- **Googlebot, verified:**
  - All 10 section headings are in the HTML for a Googlebot user agent, inside hidden blocks that React's script moves into place.
  - With JavaScript on, local headless Chromium (Googlebot user agent) shows all sections in the right order and no placeholder.
  - With JavaScript off, the visible page is the header, hero and placeholder only ([screenshot](phase2a-local-2026-10-27/screens/v1-nojs-placeholder.png)). Before, all content was visible without JavaScript.
- **Googlebot, not verified:**
  - How Google actually renders or indexes the page. Google renders with JavaScript, but that was not tested here.
  - Crawlers that don't run JavaScript would see the section text only inside hidden blocks.
  - Staging is `noindex` and disallowed in robots.txt, so Search Console's live test can't check rendering before Production.

## v2: failure isolation and crawler access

v2 changes on top of the first version:
1. **Each Section resolves in isolation.** `resolvePublicHomepageSections()` catches a Section that throws, reports it (`reportOperationalError`, flow `public-homepage`, stage `section-resolve`) and leaves it out.
2. **A last-resort boundary covers the Sections.** `HomepageSectionsErrorBoundary`, a client component, catches a failure shared by all Sections, such as an exception while rendering them. It renders nothing in their place and reports the failure to Sentry, instead of the global error page replacing the visible header and hero.
3. **Recognised crawlers get the page complete and in order.** For crawlers and link-preview bots (Next's `userAgent().isBot`: Googlebot, including Google-InspectionTool, Bingbot, facebookexternalhit, Twitterbot, LinkedInBot, Slackbot, WhatsApp, …), the page renders the same Sections in place instead of streaming them. Everyone else gets the streamed page. Only the delivery differs; the content and markup are identical.
4. **JavaScript-off visitors get links instead of an empty placeholder.** Without JavaScript, the streamed Sections never move into place. A `<noscript>` part of the placeholder hides the empty shapes and their reserved height, and links to Happy Hours, Daily Specials and Events. All three listing pages render their full content without JavaScript (66, 124 and 30 venue links in their HTML on Production).

Data: [`phase2a-local-2026-10-27/v2/`](phase2a-local-2026-10-27/v2/). Single low-priority local build, one server at a time. The before build was no longer available, so v2 is compared with the earlier local measurements of the same machine.

### Timing and layout (v2, local)

| | Hero in HTML (median) | Full document | Cold FCP = LCP (3 runs) | Warm FCP = LCP | CLS |
|---|---|---|---|---|---|
| Before (`5592a2e`, earlier) | 1316 ms | 1323 ms | 2820 ms | 1723 ms | 0 |
| First version (earlier) | 494 ms | 1328 ms | 1649 ms | 827 ms | 0 |
| **v2, visitors** | **453 ms** | 1207 ms | **1663 ms** (1681 1656 1663) | 886 ms | **0** |
| v2, Googlebot / Facebook user agents | 1256 / 1280 ms (whole page at once, as before) | 1263 / 1285 ms | — | — | — |

- **Hero, per run (v2, visitors):** 630 553 479 435 467 465 440 436 412 425.
- **Cold TBT median:** 226 ms (runs 162, 326, 226). This is noisier than before (122) and the first version (147).
- **Tracking:** every audit reported none unblocked.

### What each kind of request receives (v2, normal operation)

| Request | HTTP | Section content |
|---|---|---|
| Visitor, JavaScript on | 200 | Hero streams first; all 10 headings in order once loaded; CLS 0 |
| Visitor, JavaScript off | 200 | Header, hero, "Browse happy hours, daily specials and events." with links, then the footer — no empty shapes, no gap ([screenshot](phase2a-local-2026-10-27/v2/screens/nojs-links.png)) |
| Googlebot / facebookexternalhit user agents | 200 | Complete HTML: all 10 headings in document order before the footer, no hidden blocks, no placeholder |

- **Same links and images as visitors:** the crawler HTML (Googlebot user agent, JavaScript off) has the same 72 links and 57 images, in the same order, as a visitor's fully loaded page.
- **Text:** with JavaScript on, the Googlebot user agent's visible text is identical to a visitor's, all 497 lines.
  - With JavaScript off, the crawler HTML lacks only 94 lines the browser fills in itself (happy-hour status such as "Happy Hour Today 2 PM – 5 PM", and event times). That was already the case before streaming.

### Failure behaviour (v2, simulated)

Same method as before: a temporary switch, controlled by an environment variable, in the compiled local build, restored afterwards.

| Failure | Visitor (JavaScript on) | Visitor (JavaScript off) | Crawler (Googlebot / Facebook user agents) |
|---|---|---|---|
| One Section throws ("Featured Kelowna Events") | 200; hero and the other 9 headings; CLS 0 ([screenshot](phase2a-local-2026-10-27/v2/screens/one-section-fails.png)) | 200; hero and links | 200; complete HTML with the other 9 headings in place |
| Shared failure while rendering all Sections | 200; header, hero and footer, no Sections ([screenshot](phase2a-local-2026-10-27/v2/screens/shared-render-fails.png)); **CLS 0.25** as the reserved space collapses | 200; hero and links | **500 with `noindex`** (no streaming, so the error reaches the response — as before) |
| Homepage record lookup throws (before anything is sent) | 500, global error page | 500 | 500 with `noindex` — unchanged from before |

- **Database failures don't throw.** A failed read, or every read failing at once, resolves to no Sections rather than a throw, and the page keeps its hero (unit tests). A failed record lookup resolves to "no homepage" (200, hero and the bottom signup only), the same as before.

### Previews and search engines: what is established, what isn't

- **Established locally:**
  - Recognised crawler user agents receive the complete page in document order, with the full `<head>` (title, description, canonical, Open Graph/Twitter tags) and no hidden blocks.
  - The content matches what visitors see.
- **Not established:**
  - How Google, Bing or Facebook actually render, index or preview the page. The checks only imitate their user agents.
  - Facebook's Sharing Debugger and Search Console's live test need a public, indexable URL. Staging is `noindex` and disallowed in robots.txt.
  - Real crawler traffic hasn't been checked against the user-agent list; the list is Next's own.
- **Gaps:**
  - Crawlers outside that list, such as SentryUptimeBot, GPTBot and ClaudeBot, get the streamed page. Its Section text is present only inside hidden blocks.
  - The page now varies by user agent. It's dynamic and uncached, so there's no cache-mixing risk.

### Tests

- `tests/unit/homepage/homepageStreaming.test.ts` (source structure): hero outside the boundary, metadata reads the record only, crawler path, error boundary, `<noscript>` rule.
- `tests/unit/homepage/homepageStreamingGrants.test.ts` (stubbed database):
  - grant eligibility;
  - a throwing Section is isolated and reported;
  - every read failing;
  - a record lookup failing;
  - the error boundary.
- **Mutation checks:** removing the grant from the test data, or removing the catch, makes the relevant test fail.
