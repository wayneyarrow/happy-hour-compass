# Happy Hour Compass — Consumer Experience PRD

## Search & Decision Experience

### Purpose

This document captures the agreed product direction for the Happy Hour Compass consumer website before implementation.

The objective is to design the consumer experience first, then implement one experience at a time.

---

## Product Vision

The Happy Hour Compass website is not a marketing website.
It is not a directory.
It is not simply a discovery platform.

Happy Hour Compass is a decision engine.

The purpose of every consumer-facing experience is to help users confidently decide where to go for happy hour.

Discovery is one path to that decision.
Search is another.
Maps are another.
Editorial content is another.

Every experience ultimately supports the same outcome:

> **Help me confidently choose where to go.**

---

## Customer Journey

Through discussion and real-world beta testing, the primary customer journey has been refined to:

```
Market
  ↓
Proximity
  ↓
Time
  ↓
Rating
  ↓
Happy Hour Offer
  ↓
Decision
```

This hierarchy should guide all future consumer product decisions.

---

## Homepage Philosophy

The homepage exists to inspire discovery.

It is intentionally simple and should immediately begin the product experience.

The homepage should include:

- Hero
- Search
- Search shortcuts
- Discovery rails

The homepage should not attempt to expose the full power of search. That belongs to the Search Results experience.

---

## Discovery vs Decision

Two distinct product modes have been established.

### Discovery Mode

**Purpose:** Help users explore possibilities.

**Primary experiences:**
- Homepage
- Discovery Rails
  - Featured Tonight
  - Patio Picks
  - Highly Rated
  - Editorial Guides

The homepage encourages exploration.

### Decision Mode

**Purpose:** Help users confidently choose a venue.

**Primary experiences:**
- Search
- Map
- Filters
- Sorting
- Search Results
- Venue Detail

Once the user begins searching or selects a shortcut, they transition into Decision Mode. Discovery gives way to refinement.

---

## Search Philosophy

Homepage search is not the final destination.

The homepage search should:

- Accept search input
- Provide intelligent suggestions
- Transition users into the Search Results experience

The search interaction may be inspired by Apple Spotlight. However, the search destination is a dedicated Search Results page rather than an expanding homepage search interface.

---

## Search Results Experience

The Search Results page becomes the primary workspace for consumers making a decision.

The interaction model should closely follow Airbnb's proven search experience.

**Key characteristics:**
- Large interactive map
- Scrollable results list
- Hover synchronization between cards and map pins
- Moving or zooming the map updates visible results
- Cards scroll independently while the map remains fixed
- Desktop prioritizes both map and list equally

This is not considered copying. It is adopting a proven interaction model for a similar user problem.

---

## Maps

Maps are a primary navigation tool. They are not supplementary.

Users naturally explore geography. The map becomes the user's proximity selector.

Panning and zooming replace the need for explicit neighbourhood filters.

---

## Neighbourhood Strategy

Neighbourhoods should not be implemented as primary search filters.

Instead:
- The map provides neighbourhood exploration.
- Editorial content provides neighbourhood landing pages.

Examples:
- Best Happy Hours in Kitsilano
- Best Happy Hours in Yaletown
- Best Happy Hours in Downtown Kelowna

These become SEO assets rather than UI filters.

---

## Google Ratings

Google Ratings are a V1 requirement.

Real-world beta testing demonstrated that users rely heavily on ratings before selecting a venue.

Ratings should therefore appear directly on Search Result cards. Users should not be required to open Venue Detail pages simply to determine venue quality.

**Future filtering should also support:**
- Top Rated
- 4★+
- Rating sorting

---

## Time Philosophy

The product should interpret time rather than simply display schedules.

Instead of only displaying:

```
Happy Hour
3 PM – 6 PM
```

When a Happy Hour is active, cards should display:

```
🟢 On Now
Ends in 1 hr 15 min
3 PM – 6 PM
```

