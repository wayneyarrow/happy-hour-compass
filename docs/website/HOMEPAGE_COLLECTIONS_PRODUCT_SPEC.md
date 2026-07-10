# Homepage & Collections Product Specification

**Status:** Approved — Canonical Reference
**Supersedes:** Draft V1 of this document

## Purpose

This document defines the product philosophy, information architecture, and editorial workflow for Collections and Homepages within Happy Hour Compass.

It intentionally focuses on product behavior and editor experience rather than implementation details. Where this document differs from earlier drafts, it reflects the finalized architecture and should be treated as authoritative.

---

## Vision

The Happy Hour Compass website is an editorial discovery platform.

The homepage should never be manually populated with individual venues, events, or guides. Instead:

- Editorial content is organized into reusable **Collections**.
- **Homepages** assemble those Collections into a curated discovery experience.
- Collections become reusable assets that can power multiple parts of the website over time.

This architecture allows the website to scale across markets, cities, and future discovery surfaces without duplicating editorial work.

---

## Overall Philosophy

The system consists of three distinct layers:

```
Content
   ↓
Collections
   ↓
Homepages
```

- **Content owns information.**
- **Collections own editorial curation.**
- **Homepages own presentation.**

Guiding rules:

- Content never knows where it is displayed.
- Homepages never own content directly.
- Collections are reusable editorial assets.

If editorial content changes, editors update the Collection — not every Homepage that uses it.

---

## Content

Content includes:

- Venues
- Events
- Guides

Content is created and maintained in its own management area. Content owns:

- Details
- Metadata
- Images
- Publishing
- Geography

Content never knows which Collections it belongs to. This one-directional reference (Collection → Content, never the reverse) keeps content management fully decoupled from merchandising decisions.

---

## Collections

Collections answer one question:

> What content belongs together?

Examples:

- Spotlight Venues
- Patio Picks
- Highly Rated
- Featured Nearby
- New This Week
- Featured Events

Collections own:

- Membership
- Algorithm
- Manual Boosts
- Include
- Exclude
- Ordering

Collections do not own presentation, and do not determine where they appear. Collections are reusable editorial assets — the same Collection may be assigned to multiple Homepage Sections across different geographies without duplicating curation work.

### Collection Types (V1)

Collections are intentionally limited to a single content type in V1. Supported types:

- Venue Collection
- Event Collection
- Guide Collection

Mixed Collections (spanning multiple content types within a single Collection) are intentionally deferred — see Future Considerations.

### Collections and Discover Management

The existing Discover Management logic — algorithmic rail selection, internal boosts, includes, and excludes for venues and events — **evolves into the first implementation of Collections rather than being replaced.** The current rail engine already implements the core Collection behaviors (algorithmic membership plus manual overrides); Collections generalize this proven model across content types and give it a consistent geography-aware, reusable structure rather than rebuilding curation logic from scratch.

### Collection Reuse

Collections are designed to be reusable beyond the homepage. The same Collection should eventually be usable by:

- Homepages
- Mobile Apps
- Email
- Campaigns
- Future surfaces

Reuse applies to curation and membership logic. Presentation across fundamentally different mediums (web, email, push) is expected to require medium-appropriate rendering — reuse of *what belongs together* does not imply an identical visual treatment everywhere it's used.

### Collection Usage & Deletion Protection

Because Collections are designed to be reused across multiple Homepages and surfaces, deleting or unpublishing a Collection should eventually provide **usage visibility** (which Homepages/Sections currently reference it) and **deletion protection** before removal, so an editor cannot silently break a live Homepage by editing a shared asset. This mirrors the existing "in use" protection already applied to FAQ Library questions.

---

## Geography

Geography is a first-class concept throughout the platform. Every major object is geography-aware.

### Content

Every Venue, Event, and Guide belongs to a geography:

- Market
- City
- (Future) Neighbourhood

### Collections

Every Collection belongs to a geography — for example, Kelowna, Greater Vancouver, Victoria, or Calgary.

- **Market Collections** may include content from any city within that market.
- **City Collections** should contain only content from that city.

Collections should never mix unrelated geographies.

### Homepages

Every Homepage belongs to a geography — for example, the Greater Vancouver Homepage, the Kelowna Homepage, or the Burnaby Homepage. Homepages are created for a specific geographic scope.

---

## Information Architecture

```
Content

Venue
        \
Event -----> Collection
        /
Guide

  ↓

Homepage

  ↓

Sections

  ↓

Collection
```

A Homepage references Collections through Sections. Collections reference Content. Content never knows which Collections it belongs to.

---

## Homepages

Homepages are first-class editorial objects. They own:

- Geography
- Status (Draft / Published)
- SEO
- Preview
- Metadata (Name, Created Date, Last Updated, Created By)

Homepages never own content directly. Instead, they assemble published Collections into a structured, geography-specific editorial experience.

---

## Homepage Workflow

```
Homepage List
   ↓
Create Homepage
   ↓
Choose Geography
   ↓
Generate Homepage Template
   ↓
Assign Collections
   ↓
Preview
   ↓
Publish
```

