/**
 * Investigation aid (no app code change): preload into `next start` to log
 * every server-side Supabase request one page render makes.
 *
 *   SUPABASE_FETCH_LOG=/tmp/fetches.jsonl NODE_OPTIONS="--require ./scripts/perf/logSupabaseFetches.cjs" npx next start -p 3102
 *   curl -s -o /dev/null http://localhost:3102/        # one render
 *   node scripts/perf/summarizeSupabaseFetches.cjs /tmp/fetches.jsonl
 *
 * Logs method, table/RPC path, a short fingerprint of the query string (so
 * identical queries group together), start offset, duration and response
 * bytes. Never logs headers, keys or bodies.
 */
const { appendFileSync } = require("node:fs");
const { createHash } = require("node:crypto");

const LOG = process.env.SUPABASE_FETCH_LOG;
const realFetch = globalThis.fetch;

if (LOG && realFetch) {
  globalThis.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\.supabase\.co\//.test(url)) return realFetch(input, init);
    const u = new URL(url);
    const started = Date.now();
    const res = await realFetch(input, init);
    let bytes = -1;
    try {
      bytes = (await res.clone().arrayBuffer()).byteLength;
    } catch {}
    appendFileSync(
      LOG,
      JSON.stringify({
        t: started,
        ms: Date.now() - started,
        method: (init && init.method) || (typeof input === "object" && input.method) || "GET",
        path: u.pathname,
        q: createHash("sha1").update(u.search).digest("hex").slice(0, 10),
        selectLen: (u.searchParams.get("select") || "").length,
        bytes,
        status: res.status,
      }) + "\n"
    );
    return res;
  };
}
