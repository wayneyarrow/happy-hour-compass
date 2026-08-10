# Happy Hour Compass — Project Rules for Claude Code

## Repository layout

The active Next.js application lives entirely under **`operator-admin/`**. Every path below — `src/app/`, `src/lib/`, `app/(website)/`, `app/(consumer)/`, `app/admin/`, `app/control-panel/`, etc. — is relative to `operator-admin/` (e.g. "`src/lib/markets.ts`" means `operator-admin/src/lib/markets.ts`). The repository root also contains `docs/`, data CSVs, and a shared **`supabase/`** directory (migrations apply to the one Supabase project used by the whole app) — `supabase/` is the one exception and is *not* nested under `operator-admin/`.

## Product Architecture

### One engine, four presentation layers

HHC is a single product engine with multiple separate presentation layers. The engine is shared; the presentation layers must not be blended.

**Shared product engine** — lives in `src/lib/`, `src/app/api/` (both under `operator-admin/`), and the repo-root `supabase/`. Reuse freely across all presentation layers:
- Discover Engine: `src/lib/discover/discoverEngine.ts`, `featuredEventsEngine.ts`
- Data helpers: `src/lib/data/venues.ts`, `events.ts`, `discoverOverrides.ts`, etc.
- Market infrastructure: `src/lib/markets.ts`, `src/lib/activeMarket.ts`
- Analytics: `src/app/api/track/*`, `src/lib/analytics.ts`, `src/lib/trackingSession.ts`
- Business rules: `src/lib/plans.ts`, `src/lib/subscriptions.ts`, `src/lib/venueSetupStatus.ts`
- Supabase clients: `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`
- Utilities: email, Slack, slugify, imageProcessing, seededTags, trustSignals
- Server Actions that write to shared tables (claim, operator submission, etc.)
- API routes: all `/api/*` routes are shared infrastructure

**The four presentation layers — each is separate. Do not blend them:**

#### 1. Public Website — `app/(website)/`
- SEO-first, responsive desktop layout, premium modern consumer experience
- Should feel like Airbnb, OpenTable, Resy, Spotify, or Apple
- Must NOT feel like admin software, a SaaS dashboard, or an app simulator
- Developed on the `website` branch → staging.happyhourcompass.com
- Eventually served at happyhourcompass.com
- Has its own layout, nav, footer — completely separate from the consumer app shell
- May reuse engine functions, data helpers, and individual UI components from `(consumer)` where they fit
- Must NOT use or modify `ConsumerLayout` (phone frame + `ConsumerNav`) as its shell

**Current implementation** (`app/(website)/`) includes:
- Homepage with hero section, plus assembled-Homepage rendering driven by the Collections/Homepages admin (`page.tsx`, `HeroSection.tsx`, `homepage/HomepageDiscoveryShell.tsx`, `HomepageSectionsRenderer.tsx`, `FeatureSection.tsx`, `CollectionRail.tsx`)
- Website header/footer, including location switching across markets/cities (`WebsiteHeader.tsx`, `WebsiteFooter.tsx`, `WebsiteLocationSwitcher.tsx`)
- Happy hour and event search, with results maps (`website-happy-hours/`, `website-events/`, `SearchResultsMap.tsx`), including market-aware homepage venue search
- Venue and event detail pages (`[market]/venue/[slug]/`, `website-events/[id]/`)
- Consumer accounts, saved venues/events, and save actions (`ConsumerAuthProvider.tsx`, `account/`, `saved/`, `SaveVenueButton.tsx`, `SaveEventButton.tsx`)
- Acquisition flows — suggest venue, add venue, contact us modals (`acquisition/`), plus a standalone guided Claim Your Venue onboarding flow (`claim-your-venue/`)
- Public guides with FAQ sections and schema markup (`[market]/guides/`, `[market]/guides/[slug]/`)
- Collection landing pages for venue, event, and editorial-guide collections (`collections/`)
- For Businesses landing page — hero, product tour, pricing, comparison table, funnel narrative (`business/`)
- About Us page (`about/`) and Careers page (`careers/`)
- Shared public 404 experience

#### 2. Consumer App — `app/(consumer)/`
- App-like experience: 375px phone frame on desktop, full-screen on mobile, bottom nav
- Currently served at happy-hour-compass.vercel.app (from `main` branch)
- May later inform native iOS/Android direction
- **Do NOT modify during website development unless explicitly intended.** Accidental changes here affect the production app on main.

#### 3. Operator Admin — `app/admin/`
- Business/venue management for operators
- Admin/SaaS UI style is appropriate here
- Auth-gated via middleware; operators only
- Keep completely separate from public website styling and layout

#### 4. Founder Control Panel — `app/control-panel/`
- Internal platform management for the founder
- Admin/SaaS UI style is appropriate here
- CP-admin allowlist gated
- Keep completely separate from public website styling and layout

