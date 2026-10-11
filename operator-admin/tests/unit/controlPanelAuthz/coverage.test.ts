import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Coverage checks for Control Panel authorization (see
 * src/lib/requireControlPanelAdmin.ts for why layout-only gating leaked).
 * A new page, route handler or server action without a guard fails here.
 * Runtime verification of response bodies: scripts/verifyControlPanelAuthz.ts.
 */

const SRC = join(__dirname, "../../../src");
const CP = join(SRC, "app/control-panel");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f, match) : match(n) ? [f] : [];
  });
}
const rel = (f: string) => relative(SRC, f);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Body of the function whose declaration starts at `declStart` (brace-matched). */
function functionBody(src: string, declStart: number): string {
  let i = src.indexOf("(", declStart);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  // The body's opening brace ends its line; braces in a return-type
  // annotation (e.g. Promise<{ id: string } | null>) are inline.
  const rest = src.slice(i);
  const bodyBrace = rest.search(/\{[ \t]*\r?\n/);
  const open = bodyBrace >= 0 ? i + bodyBrace : src.indexOf("{", i);
  depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open + 1, j);
  }
  return src.slice(open + 1);
}

// ── Pages ───────────────────────────────────────────────────────────────────

const pages = walk(CP, (n) => n === "page.tsx");

test("there are Control Panel pages to check", () => {
  assert.ok(pages.length >= 40, `found ${pages.length}`);
});