This removes unnecessary mental calculation. Users immediately understand how much time remains.

This information should appear directly on Search Result cards. Users should not need to open Venue Detail pages simply to determine remaining time.

### Product Principle

> Do not make users calculate.
>
> If Happy Hour Compass already knows the answer, it should present it.
>
> Interpret data. Do not simply display raw data.

---

## Filters vs Sorting

Filters and sorting serve different purposes.

### Filters

Filters remove unwanted results.

Examples:
- Near Me
- On Now
- Top Rated
- Open Now
- Patio *(future)*
- Sports Bar *(future)*

### Sorting

Sorting prioritizes remaining results.

Examples:
- Distance
- Rating
- Ending Soon
- Alphabetical

Users naturally filter first, then sort. The interface should respect this workflow.

---

## Future Filter Strategy

Do not design filters beyond current platform capabilities.

Before implementing filters:
- Audit existing searchable fields.
- Verify data quality.
- Confirm query performance.
- Confirm sufficient dataset coverage.

Search Tags will become a major differentiator as operator adoption grows. Until then, consumer filters should focus on capabilities already supported by reliable platform data.

---

## Current Product Principles

The following principles have been established and should guide future consumer experience design:

- The website is the product.
- Build a decision engine, not a directory.
- Discovery first. Decision immediately after.
- Maps are navigation.
- Search transitions into decision mode.
- Do not make users think.
- Do not make users click if the answer is already known.
- Do not make users calculate.
- Never design ahead of the product engine.
- Filter first. Sort second.
- Reuse existing product capabilities wherever possible.

---

## Decision: Search Results Page Layout

**Status: Locked**

### Purpose

The Search Results page is the primary decision-making experience within Happy Hour Compass.

Unlike the homepage, which is designed for discovery, the Search Results page exists to help users confidently choose a venue.

The interaction model should be inspired by Airbnb's search results experience, while the content, filtering, and decision support are unique to Happy Hour Compass.

### Layout

Desktop uses a split-screen layout:

- Approximately **55%** of the page is dedicated to the search results.
- Approximately **45%** of the page is dedicated to the interactive map.

The map is considered a primary navigation tool, not a secondary component.

- The results list scrolls independently while the map remains fixed.
- Moving or zooming the map automatically updates the visible results.
- Hovering a result highlights the corresponding map pin.
- Hovering a map pin highlights the corresponding result card.

Happy Hour Compass will reuse its branded compass marker (icon) as the primary Google Maps pin.

### Search Experience

Users arrive at the Search Results page after completing their initial search or selecting a homepage shortcut.

Once on this page, the user has entered the decision phase of the journey.

The page will **not** include:
- A search pill
- A Happy Hours / Events toggle

At this stage, the user's focus shifts from searching to refining their results using the map and filters.

### Result Cards

The Search Results page will differentiate itself through rich, decision-focused cards rather than through a unique page layout.

Each card should help answer the user's primary decision questions without requiring unnecessary clicks.

**Current direction for card content:**
- Venue image
- Save (Favourite) button
- Venue name
- Verified badge
- Establishment type (Restaurant, Pub, Brewery, Fine Dining, etc.)
- Google Rating
- Distance from the user
- Happy Hour status
- Time remaining when active (e.g. "Ends in 1 hr 15 min")
- Existing consumer app logic for upcoming happy hours (e.g. "Today: Starts at 2:00 PM")
- Happy Hour hours
- Top food special *(when available)*
- Top drink special *(when available)*

Cards should intelligently collapse empty sections. If a food or drink special is unavailable, the empty space should be removed. If both are unavailable, the specials section should not appear.

Existing consumer app logic should be reused wherever possible rather than creating duplicate business logic.

### Search Results Page Wireframe (Concept)

