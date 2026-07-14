# Business Funnel Product Blueprint

**Version:** 1.0 (canonical, supersedes workshop draft "v2")
**Date:** July 2026
**Status:** Approved – Canonical Reference for Business-Facing Pages

---

## Purpose

The **For Businesses** page (`/business`) is the primary sales page for Happy Hour Compass. It is the first impression venue owners have of the business side of the platform and establishes the visual and messaging language for all future business-facing pages, including:

- Claim Your Venue
- Pricing
- About
- Careers
- Future business landing pages

This page is not simply a marketing page. It is designed to build trust, reduce anxiety, and clearly communicate how Happy Hour Compass helps restaurants and bars attract more guests during slower periods.

This document is the canonical product reference for the Business Funnel. Future business-facing pages should be built as extensions of the direction set here, not as independent designs.

---

## Relationship to Existing Website Architecture

This is new territory in terms of page content, but almost none of it is new territory in terms of platform capability or navigation. Before any implementation, confirm the following are reused rather than rebuilt:

| Blueprint element | Existing implementation | Notes |
|---|---|---|
| `/business` route and footer entry | `WebsiteFooter.tsx` — "For Businesses" column already links to `/business` | The route is a placeholder today; this page fills it. No nav/footer changes are required. |
| "Claim or Create Your Venue" step | `/claim-your-venue` (instructional landing page) and `app/(website)/acquisition/ClaimVenueModalContent.tsx` / `AddVenueModalContent.tsx` | Every CTA and journey milestone referencing claiming or adding a venue must route into these existing flows, not a new form. |
| Business Login | `WebsiteFooter.tsx` → `/login` (operator admin, opens in new tab) | Reuse as-is for any "Business Login" affordance. |
| FAQ accordion + schema markup | `app/(website)/[market]/guides/[slug]/GuideFaqSection.tsx` (`<details>/<summary>`, `buildFaqPageSchema`) | See [FAQ section](#8-faq) below — generalize rather than rebuild. |
| Pricing tiers and feature limits | `src/lib/plans.ts` (`PLANS`, `maxUsers`, `maxImages`, `maxFoodSpecials`, `maxDrinkSpecials`, `maxSearchTags`) and `app/admin/subscription/ChangePlanModal.tsx` | See [Pricing section](#7-pricing) below — pull limits from this module rather than hand-typing them into marketing copy. |
| Contact Us / Add Venue modals | `app/(website)/acquisition/ContactUsModalContent.tsx`, `AddVenueModalContent.tsx` | Reuse for any "talk to us" or "add a new venue" affordance surfaced on this page. |

**Design language sequencing note:** `/claim-your-venue` already shipped (this branch, prior task) using a specific visual vocabulary — amber uppercase eyebrow label, amber pill-shaped primary CTA, numbered circular step badges. Since this page is meant to *establish* the business-facing design language, treat those existing choices as the starting input rather than inventing a separate system. If this page's design ultimately diverges from `/claim-your-venue`, restyle `/claim-your-venue` to match afterward so the two pages don't visually drift apart.

---

## Core Philosophy

We are not selling software. We are helping restaurants and bars attract more guests. The software is simply how that happens.

Everything on the page should reinforce one idea:

> Happy Hour Compass helps great venues get discovered.

---

## Target Audience

Restaurant owners. Bar owners. Managers. Hospitality groups.

This audience is:

- extremely busy
- constantly interrupted
- operationally focused
- skeptical of marketing
- skeptical of software
- value simplicity over feature count

They want answers quickly. They do not want marketing fluff.

---

## Brand Position

Happy Hour Compass is a discovery platform, not an advertising platform. Advertising interrupts. Discovery helps. Our customers come to Happy Hour Compass because they are actively looking for somewhere to go.

---

## Overall Tone

The page should feel:

- Premium
- Editorial
- Modern
- Trustworthy
- Helpful
- Honest
- Confident

Never:

- pushy
- corporate
- overly technical
- filled with marketing buzzwords
- sales-heavy

The page should feel more like an excellent magazine article than a SaaS sales page.

---

## Guiding Principle

Every section should answer one question while naturally introducing the next. Visitors should feel guided through a conversation rather than presented with a brochure.

---

## Page Psychology

The visitor's internal dialogue should progress like this:

```
Will this help my business?
        ↓
Is it complicated?
        ↓
Why should I trust you?
        ↓
Why are you different?
        ↓
Can I actually picture my business using this?
        ↓
Show me the product.
        ↓
What does it cost?
        ↓
Do I still have any concerns?
        ↓
I'm ready.
```

---

## Visual Philosophy

The page should never feel repetitive. Each section should introduce a new visual rhythm — hero, journey, illustrations, interactive product tour, pricing matrix, FAQ, CTA. Every section should feel like the next chapter.

### Visual asset types

Two distinct visual sections use two distinct asset types. Do not blur them together, and do not fabricate one to stand in for the other:

- **Illustration / iconography** — used in [Section 4 (Why Venues Choose)](#4-why-venues-choose-happy-hour-compass) and [Section 5 (More Guests Starts Here)](#5-more-guests-starts-here). These sections are conceptual and emotional, not literal proof of the product. Illustration is appropriate here.
- **Genuine product screenshots** — used in the [Hero](#1-hero) and required in [Section 6 (See Happy Hour Compass in Action)](#6-see-happy-hour-compass-in-action). These sections exist specifically to prove the platform is real and polished. Per the Website Vision's "Build Confidence Through Quality" principle, screenshots must reflect actual current product UI — never mockups standing in for the real thing.

### Note on Section 2 vs. Section 5

Section 2 ("How It Works") and Section 5 ("More Guests Starts Here") tell the same underlying three-part story — claim/create, set up, get discovered — at two different altitudes: Section 2 is the fast, functional, "that's it?" answer; Section 5 is the slower, aspirational, illustrated version of the same journey, extended with the emotional payoff ("Welcome More Guests"). This is intentional and should stay this way — it matches the page psychology's early "is it complicated?" beat followed by the later "can I picture my business succeeding?" beat. The two sections should never be reconciled into one, but copy for each should be written independently rather than lightly reworded from the other, so the repetition of structure doesn't read as repetition of content.

---

## Page Structure

### 1. Hero

**Purpose:** Immediately communicate what Happy Hour Compass is, who it is for, and why owners should care.

**Headline:**
> Put your happy hour and events in front of people already looking for somewhere to go.

**Supporting copy** should focus on: more visibility, local discovery, happy hours, events, attracting nearby customers.

**Primary CTA:** List Your Venue Free
**Secondary CTA:** See How It Works (scrolls to Section 2)

A polished, genuine product screenshot should immediately establish that this is a real platform.

---

### 2. How It Works

Keep this intentionally simple. Three steps only.

```
Claim or Create Your Venue
        ↓
Add Happy Hours & Events
        ↓
We Help Customers Discover You
```

The goal: "That's it?" Simple builds trust.

---

### 3. Why Happy Hour Compass Exists

Mission section. Explain why the platform was built.

**Key messaging:**

> Restaurants invest heavily in attracting dinner crowds, yet some of the most profitable hours of the day are often the hardest to fill. Happy Hour Compass exists to connect people looking for somewhere to go right now with venues already offering great happy hours, events, patios, and local experiences.

**This line is locked:**

> We're not asking venues to invent discounts. We're helping people discover the ones they already offer.

*(See also the related locked line in [Section 8](#8-faq) — the two express the same idea in different words for different moments on the page. If either is edited, check the other for drift.)*

---

### 4. Why Venues Choose Happy Hour Compass

Three personality-driven pillars. Each pillar should have its own illustration, a strong headline, a supporting paragraph, and concise supporting points.

**More Guests**
Reach people already searching for somewhere to go.

**Easy to Manage**
Updating your venue should take minutes — not hours.

**You're in Control**
You control specials, events, branding, and visibility. Nothing changes without you.

---

### 5. More Guests Starts Here

This is the emotional centrepiece of the page.

**Purpose:** Allow owners to picture themselves succeeding with Happy Hour Compass. This is not a feature section — it is an aspirational journey.

**Heading:** More Guests Starts Here

Supporting copy should explain that only a few simple milestones separate them from reaching more local customers.

**Desktop:** Horizontal illustrated journey.
**Mobile:** Vertical stacked journey.

**Journey milestones:**

```
Get Your Venue on Happy Hour Compass
   (Claim or Create)
        ↓
Make It Your Own
   Branding · Happy Hours · Events · Business Information
        ↓
We'll Help People Discover You
   Beautiful consumer experience · Local discovery · SEO · Happy hours · Events
        ↓
Welcome More Guests
   (the business outcome)
```

No numbers. No arrows in the visual treatment — the connecting line itself becomes the journey. Subtle scroll animations may progressively reveal each milestone.

---

### 6. See Happy Hour Compass in Action

**Purpose:** Prove the platform is polished, simple, and real.

This section introduces an interactive guided product tour — not a traditional carousel, but a story-driven slideshow: large screenshot, headline, supporting copy, business outcome, per tab.

**Tabs:** Get Started · Manage Specials · List Events · Measure Success

**Slide 1 — Get Started**
Headline: *Get your venue on Happy Hour Compass.*
Copy: Whether you're claiming an existing listing we've already created or adding a brand-new venue, getting started only takes a few minutes. Once approved, you'll have full control over your venue profile, happy hours, events, and business information.
Outcome: *Be online in minutes.*

**Slide 2 — Manage Specials**
Show the Happy Hour editor.
Outcome: *Keep your customers informed.*

**Slide 3 — List Events**
Show recurring events.
Outcome: *Turn first-time visitors into regulars.*

**Slide 4 — Measure Success**
Show analytics.
Outcome: *Make informed decisions as you grow.*

Every slide should communicate a business outcome — not simply describe software.

**Future enhancement:** Reserve space after the product tour for authentic social proof once available — operator testimonials, venue success stories, venue logos, customer quotes. Do not fabricate testimonials for launch.

---

### 7. Pricing

**Pricing Philosophy (LOCKED)**

The purpose of pricing is not to maximize upgrades. Its purpose is to remove the final barrier to joining Happy Hour Compass. Desired reaction:

> "I can get my venue on Happy Hour Compass this afternoon."

**Lead with reassurance.** Example messaging:

> Simple, Transparent Pricing
> Our Free plan is a permanent plan — not a free trial. There is no credit card required, no contracts, and no pressure to upgrade.
> Start for free today. Upgrade later if and when your business needs additional features.

**Use a familiar pricing matrix.** Three public columns: **Free, Pro, Premium.**

This matches existing product precedent, not a new invention: the operator admin's self-serve plan-change UI (`ChangePlanModal.tsx`) already limits self-serve plan selection to Free/Pro/Premium and deliberately excludes Enterprise, which is handled as a sales-assisted tier outside the self-serve flow. Carry the same boundary here — do not add a fourth public "Enterprise" column. Larger operators or restaurant groups should be routed to a sales-assisted path (see the multi-location FAQ answer in Section 8) rather than a self-serve Enterprise tile.

**Do not reinvent pricing presentation.** Users already understand pricing tables. The Free plan is a legitimate permanent plan — not a marketing tactic. Do not apologize for Free. Do not artificially emphasize Free. A subtle badge such as "Great Place to Start" is acceptable.

**Implementation note:** Feature limits shown in the matrix (team seats, image counts, food/drink special counts, search tags, analytics tier, discover placement) must be pulled from `src/lib/plans.ts` (`maxUsers`, `maxImages`, `maxFoodSpecials`, `maxDrinkSpecials`, `maxSearchTags`, `analyticsTier`, `canUseDiscoverPlacement`, etc.) rather than re-typed as static marketing copy. This is the same source of truth `ChangePlanModal.tsx` already reads from — pulling the public pricing table from the same module guarantees the marketing page and the operator admin's actual plan-change screen can never quietly disagree.

---

### 8. FAQ

**Purpose:** Remove the final hesitations. Questions should answer genuine hospitality concerns.

**Initial FAQ list:**

- What's the difference between claiming a venue and adding a new one?
- How long does approval take?
- Can I update my happy hours and events anytime?
- How do I know Happy Hour Compass is actually bringing me customers?
- What if I manage multiple locations or a restaurant group? *(Route toward a sales-assisted / Enterprise conversation here — see [Pricing](#7-pricing).)*
- Are we locked into a long-term contract?
- Will Happy Hour Compass only attract customers looking for discounts?
- Why should I use Happy Hour Compass if I already use social media?

**One key answer is locked:**

> You're not creating additional discounts or reducing your margins. You're simply making it easier for people to discover the happy hours and events you already offer.

**Another key positioning statement:**

> Happy hour may introduce someone to your venue, but it's your food, drinks, service, and atmosphere that turn first-time visitors into regulars.

**Implementation note:** Reuse the accordion pattern already built for guide FAQs (`app/(website)/[market]/guides/[slug]/GuideFaqSection.tsx`) rather than building a new one. That component already solves the two things this section needs — a native `<details>/<summary>` accordion (no client JS, full keyboard/SEO support) and `FAQPage` JSON-LD schema via `buildFaqPageSchema`. Its current type (`GuideFaqAnswer`) carries a guide-specific `relatedGuideSlug` cross-link that doesn't apply here; generalize the shared component to accept a plain `{question, answer}[]` shape (with the guide cross-link as an optional field) rather than duplicating the accordion markup and schema logic for this page.

---

### 9. Final CTA

**Purpose:** End with optimism rather than urgency.

**Headline:**
> Ready to become someone's new favourite local spot?

**Primary CTA:** List Your Venue Free
**Secondary CTA:** Claim Your Venue *(links to the existing `/claim-your-venue` page, not a new flow)*

No aggressive sales language. Simply invite the owner to take the next step.

---

## CTA Label Glossary

Because this page sets the language for every future business-facing page, its CTA labels should be treated as the fixed vocabulary those pages reuse rather than each page inventing its own variant:

| Label | Role | Destination |
|---|---|---|
| List Your Venue Free | Primary CTA | Add-venue flow (`AddVenueModalContent.tsx`) or equivalent onboarding entry point |
| See How It Works | Secondary CTA (hero only) | In-page scroll anchor to Section 2 |
| Claim Your Venue | Secondary CTA (final CTA only) | `/claim-your-venue` |
| Business Login | Utility link (footer-level, not a page CTA) | `/login`, opens in new tab |

Future business pages (Pricing, About, Careers) should reuse "List Your Venue Free" as the primary CTA rather than introducing new phrasing like "Get Started Free" or "Sign Up Now."

---

## Design Principles (LOCKED)

- One clear message per section.
- One question answered per section.
- Large amounts of whitespace.
- Editorial pacing.
- Premium typography.
- Genuine product screenshots.
- Calm, confident design.
- Business outcomes over software features.
- Discovery over advertising.
- Trust over urgency.
- Simplicity over feature overload.
- Honest messaging over marketing hype.

---

## Product Principles (LOCKED)

- We are selling more guests, not software.
- We help venues get discovered — we don't interrupt customers with advertising.
- Restaurant owners value simplicity more than feature count.
- The Free plan is part of the product strategy — not a marketing tactic.
- Mobile management is table stakes for hospitality.
- Every interaction should reduce anxiety and build trust.
- The page should feel like a guided conversation, not a brochure.

---

## Open Follow-Ups / Roadmap Signals

Items surfaced during this blueprint that are product/roadmap signals rather than page copy, and should not be implemented as literal on-page text:

- **Mobile management priority.** Operator feedback confirms mobile management is table stakes and should become a roadmap priority. This belongs in the product roadmap, not inside the "Easy to Manage" pillar's customer-facing copy. Track it as a roadmap item per the Playbook's Drift Prevention rule; write the pillar's actual copy around current, shipped capability.
- **Social proof placeholder.** Section 6 reserves space for testimonials/logos once real ones exist. Do not fabricate these for launch; revisit this document once authentic social proof is available.
- **`/claim-your-venue` visual reconciliation.** If this page's shipped design differs from `/claim-your-venue`'s existing amber/pill/numbered-badge treatment, restyle `/claim-your-venue` to match afterward (see [Relationship to Existing Website Architecture](#relationship-to-existing-website-architecture)).
