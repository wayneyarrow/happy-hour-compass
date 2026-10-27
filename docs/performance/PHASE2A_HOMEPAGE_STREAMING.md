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

## Staging (2026-10-27)

- **Deployments:**
  - new: `dpl_9RooTrwofPz3bSkPBpr6Vp6TucVk`, built from `a182778`, iad1;
  - previous: `dpl_3setZQaeikwRZvNhDM8whj5AoAsV` (`5592a2e`).
- **Method:** both were measured alternately on their `*.vercel.app` deployment URLs (the homepage has no map, so the Maps key restriction doesn't matter), from the Pacific Northwest, with all tracking blocked. No tracking request got through in any run.
- **Data:** [`phase2a-staging-2026-10-27/`](phase2a-staging-2026-10-27/).

### Hero arrival (10 alternating runs, ms)

| | Hero, per run | Median | Full document, median |
|---|---|---|---|
| Previous | 2922 2960 2679 2926 3060 4016 2984 2803 3383 3571 | 2972 | 3028 |
| New | 1347 1231 1426 1447 1219 1213 1175 1192 1265 1582 | **1248** | 2924 |

### Lighthouse (3 alternating rounds, mobile, DevTools throttling)

| | FCP = LCP per run | Median | CLS | TBT (median) | Score |
|---|---|---|---|---|---|
| Previous, cold | 7411 5097 3669 | 5097 ms | 0 | 181 ms | 66 |
| New, cold | 2833 2730 2642 | **2730 ms** | 0 | 264 ms | 87 |
| Previous, warm | 2904 3169 3161 (LCP) | 3161 ms | 0 | 119 ms | 86 |
| New, warm | 1157 1295 1297 | **1295 ms** | 0 | 138 ms | 98 |

- **Outlier:** the previous deployment's first cold run (7.4 s) looks like a cold start.
- **Vercel function figures** (`/`, 35–40 renders per deployment, mostly test traffic, too few to rely on): duration p50 2696 → 2507 ms; CPU p50 800 → 520 ms; time to first byte p50 2599 → 908 ms.

### Checks against the previous deployment

- **Same finished homepage:** sections, links, placements, Weekly Picks, metadata, JSON-LD and discovery payloads are all identical, with CLS 0.
- **Market switching:** the same.
- **Comped venues:** they appear identically, including content only a plan above Free allows.
- **JavaScript off:** the browse links, no skeleton, the placeholder collapsed to 137 px.
- **Bot user agents:** Googlebot and Facebook user agents get complete HTML.
- **Caching:** all responses are `private, no-cache, no-store` with `x-vercel-cache: MISS`, so visitor and bot responses can't be mixed by the CDN.

### When page scripts fail (JavaScript enabled)

The scripts that move streamed Sections into place are small inline scripts (`$RS`/`$RC`) inside the HTML response, not separate files. Each case below altered only the test browser's own copy of the staging response:

| Case | What the visitor sees |
|---|---|
| External JavaScript files fail to load | All Sections in place (the inline scripts still run), but the page isn't interactive |
| Inline placement scripts blocked | All Sections; the page's JavaScript rebuilds them |
| Response cut off before the Sections arrive | Hero, then the footer: no Sections, no links ([screenshot](phase2a-staging-2026-10-27/screens/stream-cut-before-sections.png)) |
| JavaScript enabled but no script runs | **The placeholder stays indefinitely** (still showing at 15 s), with no links: `<noscript>` only applies when JavaScript is turned off ([screenshot](phase2a-staging-2026-10-27/screens/scripts-enabled-none-run.png)) |

Before streaming, the last case still showed every Section, because they were plain HTML.

## Loading fallback (local build, 2026-10-27)

**Change:**
1. **Delayed reveal.** The placeholder already contains the browse links (Happy Hours, Daily Specials, Events), hidden. Pure CSS reveals them after **10 s** if the Sections still haven't arrived, hiding the empty shapes and collapsing the reserved height at the same moment. It needs no script, so it also covers JavaScript being enabled while no script runs, and a stalled stream.
   - It's a zero-duration step rather than an animation of motion. The site has no reduced-motion override that could cancel it.
2. **Without JavaScript,** a `<noscript>` style shows the same links immediately.
3. **Error boundary.** On a shared failure the boundary now shows the same links instead of nothing.

**Build note:** the production minifier mis-folded the CSS when it was written with template literals: it dropped `s forwards}` from two rules, which broke the reveal. The CSS is now plain string concatenation, and the served CSS was checked in the built page.

Data: [`phase2a-fallback-2026-10-27/`](phase2a-fallback-2026-10-27/). Single low-priority local build, one server at a time, tracking blocked.

| Case | Result |
|---|---|
| Normal load | Placeholder replaced by the Sections; the links are never visible (checked partway through loading); CLS 0; finished page, Weekly Picks, JSON-LD and discovery payloads identical to staging `a182778` |
| JavaScript disabled | Links immediately; no shapes; footer directly below (771 px on mobile) ([screenshot](phase2a-fallback-2026-10-27/screens/javascript-off.png)) |
| JavaScript enabled, no script runs | Shapes until 10 s after the placeholder renders, then the links with the footer directly below ([screenshot](phase2a-fallback-2026-10-27/screens/scripts-enabled-none-run-after-10s.png)) |
| Same, with reduced motion | Identical |
| Response cut off just before the Sections (a local proxy that drops the connection) | Links in every run. Chrome handled the cut two ways: either the page's JavaScript failed on the missing data and the error boundary showed the links almost at once, or the page stayed "loading" and the CSS fallback showed them at 10 s |
| Simulated shared rendering failure (temporary patch, restored) | Visitors: links within 3 s, CLS 0.086 (was 0.25 with an empty boundary) ([screenshot](phase2a-fallback-2026-10-27/screens/shared-render-failure.png)). Crawlers: 500, unchanged |
| Keyboard | The links are reached by Tab (11 presses from the top on mobile), show the browser's focus outline and open on Enter, in every fallback case |

- **Hero timing** (10 runs, local): median 474 ms (runs 532 503 453 444 464 463 476 509 584 471), against 453 ms before this change.
- **Bot user agents:** Googlebot and Facebook still get complete HTML with all 10 headings in place. Their `<head>` differs from a visitor's only in Sentry's random trace IDs.

## Loading fallback on staging (2026-10-27)

- **Deployments:**
  - new: `dpl_HFPo4knVS9hxUHEiB6cJ1LGxKUeR`, built from `e11158d`, iad1;
  - previous: `dpl_9RooTrwofPz3bSkPBpr6Vp6TucVk` (`a182778`).
- **Served CSS:** the deployed page contains the fallback CSS intact (full `10s` rules).
- **Data:** [`phase2a-fallback-staging-2026-10-27/`](phase2a-fallback-staging-2026-10-27/).

**Hero arrival** (10 alternating runs on the deployment URLs, ms):

| | Hero, per run | Median | Full document, median |
|---|---|---|---|
| Previous (`a182778`) | 1376 1116 1314 1179 1218 1182 1075 1048 1056 1092 | 1148 | 2555 |
| New (`e11158d`) | 1741 1351 1336 1105 1154 1056 1406 1086 1066 1199 | 1177 | 2624 |

**Checked on the deployed build:**

- **Finished homepage:** unchanged from `a182778` on mobile and desktop. Sections, links, placements, both Weekly Picks placements, metadata, JSON-LD and discovery payloads (8 exposures; 14/29 impressions; the same click) are identical. CLS 0, and no tracking request got through.
- **JavaScript off:** links immediately, footer directly below (771 px on mobile), no shapes ([screenshot](phase2a-fallback-staging-2026-10-27/screens/javascript-off-mobile.png)).
- **Scripts enabled but not running** (with and without reduced motion): shapes at 3 s, links by 15 s ([screenshot](phase2a-fallback-staging-2026-10-27/screens/scripts-enabled-none-run-15s.png)). The only layout shift (0.086) is the deliberate collapse at 10 s.
- **Keyboard:** the links take focus with Tab, show the focus outline and open on Enter in every fallback case.
- **Interrupted response:** a local relay forwarded staging's real response and dropped the connection just before the Sections. It only reads from staging. Links appeared in all 4 runs:
  - in 3 runs, within 3 s through the error boundary;
  - in 1 run, the page stayed "loading" and the CSS reveal was pending.
- **Crawlers:** Googlebot and Facebook user agents get complete HTML, the same size as on `a182778`. The `<head>` is identical for all user agents. Every response is `private, no-store`, `x-vercel-cache: MISS`.

**Local only:** the shared rendering failure; triggering it on a deployed build would need test code or data changes.
