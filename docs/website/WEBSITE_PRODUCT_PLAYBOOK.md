# Happy Hour Compass Website Product Playbook

**Version:** 1.0  
**Date:** June 2026  
**Status:** Living Product & Build Guide

---

## Purpose

This playbook captures practical product, UX, design, and build decisions for the Happy Hour Compass public website.  
The Website Vision & Design Principles document defines the philosophy.  
This playbook defines how we apply that philosophy during real implementation.  
This is a living document. It should be updated whenever a meaningful website product decision is made.

---

## Core Operating Principle

The Happy Hour Compass website is the public front door to an existing product engine.  
It should not invent a separate product.  
It should reveal, elevate, and extend the product capabilities already built underneath.

---

## Website Build Governance

Every significant public website task should begin by reviewing:

- `docs/website/WEBSITE_VISION_AND_DESIGN_PRINCIPLES.md`
- `docs/website/WEBSITE_PRODUCT_PLAYBOOK.md`

Before implementation, Claude should confirm how the task supports these documents.  
If a requested implementation conflicts with these principles, Claude should stop and explain the conflict before writing code.

---

## Design Brief Requirement

Website implementation tasks should be treated as design briefs, not generic coding tasks.  
Each significant website task should include:

- Objective
- User problem
- Design intent
- Existing capabilities to reuse
- Constraints
- Success criteria
- Deliverables

This prevents implementation from drifting away from the product vision.

---

## Reuse Hierarchy

The public website should maximize reuse of the existing product engine while presenting it in a premium, responsive public website experience.

### Tier 1 — Reuse Exactly

These should never be duplicated:

- Discover Engine
- Featured Events Engine
- Market selection and geolocation
- Venue detail data
- Event detail data
- Guides
- Authentication
- Operator onboarding flows
- APIs
- Analytics
- Shared business logic

If the product engine improves, the website should improve automatically.

### Tier 2 — Reuse and Enhance

These should reuse the same data, logic, and component patterns, but evolve the presentation for a larger responsive canvas:

- Venue cards
- Event cards
- Search
- Filters
- Discovery rails
- Collections

The website version should feel like the desktop evolution of the mobile experience, not an unrelated redesign.

### Tier 3 — Website Only

These exist because the public website has different goals than the consumer app:

- Homepage hero
- Website navigation
- Website footer
- SEO landing pages
- Market landing pages
- Business acquisition pages
- Editorial content
- Company pages
- Trust and social proof sections
- Conversion funnels

---

## Reuse Decision Rule

Never rebuild what already exists.  
First ask:

> How do we present this existing capability better on desktop and responsive web?

Only create new UI when the existing product does not already contain the capability.

---

## Product Engine Rule

Never design ahead of the product engine.  
Do not create homepage widgets, filters, chips, or claims that are not backed by current product capabilities or reliable data.  
The website should showcase mature product capabilities first.

---

## Search Philosophy

Search is one of the website's signature interactions.  
Search should feel smart, fast, and useful.  
The desired direction is closer to Spotlight search than a traditional submit-and-wait search form.  
Search should help users quickly find:

- Restaurants and bars
- Happy hours
- Events
- Collections
- Guides
- Neighbourhoods or markets when available

Search should make Happy Hour Compass feel intelligent.

---

## Search Shortcuts vs Discovery Rails

Do not confuse search shortcuts with discovery rails.

### Search Shortcuts

Search shortcuts help users who already know what kind of result they want.  
Examples already used in the consumer app:

- Happening Now
- Near Me
- Open Now
- Sports Bars
- Fine Dining
- Under $10

These should only be used if backed by existing product logic.

### Discovery Rails

Discovery rails inspire users who do not yet know what they want.  
Examples:

- Spotlight
- Patio Picks
- Featured Events
- Highly Rated
- New This Week

Discovery rails should be powered by the Discover Engine and existing curation logic.

---

## Homepage Direction

The homepage should primarily help users discover where to go tonight.  
It should not begin as a traditional marketing landing page.  
The homepage should quickly move users into:

- Search
- Search shortcuts
- Discovery rails
- Featured venues
- Featured events
- Curated collections

The homepage should feel like the beginning of the product, not an introduction to the product.

---

## Navigation Direction

Website navigation should be simple and discovery-oriented.  
Current direction:

- Restaurants & Bars
- Guides
- For Businesses
- Sign In

Markets should be treated as context, not primary navigation.  
Market selection should appear near search or as a contextual location control.

---

## Homepage Copy Direction

**Primary promise:**  
Find the best happy hour nearby.

**Emotional hook:**  
Never ask "Where should we go?" again.

**Current preferred hero order:**  
Never ask "Where should we go?" again.  
Find the best happy hour nearby.

Copy should be concise, useful, and focused on helping users take action.

---

## Data Quality Rule

Do not over-feature fields that are present but not consistently high quality.

Example:  
Happy hour taglines exist, but seeded venue taglines may not be strong enough to carry homepage cards yet.  
Operator-written taglines may become more valuable after more venues are claimed.  
Use weaker or inconsistent fields as supporting details, not primary homepage drivers.

---

## Search Tags Caution

Operator search tags are a paid-plan feature.  
Because early launch may have few or no paid venues, homepage discovery should not depend primarily on operator-selected search tags.  
Use seeded tags, establishment type, rail logic, existing filters, ratings, events, and other mature data first.

---

## Market Philosophy

Markets are essential context.  
They should help users understand where they are browsing.  
Markets should not overwhelm the homepage or become primary navigation unless needed.  
The website should feel local without feeling fragmented.

---

## Website Cards

Website venue and event cards should evolve from the existing consumer app cards.  
They should reuse the same core data and interaction logic while improving presentation for desktop and responsive web.  
Website cards should generally preserve the same product expectations as the app:

- Image
- Venue or event name
- Relevant summary
- Status badges where appropriate
- Rating or trust signal where appropriate
- Distance or market context where appropriate
- Save or action affordance where appropriate

The website card should feel like the same product on a larger canvas.

---

## Experience-Based Thinking

Do not think only in pages.  
Think in user experiences.  
Key public website experiences include:

- **Landing Experience** — turn visitors into explorers.
- **Discovery Experience** — help users find something that sounds good.
- **Decision Experience** — help users confidently choose where to go.
- **Venue Experience** — provide everything needed before heading out.
- **Operator Experience** — convert restaurants and bars into customers.

Pages should serve these experiences.

---

## Drift Prevention

Ideas from planning sessions must become one of three things:

1. A documented principle.
2. A roadmap item.
3. A Claude task.

If an idea is not captured in one of those places, it should not be considered retained.

---

## Claude Task Guardrail

Every significant public website Claude task should include this guidance:

Before writing code:

- Review `docs/website/WEBSITE_VISION_AND_DESIGN_PRINCIPLES.md`
- Review `docs/website/WEBSITE_PRODUCT_PLAYBOOK.md`

The implementation should:

- Reuse existing platform capabilities wherever possible.
- Avoid rebuilding business logic.
- Build a premium responsive public website experience.
- Prioritize helping visitors decide where to go tonight.
- Avoid creating UI that is not backed by mature product data.
- Preserve separation between Public Website, Consumer App, Operator Admin, and Founder Control Panel.

If the requested implementation conflicts with these principles, stop and explain why before writing code.

---

## Final Rule

The website should not drift into a generic startup website.  
Whenever there is uncertainty, ask:

> Does this help make Happy Hour Compass the best happy hour discovery homepage on the internet?
