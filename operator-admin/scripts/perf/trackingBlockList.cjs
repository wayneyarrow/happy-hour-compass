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

module.exports = { LIGHTHOUSE_PATTERNS, isTrackingRequest, looksLikeTracking };