The Homepage List page intentionally mirrors the Guides management experience for consistency — editors who already know how to find, create, and manage Guides should immediately understand how to find, create, and manage Homepages.

Collections available for assignment automatically filter by:

- Geography
- Collection Type
- Published Status

This prevents editors from selecting inappropriate or incompatible Collections.

---

## Homepage Templates

Every Homepage begins from a standard template. Editors never begin with a blank page.

Example default template:

- Hero
- Featured Venues
- Featured Events
- Featured Guides
- Explore Nearby

Templates are **editable starting points, not locked structures** — an editor can adjust which Sections a given Homepage includes after creation. Templates exist to ensure consistency, better UX, faster creation, and easier maintenance, not to constrain every Homepage to an identical shape forever.

Additional capabilities such as new Section types, drag-and-drop reordering, or richer layout options are intentionally deferred from V1 — see Future Considerations.

---

## Homepage Sections

A Homepage is composed of Sections. Each Section contains:

- **Section Type** (e.g. Hero, Featured Venues, Featured Events, Featured Guides, Explore Nearby)
- **Editable Public Title** — the heading shown to visitors, fully editable independent of the Section Type's internal name
- **Assigned Collection**
- **Display Order**
- **Enabled / Disabled**

The Section Type determines:

- Which Collection types are compatible with that Section (e.g. a Featured Venues section only accepts a Venue Collection)
- Which rendering component is used
- Which card type is used
- Where the Section's "View All" link points

**Example:**

| Section Type | Compatible Collection Type | Card Type | View All Destination |
|---|---|---|---|
| Featured Venues | Venue Collection | Venue card | Venue Search Results |
| Featured Events | Event Collection | Event card | Event Search Results |
| Featured Guides | Guide Collection | Guide card | Guide Listing |

A Section with no assigned Collection, or an assigned Collection with no eligible members, does not render publicly — empty sections are simply omitted rather than shown blank.

---

## Homepage Fallback

Approved V1 behavior:

- If a City Homepage exists for the visitor's geography, use it.
- Otherwise, use the parent Market Homepage.

Section-level inheritance (e.g. a City Homepage automatically borrowing individual Sections from its parent Market Homepage while defining others itself) is intentionally deferred until a genuine business need exists. V1 fallback operates at the whole-Homepage level only.

---

## Collection Landing Pages

"View All" links reuse existing public browsing experiences rather than introducing new browsing UI:

```
Venue Collection   →  Venue Search Results
Event Collection   →  Event Search Results
Guide Collection   →  Guide Listing
```

No new browsing UI should be created for V1. A dedicated, SEO-supported public landing page per Collection (e.g. a "See All: Patio Picks" page with its own URL) remains a possible future evolution — see SEO, below — but is not required for V1's "View All" behavior.

---

## SEO

Every public URL receives SEO. Examples include:

- Homepages
- Guides
- Venue Pages
- Event Pages
- Search Results
- Future Collection Landing Pages

Collections themselves are editorial assets and therefore do not require SEO. If a Collection eventually gains its own public landing page (see Collection Landing Pages, above), that page should receive full SEO support at that time.

---

## Admin Navigation

Collections and Homepages each have their own dedicated management pages within the Control Panel:

- Guides
- FAQ Library
- Collections
- Homepages

Grouped or nested navigation is intentionally avoided until the Control Panel's surface area grows further. For now, simplicity is preferred over premature information architecture.

---

## Future Considerations

The following ideas are intentionally deferred from V1. They are documented here as approved future direction, not as current implementation requirements.

### Metro Markets

The Market → City → Neighbourhood geography model already supports this future evolution without requiring architectural change:

- **Market** — operational and analytics boundary; already the top-level geography for Collections and Homepages.
- **City** — the primary consumer-facing unit; already supported today.
- **Neighbourhood** — deferred, but the geography model already reserves this tier so it can be enabled per-city later without a schema migration.

### Homepage Evolution

Potential future capabilities:

- Drag-and-drop Sections
- Duplicate Sections
- Additional Section Types
- Editorial Callouts
- Promotions
- Newsletter Blocks
- Seasonal Sections
- Personalized Sections

### Collection Evolution

Potential future capabilities:

- Mixed Collections (spanning multiple content types — e.g. an editorial idea like "Date Night" or "This Weekend" that naturally wants both venues and events together)
- Global Collections (spanning multiple markets, for cross-market or national campaigns)
- Scheduling
- Personalization
- AI-assisted Collections
- Analytics
- Campaign Collections

---

## Guiding Principles

- Reuse over duplication.
- Geography is first-class.
- Collections own editorial curation.
- Homepages own presentation.
- Content never knows where it is displayed.
- Homepages never own content directly.
- Collections are reusable editorial assets.
- Discover Management evolves into Collections rather than being replaced.
- Every Homepage begins from an editable template — editors never start from a blank page.
- Homepage creation follows the same philosophy established by Guide creation.
- City Homepages take precedence; Markets provide fallback coverage.
- Section Type determines rendering, card type, and compatible Collection type.
- Build for future scalability without overengineering.
- Anything with a public URL requires SEO.
- Editors should always be guided toward the correct choices through filtered, geography-aware workflows.