---

### Website branch rules

1. **Website work happens on the `website` branch only.** Never commit website-specific changes to `main`.
2. **Website UI goes in `app/(website)/`.**
3. **The website has its own layout.** Do not add website routes or layout changes to `app/(consumer)/layout.tsx`, `app/(legal)/layout.tsx`, or `app/(standalone)/layout.tsx`.
4. **Reuse the engine.** Any function in `src/lib/` is fair game. Any API route is shared. Any data helper is shared.
5. **Components: import, don't modify.** If a `(consumer)` component fits the website, import it as-is. Adapt it in a wrapper or a new component in `(website)/`. Do not edit the `(consumer)` component to accommodate website needs.

---

### Staging and deployment

- `main` branch → Vercel Production → happy-hour-compass.vercel.app (the consumer app, operator admin, control panel)
- `website` branch → Vercel Preview → staging.happyhourcompass.com (the public website)
- **No Vercel build config changes are needed.** Staging vs production behavior is controlled entirely through Next.js routing on the respective branches and the `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_NOINDEX` env vars already in place.
- When the website is ready for launch, the routing and domain assignment changes in Vercel dashboard — not in the codebase.

---

### Current status and next steps

- Content Engine (guide publishing) Phase 1 and the public Guide Experience V2 (editorial layout, FAQ sections with schema markup) are complete.
- Collections Management V1 (control-panel CRUD for Collections, resolved/preview tables, guide picker) is complete, including the algorithmic collection workflow and resolved-collection UX.
- Homepage Management is complete: the control-panel admin UI for assembling Collections into Homepages (creation flow, sections editor, content/guide pickers, preview) is built (`app/control-panel/homepages/`), and the public site renders assembled Homepages and Collection landing pages. See `docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md`.
- Several new public-facing pages have shipped since Homepage Management: For Businesses landing page, About Us, Careers, and a standalone guided Claim Your Venue onboarding flow.
- SEO/metadata implementation (canonical URLs, Open Graph/Twitter, structured data, sitemap, robots, environment-aware indexing) is complete for launch, with one known pre-launch gap around market-status gating in the sitemap. See the **SEO & Metadata** section below and `docs/website/SEO_ROADMAP.md`.
- Next major implementation area is not yet defined in this doc — confirm with the user/product docs before starting new large website work.

---

### Reference documents

- `operator-admin/WEBSITE_REUSE_AUDIT.md` — detailed audit of what to reuse, what to adapt, what to build new; recommended build sequence; key risks
- `docs/PHASE2-VENUE-COMPLETENESS.md` — venue completeness signals

---

## Website Vision & Playbook

Before any significant public-facing website functionality — UI, UX, layout, navigation, homepage, search, filters, maps, mobile experience, SEO, geographic or location architecture, content, or architecture decisions — review all five documents:

1. **[`docs/website/WEBSITE_VISION_AND_DESIGN_PRINCIPLES.md`](docs/website/WEBSITE_VISION_AND_DESIGN_PRINCIPLES.md)** — Website philosophy, UX principles, and design vision. Takes precedence over implementation convenience.
2. **[`docs/website/WEBSITE_PRODUCT_PLAYBOOK.md`](docs/website/WEBSITE_PRODUCT_PLAYBOOK.md)** — Engineering implementation guide and website build standards. Defines how to apply the philosophy during real implementation. Includes the **Geographic Information Architecture** — the authoritative reference for market, city, neighbourhood, URL structure, search origin priority, and all geographic decisions. Review this section before any geographic, URL, SEO, or location-related implementation.
3. **[`docs/website/CONSUMER_EXPERIENCE_PRD.md`](docs/website/CONSUMER_EXPERIENCE_PRD.md)** — Consumer product experience, customer journey, homepage philosophy, search framework, search results framework, filters, maps, mobile experience, and future consumer roadmap.
4. **[`docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md`](docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md)** — The Happy Hour Compass Content Engine is the long-term publishing engine for the public website's editorial content (Venue Guides, Event Guides, and future guide types). It is not a traditional CMS or blogging platform. It is a core architectural document, equal in importance to the Website Vision and Website Product Playbook. Review it before any Content Engine (CMS) implementation work — new guide types, publishing workflow changes, SEO automation, distribution, or admin control panel content functionality.
5. **[`docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md`](docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md)** — The canonical reference for Homepage Management and Collections: the Content → Collections → Homepages ownership model, geography-aware curation, Homepage Sections/Templates/Fallback, and how existing Discover Management logic evolves into Collections. Review it before any Homepage, Collection, or editorial merchandising implementation work.

If a requested implementation conflicts with any of these documents, surface the conflict before writing code.

