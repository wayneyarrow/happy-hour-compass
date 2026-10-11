/**
 * Runtime authorization check for the Founder Control Panel.
 *
 * For every /control-panel page route (discovered from the filesystem) it
 * sends, WITHOUT an admin session:
 *   - a plain document request (what curl / a crawler gets), and
 *   - a Next.js RSC navigation request (RSC: 1 — what client-side
 *     navigation fetches),
 * and inspects the RESPONSE BODY, not only the status: a 307 whose body
 * still carries the page's rendered payload is a leak.
 *
 * Checks (all counts only — no matched value is ever printed):
 *   - the page's own static <h1> heading (read from its page.tsx), after
 *     removing <title>/metadata — present means the page component
 *     RENDERED (catches aggregate-only pages with no emails/ids) → must be 0
 *   - email-like strings in the body                       → must be 0
 *   - UUIDs in the body that aren't in the requested URL   → must be 0
 *   - hits from an optional private markers file (one sensitive string per
 *     line, e.g. venue names exported locally)             → must be 0
 *
 * Read-only: GET requests only, no database access, nothing written.
 *
 * Usage:
 *   npx tsx scripts/verifyControlPanelAuthz.ts --base-url=http://127.0.0.1:3000 \
 *     [--ids=ids.json] [--markers=markers.txt] [--cookie-env=CP_AUTHZ_COOKIE]
 *   ids.json: {"claims":"<uuid>","collections":"<uuid>","content-engine":"<uuid>",
 *              "homepages":"<uuid>","operator-submissions":"<uuid>","venues":"<uuid>"}
 *   --cookie-env names an environment variable holding a Cookie header for a
 *   signed-in NON-admin session (never pass cookies on the command line).
 * Exits 1 if any route leaks.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  })
);
const BASE = (args["base-url"] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const IDS: Record<string, string> = args.ids ? JSON.parse(readFileSync(args.ids, "utf8")) : {};
const MARKERS: string[] = args.markers && existsSync(args.markers)
  ? readFileSync(args.markers, "utf8").split("\n").map((s) => s.trim()).filter((s) => s.length >= 4)
  : [];
const COOKIE = args["cookie-env"] ? process.env[args["cookie-env"]] ?? "" : "";
const FALLBACK_ID = "00000000-0000-4000-8000-000000000000";

const APP = join(__dirname, "../src/app");
const CP = join(APP, "control-panel");

/** Static text of the page's <h1> (JSX string content only; null when dynamic). */
function pageHeading(route: string): string | null {
  const file = join(APP, ...route.slice(1).split("/"), "page.tsx");
  const src = existsSync(file) ? readFileSync(file, "utf8") : "";
  const m = src.match(/<h1[^>]*>\s*([^<{]+?)\s*<\/h1>/);
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/\s+/g, " ").trim() || null;
}

/** The heading as it appears inside server-rendered HTML. */
function htmlEscape(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
}

/** Remove document <title>, RSC title elements and meta tags — they legitimately repeat the page name. */
function stripMetadata(body: string): string {
  return body
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/\["\$","title"[^\]]*\]/g, "")
    .replace(/\[\\"\$\\",\\"title\\"[^\]]*\]/g, "") // same element JSON-escaped inside <script>
    .replace(/<meta[^>]*>/gi, "")
    .replace(/\["\$","meta"[^\]]*\]/g, "")
    .replace(/\[\\"\$\\",\\"meta\\"[^\]]*\]/g, "");
}

function pageRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) return pageRoutes(f);
    return n === "page.tsx" ? ["/" + relative(APP, dir).split(sep).join("/")] : [];
  });
}

/** Fill dynamic segments: /control-panel/<section>/[id]/… → the id for that section (or a placeholder UUID). */
function concrete(route: string): string {
  return route.replace(/\/([^/]+)\/\[id\]/g, (_m, section: string) => `/${section}/${IDS[section] ?? FALLBACK_ID}`);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type Result = {
  route: string;
  kind: "document" | "rsc";
  headingChecked: boolean;
  headingFound: boolean;
  status: number;
  location: string;
  redirectInPayload: boolean;
  bytes: number;
  emails: number;
  foreignUuids: number;
  markers: number;
};

async function check(path: string, route: string, kind: Result["kind"]): Promise<Result> {
  const headers: Record<string, string> = kind === "rsc"
    ? { RSC: "1", "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(["", { children: ["__PAGE__", {}] }, null, null, true])) }
    : { Accept: "text/html" };
  if (COOKIE) headers.Cookie = COOKIE;
  const res = await fetch(BASE + path, { headers, redirect: "manual" });
  const body = await res.text();
  const urlUuids = new Set((path.match(UUID_RE) ?? []).map((u) => u.toLowerCase()));
  const uuids = new Set((body.match(UUID_RE) ?? []).map((u) => u.toLowerCase()).filter((u) => !urlUuids.has(u)));
  const lower = body.toLowerCase();
  const heading = pageHeading(route);
  return {
    route: path,
    kind,
    headingChecked: heading !== null,
    // Plain (RSC), HTML-escaped (server HTML) and \u0026-escaped (flight data inside <script>) forms.
    headingFound:
      heading !== null &&
      [heading, htmlEscape(heading), heading.replace(/&/g, "\\u0026")].some((h) => stripMetadata(body).includes(h)),
    status: res.status,
    location: res.headers.get("location") ?? "",
    redirectInPayload: body.includes("NEXT_REDIRECT"),
    bytes: body.length,
    emails: new Set(body.match(EMAIL_RE) ?? []).size,
    foreignUuids: uuids.size,
    markers: MARKERS.filter((m) => lower.includes(m.toLowerCase())).length,
  };
}

(async () => {
  const routes = pageRoutes(CP).sort();
  const results: Result[] = [];
  for (const r of routes) {
    results.push(await check(concrete(r), r, "document"));
    results.push(await check(concrete(r), r, "rsc"));
  }
  let leaks = 0;
  for (const r of results) {
    // Data in the body is always a leak. Beyond that, the request must be
    // redirected: an HTTP 3xx (document requests, and middleware redirects of
    // RSC requests), or — for RSC requests redirected during render — a 200
    // carrying a NEXT_REDIRECT instruction in the payload.
    const is3xx = r.status >= 300 && r.status < 400;
    const notRedirected = r.kind === "document" ? !is3xx : !(is3xx || r.redirectInPayload);
    const leaked = r.headingFound || r.emails > 0 || r.foreignUuids > 0 || r.markers > 0 || notRedirected;
    if (leaked) leaks++;
    console.log(
      `${leaked ? "LEAK" : "ok  "} ${r.kind.padEnd(8)} ${String(r.status).padEnd(3)} ${(r.location || (r.redirectInPayload ? "(NEXT_REDIRECT)" : "")).padEnd(22).slice(0, 22)} ${String(r.bytes).padStart(7)}B h1=${r.headingChecked ? (r.headingFound ? "FOUND" : "absent") : "n/a"} emails=${r.emails} uuids=${r.foreignUuids} markers=${r.markers}  ${r.route}`
    );
  }
  console.log(`\n${routes.length} routes × 2 request kinds; ${routes.filter((r) => pageHeading(r)).length} with a static h1; ${MARKERS.length} private markers; session cookie: ${COOKIE ? "yes" : "no"}`);
  console.log(leaks === 0 ? "PASS — no protected data in any unauthorized response" : `FAIL — ${leaks} leaking responses`);
  process.exit(leaks === 0 ? 0 : 1);
})();
