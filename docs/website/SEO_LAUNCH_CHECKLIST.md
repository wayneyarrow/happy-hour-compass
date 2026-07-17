# SEO Launch-Day Checklist

Actions to take immediately before and after the public website goes live. This is an operational runbook, not a status document — see `docs/website/SEO_ROADMAP.md` for what's already been built and verified, and why each item below matters.

Every item below should be checked against the **real production domain**, not staging or local — several of these (indexing, robots.txt, environment variables) are specifically about behavior that only differs in production.

---

## Before Launch

- [ ] **Verify production environment variables.** `NEXT_PUBLIC_SITE_URL` must be set to the real production domain, and `NEXT_PUBLIC_NOINDEX` must be **absent** (or explicitly `false`) on the Production Vercel environment — never carried over from staging. Both are `NEXT_PUBLIC_*` vars, inlined at build time: confirm the values are correct *before* triggering the production build/deploy, not after.
- [ ] **Confirm production indexing is enabled.** With the above env vars correct, `shouldNoIndex()` should return `false` in production. Spot-check a real page's rendered `<head>` for the absence of `<meta name="robots" content="noindex">`.
- [ ] **Confirm `robots.txt`.** Fetch the real production `/robots.txt` and confirm it shows the production allow-list (`Allow: /` plus the admin/control-panel/api/auth disallow list), not the staging `Disallow: /`.
- [ ] **Confirm `sitemap.xml`.** Fetch the real production `/sitemap.xml` and confirm it resolves, lists the expected static pages, and its `Sitemap:` line in `robots.txt` points at the correct production URL.
- [ ] **Verify canonical URLs.** Spot-check canonical tags on the homepage and one of each content type (venue, event, guide, collection) — confirm each resolves to the correct production domain and, for the homepage specifically, that it's `/` (not a per-market/city path).
- [ ] **Verify homepage metadata.** Confirm the homepage's title, description, Open Graph tags (including image), and Twitter Card all render correctly on production, for the market a first-time visitor actually lands on.
- [ ] **Verify structured data.** Run the homepage and one of each content type through Google's Rich Results Test / Schema Markup Validator against the live production URL. Confirm no errors, and that Organization/WebSite appear on every page (rendered sitewide from the layout).
- [ ] **Verify Open Graph preview.** Use a real link-preview tool (e.g. Facebook's Sharing Debugger, Twitter's Card Validator, or simply pasting the URL into Slack/iMessage) against the live production homepage and at least one venue/event/guide page. Confirm an image actually renders — don't rely on the `<meta>` tag alone, since some previewers cache or fail silently on certain image formats/sizes.
- [ ] **Verify only intended markets are public.** As of the last SEO review, this needs active attention, not just a glance: confirm which markets are marked `status: "active"` in `src/lib/markets.ts`, and separately confirm the actual sitemap output only includes content from those markets. The sitemap's market gating today only covers the guide-library index page — venues, events, guides, and collections are included by publish status alone, regardless of market. If Central Okanagan is meant to be the only live market, verify Greater Vancouver (and any other non-launch market) content is not present in the production sitemap and does not resolve to indexable pages before flipping indexing on. See `SEO_ROADMAP.md`'s "Known Gaps" section.
- [ ] **Verify no test content remains.** Specifically check for seed/placeholder venues in non-launch markets (a `coming_soon`-market test venue was found live in the sitemap during the final review) and confirm nothing with an obviously fake name, address, or venue type is published and public.
- [ ] **Confirm Search Console property.** Verify (or set up) the Search Console property for the real production domain. No verification artifact exists in the codebase today, so this needs to be confirmed as a manual/external step — not assumed complete because other SEO infrastructure is in place.

---

## Immediately After Launch

- [ ] **Submit the sitemap** in Search Console for the production domain.
- [ ] **Request indexing for the homepage** via Search Console's URL Inspection tool.
- [ ] **Request indexing for priority pages** — a representative sample of venue, event, guide, and collection pages, plus About/Business/Careers/Claim Your Venue.
- [ ] **Validate Search Console coverage** over the following days — confirm pages are being discovered and indexed, and that nothing unexpected shows up as "Excluded" that should be indexable (or vice versa).
- [ ] **Check `robots.txt` live** one more time post-deploy, after DNS/domain changes have propagated — confirm it's still serving the production ruleset from the actual production domain, not a cached or misrouted response.
- [ ] **Validate structured data** again post-deploy using the same tools as the pre-launch check, this time against the final live domain (URLs and asset paths can differ subtly from a pre-launch preview deployment).
- [ ] **Validate social previews** again post-deploy for the same reason — confirm Open Graph images resolve correctly from the final production domain.
- [ ] **Monitor crawl/index status** in Search Console for the first 1–2 weeks — watch for unexpected drops, spikes, or exclusions.
- [ ] **Monitor Search Console errors** — coverage errors, mobile usability issues, and any structured data warnings that didn't surface in pre-launch spot-checks.
- [ ] **Monitor 404s** — via Search Console's Page Indexing report and/or server logs. Pay particular attention to whether any *internal* link on the site is producing a 404 (a real bug) versus external/historical links to since-removed content (expected, lower priority).

---

## Reference

- `docs/website/SEO_ROADMAP.md` — full implementation status, intentional deferrals, and the one known pre-launch gap this checklist's market-verification item exists to catch.
- `CLAUDE.md`'s **SEO & Metadata** section — implementation rules, in case anything above surfaces a fix that needs to be made before re-checking.