Key principles from these documents to carry into every website task:
- The website is the product, not a marketing website. Discovery always comes before explanation.
- Reveal and elevate the existing product engine — never rebuild what already exists.
- Every homepage section must earn its place by improving discovery; it should feel like the beginning of the product, not an introduction to it.
- Show the product instead of describing it. Real venues, real events, real content.
- The product should feel closer to Airbnb, Apple, OpenTable, Resy, or Spotify — never like SaaS or admin software.
- Desktop must feel immersive; mobile must feel native. Neither is an afterthought.
- Do not create UI backed by immature or inconsistently populated data.
- Preserve separation between Public Website, Consumer App, Operator Admin, and Founder Control Panel.
- The Content Engine is the long-term publishing engine for the public website — not a traditional CMS or blogging platform. Follow `docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md` before introducing new Content Engine functionality or architecture; surface conflicts before writing code.
- Homepages assemble Collections; Collections own editorial curation; content never knows where it's displayed. Follow `docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md` before introducing new Homepage, Collection, or editorial merchandising functionality or architecture; surface conflicts before writing code.

---

## SEO & Metadata

The public website's SEO/metadata implementation is complete for launch (see `docs/website/SEO_ROADMAP.md` for full status, deferrals, and the launch-day checklist). The rules below are load-bearing — follow them for any new public page rather than re-deriving the pattern.

### Architecture

- `operator-admin/src/lib/siteUrl.ts` — single source of truth for absolute URLs and noindex logic (`getSiteUrl()`, `shouldNoIndex()`, `absoluteUrl()`). Every other SEO file reads through these three functions; nothing else reads `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_NOINDEX` directly.
- `operator-admin/src/lib/seo/metadata.ts` — `buildPageMetadata()`, the shared metadata helper, plus `buildVenueMetadata()` / `buildEventMetadata()` (thin wrappers for those two route shapes).
- `operator-admin/src/lib/seo/schema/` — JSON-LD structured-data builders, one per entity type, rendered through the shared `<JsonLd>` component (`(website)/JsonLd.tsx`).
- `operator-admin/src/app/sitemap.ts` / `robots.ts` — sitemap and robots generation, reusing the same visibility rules (`is_published`, `status='published'`, etc.) the pages themselves already use to decide whether to render or 404.

### buildPageMetadata() — use it for every new public page

Call `buildPageMetadata({ title, description, path, ogImage?, ogTitle?, ogDescription?, ogType? })` rather than hand-writing a `metadata` object. It generates canonical, Open Graph, and Twitter Card metadata together and applies environment-aware `noindex` automatically. Static pages assign it directly (`export const metadata = buildPageMetadata({...})`); dynamic pages call it from `generateMetadata()`. Every current public page (Homepage, venue, event, guide, guide index, collection, About, Business, Careers, Claim Your Venue, Privacy, Terms) goes through this helper — do not hand-roll a competing canonical/OG/Twitter implementation for a new one.

### Title template convention

The root layout (`operator-admin/src/app/layout.tsx`) sets `title: { template: "%s — Happy Hour Compass", default: "Happy Hour Compass" }`.
- **Default:** return a plain-string title with no brand suffix — the template appends "— Happy Hour Compass" exactly once. This is what `buildPageMetadata()` expects.
- **Exception:** use `title: { absolute: "..." }` only when the title is already fully composed elsewhere (CMS/admin-authored — currently only Homepage and Guide detail, where the stored `page_title` may already include the brand). This bypasses the template. Don't reach for it as a shortcut on a new page.
- Never hardcode "Happy Hour Compass" into a plain-string title — it will render twice.

### Canonical URL conventions

- Every indexable public page sets a self-referencing canonical via `buildPageMetadata()`'s `path` (or `canonicalPath` for a CMS-driven override, e.g. a guide's admin-entered `canonical_url`).
- A canonical must always point at a URL that actually resolves to a real route — never assert one for a path with no corresponding `page.tsx`.
- **Homepage canonical is always `/`, regardless of resolved market/city.** `WEBSITE_PRODUCT_PLAYBOOK.md`'s Geographic Information Architecture documents a future `/{market}/{city}` canonical shape, and the Homepage CMS's `canonicalUrl` field (`homepageSeo.ts`, `control-panel/homepages/HomepageForm.tsx`) is already built against it — but no `/{market}` or `/{market}/{city}` route exists yet. Until those routes ship, `(website)/page.tsx`'s `generateMetadata()` intentionally ignores the CMS-stored value and always resolves to `/`. Do not wire the CMS canonical back into the live tag without first shipping the routes it depends on.

### Open Graph / Twitter conventions