test("every Control Panel page authorizes as its FIRST statement, before any data read or render", () => {
  for (const f of pages) {
    const src = readFileSync(f, "utf8");
    const m = src.match(/export default async function \w+\s*\(/);
    assert.ok(m, `${rel(f)}: default export must be an async function`);
    const body = stripComments(functionBody(src, m.index!)).trim();
    assert.match(body, /^await requireControlPanelAdmin\(\);/, `${rel(f)}: first statement must be await requireControlPanelAdmin()`);
    assert.match(src, /import \{ requireControlPanelAdmin \} from "@\/lib\/requireControlPanelAdmin";/, rel(f));
  }
});

test("no Control Panel module renders or serves data outside a guarded page body", () => {
  for (const f of walk(CP, (n) => /\.(ts|tsx)$/.test(n))) {
    const src = readFileSync(f, "utf8");
    for (const fn of ["generateMetadata", "generateStaticParams", "generateImageMetadata"]) {
      if (new RegExp(`export (async )?function ${fn}\\b|export const ${fn}\\b`).test(src)) {
        const m = src.match(new RegExp(`export (async )?function ${fn}\\s*\\(`))!;
        assert.match(stripComments(functionBody(src, m.index!)).trim(), /^await requireControlPanelAdmin\(\);/, `${rel(f)}: ${fn} must authorize first`);
      }
    }
  }
  // Route handlers under /control-panel would bypass page rendering entirely.
  for (const f of walk(CP, (n) => n === "route.ts" || n === "route.tsx")) {
    assert.match(readFileSync(f, "utf8"), /requireControlPanelAdmin\(/, `${rel(f)}: route handler must authorize`);
  }
  // No loading/template UI that could stream before the page guard runs.
  assert.deepEqual(walk(CP, (n) => /^(loading|template|default)\.tsx$/.test(n)).map(rel), []);
});

test("the layout keeps its gate, using the same helper", () => {
  const src = readFileSync(join(CP, "layout.tsx"), "utf8");
  assert.match(src, /await requireControlPanelAdmin\(\)/);
  assert.doesNotMatch(src, /from "@\/lib\/controlPanelAuth"/, "layout should not hand-roll the check");
});

test("middleware redirects logged-out Control Panel requests, never matching /control-panel-login", () => {
  const src = readFileSync(join(SRC, "middleware.ts"), "utf8");
  assert.match(src, /!user && \(pathname === "\/control-panel" \|\| pathname\.startsWith\("\/control-panel\/"\)\)/);
  assert.match(src, /loginUrl\.pathname = "\/control-panel-login"/);
  assert.doesNotMatch(src, /startsWith\("\/control-panel"\)/, "a bare prefix would also match /control-panel-login");
});

// ── Server actions ──────────────────────────────────────────────────────────

// Reads/writes and side effects. (createAdminClient() itself only builds a client.)
const DATA_ACCESS = /\.from\(|\.rpc\(|\.storage\b|sendTransactionalEmail\(|send\w*Email\(|sendSlack\w*\(|revalidatePath\(/;

/**
 * Index of the first admin check in `body`: direct, via a local helper that
 * performs it, or via a local alias of isControlPanelAdmin (the injectable
 * `const checkAdmin = deps.checkAdmin ?? isControlPanelAdmin` pattern).
 */
function firstGuard(body: string, localGuards: string[]): number {
  const aliases = [...body.matchAll(/const (\w+) = [^;]*\bisControlPanelAdmin\b/g)].map((m) => m[1]);
  const pats = [
    /isControlPanelAdmin\(/,
    /requireControlPanelAdmin\(/,
    ...[...localGuards, ...aliases].map((g) => new RegExp(`\\b${g}\\(`)),
  ];
  const hits = pats.map((p) => body.search(p)).filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : -1;
}

/** Local helper functions whose own body performs the admin check (called directly or via an alias). */
function localGuardHelpers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^(?!export)(?:async\s+)?function\s+(\w+)\s*\(/gm)) {
    const body = stripComments(functionBody(src, m.index!));
    const g = firstGuard(body, []);
    const d = body.search(DATA_ACCESS);
    if (g >= 0 && (d < 0 || g < d)) out.push(m[1]);
  }
  return out;
}

/** Resolve `fooImpl` imported into `src`: its body and its own file's guard helpers. */
function implBody(src: string, fromFile: string, name: string): { body: string; guards: string[] } | null {
  const imp = src.match(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`));
  if (!imp) return null;
  const spec = imp[1];
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : join(fromFile, "..", spec);
  const file = [`${base}.ts`, `${base}.tsx`].find(existsSync);
  if (!file) return null;
  const isrc = readFileSync(file, "utf8");
  const m = isrc.match(new RegExp(`export async function ${name}\\s*\\(`));
  return m ? { body: functionBody(isrc, m.index!), guards: localGuardHelpers(isrc) } : null;
}

const actionFiles = [
  ...walk(CP, (n) => /\.(ts|tsx)$/.test(n)),
  ...walk(join(SRC, "lib/activation"), (n) => /Actions\.ts$/.test(n)),
].filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));

test("there are Control Panel server actions to check", () => {
  assert.ok(actionFiles.length >= 15, `found ${actionFiles.length}`);
});

test("every exported Control Panel server action authorizes before any data access", () => {
  let checked = 0;
  for (const f of actionFiles) {
    const src = readFileSync(f, "utf8");
    const guards = localGuardHelpers(src);
    for (const m of src.matchAll(/export async function (\w+)\s*\(/g)) {
      checked++;
      const body = stripComments(functionBody(src, m.index!));
      let g = firstGuard(body, guards);
      const d = body.search(DATA_ACCESS);
      if (g < 0) {
        // Allowed: delegate straight to an imported *Impl that authorizes first.
        const call = body.match(/\b(\w+Impl)\(/);
        assert.ok(call, `${rel(f)}: ${m[1]} has no admin check`);
        const ib = implBody(src, f, call![1]);
        assert.ok(ib, `${rel(f)}: ${m[1]} delegates to ${call![1]}, which could not be resolved`);
        const ibs = stripComments(ib!.body);
        g = firstGuard(ibs, ib!.guards);
        assert.ok(g >= 0, `${call![1]} (from ${m[1]}) has no admin check`);
        const id = ibs.search(DATA_ACCESS);
        assert.ok(id < 0 || g < id, `${call![1]} accesses data before its admin check`);
        // The wrapper itself must not touch data before delegating.
        const delegateAt = body.indexOf(call![0]);
        assert.ok(d < 0 || d > delegateAt, `${rel(f)}: ${m[1]} accesses data before delegating`);
        continue;
      }
      assert.ok(d < 0 || g < d, `${rel(f)}: ${m[1]} accesses data before its admin check`);
    }
  }
  assert.ok(checked >= 60, `checked ${checked} actions`);
});
