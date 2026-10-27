/**
 * Requests every performance test must block so a test run never records
 * analytics, tracking or error events — against Production, staging or a
 * local build pointed at the shared database.
 *
 * One list, two shapes:
 *   LIGHTHOUSE_PATTERNS — Chrome Network.setBlockedURLs wildcards (`*` matches
 *                         any run of characters, including `/`).
 *   isTrackingRequest() — the same rules for Playwright page.route().
 *
 * Vercel Web Analytics / Speed Insights are served from per-project
 * randomized first-party paths (e.g. /f16ccac995dd8fff/view,
 * /a351f4d163e0e851/vitals), not /_vercel/*, so they are matched by their
 * trailing segment. The 2026-10-26 baseline missed these — see
 * docs/performance/README.md.
 *
 * What blocking does NOT cover (see README "Not blockable"):
 *   - server-side work triggered by the page request itself (Vercel function
 *     invocations / request logs) — unavoidable, and records nothing in
 *     HHC's analytics tables;
 *   - Google Maps JS / Static Maps loads — billed API usage, deliberately not
 *     blocked because they are part of what the pages cost to load.
 */

const RULES = [
  // First-party analytics writes (venue/event views, discovery, search, clicks, saves)
  { lh: "*/api/track/*", re: /\/api\/track\// },
  // GA4 hits (primary and secondary collection endpoints)
  { lh: "*google-analytics.com/*collect*", re: /google-analytics\.com\/.*collect/ },
  { lh: "*analytics.google.com/*collect*", re: /analytics\.google\.com\/.*collect/ },
  { lh: "*google.com/g/collect*", re: /google\.com\/g\/collect/ },
  { lh: "*googletagmanager.com/*collect*", re: /googletagmanager\.com\/.*collect/ },
  { lh: "*doubleclick.net/*", re: /doubleclick\.net\// },
  // Vercel Web Analytics + Speed Insights beacons (randomized and legacy paths)
  { lh: "*/_vercel/insights/*", re: /\/_vercel\/insights\// },
  { lh: "*/_vercel/speed-insights/*", re: /\/_vercel\/speed-insights\// },
  { lh: "*happyhourcompass.com/*/view", re: /^https?:\/\/[^/]*happyhourcompass\.com\/[0-9a-f]{8,}\/view(\?|$)/ },
  { lh: "*happyhourcompass.com/*/vitals", re: /^https?:\/\/[^/]*happyhourcompass\.com\/[0-9a-f]{8,}\/vitals(\?|$)/ },
  { lh: "*happyhourcompass.com/*/event", re: /^https?:\/\/[^/]*happyhourcompass\.com\/[0-9a-f]{8,}\/event(\?|$)/ },
  // Same beacons on Vercel deployment URLs (happy-hour-compass-<id>-<team>.vercel.app)
  { lh: "*.vercel.app/*/view", re: /^https?:\/\/[^/]*\.vercel\.app\/[0-9a-f]{8,}\/view(\?|$)/ },
  { lh: "*.vercel.app/*/vitals", re: /^https?:\/\/[^/]*\.vercel\.app\/[0-9a-f]{8,}\/vitals(\?|$)/ },
  { lh: "*.vercel.app/*/event", re: /^https?:\/\/[^/]*\.vercel\.app\/[0-9a-f]{8,}\/event(\?|$)/ },
  { lh: "*localhost*/*/view", re: /^https?:\/\/localhost(:\d+)?\/[0-9a-f]{8,}\/view(\?|$)/ },
  { lh: "*localhost*/*/vitals", re: /^https?:\/\/localhost(:\d+)?\/[0-9a-f]{8,}\/vitals(\?|$)/ },
  // Sentry error/performance envelopes
  { lh: "*sentry.io/api/*", re: /sentry\.io\/api\// },
  { lh: "*/monitoring?*", re: /\/monitoring\?/ },
];

const LIGHTHOUSE_PATTERNS = RULES.map((r) => r.lh);

function isTrackingRequest(url) {
  return RULES.some((r) => r.re.test(url));
}

/**
 * Requests that look like tracking but were NOT blocked — used to verify a
 * run. Anything returned here reached its destination.
 */
const AUDIT_RE = /\/api\/track\/|\/g\/collect|\/collect(\?|$)|\/view(\?|$)|\/vitals(\?|$)|\/event(\?|$)|_vercel\/insights|speed-insights|sentry\.io|doubleclick/;
function looksLikeTracking(url) {
  return AUDIT_RE.test(url);
}

/**
 * Sample URLs for every host a test runs against (Production, staging,
 * deployment URLs, local). `node scripts/perf/trackingBlockList.cjs` checks
 * each one is classified as expected — run it after changing RULES.
 */
const SELF_CHECK = [
  ["https://happyhourcompass.com/f16ccac995dd8fff/view", true],
  ["https://staging.happyhourcompass.com/a351f4d163e0e851/vitals", true],
  ["https://happy-hour-compass-14sj9hglo-waynes-projects-37cc94f2.vercel.app/f16ccac995dd8fff/view", true],
  ["https://happy-hour-compass-14sj9hglo-waynes-projects-37cc94f2.vercel.app/a351f4d163e0e851/vitals", true],
  ["https://happy-hour-compass-14sj9hglo-waynes-projects-37cc94f2.vercel.app/f16ccac995dd8fff/event", true],
  ["http://localhost:3100/f16ccac995dd8fff/view", true],
  ["https://happy-hour-compass-14sj9hglo-waynes-projects-37cc94f2.vercel.app/api/track/website-search", true],
  ["https://www.google.com/g/collect?v=2&en=page_view", true],
  ["https://o4511543517184000.ingest.us.sentry.io/api/1/envelope/", true],
  // Must stay unblocked: pages and the analytics scripts themselves
  ["https://happy-hour-compass-14sj9hglo-waynes-projects-37cc94f2.vercel.app/", false],
  ["https://happy-hour-compass-14sj9hglo-waynes-projects-37cc94f2.vercel.app/f16ccac995dd8fff/script.js", false],
  ["https://staging.happyhourcompass.com/website-events", false],
  ["https://happyhourcompass.com/central-okanagan/kelowna/joey", false],
];

if (require.main === module) {
  // Lighthouse wildcards: `*` matches any run of characters.
  const lhMatches = (url) =>
    LIGHTHOUSE_PATTERNS.some((p) => new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(url));
  let failed = 0;
  for (const [url, expected] of SELF_CHECK) {
    const re = isTrackingRequest(url);
    const lh = lhMatches(url);
    const ok = re === expected && lh === expected;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} blocked(playwright)=${re} blocked(lighthouse)=${lh} expected=${expected}  ${url}`);
  }
  console.log(failed ? `${failed} FAILED` : "all ok");
  process.exit(failed ? 1 : 0);
}

module.exports = { LIGHTHOUSE_PATTERNS, isTrackingRequest, looksLikeTracking };