- `buildPageMetadata()` sets `openGraph` and `twitter` together, always, for every caller. Don't add a page-specific OG/Twitter block outside the helper.
- **Default Open Graph image:** `DEFAULT_OG_IMAGE` in `metadata.ts` is `/logo.png` — the sitewide brand asset already used elsewhere (Organization JSON-LD, email templates, auth pages). It's used automatically whenever a page doesn't pass its own `ogImage`. Never reference `/og-default.png` — that path was never a real file and has been fully removed from the codebase.
- Pages with a real content image (venue photo, event photo, guide hero image) should pass it as `ogImage`; everything else correctly falls through to the shared default.

### Structured data (JSON-LD)

- Builders live in `src/lib/seo/schema/` — one per entity (`organization.ts`, `website.ts`, `breadcrumb.ts`, `venue.ts`, `article.ts` for guides, `collection.ts`, `aboutPage.ts`, `faq.ts`). Each returns a plain `SchemaNode | null`; never include `@context`/`@graph` inside a builder — that envelope belongs solely to `<JsonLd>`.
- Organization + WebSite render once, sitewide, from `(website)/layout.tsx`. Every other node is page-specific.
- Governing rule for every builder: never mark up a fact the data model can't stand behind — omit a property entirely (never a guessed or placeholder value) when the underlying data isn't reliably available at scale.
- **Event structured data (`schema.org/Event`) is intentionally deferred.** The current event data model cannot produce a truthful, timezone-aware occurrence datetime, which `Event` schema requires. Do not add it until that gap is actually resolved — see `docs/website/SEO_ROADMAP.md`.

### Environment-aware indexing

- `shouldNoIndex()` drives both `robots.txt` (full `Disallow: /` on staging) and each page's `<meta name="robots">`. Controlled by `NEXT_PUBLIC_NOINDEX=true`, set in Vercel project settings for the staging/preview environment only — **never set it on Production.**
- `NEXT_PUBLIC_*` env vars are inlined at build time, not read at request time. Changing this value requires a new build/deploy — a runtime-only restart will not pick up the change.

### Implementation rules for future contributors

- Use `buildPageMetadata()` for every new public page; don't hand-write canonical/OG/Twitter.
- Never hardcode the brand suffix into a plain-string title.
- Never reference `/og-default.png`.
- Never add a canonical pointing at a route that doesn't exist yet.
- Before adding Event structured data, confirm the timezone/occurrence-datetime gap is actually closed.
- See `docs/website/SEO_ROADMAP.md` for completed work, intentional deferrals, known gaps, and the launch-day checklist.

---

## Authentication & Email

### Consumer email confirmation flow

Consumer signup confirmations resolve through **`/auth/confirm`** (`operator-admin/src/app/auth/confirm/page.tsx`), not `/auth/callback`.

**Rule:** Never route a consumer confirmation link through `/auth/callback`.

**Why:** `/auth/callback` handles the browser PKCE `?code=` flow. Server-generated Supabase links (`auth.admin.generateLink()`, used for consumer signup) have no browser `code_verifier` to anchor a PKCE exchange, so Supabase can only redirect back with tokens in the URL hash fragment (`#access_token=...&type=signup`) — a shape `/auth/callback` doesn't understand. `/auth/confirm` is the dedicated handler for that hash-fragment shape.

### Supabase Redirect URLs

**Rule:** Every authentication callback route the app redirects to (`/auth/callback`, `/auth/confirm`, `/operator/create-password`, etc.) must also be added to the Supabase dashboard under **Authentication → URL Configuration → Redirect URLs** — for **both** the staging and production URLs. Adding the route in code is not sufficient by itself.

**Why it matters:** If a `redirectTo` isn't in that allow-list, Supabase does not error — it silently falls back to the dashboard-configured Site URL, stripping the intended path/query entirely. This produces misleading behavior: the code is correct, but the deployed redirect is wrong, and it looks like the new route "isn't being used." See `operator-admin/src/app/(consumer)/RecoveryRedirect.tsx`'s header comment for the original diagnosis of this failure mode (operator recovery links).

### Environment-aware authentication links

**Rule:** Every authentication email must build its redirect/action URL through `getSiteUrl()` (`operator-admin/src/lib/siteUrl.ts`) rather than a hard-coded domain. This is the same environment-aware helper used for SEO/metadata — it resolves to the correct staging vs. production origin per deployment, whereas Supabase's own dashboard-configured Site URL does not vary per environment.

### Supabase Auth email delivery (SMTP)

No flow in the app relies on Supabase Auth's own mail delivery anymore. Every Auth-adjacent email — consumer signup confirmation, operator activation, operator forgot-password, and consumer forgot-password (`requestConsumerPasswordReset`, `operator-admin/src/app/(consumer-auth)/account/forgot-password/actions.ts`) — calls `supabase.auth.admin.generateLink()` to obtain the link only, then sends its own branded email via Resend (`src/lib/email.ts`), deliberately bypassing Supabase's mailer.

