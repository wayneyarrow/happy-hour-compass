import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 2A-4 correction — static wiring proof that the thin "use server"
 * wrapper (activationReleaseActions.ts) exposes no dependency-injection
 * seam of any kind, matching activationLifecycleActions.ts /
 * legacyActivationResumeActions.ts's own established fixed-signature
 * convention. The real DI seam (including the new `sendAlert` field) lives
 * entirely on activationReleaseImpl.ts, which has no "use server" directive
 * and is never itself network-reachable.
 */

const ACTIONS_SOURCE = readFileSync(join(__dirname, "../../../src/lib/activation/activationReleaseActions.ts"), "utf8");
const IMPL_SOURCE = readFileSync(join(__dirname, "../../../src/lib/activation/activationReleaseImpl.ts"), "utf8");
// Comment-stripped — the module's own header comment legitimately explains
// (in prose) that the DI seam lives elsewhere, naming
// ReleaseActivationLifecycleDeps/deps/sendAlert to say so, which would
// otherwise false-positive a blanket doesNotMatch on those very sentences.
// Mirrors the established "prose vs actual code" distinction elsewhere in
// this suite (e.g. operatorActivationRemindersCron.test.ts's CODE_ONLY).
const ACTIONS_CODE_ONLY = ACTIONS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("the \"use server\" wrapper has the fixed (lifecycleId, prevState, formData) signature and no deps parameter", () => {
  assert.match(ACTIONS_SOURCE, /"use server";/);
  assert.match(
    ACTIONS_CODE_ONLY,
    /export async function releaseActivationLifecycleAction\(\s*lifecycleId: string,\s*_prevState: ReleaseActivationState,\s*_formData: FormData\s*\)/
  );
  assert.doesNotMatch(ACTIONS_CODE_ONLY, /\bdeps\b/, "no `deps` identifier appears anywhere in the server-action module's actual code");
  assert.doesNotMatch(ACTIONS_CODE_ONLY, /ReleaseActivationLifecycleDeps/, "the DI type itself is never imported/re-exported here");
  assert.doesNotMatch(ACTIONS_CODE_ONLY, /sendAlert/, "the alert DI seam is never referenced in the network-reachable module's actual code");
});

test("releaseActivationLifecycleImpl is called with no second argument from the server-action module — the impl's own defaults (including the real sendSlackAlert) are what runs in production", () => {
  assert.match(ACTIONS_SOURCE, /return releaseActivationLifecycleImpl\(lifecycleId\);/);
});

test("activationReleaseImpl.ts (the impl module) has no \"use server\" directive — it is never itself network-reachable, so its sendAlert DI seam carries no risk", () => {
  assert.doesNotMatch(IMPL_SOURCE, /"use server";/);
});

test("the impl module defaults sendAlert to the real sendSlackAlert — production behavior is unchanged by the DI seam's existence", () => {
  assert.match(IMPL_SOURCE, /const sendAlert = deps\.sendAlert \?\? sendSlackAlert;/);
});
