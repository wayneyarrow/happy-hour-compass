# CONTENT_ENGINE_PRODUCT_SPEC.md

## 1. Overview

The Happy Hour Compass Content Engine is a publishing module within the Admin Control Panel.

It enables platform administrators to rapidly create, manage, publish, distribute, and optimize editorial content across the Happy Hour Compass website.

The Content Engine is not a traditional CMS or blogging platform.

Its purpose is to make high-quality content creation systematic, scalable, and SEO-focused while leveraging the structured data already contained within the Happy Hour Compass platform.

The Content Engine initially focuses on publishing Venue Guides and Event Guides, but is designed to evolve into the publishing engine for all editorial content across the website.

## 2. Vision

The Content Engine exists to support five primary goals:

- Build long-term organic SEO traffic.
- Increase consumer discovery of venues and events.
- Strengthen the Happy Hour Compass brand as the authority on happy hours and local experiences.
- Make publishing fast, repeatable, and easy for non-technical users.
- Scale content creation across hundreds of cities without dramatically increasing workload.

Editors provide:

- The content idea.
- Editorial copy.
- Images.
- Curated venue or event selections.

The platform automatically provides:

- Live venue/event data.
- SEO generation.
- URL generation.
- Internal linking.
- Publishing.
- Distribution.
- Consistent presentation.

The objective is simple:

Publishing a professional, SEO-optimized guide should take minutes—not hours.

## 3. Admin Control Panel Integration

The Content Engine lives entirely inside the Admin Control Panel.

Proposed navigation:

```
Website
    Dashboard
    Homepage Management
    Discover Management
    Content Engine
```

The Content Engine becomes the central location for:

- Venue Guides
- Event Guides
- Draft management
- Publishing
- Scheduling
- SEO management
- Distribution eligibility

Content creation never requires code changes.

Platform administrators should be able to publish and manage website content entirely through the Control Panel.

## 4. Editorial Principles

(Our nine principles.)

## 5. V1 Scope

Two guide types only.

- Venue Guides
- Event Guides

Future guide types will use the same publishing engine.

## 6. Guide Creation Experience

The Content Engine should present a single, structured publishing page.

It is not a page builder.

It is not a blogging editor.

It is a guided publishing experience designed to minimize decisions.

The editor has already:

- Identified the content opportunity.
- Written the editorial copy.
- Selected images.

The Content Engine assembles the final guide.

Every major section should include a visual completion indicator.

## 7. Publishing Workflow

Sections:

- Guide Type
- Guide Details
- Content
- Related Venues / Events
- FAQ
- Distribution
- SEO
- Preview
- Publishing

No wizard.

One page.

Logical sections.

Auto-save (future enhancement).

## 8. Guide Details

Include:

- Guide Type
  - Venue Guide
  - Event Guide
- Market
- City
- Neighbourhood (optional)
- Guide Title
- Primary Keyword
- Secondary Keywords
- Hero Image

## 9. Content

- Introduction
- Body
- FAQ

Structured editing only.

No HTML editing.

No drag-and-drop builder.

No custom layouts.

The Content Engine controls presentation.

## 10. Live Platform Data

Venue Guides reference live venue records.

Event Guides reference live event records.

Editors select venues/events from searchable dropdowns.

Guides never duplicate platform data.

## 11. SEO Automation

The editor provides:

- Primary Keyword
- Secondary Keywords
- Guide Title
- Editorial copy

The Content Engine automatically generates:

- URL
- Page Title
- Meta Title
- Meta Description
- Open Graph metadata
- Canonical URL

Every generated field displays:

Generated From

For example:

```
Meta Title

Generated From

✓ Primary Keyword

✓ Guide Title

✓ City
```

Editors may override any generated value.

Automation should eliminate work—not remove editorial control.

## 12. Images

One Hero Image.

Automatically reused for:

- Card
- Social
- Thumbnail

Future versions may support overrides.

## 13. Distribution

The Content Engine determines eligibility.

Discover Management determines merchandising.

Editors specify where a guide is eligible to appear.

Examples:

- Guides Library
- Central Okanagan Homepage
- Kelowna Homepage

Those selections make the guide available within Discover Management.

Homepage ordering, featured placement, and prioritization remain managed entirely through Discover Management.

The relationship is intentionally:

Content Engine creates. Discover Management merchandises.

## 14. Related Guides

Editors select related guides using searchable dropdowns.

Priority should favour guides from the same city or market.

## 15. Preview

- Desktop preview.
- Mobile preview.

Exactly matches the public website.

## 16. Publishing

Supported states:

- Draft
- Publish Now
- Scheduled
- Expired

Publishing options:

- Publish Date
- Expiry Date

## 17. Website Integration

V1

- Guides Library.
- Footer guide links.
- Homepage guide sections.

Future versions may surface guides on:

- Search pages
- Venue pages
- Event pages
- Marketing landing pages
- Email campaigns
- Push notifications

## 18. AI Philosophy

The Content Engine is not responsible for generating content ideas.

Editors determine content strategy outside the platform.

AI exists to reduce repetitive work.

Examples:

- Generate SEO metadata.
- Explain generated SEO fields.
- Suggest internal links.
- Identify missing references.
- Recommend related guides.
- Flag opportunities for optimization.

Future AI Agents may monitor performance and proactively recommend updates based on search rankings, CTR, and content freshness.

## 19. Future Roadmap

Future guide types:

- Neighbourhood Guides
- Seasonal Guides
- Holiday Guides
- Operator Spotlights
- Itineraries
- Collections

Future capabilities:

- Performance analytics
- Search ranking tracking
- AI optimization agents
- Revision history
- Multi-author support
- Advanced taxonomy
- Guide search and filtering