Consumer forgot-password used to be the one exception: it called `supabase.auth.resetPasswordForEmail()` and let Supabase render and send the whole email itself. Staging end-to-end testing (2026-07-24) traced Gmail's "This message might be dangerous" warning and the missing Slack/branding on that email directly to this — the email came from Supabase's own unauthenticated mail path with Supabase's default unbranded template, not from Resend/`hello@happyhourcompass.com`. It was switched to the `generateLink()` + Resend pattern below to match every other flow; see that file's header comment for the full reasoning, including how it still avoids embedding the raw `action_link` (see the token_hash note further down).

**Rule:** Supabase Auth should still have **Custom SMTP enabled** (Supabase dashboard → Authentication → Emails → SMTP Settings), routed through the project's existing Resend account, using the domain already verified there (`happyhourcompass.com` — SPF/DKIM confirmed via Resend + DNS), as defense-in-depth in case any future flow ever falls back to Supabase's own mailer (e.g. a new flow calling `resetPasswordForEmail()` or `signUp()` directly). No current flow depends on it, but leaving Supabase's shared/default mail infrastructure as the fallback is never correct for production (low fixed send-rate limits).

**Why it matters:** This is a single project-wide Supabase setting — there is only one Supabase project behind local dev, staging, and production (see `supabase/` note in Repository layout) — so it can't be scoped per environment, and misconfiguring or reverting it affects every environment identically, including local dev.

