/**
 * Analytics blocking for logged-out Production checks (scripts/seeding/check*.ts).
 *
 * Two layers, both required: an init script that stops tracking calls inside the page before they leave it
 * (sendBeacon / fetch / XHR to /api/track/* and Google Analytics/Tag Manager), and Playwright routes that answer any
 * call that still reaches the network locally (counted, never sent). Checks must report the counter.
 */
import type { BrowserContext } from "playwright";

export const ANALYTICS_INIT_SCRIPT = `(() => {
  const isAnalytics = (u) => { try { const x = new URL(String(u), location.href);
    return x.pathname.startsWith("/api/track/") || /(^|\\.)(google-analytics\\.com|googletagmanager\\.com|analytics\\.google\\.com)$/.test(x.hostname); } catch { return false; } };
  if (navigator.sendBeacon) { const sb = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => isAnalytics(u) ? true : sb(u, d); }
  const f = window.fetch.bind(window);
  window.fetch = (input, init) => isAnalytics(typeof input === "string" ? input : input && input.url) ? Promise.resolve(new Response(null, { status: 204 })) : f(input, init);
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__hhcBlocked = isAnalytics(u); return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { if (this.__hhcBlocked) return; return send.apply(this, arguments); };
  window.gtag = function () {}; window.dataLayer = { push() {} };
})();`;

export const ANALYTICS_ROUTE = /\/api\/track\/|google-analytics\.com|googletagmanager\.com|analytics\.google\.com/;

/** Applies both layers to a context; returns a counter of calls answered locally. */
export async function blockAnalytics(ctx: BrowserContext): Promise<{ intercepted: number }> {
  const counter = { intercepted: 0 };
  await ctx.addInitScript(ANALYTICS_INIT_SCRIPT);
  await ctx.route(ANALYTICS_ROUTE, (r) => { counter.intercepted++; return r.fulfill({ status: 204, body: "" }); });
  return counter;
}