```
--------------------------------------------------------------
Header
--------------------------------------------------------------

Filter Chips

--------------------------------------------------------------

┌───────────────────────────────┬─────────────────────────────┐
│                               │                             │
│                               │                             │
│                               │                             │
│                               │                             │
│       Search Results          │      Interactive Map        │
│           (55%)               │          (45%)              │
│                               │                             │
│                               │                             │
│                               │                             │
│                               │                             │
└───────────────────────────────┴─────────────────────────────┘
```

### Product Principles Reinforced

- The homepage is for Discovery.
- The Search Results page is for Decision.
- Maps are a primary navigation tool.
- The interface should remove friction from choosing a venue.
- Do not make users click if the answer is already known.
- Do not make users calculate.
- Reuse existing platform capabilities and business logic wherever possible.

---

## Decision: Filters & Sort Experience

**Status: Locked**

### Philosophy

The Search Results page is optimized for refining results rather than performing a new search.

- Filters should remove unwanted results.
- Sorting should prioritize the remaining results.
- Users naturally filter first, then sort.
- The interface should respect this workflow.

### Filter Bar

The desktop filter bar should remain visible while scrolling.

**Current V1 toolbar:**

| Control | Type |
|---|---|
| Near Me | Filter |
| On Now | Filter |
| Time ▼ | Filter (panel) |
| Top Rated | Filter |
| Type ▼ | Filter (dropdown) |
| Sort ▼ | Sort (dropdown) |

The toolbar should remain intentionally simple and avoid exposing advanced filtering options until supported by mature platform data.

### Time Filter

Time is considered a primary filter and deserves a dedicated interaction rather than a collection of preset chips.

Selecting **Time** should open an elegant filtering panel that allows users to define a custom happy hour time range.

The design should support both traditional afternoon happy hours and late-night happy hours without requiring dozens of predefined filter chips.

The exact UI (dropdowns, time pickers, etc.) will be refined during implementation.

### Near Me

Near Me remains a primary one-click filter.

Selecting Near Me immediately recenters the map and refreshes the results without requiring manual map navigation.

### On Now

On Now remains one of the primary filters.

Search Result cards should clearly communicate how much time remains in the active happy hour so users can make informed decisions without additional clicks.

### Top Rated

Top Rated is a primary trust filter and reflects real-world user behavior observed during beta testing.

### Establishment Type

Establishment Type is a structured filter based on existing venue classifications (Restaurant, Pub, Brewery, Fine Dining, Cocktail Lounge, Wine Bar, etc.).

It helps users quickly identify venues appropriate for different occasions.

### Sort

Sorting remains separate from filtering.

The initial sort options will remain intentionally limited and will be refined as the search experience evolves.

### Future Filters

Additional filters (Patio, Sports Bar, Search Tags, etc.) should only be introduced after confirming:

- Data availability
- Data quality
- Query performance
- Sufficient coverage across venues

Future Search Tags are expected to become a major differentiator but should not drive the initial consumer filtering experience.

---

## Decision: Map Experience

**Status: Locked**

### Purpose

The map is a primary navigation tool within the Search Results experience.

Its purpose is to help users explore venues geographically, understand proximity, and refine results naturally through map interactions.

The map is not a secondary view or supporting feature.

### Map Behaviour

The Search Results page uses a split-screen layout with a fixed interactive map and a scrollable results list.

Panning or zooming the map automatically updates the visible results.

The application should not require a separate "Search this area" action. The current map viewport defines the active search area.

### Map Interaction

- Hovering a result card highlights the corresponding map pin.
- Hovering a map pin highlights the corresponding result card.
- Clicking a map pin displays a lightweight venue preview directly on the map.
- Clicking a map pin also highlights the corresponding Search Result card.
- If the associated card is outside the current scroll position, the results list should automatically scroll to bring it into view.
- Selecting the highlighted card (or clicking the highlighted pin again) opens the Venue Detail page.

### Map Markers

- Venue markers will reuse the existing Happy Hour Compass branded compass icon.
- The selected venue marker should remain the same icon while using a distinct selected state (size, colour, shadow, etc.).
- The user's location should continue to use the standard Google Maps blue location dot.

