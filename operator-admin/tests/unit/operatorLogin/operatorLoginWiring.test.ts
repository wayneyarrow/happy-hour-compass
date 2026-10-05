import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source-wiring checks: the login-notification action is reachable only from
 * the Business Login form, after access is granted, and accepts no
 * client-supplied identity.
 */

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("the server action takes no parameters", () => {
  const src = read("src/app/login/actions.ts");
  assert.match(src, /^"use server";/);
  assert.match(src, /export async function recordOperatorSignInAction\(\): Promise<void>/);
  assert.equal((src.match(/export async function/g) ?? []).length, 1);
});

test("only the Business Login page calls the action, after access is granted", () => {
  const callers = walk(join(ROOT, "src"))
    .filter((f) => /import[^;]*\brecordOperatorSignInAction\b/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f))
    .sort();
  assert.deepEqual(callers, ["src/app/login/page.tsx"]);

  const page = read("src/app/login/page.tsx");
  const signIn = page.indexOf("signInWithPassword(");
  const errorReturn = page.indexOf("if (error)", signIn);
  const granted = page.indexOf('if (outcome !== "granted")', signIn);
  const call = page.indexOf("recordOperatorSignInAction()", signIn);
  assert.ok(signIn > 0 && errorReturn > signIn && granted > errorReturn && call > granted);
  // Called with no arguments, errors swallowed, wait capped.
  assert.match(page, /recordOperatorSignInAction\(\)\.catch\(\(\) => undefined\)/);
  assert.match(page, /setTimeout\(resolve, 3_000\)/);
});

test("setup, verification, reset and consumer flows never import the login recorder", () => {
  const flows = [
    "src/app/(consumer-auth)/sign-in/page.tsx",
    "src/app/activate-account/ActivateAccountForm.tsx",
    "src/app/operator/invite/[token]/InviteAcceptForm.tsx",
    "src/app/control-panel-login/page.tsx",
  ];
  for (const f of flows) assert.doesNotMatch(read(f), /operatorLogin|recordOperatorSignIn/, f);
});

test("store writes notes with an event_key and the system author, and never logs credentials", () => {
  const store = read("src/lib/operatorLogin/operatorLoginStore.ts");
  assert.match(store, /event_key: eventKey/);
  assert.match(store, /created_by_email: SYSTEM_AUTHOR_EMAIL/);
  assert.match(store, /getClaims\(\)/);
  assert.match(store, /claimsData\.claims\.sub !== user\.id/);
  assert.doesNotMatch(store, /access_token|refresh_token|password/i);
  // Slack goes to the existing Customer Success channel helper.
  assert.match(store, /channel: "customer-success"/);
});

test("operator resolution is read-only (never relinks memberships or creates operators)", () => {
  const store = read("src/lib/operatorLogin/operatorLoginStore.ts");
  const resolveFn = store.slice(store.indexOf("async function resolveOperator"), store.indexOf("async function listOperatorVenues"));
  assert.doesNotMatch(resolveFn, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(store, /ensureOperatorForSession/);
});
