# Happy Hour Compass — Production Monitoring

## Overview

| Tool | Purpose | Plan |
|---|---|---|
| Vercel | Logs, deployment observability | Hobby (existing) |
| Sentry | Application exception monitoring | Free |
| UptimeRobot | Availability monitoring + alerting | Free |
| Slack | Central alert destination | Existing workspace |

---

## Sentry — Application Error Monitoring

**Organization:** `happy-hour-compass`  
**Project:** `javascript-nextjs`  
**SDK version:** `@sentry/nextjs` v10+

### What Sentry captures

- Unhandled server-side exceptions (Server Actions, API routes, RSC rendering)
- Unhandled client-side exceptions (React errors in browser)
- Errors that reach the `global-error.tsx` boundary
- Manual `Sentry.captureException(err)` calls

### Required Vercel environment variables

Set these in Vercel → Project Settings → Environment Variables.

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | `https://xxxx@oxxxx.ingest.sentry.io/xxxx` | Found in Sentry → Settings → Projects → javascript-nextjs → Client Keys (DSN). Required for all environments (preview + production). |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` | Tag for production environment; set on the Production environment only. Leave unset on Preview. |

#### Optional — source map upload (add when ready for readable stack traces)

| Variable | Value | Notes |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | `sntrys_...` | Sentry → Settings → Auth Tokens. Scopes: `project:releases`, `org:read`. |
| `SENTRY_ORG` | `happy-hour-compass` | Organization slug from Sentry Settings. |
| `SENTRY_PROJECT` | `javascript-nextjs` | Project slug from Sentry Settings. |

Without `SENTRY_AUTH_TOKEN`, Sentry still captures every error — stack traces will show minified variable names. This is acceptable until the project is past beta.

### Verifying Sentry after deployment

After setting `NEXT_PUBLIC_SENTRY_DSN` in Vercel and redeploying, trigger a real error in your app (e.g., temporarily break a Server Action or throw from a Route Handler). Check Sentry → Issues within 30–60 seconds. If the event appears, the integration is working.

If no events arrive, verify that `NEXT_PUBLIC_SENTRY_DSN` matches the DSN shown in Sentry → Settings → Projects → javascript-nextjs → Client Keys.

### Connecting Sentry alerts to Slack

1. In Sentry, go to **Settings → Integrations → Slack**.
2. Connect your Slack workspace.
3. Go to **Alerts → Alert Rules → Create Alert Rule**.
4. Condition: "A new issue is created" (or "issue frequency exceeds threshold").
5. Action: "Send a Slack notification" → select the **#ops-alerts** channel.
6. Recommended: also add an alert for "issue regression" (resolved issue reoccurs).
7. Save the rule.

All unhandled application errors will now post to `#ops-alerts` in Slack.

---

## Health Endpoint

**URL:** `https://happy-hour-compass.vercel.app/api/health`

### Response format

**Healthy (HTTP 200):**
```json
{
  "status": "ok",
  "database": "ok",
  "timestamp": "2026-06-11T04:20:00.000Z"
}
```

**Degraded (HTTP 503):**
```json
{
  "status": "degraded",
  "database": "error",
  "timestamp": "2026-06-11T04:20:00.000Z"
}
```

### What the endpoint checks

1. **App is responding** — the fact that it returns JSON confirms Next.js is up.
2. **Supabase connectivity** — a lightweight `HEAD`-only query against the `venues` table (no rows returned, no data exposed).

No secrets, credentials, or internal details are included in the response.

---

## UptimeRobot — Availability Monitoring

### Setup (manual — free plan)

Go to [uptimerobot.com](https://uptimerobot.com) and create the following monitors.

#### Monitor 1 — Production application

| Setting | Value |
|---|---|
| Monitor type | HTTP(s) |
| Friendly name | HHC — Production |
| URL | `https://happy-hour-compass.vercel.app/` |
| Monitoring interval | 5 minutes (free plan maximum) |
| Alert when | Status code is not 200 |

#### Monitor 2 — Health endpoint

| Setting | Value |
|---|---|
| Monitor type | HTTP(s) |
| Friendly name | HHC — Health Check |
| URL | `https://happy-hour-compass.vercel.app/api/health` |
| Monitoring interval | 5 minutes (free plan maximum) |
| Alert when | Status code is not 200 |
| Keyword monitoring | Optional: add keyword `"status":"ok"` to catch database-degraded 503s |

### Connecting UptimeRobot alerts to Slack

1. In UptimeRobot, go to **My Settings → Alert Contacts → Add Alert Contact**.
2. Choose **Slack** as the contact type.
3. Authorize UptimeRobot with your Slack workspace and choose the **#critical** channel (or **#ops-alerts** if no separate critical channel exists).
4. Set this contact as the alert destination on both monitors.
5. **Email backup:** Also add your email as a second alert contact on both monitors. UptimeRobot's free plan sends email reliably even if the Slack webhook has a transient failure.

### When happyhourcompass.com goes live

Update both monitors to point to the production domain:
- `https://happyhourcompass.com/`
- `https://happyhourcompass.com/api/health`

Keep the Vercel URL monitors active alongside them if you want to distinguish app-level failures from DNS/CDN failures.

---

## Slack Alert Routing Summary

| Source | Alert type | Destination | Mechanism |
|---|---|---|---|
| Sentry | Application exceptions | `#ops-alerts` | Sentry Slack integration + alert rule |
| UptimeRobot | Site downtime / health failures | `#critical` (or `#ops-alerts`) | UptimeRobot Slack contact |
| Existing HHC framework | Payment failures, business workflow errors | Existing channels (unchanged) | `SLACK_OPS_ALERTS_WEBHOOK_URL` / `SLACK_OPS_CRITICAL_WEBHOOK_URL` env vars |

The existing Slack alert framework (in `src/lib/slack.ts` or equivalent) is **not modified** by this implementation. Sentry and UptimeRobot alerts are additive.

---

## Future improvements (not in scope for this card)

- Add `SENTRY_AUTH_TOKEN` and enable source map upload for human-readable stack traces.
- Add a Founder System Health dashboard in the Control Panel.
- Add Sentry performance monitoring / custom transactions for critical flows (venue publish, claim approval).
- Add keyword monitoring in UptimeRobot for the health endpoint JSON content.
- Upgrade UptimeRobot to a paid plan for 1-minute intervals if uptime SLA tightens.
