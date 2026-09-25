import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source-wiring checks for the email-code activation foundation
 * (migration 100). This phase must leave the feature unreachable: no
 * route, action, component, reminder, or existing activation module may
 * import the new modules yet.
 */

const SRC_ROOT = join(__dirname, "../../../src");
const ACTIVATION_DIR = join(SRC_ROOT, "lib/activation");
const NEW_MODULES = ["emailCodeVerificationConfig", "emailCodeVerificationPolicy", "emailCodeVerificationTypes"];
const NEW_MODULE_FILES = new Set(NEW_MODULES.map((m) => join(ACTIVATION_DIR, `${m}.ts`)));

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("no application source outside the new modules imports them (feature unreachable)", () => {
  const offenders: string[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    if (NEW_MODULE_FILES.has(file)) continue;
    const source = readFileSync(file, "utf8");
    if (NEW_MODULES.some((m) => source.includes(m))) offenders.push(relative(SRC_ROOT, file));
  }
  assert.deepEqual(offenders, []);
});

test("new modules never use Math.random, console logging, or network/database/email clients", () => {
  for (const file of NEW_MODULE_FILES) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.ok(!code.includes("Math.random"), `${file} uses Math.random`);
    assert.ok(!/console\./.test(code), `${file} logs to console`);
    const importSpecifiers = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of importSpecifiers) {
      assert.ok(spec === "node:crypto" || spec.startsWith("./emailCodeVerification"), `${file} imports ${spec}`);
    }
    assert.ok(!/\bfetch\(|createAdminClient|sendSlackAlert/.test(code), `${file} performs I/O`);
  }
});

test("policy module uses node:crypto for randomness and comparison", () => {
  const code = stripComments(readFileSync(join(ACTIVATION_DIR, "emailCodeVerificationPolicy.ts"), "utf8"));
  assert.match(code, /from "node:crypto"/);
  assert.match(code, /randomInt/);
  assert.match(code, /timingSafeEqual/);
  assert.ok(!/process\.env/.test(code), "policy module must not read environment variables");
});

test("config module never reads a NEXT_PUBLIC_ variable and reads env only inside functions", () => {
  const code = stripComments(readFileSync(join(ACTIVATION_DIR, "emailCodeVerificationConfig.ts"), "utf8"));
  assert.ok(!code.includes("NEXT_PUBLIC_"));
  // Every process.env access sits inside an exported function body, never at module top level.
  const topLevel = code.replace(/export function[\s\S]*?\n}\n/g, "");
  assert.ok(!/process\.env/.test(topLevel), "process.env read at module import time");
});

test("existing activation state derivation, lifecycle insert, and reminder worker are untouched by verification fields", () => {
  for (const name of ["activationState.ts", "activationLifecycle.ts", "processActivationReminders.ts", "activationReminderPolicy.ts"]) {
    const code = readFileSync(join(ACTIVATION_DIR, name), "utf8");
    assert.ok(!/verification_required|verification_completed_at|verificationRequired/.test(code), `${name} references verification fields`);
  }
});