**Required values** (Resend's standard SMTP relay — see Resend's SMTP docs for the authoritative values, don't hardcode them elsewhere): host `smtp.resend.com`, username `resend`, password = the existing `RESEND_API_KEY`, sender `hello@happyhourcompass.com` / "Happy Hour Compass" — matching `DEFAULT_FROM` in `src/lib/email.ts`. No new DNS records are needed; the domain is already verified in Resend.

**Custom SMTP alone does not resolve Gmail's "This message might be dangerous" warning.** That warning was confirmed (via Gmail "Show original" evidence) to be unrelated to sender authentication — SPF, DKIM, and DMARC all pass and are fully aligned to `happyhourcompass.com` once Custom SMTP is enabled. The actual trigger is the **link inside the email**: Supabase's default recovery template builds the link from `{{ .ConfirmationURL }}`, which renders as a raw `https://<project-ref>.supabase.co/auth/v1/verify?...` URL — a branded sender pointing at an opaque, unrelated third-party domain, which is exactly the pattern Gmail's phishing heuristics flag regardless of passing authentication. The fix is a template + app change, not an SMTP/DNS change:
- The Supabase **Reset Password email template**'s `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` shape (instead of `{{ .ConfirmationURL }}`) is what this pattern is named after — it keeps the link on our own domain instead of the raw Supabase project domain. This dashboard template is no longer actually invoked by the app (nothing calls `resetPasswordForEmail()` anymore, so Supabase never renders it), but the same link shape is now built directly in code: `requestConsumerPasswordReset` calls `admin.generateLink({ type: "recovery" })` and rebuilds the link as `${redirectTo}?token_hash=${linkData.properties.hashed_token}&type=recovery` — `hashed_token` is the same value `{{ .TokenHash }}` would have resolved to. Do **not** switch this to `linkData.properties.action_link` — that's the raw `/auth/v1/verify` URL and reintroduces the prefetch-consumption risk below.
- `/account/reset-password` (`operator-admin/src/app/(consumer-auth)/account/reset-password/page.tsx`) handles the resulting `?token_hash=...&type=recovery` query param, alongside the pre-existing hash-fragment (`access_token`/`refresh_token`) handling kept for backward compatibility.
- **Consumer signup confirmation, operator activation, and operator forgot-password carry the same underlying risk** — all three embed a Supabase `admin.generateLink()` `action_link` directly into their branded Resend emails, and `action_link` is the same raw `/auth/v1/verify` URL shape. None have triggered a reported Gmail warning, so none have been changed — but if one ever does, the fix is the same class (build the link from `{{ .RedirectTo }}`/`{{ .TokenHash }}`-equivalent data rather than the raw action link), not an SMTP/DNS change. Consumer forgot-password is deliberately no longer in this list — see the token_hash bullet above.

**A one-time recovery token must never be verified automatically on page load.** Supabase documents email-security scanners prefetching links as a common cause of single-use recovery tokens being silently consumed before the user ever opens the message — confirmed here directly: a fresh, never-manually-reused `token_hash` sometimes already read as expired (`verifyOtp` → `code: otp_expired`, HTTP 403) purely from the page having loaded. This is not fixed by the user "clicking faster" — the token can be consumed by something other than the user's own click at any point after the email is sent, regardless of how quickly they open it — and a copy-the-link-and-paste-it-elsewhere affordance doesn't fix it either, since loading the URL at all is the trigger, not which application renders it.

**Rule:** `/account/reset-password` must never call `supabase.auth.verifyOtp()` from `useEffect`, initial render, or any other page-load/navigation/prefetch path. A `token_hash` link lands on an intermediate branded confirmation state ("Reset your password" / "Continue to securely reset the password for your Happy Hour Compass account." / a "Continue to reset password" button) and `verifyOtp()` is called **only** from that button's explicit `onSubmit`/click handler — guarded both by disabling the button while the request is in flight and by an in-memory ref checked synchronously (`verifyingRef`), so neither a double-click nor a React re-render can issue a second verification call for the same token. Reloading the confirmation page must never consume the token either — it only re-detects the `token_hash` query param, it never re-verifies.

### Known Supabase generateLink() JWT/kid failures

Supabase's GoTrue Admin API intermittently rejects `auth.admin.generateLink()` calls with `"unrecognized JWT kid <nil> for algorithm ES256"` — a confirmed upstream bug following Supabase's platform-wide HS256→ES256 JWT signing-key migration (see supabase/supabase#48295, #48272), not a config or code issue on our side. It surfaced first in operator provisioning (`provisionOperatorForVenue`, `operator-admin/src/lib/operatorActivation.ts`) and again in the operator forgot-password flow (`forgotPasswordAction`) during 2026-07-24 staging testing — a request that hits it gets no recovery link and no email, with only a Slack alert (if the call site alerts on `linkError`) as a symptom.

**Mitigation:** retry only this specific error, up to 3 attempts with short backoff; any other `generateLink` error still returns immediately on the first attempt. The shared helper is `generateLinkWithRetry()` (`operator-admin/src/lib/supabase/generateLinkWithRetry.ts`), used by `forgotPasswordAction` (operator) and `requestConsumerPasswordReset` (consumer). `provisionOperatorForVenue` keeps its own inline copy of the same check predating this helper — both are expected to be deleted once Supabase ships a fix, so they weren't consolidated. Any **new** `generateLink()` call site should use the shared helper rather than calling `supabase.auth.admin.generateLink()` directly.

### Consumer signup notifications

On successful consumer account creation (`createConsumerAccount()`, `operator-admin/src/app/(consumer-auth)/sign-up/actions.ts`):
- Consumer receives the branded confirmation email (`sendConsumerSignupConfirmationEmail`).
- Slack notification is sent to `#consumer-signup`.
- Founder notification email is sent to `hello@happyhourcompass.com` (`sendConsumerSignupFounderNotificationEmail`).

**Rule:** Notification failures (email or Slack) must never block successful account creation — each is fire-and-forget with its own error logging, matching the founder-notification pattern already used for claims/suggestions/submissions in `src/lib/email.ts`.

---

## Bot Protection (Cloudflare Turnstile)

Every unauthenticated public form/server action that writes to the database, creates an account, sends an email, or sends a Slack notification is gated by Cloudflare Turnstile. Client-side widget completion is never sufficient on its own — every protected server action re-verifies the token server-side via Siteverify before doing anything else.

### Architecture

- `operator-admin/src/lib/turnstile.ts` — server-only. `verifyTurnstileToken(token, remoteIp?)` calls Cloudflare Siteverify and returns `{ success: true }` or `{ success: false, reason }`. A missing token, a failed/expired/already-used token, and a Siteverify network failure are all treated identically: verification did not succeed. Also exports `TURNSTILE_FAILURE_MESSAGE` (the shared user-facing error copy) and `TURNSTILE_TOKEN_FIELD` (the FormData field name, `cf_turnstile_token`, used by every form-action-based flow).
- `operator-admin/src/components/Turnstile.tsx` — the one shared client widget. Renders Cloudflare's official script (`https://challenges.cloudflare.com/turnstile/v0/api.js`) via `next/script` and explicit `window.turnstile.render()` (not the implicit `data-sitekey` div), so a parent form can reset the widget imperatively through a forwarded ref (`TurnstileHandle.reset()`) after a failed submission. `onVerify(token)` fires on completion; `onExpire()` fires on token expiry, widget error, or timeout — callers must clear any stored token in response.
- No third-party Turnstile wrapper package is used — Cloudflare's script + Siteverify's plain HTTP API cover every case here.

### Protected flows

| Flow | Server action | Client form(s) |
|---|---|---|
| Contact Us | `submitContactAction` (`(consumer)/contact/actions.ts`) | `ContactForm.tsx`, website `ContactUsModalContent.tsx` |
| Suggest a Venue | `submitSuggestionAction` (`(consumer)/suggest/customer/actions.ts`) | `SuggestionForm.tsx`, website `SuggestVenueModalContent.tsx` |
| Add Your Venue | `saveOperatorSubmissionAction` (`(consumer)/suggest/owner/actions.ts`) | `OwnerSubmissionFlow.tsx`, website `AddVenueModalContent.tsx` |
| Add Venue — more info follow-up | `submitMoreInfoAction` (`(standalone)/suggest/owner/more-info/[token]/actions.ts`) | `MoreInfoForm.tsx` |
| Claim Your Venue | `submitClaimAction` (`(consumer)/venue/[id]/claim/actions.ts`) | `ClaimForm.tsx`, website `ClaimVenueModalContent.tsx` |
| Claim — more info follow-up | `submitClaimMoreInfoAction` (`(standalone)/claim/more-info/[token]/actions.ts`) | `MoreInfoForm.tsx` |
| Consumer signup | `createConsumerAccount` (`(consumer-auth)/sign-up/actions.ts`) | `sign-up/page.tsx` |
| Operator forgot password | `forgotPasswordAction` (`app/forgot-password/actions.ts`) | `ForgotPasswordForm.tsx` |
| Consumer forgot password | `requestConsumerPasswordReset` (`(consumer-auth)/account/forgot-password/actions.ts`) | `account/forgot-password/page.tsx` |

The consumer forgot-password flow previously called `supabase.auth.resetPasswordForEmail()` directly from the browser with no server action at all — there was no point to gate. It was moved into a small server action for exactly this reason; behavior (redirect target, always-return-success anti-enumeration) is unchanged, just moved server-side. It has since been changed again to call `admin.generateLink()` + send its own Resend email instead of calling `resetPasswordForEmail()` at all — see the "Supabase Auth email delivery (SMTP)" section above; the Turnstile gate and anti-enumeration behavior are unaffected by that change.

The Add Your Venue flow is multi-step (business lookup → match confirmation / no-match / rejection). `lookupBusinessAction` (the Google Places lookup) is **not** Turnstile-gated — it performs no database write, account creation, email, or Slack notification. Verification instead happens inside `saveOperatorSubmissionAction`, the actual side-effecting call, which is reached from all three terminal steps (confirm match, reject match, no-match continue); the widget is rendered on each of those three steps, immediately before its submit action.

**Not protected, intentionally:** operator/founder authenticated actions (Operator Admin, Founder Control Panel), read-only browsing/search/saved-items interactions, and `src/app/api/track/*` analytics endpoints (unauthenticated but not a submission/lead-capture surface).

### Server-side verification rule

Every protected server action follows the same shape:
1. Run existing field validation first (cheap, no network) — return field errors before touching Turnstile.
2. Extract the token from `formData.get(TURNSTILE_TOKEN_FIELD)` (form-action flows) or an explicit `turnstileToken` parameter (flows that call the server action directly, e.g. `createConsumerAccount`, `saveOperatorSubmissionAction`).
3. Call `verifyTurnstileToken()`. On failure, return immediately with the shared failure message and a `turnstileFailed: true` flag on the result — **before** any database write, `auth.admin.createUser`/`generateLink`, email send, or Slack notification.
4. Only proceed to the flow's existing side effects once verification succeeds. Existing behavior (emails, Slack notifications, redirects, success confirmations, the "notification failures never block a valid submission" rule) is otherwise unchanged.

On the client, `turnstileFailed: true` in the result is what triggers `turnstileRef.current?.reset()` and clears the stored token — an ordinary validation error does not reset the widget, since the token is still valid for the next attempt.

### Environment variables

Uses the existing `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (client-side, safe to expose) and `TURNSTILE_SECRET_KEY` (server-only — never import `src/lib/turnstile.ts` from a Client Component). Both already exist locally and in Vercel Preview/Production; no new environment variables were introduced.

### Content Security Policy

This codebase has no CSP anywhere (`next.config.ts` has no `headers()` block; `middleware.ts` sets no security headers). Turnstile therefore required no CSP update — there is nothing to conflict with. If a CSP is introduced later, it must allow `https://challenges.cloudflare.com` for `script-src`, `frame-src`, and `connect-src`.

---

## Supabase migrations

### Every new public-schema table must have explicit GRANTs

Supabase removes automatic grants for `anon`, `authenticated`, and `service_role` on new public-schema tables starting **October 30 2026**. Any table created without explicit GRANTs will be silently inaccessible via the Supabase Data API.

**Rule:** Every migration that creates a `CREATE TABLE` in the `public` schema must end with a GRANT block.

**Template:** Copy `supabase/migrations/_template.sql` — the GRANT section is pre-filled with the correct structure and inline guidance.

**Reference:** `supabase/migrations/039_security_hardening.sql` documents the full grant philosophy:
- `anon` — public-facing intake forms only (no login gate required)
- `authenticated` — operator-facing tables accessed directly by the app
- `service_role` — all tables, always (bypasses RLS; required for `createAdminClient()`)
- Scope each role to the minimum operations it actually performs (`SELECT`, `INSERT`, `ALL`, etc.)
- Never grant `ALL` to `anon` or `authenticated`

### RLS must be enabled on every new table

Always include `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` even if no permissive policies are added yet. No permissive policy + RLS enabled = inaccessible to all non-service-role callers by default (safe baseline).

---

## Seeded Market Launch Prep — Google Places Refresh Tool

When preparing any previously-seeded market for activation/launch (Central Okanagan was the pilot; this applies equally to Greater Vancouver, Seattle, Toronto, or any future market), run the **Seeded Venue Refresh** tool before the separate manual Happy Hour certification pass:

```
npm run refresh:seeded-venues -- --market=<market-slug> --dry-run
npm run refresh:seeded-venues -- --market=<market-slug> --apply   # only after reviewing the dry run
```

`<market-slug>` is any `markets.slug` already in the database (e.g. `central-okanagan`, `greater-vancouver`) — run with no `--market` to print the valid list. **Dry run is the default and is mandatory before apply** — a normal invocation makes zero database writes; only `--apply` writes anything, and only after the dry-run output has been reviewed.

**What it does:** `operator-admin/scripts/refreshSeededVenues.ts` queries the Google Places API (New) for every venue in the selected market and compares Google's current data against the production row — `place_id`, Google operating status, `business_hours`, `phone`, `website_url`, `google_rating`, `google_review_count`, latitude/longitude, address/postal code, and `google_primary_type`/`google_types`. It reuses the existing proven Get-Place/Text-Search-fallback matching logic (place_id first, then name-similarity + geographic-distance-guarded text search) already used by `scripts/backfillMissingBusinessHours.ts`, `scripts/backfillGoogleRating.ts`, and `searchGooglePlace()` in the operator-submission flow — it does not reinvent that matching algorithm.

**What it explicitly does NOT do:**
- **Happy Hour data is out of scope.** `hh_times`, `hh_food_details`, `hh_drink_details`, and `hh_tagline` are never read for comparison and never written by this tool — Google Places has no concept of "happy hour." Happy Hour data still requires the separate manual Happy Hour certification workflow (see the Data Hygiene process used for the BTS Cocktail Bar & Kitchen pilot). The tool's CSV output exists to feed that workflow, not replace it.
- **`establishment_type` is never auto-updated.** It's a curated Happy Hour Compass product field, not a mirror of Google's `primaryType`/`types`. A mismatch is only ever surfaced as a review flag for a human to judge.
- **Geography is never auto-updated.** Latitude/longitude, address, and postal-code differences are always flag-only — a geographic mismatch can mean a bad Google match as easily as a stale DB value.
- Never touches `is_published`, `claimed_at`, `claimed_by`, `created_by_operator_id`, `updated_by_operator_id`, `source`, `placeholder_image_path`, media, editorial copy, payment/plan data, guides, or events. `--apply` only ever writes to venues where `source = 'seed' AND claimed_at IS NULL AND created_by_operator_id IS NULL` — once an operator can edit a venue from Operator Admin, this tool must never silently overwrite their data with Google's.
- Google `CLOSED_TEMPORARILY` / `CLOSED_PERMANENTLY` is never auto-actioned (no auto-unpublish, no delete) — only a prominent review flag.

**Output:** a console dry-run report (per-venue match method/confidence and field-by-field current-vs-Google-vs-proposed, plus a summary with proposed-change counts by field and a manual-review list), and a CSV **"Happy Hour review worksheet"** under `operator-admin/scripts/output/` (gitignored — production data snapshots are never committed). This CSV is the permanent working document for the manual Happy Hour review step of every market launch (run refresh → generate CSV → manual HH review, currently Wayne + ChatGPT → HH import → QA) — not a one-off report. One row per venue, columns grouped to follow that review workflow rather than the database schema: Identification → Google verification → Venue verification (current vs. Google phone/website/business hours, each with a status, plus establishment_type vs. Google's primary type as a flag) → Happy Hour **current** data in human-readable columns (`current_hh_schedule`, `current_food_1_name`/`_price`/`_notes` ×3, `current_drink_1_name`/`_price`/`_notes` ×3 — read-only, never JSON, never compared or modified by this tool) → Happy Hour **new** columns (`new_hh_schedule` as a single field, then `new_food_1_name`/`_price`/`_notes` ×3 and `new_drink_1_name`/`_price`/`_notes` ×3 — structured to exactly mirror the `current_*` item columns rather than free text, always blank on generation, filled in by hand during manual review — so a future HH import tool can map them deterministically into `hh_food_details`/`hh_drink_details` without parsing reviewer prose) → workflow (`manual_notes`, pre-seeded with this run's system review flags; `workflow_status`, blank by default — set by hand to e.g. "Not Started"/"In Review"/"Complete") → a trailing reference group of secondary system columns. Re-running the tool always regenerates a fresh snapshot — it does not read back or merge a previously hand-edited CSV, so save in-progress manual review work before re-running for the same market.
