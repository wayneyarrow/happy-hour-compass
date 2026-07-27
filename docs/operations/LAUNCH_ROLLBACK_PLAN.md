# Launch Rollback Plan

**Status:** Draft — written from the current deployment, monitoring, and payments setup ahead of public launch. Has not yet been exercised against a real incident. See Revision History.

This is an operational decision-making guide, not an implementation guide. It defines *when* a production rollback should happen, *who* decides, and *how* to execute one safely on launch day and afterward. It covers the deployed application only — for data loss, corruption, or a bad migration, see `docs/operations/DISASTER_RECOVERY.md`.

---

## 1. Purpose

### Scope

This document covers rollback of the deployed application. Per `CLAUDE.md`, one Vercel project serves this repo from two branches:

- `main` → Production → `happy-hour-compass.vercel.app` (Consumer App, Operator Admin, Founder Control Panel)
- `website` → Preview → `staging.happyhourcompass.com` (Public Website)

At launch, the Public Website moves to `happyhourcompass.com` via a Vercel dashboard change, not a code change (see `CLAUDE.md`'s Staging and deployment section). After that, this plan covers whichever branch is currently serving production traffic.

**Out of scope:** database restore (`DISASTER_RECOVERY.md`), DNS/domain configuration, and third-party outages unrelated to our own deploy.

### When to use this document

- A production deploy is suspected of causing a user-facing problem.
- You need to decide, under time pressure, whether to fix forward or roll back.
- You're on call and want a pre-agreed process instead of a judgment call made from scratch.

---

## 2. Guiding Principles

- **A stable customer experience beats the newest deployment.** The latest code isn't sacred — if it's not working, restore what was working first, then debug calmly afterward.
- **A rollback is reversible; a prolonged outage isn't.** Every minute a major issue stays live costs trust. A rollback can always be undone once the fix is ready.
- **Don't roll back what a rollback can't fix.** A data problem (corruption, a bad migration) isn't solved by rolling back the app — see the fork in §6 and `DISASTER_RECOVERY.md`.
- **One person decides.** A single named role has authority to call a rollback — no consensus required mid-incident (§7).
- **Verify before declaring victory.** The job isn't done when the deploy finishes — it's done when Post-Rollback Verification (§9) passes.

---

## 3. Rollback Philosophy

**A rollback is not a failure — it's a controlled operational decision.** Shipping fast means occasionally shipping something that needs to be undone quickly. Rolling back calmly and visibly is what looks competent; leaving a broken experience live while debugging under pressure doesn't.

**A stable, working product for customers always outranks keeping the newest code live.** Treat a rollback as routine, not exceptional:

- It restores a known-good state for users while investigation continues, off the clock pressure of a live incident.
- It doesn't require a root cause first. "We don't know why yet, but it's correlated with the last deploy" is enough.
- It's always reversible — rolling forward once a real fix is ready is a normal follow-up deploy, not an admission the rollback was wrong.
- The bar for rolling back should be **lower**, not higher, in the first hours after launch or a major deploy, when reputational risk is outsized relative to how many users are actually affected.

---

## 4. Rollback Decision Matrix

Use this table as the first filter for any reported issue. It maps directly to the three operational outcomes this plan is built around.

| Outcome | When it applies | Action |
|---|---|---|
| **1. Minor** | Small, non-blocking, cosmetic, or affects a tiny fraction of users | Log it. Keep operating. Fix in a future patch — no urgency. |
| **2. Fix forward** | Significant but well understood, with a quick, low-risk fix available | Ship the fix while staying live. Don't roll back if a targeted fix is faster and safer. |
| **3. Rollback** | Major, user-facing, no quick or confident fix | Roll back immediately (§8). Don't spend the first 15 minutes debugging live if the blast radius is severe — roll back, then investigate. |

### Realistic examples

| Scenario | Outcome | Why |
|---|---|---|
| Typo or misaligned spacing on a page | **1. Minor** | Cosmetic, no functional impact. |
| One venue or event page 404s from bad data | **1. Minor** | Isolated to a single record — fix the data, not the deploy. |
| A non-critical filter (e.g. price range) stops working | **2. Fix forward** | Degrades one feature; doesn't block discovery. |
| The save button stops working for signed-in users | **2. Fix forward** | Annoying, but doesn't block browsing or account access. |
| Login fails for all consumers or operators | **3. Rollback** | Blocks access entirely; every minute compounds lost trust. |
| Search returns no results sitewide, or the homepage won't render | **3. Rollback** | Search and discovery are the core product — this is existential, not degraded. |
| Widespread errors, or the site is down (monitoring firing broadly) | **3. Rollback** | Clear signal of a bad deploy — don't wait for root cause. |
| Checkout or billing fails once Stripe is live | **3. Rollback**, if tied to our deploy | Payment failures carry direct revenue and trust risk. If Stripe itself is down, see §5 — a rollback won't help. |
| A protected form (signup, claim, contact, suggestions) rejects all valid submissions | **2. Fix forward** if one form; **3. Rollback** if sitewide | Scope determines severity — one broken form vs. every protected flow. |
| Search engines stop indexing the site, or metadata renders wrong | **2. Fix forward** | No user-facing breakage — a configuration fix, not a code rollback. |
| A market shows content it shouldn't yet | **2. Fix forward**, escalate only if it can't be contained same-day | Reputational concern, not typically an outage. |

---

## 5. What Does NOT Trigger a Rollback

- Cosmetic issues (spacing, alignment, typos) with no functional impact.
- A single page with bad or missing data — a content problem, not a deployment problem.
- Slow performance that doesn't cross into errors or timeouts, without a clear tie to the latest deploy.
- A confirmed third-party outage (Supabase, Stripe, Google Maps, Resend) — rolling back our code won't fix another provider's incident. Monitor and communicate instead (§6, §10).
- An isolated bug in one non-critical flow with a fast, well-understood fix — this is Outcome 2.
- Anything already known and intentionally deferred — this isn't a new incident.

---

## 6. What SHOULD Trigger a Rollback

- Authentication is broken sitewide for consumers or operators.
- Core discovery is broken: the homepage won't render, or search returns no results or errors sitewide.
- Widespread errors — a spike in server errors, rising Sentry volume, or a failing health check — correlated with a recent deploy.
- The site is down per uptime monitoring, correlated with a recent deploy.
- Checkout or billing fails once Stripe is live, and the cause traces to our own recent deploy — not a Stripe-side incident (see §5).
- A security regression: a protected form accepting unverified submissions, an auth bug that exposes another user's data, or a data-access regression.
- Any Outcome 3 situation with no fast, confident fix — including "we don't know why yet, but it's tied to the last deploy."

If it's unclear whether the cause is the deploy or the data, use this fork before deciding:

| Signal | Likely cause | Next step |
|---|---|---|
| Broke right after a deploy, no recent data change | Application deploy | Proceed to §8. |
| Broke without a deploy, or coincides with a migration/bulk data change | Data/database | See `DISASTER_RECOVERY.md`'s Decision Guide — don't roll back the app for a data problem. |
| Genuinely unclear | Investigate first | Check error monitoring and recent deploy logs before acting. Move only once the cause is reasonably clear, not on suspicion. |

---

## 7. Rollback Decision Authority

**The founder (or whoever is on call) has sole authority to call a rollback.** This avoids consensus delays mid-incident — speed matters more than a second opinion when the site is materially broken.

- No sign-off from anyone else is required to execute a rollback that meets the Outcome 3 bar (§4).
- **Decide with the evidence you have.** Waiting for full certainty costs more than an imperfect call made quickly — if it clearly looks like Outcome 3, roll back rather than keep investigating live.
- If the decision-maker is unreachable and the bar is clearly met (sitewide outage, broken auth, broken checkout with Stripe live), default to rolling back — this document stands in for real-time approval.
- Afterward, note the decision and reasoning wherever incidents are tracked, so future reviews of this document have real precedent, not just hypotheticals.

---

## 8. Rollback Procedure

Two ways to roll back. Default to the git revert path — it works regardless of Vercel plan and leaves a clean history. Use the Vercel dashboard redeploy as a faster fallback when service needs to be restored before a revert commit is even ready.

### Option A — Git revert and push (default)

1. Identify the last known-good commit on the branch serving production (`main`, or `website` after launch cutover).
2. `git revert` the offending commit(s) — don't force-push or reset. This preserves history.
3. Push the revert. Vercel builds and deploys it automatically from the existing branch mapping — no Vercel config changes needed.
4. Wait for the build to finish before considering the rollback live.
5. Proceed to §9.

### Option B — Redeploy a previous build from Vercel (fastest fallback)

Use this when service needs to be restored immediately, before a revert commit is ready.

1. In the Vercel dashboard, open the `happy-hour-compass` project → **Deployments**.
2. Find the last known-good deployment on the relevant branch — the one before the suspect deploy.
3. Redeploy it (or promote it to Production, if available). Double-check the branch/environment first — this project serves two branches from one Vercel project, and picking the wrong one rolls back the wrong surface.
4. Once live, still land a matching `git revert` (Option A) — otherwise the next ordinary push to that branch redeploys the bad commit and undoes the rollback.
5. Proceed to §9.

### Notes

- No feature-flag or maintenance-mode system exists today. A rollback means restoring a previous build — don't invent a flag mid-incident.
- Rolling back the app does **not** roll back the database. If a migration or data change is also involved, handle that separately via `DISASTER_RECOVERY.md`.
- If the cause is a misconfigured setting rather than code (e.g. an indexing/SEO setting), fixing the setting and triggering a new deploy is usually faster and more precise than a full rollback.

---

## 9. Post-Rollback Verification

Run this checklist immediately after any rollback, before communicating that the incident is resolved.

- [ ] **Deployment is live.** The new build is ready, on the correct branch/domain.
- [ ] **Health check passes.** `GET /api/health` returns healthy (see `docs/monitoring.md`).
- [ ] **Uptime monitors recover.** Both production monitors show "Up."
- [ ] **The original issue is confirmed gone.** Reproduce the failure path manually — sign in, run a search, load the homepage. Don't rely on monitors alone for a UX-shaped bug.
- [ ] **Error volume drops back to baseline.** The errors that triggered the rollback stop recurring in Sentry.
- [ ] **Spot-check the affected experience.** Load the actual pages/flows involved and confirm they look and work right, not just "return 200."
- [ ] **Stripe flows verified** (if billing/checkout was involved). Confirm checkout and the webhook endpoint work end-to-end, once Stripe is live.
- [ ] **No unintended side effects.** Confirm the rollback didn't also revert unrelated changes worth keeping — fast-follow to reintroduce them if it did.

---

## 10. Communications

- **Internal:** Post to `#ops-critical` as soon as a rollback is decided — before it completes, not after. Follow up in the same thread once Post-Rollback Verification (§9) passes.
- **Monitoring context:** Sentry and uptime alerts post to `#ops-alerts`/`#critical` — check those channels first when investigating a reported issue; the incident may already be visible there.
- **External (operators/consumers):** No status page or broadcast tooling exists today. For an Outcome 3 incident, acknowledge once confirmed (not before), and confirm resolution once §9 passes. Use existing direct channels rather than inventing new ones mid-incident.
- **Don't over-communicate on Outcome 1/2.** Reserve incident-style announcements for genuine rollbacks.

---

## 11. Recovery and Next Steps

Once §9 passes and the incident is stable:

1. **Root-cause the issue** without the pressure of a live outage — that's what the rollback bought time for.
2. **Write the real fix** as a normal PR and test it thoroughly, including against the exact failure that triggered the rollback.
3. **Deploy forward**, not by reverting the revert — land a fresh, corrected commit.
4. **Confirm the fix in production** using the Post-Rollback Verification checklist (§9) again, plus explicit confirmation of the root cause.
5. **Record what happened** — decision, timeline, root cause, fix — wherever incidents are tracked, so future revisions of this document have real precedent.
6. **Close the loop.** Ask whether better testing, monitoring, documentation, or process would have caught this sooner or made the rollback faster — and act on what's clearly worth fixing.

---

## 12. Revision History

| Date | Change | Context |
|---|---|---|
| 2026-07-27 | Initial creation | Written ahead of public launch, based on the current Vercel deployment setup (`main`/`website` branch-to-environment mapping), `docs/monitoring.md`'s Sentry/UptimeRobot/Slack stack, `docs/operations/DISASTER_RECOVERY.md`'s decision-guide format, and the current (test-mode) Stripe integration. Not yet exercised against a real incident. |
| 2026-07-27 | Editorial polish pass | Tightened wording throughout; removed internal implementation details (function names, file paths, env var names) that didn't aid operational decisions while keeping genuinely actionable references (health/webhook endpoints, Slack channels); simplified overly nuanced Decision Matrix examples and fixed a malformed table row; sharpened the "stable customer experience over newest deployment" principle in §2–§3; reinforced deciding on available evidence over waiting for certainty in §7; added a continuous-improvement step to §11. No change to approved structure, scope, or philosophy. |
