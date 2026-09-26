import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * No part of the Resend API key may reach application logs — not the key,
 * a prefix, a suffix, or anything derived from it. getResend() used to log
 * `key.slice(0, 8) + "…"` on every send. Source-level on purpose: a
 * behavioural test would have to construct a real Resend client and send,
 * and must never depend on the real secret.
 */

const ROOT = join(__dirname, "../../..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every console.* call's full argument text (handles multi-line calls). */
function consoleCalls(code: string): string[] {
  const calls: string[] = [];
  const re = /console\.(log|info|warn|error|debug)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
      i++;
    }
    calls.push(code.slice(m.index, i));
  }
  return calls;
}

test("getResend() never logs the key or anything derived from it", () => {
  const code = stripComments(readFileSync(join(ROOT, "src/lib/email.ts"), "utf8"));
  const start = code.indexOf("function getResend(");
  const body = code.slice(start, code.indexOf("\n}\n", start));
  assert.ok(start !== -1, "getResend() found");
  assert.ok(!/key\.(slice|substring|substr|at|charAt|padStart|padEnd)\(|key\[|btoa\(|Buffer\.from\(key/.test(body), "no fragment of the key is taken");
  const calls = consoleCalls(body);
  assert.ok(calls.every((c) => !/\bkey\b|RESEND_API_KEY\s*[,)+]|process\.env/.test(c.replace(/"[^"]*"/g, '""'))), `a log call references the key: ${calls.join(" | ")}`);
  assert.ok(!calls.some((c) => /console\.(log|info|debug)\(/.test(c)), "getResend() makes no info/debug logs at all");
  assert.match(body, /return new Resend\(key\);/, "authentication unchanged");
});

test("no console call anywhere in src/ or scripts/ references the Resend key value", () => {
  const offenders: string[] = [];
  for (const dir of ["src", "scripts"]) {
    for (const file of listFiles(join(ROOT, dir))) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const call of consoleCalls(code)) {
        // String literals may *name* the variable (e.g. "RESEND_API_KEY is not set"); only code may not read it.
        const withoutStrings = call.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
        if (/process\.env\.RESEND_API_KEY|process\.env\[["']RESEND_API_KEY["']\]/.test(withoutStrings)) {
          offenders.push(relative(ROOT, file));
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