### Current Location

- If location permission is granted, the map should initially center on the user's current location.
- If location permission is unavailable or declined, the map should automatically fit the currently selected market.

### Map Controls

- Desktop includes standard Google Maps zoom controls.
- Mobile relies primarily on native touch gestures.
- A "Return to My Location" control should be available on the map.

### Marker Clustering

Marker clustering should be supported as venue density increases.

- Cluster markers display the number of venues contained within an area.
- As users zoom in, clusters progressively separate into individual venue markers.

### Product Principles Reinforced

- Maps are navigation, not decoration.
- The map should help users make faster decisions with fewer clicks.
- Geographic exploration should feel natural and intuitive.
- Existing Google Maps interaction patterns should be reused whenever appropriate.
- Happy Hour Compass branding should be reinforced through the use of custom map markers.

---

## Decision: Homepage Entry Experience

**Status: Locked**

### Purpose

The homepage should provide the fastest possible path into the Happy Hour Compass product experience.

Users should not be required to search before they can begin exploring.

The homepage exists to orient users, establish context, and move them into the Search Results experience with as little friction as possible.

### Homepage Flow

The primary user journey is:

```
Market
  ↓
Content Type
  ↓
Show Me
  ↓
Search Results
  ↓
Refine (Filters + Map)
  ↓
Decision
```

Search remains available as an alternate path for users who already know what they are looking for.

### Homepage Responsibilities

The homepage should help users answer only two questions:

1. Which market am I exploring?
2. Am I looking for Happy Hours or Events?

Once those choices have been made, the homepage should encourage users to immediately begin exploring rather than requiring them to perform a search.

### Primary Call-to-Action

The homepage should have a single, clear primary action.

The button is dynamic based on the selected content type.

Examples:
- **Show Me Happy Hours**
- **Show Me Events**

Selecting this button immediately transitions the user into the Search Results experience for the selected market and content type. No typing is required.

### Secondary Call-to-Action

Search becomes the secondary entry path.

Search is intended for users who already have a specific destination in mind.

Examples include:
- Venue name
- Neighbourhood
- Address
- Event name *(when browsing Events)*

Search should complement exploration rather than replace it.

### Search Placeholder

The search placeholder should reflect the currently selected content type.

| Content Type | Placeholder |
|---|---|
| Happy Hours | Search for a venue or neighbourhood... |
| Events | Search for an event, venue or neighbourhood... |

The placeholder should help teach users what can be searched.

### Product Philosophy

The homepage should never require typing to begin using Happy Hour Compass.

- Typing is optional.
- Exploration is the default.

The homepage should guide users into the product experience as quickly as possible while preserving a fast search path for users with a specific destination in mind.

### Product Principles Reinforced

- The homepage is for orientation and discovery.
- The Search Results page is for refinement and decision-making.
- Search is a precision tool, not the default workflow.
- The interface should minimize friction before users begin exploring.
- The homepage should present one clear primary action and one clear secondary action.
- Happy Hour Compass is a decision engine, not a directory.

---

## Decision: Search Experience

**Status: Locked**

### Purpose

Search is a secondary entry path into the Happy Hour Compass product experience.

Its purpose is to help users quickly locate a specific destination when they already know what they are looking for.

The primary homepage experience remains exploration through the dynamic **Show Me** action.

### Search Philosophy

Search is not intended to be the primary way users begin using Happy Hour Compass.

Most users should be able to enter the Search Results experience without typing.

Search exists as a precision tool for users who already have a destination in mind.

### Searchable Content (Happy Hours)

The initial search experience should focus on structured, reliable data.

**Supported search types:**
- Venue name
- Neighbourhood
- Market
- Partial address

Additional searchable content may be introduced as platform data matures. Search should not depend on inconsistent or incomplete data.

### Search Suggestions

