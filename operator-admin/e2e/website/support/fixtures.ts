import { test as base, expect, type Page } from "@playwright/test";

/**
 * Cross-browser compatibility audit fixtures — public website only.
 *
 * Automatically tracks uncaught JS errors and first-party (same-origin)
 * network failures on every test, and fails the test if any occur. This is
 * the signal this audit cares about: a genuine crash or a broken first-party
 * request, not third-party noise (Cloudflare Turnstile, Google Maps, Sentry,
 * analytics) which is expected and non-actionable per the audit brief.
 */

const THIRD_PARTY_CONSOLE_NOISE: RegExp[] = [
  /challenges\.cloudflare\.com/i,
  /turnstile/i,
  /maps\.google(apis)?\.com/i,
  /google maps javascript api/i,
  /sentry/i,
  /vercel-insights|vitals\.vercel-insights|va\.vercel-scripts/i,
  /resizeobserver loop/i,
  /download the react devtools/i,
  /\[fast refresh\]/i,
  /googletagmanager|google-analytics/i,
  /net::err_blocked_by_client/i,
];

function isThirdPartyNoise(text: string): boolean {
  return THIRD_PARTY_CONSOLE_NOISE.some((pattern) => pattern.test(text));
}

const THIRD_PARTY_PAGEERROR_NOISE: RegExp[] = [
  // Vercel's own "Live Feedback" toolbar script, auto-injected into every page
  // response on Preview deployments only (confirmed absent from Production —
  // `happy-hour-compass.vercel.app` never serves this script). It calls
  // `navigator.storage.persisted()` without checking `navigator.storage`
  // exists first. Playwright's Linux WebKit build has no Storage Manager API
  // at all (`navigator.storage` is `undefined`, unlike real macOS/iOS Safari,
  // which has supported it since Safari 16.4), so this throws an uncaught
  // rejection on every page load under the `webkit`/`mobile-safari` projects
  // when run against staging. Not HHC code, not reproducible in real Safari,
  // not present in Production.
  /vercel\.live\/_next-live\/feedback/i,
  // Cloudflare's own Turnstile "challenge platform" script
  // (`challenges.cloudflare.com/cdn-cgi/challenge-platform/.../turnstile/...`)
  // throws an uncaught `SecurityError: Blocked a frame with origin
  // "https://challenges.cloudflare.com" from accessing a frame with origin
  // "https://<site>". Protocols, domains, and ports must match.` — confirmed
  // via full stack trace to originate entirely inside that Cloudflare-hosted
  // script (every frame is a `challenges.cloudflare.com` URL; HHC's
  // `Turnstile.tsx` never touches the widget iframe's contents, only the
  // public `window.turnstile.render/reset/remove` API). Reproduces only under
  // Playwright's `webkit`/`mobile-safari` projects — never Chromium or
  // Firefox on the identical interaction — and only in this sandboxed test
  // environment, which lacks an IPv6 route to
  // `brunhild.challenges.cloudflare.com` (one of Turnstile's own attestation
  // domains, IPv6-only; confirmed via `ip -6 route` and a raw `curl`
  // connection failure), a plausible contributor to Cloudflare's script not
  // completing its normal flow here. A real iPhone Safari device completed
  // this same widget and submitted a protected form successfully, so this
  // is not reproducible outside this constrained environment.
  /challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform/i,
];

function isThirdPartyPageError(err: Error): boolean {
  return THIRD_PARTY_PAGEERROR_NOISE.some((pattern) => pattern.test(err.stack ?? err.message));
}

export type Diagnostics = {
  pageErrors: string[];
  consoleErrors: string[];
  firstPartyFailures: string[];
};

export const test = base.extend<{ diagnostics: Diagnostics }>({
  diagnostics: [
    async ({ page, baseURL, browserName }, use) => {
      const diagnostics: Diagnostics = { pageErrors: [], consoleErrors: [], firstPartyFailures: [] };
      const siteHost = baseURL ? new URL(baseURL).host : "";

      page.on("pageerror", (err) => {
        if (isThirdPartyPageError(err)) return;
        diagnostics.pageErrors.push(err.message);
      });

      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (isThirdPartyNoise(text)) return;
        diagnostics.consoleErrors.push(text);
      });

      page.on("requestfailed", (request) => {
        let host = "";
        try {
          host = new URL(request.url()).host;
        } catch {
          // opaque/invalid URL — ignore
        }
        if (host !== siteHost) return;
        const failure = request.failure()?.errorText ?? "unknown";
        if (/net::ERR_ABORTED/i.test(failure)) return; // benign nav cancellation (Chromium/WebKit)
        // Firefox's network stack reports the same benign
        // superseded-by-navigation cancellation under a different error
        // string — confirmed via direct repro (rapid client-side
        // navigations abort in-flight chunk/RSC/image requests with this
        // exact code on Firefox, never on Chromium/WebKit for the identical
        // interaction). Scoped to `browserName === "firefox"` specifically
        // so Chromium/WebKit diagnostics are completely unaffected, and to
        // this exact error string so a genuine first-party failure (a real
        // connection error, timeout, or 5xx) is never swallowed.
        if (browserName === "firefox" && /NS_BINDING_ABORTED/i.test(failure)) return;
        diagnostics.firstPartyFailures.push(`${request.url()} — ${failure}`);
      });

      page.on("response", (response) => {
        let host = "";
        try {
          host = new URL(response.url()).host;
        } catch {
          // opaque/invalid URL — ignore
        }
        if (host !== siteHost) return;
        if (response.status() >= 500) {
          diagnostics.firstPartyFailures.push(`${response.url()} — HTTP ${response.status()}`);
        }
      });

      await use(diagnostics);

      expect(diagnostics.pageErrors, "Uncaught JS errors").toEqual([]);
      expect(diagnostics.firstPartyFailures, "First-party network failures").toEqual([]);
      if (diagnostics.consoleErrors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("[audit] non-fatal first-party console.error output:", diagnostics.consoleErrors);
      }
    },
    { auto: true },
  ],
});

export { expect };

/** Fails the test if the document is wider than its viewport (unwanted horizontal scroll). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `Horizontal overflow: document scrollWidth ${scrollWidth}px > viewport width ${clientWidth}px`
  ).toBeLessThanOrEqual(clientWidth + 1);
}
