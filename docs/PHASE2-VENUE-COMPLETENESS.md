# Phase 2 Venue Completeness Specification

## Overview

This document classifies the authoritative venue fields for Happy Hour Compass and defines what constitutes a "Beta-complete" venue for Phase 2.

---

## Field Classification Table

| Field | CSV Column | Phase | Required/Optional | Notes |
|-------|------------|-------|-------------------|-------|
| Venue Name | `name` | Phase 1 | — | Complete |
| Address | `address` | Phase 1 | — | Complete |
| Latitude/Longitude | `latitude`, `longitude` | Phase 1 | — | Complete |
| City | `city` | Phase 1 | — | Complete |
| Area | `area` | Phase 1 | — | Complete |
| ID/Slug | `id` | Phase 1 | — | Complete (internal) |
| Happy Hour Times | `happy_hour_times` | **Phase 2** | **REQUIRED** | Core value proposition |
| Happy Hour Tagline | `happy_hour_tagline` | **Phase 2** | **REQUIRED** | Listing display text |
| Happy Hour Food Details | `happy_hour_food_details` | **Phase 2** | OPTIONAL | Food specials description |
| Happy Hour Drink Details | `happy_hour_drink_details` | **Phase 2** | OPTIONAL | Drink specials description |
| Establishment Type | `type` | **Phase 2** | OPTIONAL | Filtering/categorization |
| Phone Number | `phone` | **Phase 2** | OPTIONAL | Column exists, needs population |
| Website | `website` | **Phase 2** | OPTIONAL | Venue verification |
| Business Hours | `business_hours` | **Phase 2** | OPTIONAL | Context for happy hour |
| Menu URL | `menu_url` | Out of Scope | — | Future phase |
| Payment Types | `payment_types` | Out of Scope | — | Future phase |
| Image(s) | `images` | Out of Scope | — | Requires hosting infrastructure |
| Favourite | — | Out of Scope | — | User preference, not venue data |

---

## Phase Summary

### Phase 1 (Complete)
Core venue identity and location data:
- `id`, `name`, `city`, `area`, `address`, `latitude`, `longitude`

### Phase 2 (Venue Completeness for Beta)
Happy hour content and essential contact info:
- **REQUIRED:** `happy_hour_times`, `happy_hour_tagline`
- **OPTIONAL:** `happy_hour_food_details`, `happy_hour_drink_details`, `type`, `phone`, `website`, `business_hours`

### Out of Scope (Future)
Features requiring additional infrastructure or not critical for Beta:
- `menu_url`, `payment_types`, `images`, Favourite

---

## Beta-Complete Venue Criteria

A venue is considered **Beta-complete** when it meets ALL of the following:

### Mandatory Criteria (must pass all)
1. **Has a unique, stable `id`** — already satisfied by Phase 1
2. **Has a populated `name`** — already satisfied by Phase 1
3. **Has a populated `address`** — already satisfied by Phase 1
4. **Has valid `latitude` and `longitude`** — already satisfied by Phase 1
5. **Has populated `happy_hour_times`** — specific days/times of happy hour
6. **Has populated `happy_hour_tagline`** — brief summary for listing display (≤150 chars recommended)

### Optional Criteria (enhance quality but not blocking)
- `happy_hour_food_details` — detailed description of food specials
- `happy_hour_drink_details` — detailed description of drink specials
- `type` — establishment category (e.g., "Pub", "Restaurant", "Brewery")
- `phone` — contact number
- `website` — venue URL
- `business_hours` — general operating hours

### Testable Validation Rules
```
IS_BETA_COMPLETE = (
    id IS NOT EMPTY AND
    name IS NOT EMPTY AND
    address IS NOT EMPTY AND
    latitude IS NOT EMPTY AND
    longitude IS NOT EMPTY AND
    happy_hour_times IS NOT EMPTY AND
    happy_hour_tagline IS NOT EMPTY
)
```

---

## Promotion Rules: venues.working.csv → venues.beta.csv

### General Rules
1. **Match by `id`** — never by name or other fields
2. **Preserve Phase 1 columns** — do not modify `id`, `name`, `city`, `area`, `address`, `latitude`, `longitude` during Phase 2 promotion (unless explicitly correcting an error)
3. **Column order** — maintain existing schema order; new columns append to the right

### Phase 2 Promotion Process

#### Step 1: Schema Extension
Add Phase 2 columns to both `venues.working.csv` and `venues.beta.csv`:
```
id,name,type,city,area,address,phone,latitude,longitude,happy_hour_times,happy_hour_tagline,happy_hour_food_details,happy_hour_drink_details
```

#### Step 2: Working File Population
- Populate Phase 2 fields in `venues.working.csv` via manual data entry
- Each venue must have at minimum: `happy_hour_times`, `happy_hour_tagline`

#### Step 3: Promotion Criteria
A venue row can be promoted from working → beta when:
1. All Phase 1 fields remain unchanged (integrity check)
2. `happy_hour_times` is populated and valid
3. `happy_hour_tagline` is populated and non-empty
4. Optional fields may be empty or populated

#### Step 4: Promotion Execution
For each venue meeting promotion criteria:
1. Copy Phase 2 field values from `venues.working.csv` to matching `id` row in `venues.beta.csv`
2. Verify no Phase 1 fields were inadvertently modified
3. Document promotion in commit message

### Field-Specific Rules

| Field | Promotion Rule |
|-------|----------------|
| `happy_hour_times` | Copy if non-empty; format: free text (e.g., "Mon-Fri 3-6pm") |
| `happy_hour_tagline` | Copy if non-empty; max 150 chars recommended |
| `happy_hour_food_details` | Copy if non-empty; no length limit |
| `happy_hour_drink_details` | Copy if non-empty; no length limit |
| `type` | Copy if non-empty; use consistent categories |
| `phone` | Copy if non-empty; format: as provided |
| `website` | Copy if non-empty; must be valid URL |
| `business_hours` | Copy if non-empty; format: free text |

---

## Column Ordering (Post Phase 2)

```csv
id,name,type,city,area,address,phone,latitude,longitude,happy_hour_times,happy_hour_tagline,happy_hour_food_details,happy_hour_drink_details
```

Note: `type` and `phone` columns already exist in Phase 1 schema. New Phase 2 columns (`happy_hour_times`, `happy_hour_tagline`, `happy_hour_food_details`, `happy_hour_drink_details`) append after existing columns.

---

## What This Specification Does NOT Cover

- Event data (Phase 3)
- Image hosting or management
- User preferences (Favourites)
- Backend automation
- Data validation beyond presence checks
- Long-term or V2 features