Search should provide intelligent autocomplete suggestions while the user types.

Suggestions should be grouped by type.

Example:

```
Venues
  King Taps
  BNA Brewing
-------------------
Neighbourhoods
  Downtown Kelowna
  Pandosy
-------------------
Markets
  Kelowna
  Vancouver
```

Grouping helps users immediately understand what they are selecting and allows new searchable content types to be added in the future without redesigning the interface.

### Search Interaction

The search interaction should remain lightweight and responsive.

- Search opens an autocomplete suggestion list anchored to the search field.
- The experience should feel fast and unobtrusive.
- It should not require a full-screen search page or complex Spotlight-style interface.
- Selecting a suggestion immediately transitions the user into the Search Results experience with the appropriate context already applied.

### Homepage Search

Search remains the homepage's secondary call-to-action.

The search placeholder should reflect the currently selected content type.

| Content Type | Placeholder |
|---|---|
| Happy Hours | Search for a venue or neighbourhood... |
| Events | Search for an event, venue or neighbourhood... |

### Future Enhancements

Neighbourhoods are considered an important part of the search experience.

A technical audit should confirm whether neighbourhood data currently exists within the platform. If neighbourhood data is incomplete or unavailable, it should be added to the platform and populated through the existing venue seeding process so it becomes a first-class searchable field.

Additional searchable content (specials, Search Tags, etc.) should only be introduced after sufficient data quality and platform coverage have been achieved.

### Product Principles Reinforced

- Search is a precision tool, not the default workflow.
- Exploration is the primary experience.
- Search should feel fast, lightweight, and intelligent.
- Search should rely on structured, high-quality data.
- Users should transition directly into the Search Results experience rather than a separate search interface.
- Reuse and strengthen the existing product engine rather than introducing search capabilities unsupported by the data.

---

## Decision: Mobile Search Results

**Status: Locked**

### Purpose

Mobile Search Results should preserve the same decision-making experience as desktop while adapting the presentation for a smaller screen.

The mobile experience should support both map-first exploration and list-first browsing.

### Mobile Layout

Mobile should not use the desktop split-screen layout.

Instead, mobile should use a single-view experience with a floating toggle between:
- Map View
- List View

### Default View

Map View should be the default.

This reinforces the product principle that proximity and geography come first.

### Map/List Toggle

A floating action button should allow users to switch between Map and List.

- This should not be implemented as top tabs.
- The toggle should feel lightweight and easy to access.
- If possible, the user's last selected preference should be remembered.

### Filters

Mobile uses the same filter and sort system as desktop:

- Near Me
- On Now
- Time
- Top Rated
- Type
- Sort

Filters should be horizontally scrollable on mobile.

### Map View

Map View prioritizes geography. Cards or previews may be simplified to fit the available screen space. The most important decision-making information should remain visible.

### List View

List View prioritizes card browsing. Cards can be closer to the desktop version because the full screen is available.

### Product Principles Reinforced

- Same product, different presentation.
- Map-first by default.
- Users can easily switch to list-first browsing.
- Reuse the same filters, cards, data, and decision logic wherever possible.
- Do not over-specify mobile card density until tested on real screens.

---

## Future Design Phase: Events Experience

**Status: Planned**

The Happy Hour experience has been fully designed first because it is the flagship consumer experience.

The Events experience will reuse the same Search Results framework wherever possible while introducing event-specific functionality.

**Topics to be designed:**
- Event Search Results layout (reusing the HH Search Results framework)
- Event-specific filters
- Date and date-range selection using a calendar interface (similar to the existing consumer app)
- Event Search Result card design and information hierarchy
- Event Detail page experience
- Event-specific sorting
- Search behaviour for Events
- Event map interactions (confirm reuse vs. HH implementation)

### Guiding Principle

Reuse the shared Search Results framework whenever possible.

Only replace the pieces that are unique to Events (cards, filters, calendar/date logic, and event-specific content).
