# CSV → Supabase Field Mapping

Blueprint for the CSV import script. All mappings are derived by inspecting
the actual CSV files, the Supabase migration files, and the existing
parsing/normalization code in `index.html` and `operator-admin/src/lib/data/`.

---

## Source Files

| File | Purpose | Primary use |
|---|---|---|
| `venues.beta.csv` | Full venue dataset — most complete | **Primary import source** |
| `venues.working.csv` | Earlier working copy — fewer columns | Secondary / cross-reference |
| `venues.template.csv` | Blank template — headers only | Reference only |
| `events.beta.csv` | Event dataset tied to venue slugs | **Primary import source** |

### Column comparison across venue files

| Column | `venues.beta.csv` | `venues.working.csv` | `venues.template.csv` |
|---|:---:|:---:|:---:|
| `id` | yes | yes | yes |
| `name` | yes | yes | yes |
| `type` | yes | yes | yes |
| `city` | yes | yes | yes |
| `area` | yes | yes | yes |
| `address` | yes | yes | yes |
| `phone` | yes | yes | yes |
| `latitude` | yes | yes | yes |
| `longitude` | yes | yes | yes |
| `url` | yes | — | — |
| `menu_url` | yes | — | — |
| `business_hours` | yes | — | — |
| `payment_types` | yes | — | — |
| `happy_hour_times` | yes | yes | — |
| `happy_hour_tagline` | yes | yes | — |
| `happy_hour_food_details` | yes | yes | — |
| `happy_hour_drink_details` | yes | yes | — |

`venues.beta.csv` is the superset. Use it as the primary source.

---

## Supabase Schema (complete, post all migrations)

### `venues` table

Assembled from migrations 001 → 006:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | PK, auto-generated |
| `slug` | TEXT | no | UNIQUE; consumer-facing URL identifier |
| `name` | TEXT | no | |
| `address_line1` | TEXT | yes | |
| `city` | TEXT | yes | |
| `region` | TEXT | yes | Not populated by operator admin UI |
| `postal_code` | TEXT | yes | Not populated by operator admin UI |
| `country` | TEXT | yes | Not populated by operator admin UI |
| `phone` | TEXT | yes | |
| `website_url` | TEXT | yes | |
| `menu_url` | TEXT | yes | |
| `lat` | DOUBLE PRECISION | yes | |
| `lng` | DOUBLE PRECISION | yes | |
| `hours` | TEXT | yes | **Legacy column — never populated; ignore** |
| `payment_types` | TEXT | yes | Stored as JSON array string, e.g. `'["Cash","Debit"]'` |
| `hh_times` | TEXT | yes | Multi-line plain text weekly schedule |
| `hh_tagline` | TEXT | yes | |
| `hh_food_details` | TEXT | yes | Plain text (legacy) or JSON array string |
| `hh_drink_details` | TEXT | yes | Plain text (legacy) or JSON array string |
| `is_published` | BOOLEAN | no | Default FALSE |
| `business_hours` | JSONB | yes | Added migration 003 |
| `establishment_type` | TEXT | yes | Added migration 006; default `'Restaurant and Bar'` |
| `created_at` | TIMESTAMPTZ | no | Auto |
| `updated_at` | TIMESTAMPTZ | no | Auto |
| `created_by_operator_id` | UUID FK | yes | |
| `updated_by_operator_id` | UUID FK | yes | |

### `events` table

Assembled from migrations 001, 004, 005:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | no | PK, auto-generated |
| `venue_id` | UUID FK | no | → venues.id (UUID, not slug) |
| `slug` | TEXT | no | UNIQUE; consumer-facing URL identifier |
| `title` | TEXT | no | |
| `event_time` | TEXT | yes | Legacy plain text, e.g. `"Sundays · 2–4 PM"` |
| `event_frequency` | TEXT | yes | Legacy plain text, e.g. `"weekly"`, `"one-off"` |
| `description` | TEXT | yes | |
| `is_published` | BOOLEAN | no | Default FALSE |
| `first_date` | DATE | yes | Added migration 004 |
| `start_time` | TEXT | yes | Added migration 004, e.g. `"2:00 PM"` |
| `end_time` | TEXT | yes | Added migration 004, e.g. `"4:00 PM"` |
| `recurrence` | TEXT | no | Added migration 004; default `'none'` |
| `image_url` | TEXT | yes | Added migration 005 |
| `created_at` | TIMESTAMPTZ | no | Auto |
| `updated_at` | TIMESTAMPTZ | no | Auto |
| `created_by_operator_id` | UUID FK | yes | |
| `updated_by_operator_id` | UUID FK | yes | |

---

## Mapping: `venues.beta.csv` → `venues`

| CSV column | DB column | Transformation | Notes |
|---|---|---|---|
| `id` | `slug` | copy as-is | CSV id is already slug-style, e.g. `"kelowna-the-keg"` |
| _(none)_ | `id` | `gen_random_uuid()` | Auto-generated; not in CSV |
| `name` | `name` | copy as-is | |
| `url` | `website_url` | copy as-is | Column name differs |
| `menu_url` | `menu_url` | copy as-is | |
| `type` | `establishment_type` | copy as-is | CSV `type` (e.g. `"Casual Dining"`, `"Sports Bar"`) maps to `establishment_type` (migration 006). The consumer code hardcodes `type: "Restaurant"` separately and never reads this from DB. |
| `city` | `city` | copy as-is | |
| `area` | _(no DB column)_ | **DROPPED** | `area` is absent from the DB schema. Consumer code hardcodes `area: ""`. If neighbourhood data is needed, a migration must add a column first. |
| `address` | `address_line1` | copy as-is | CSV stores the full address as one string. No decomposition into region/postal_code is attempted. |
| `phone` | `phone` | copy as-is | |
| `latitude` | `lat` | `parseFloat` | CSV column is `latitude`; DB column is `lat` |
| `longitude` | `lng` | `parseFloat` | CSV column is `longitude`; DB column is `lng` |
| `payment_types` | `payment_types` | split → JSON array string | CSV: `"Cash, Debit, Credit Cards"`. DB stores a JSON array string, e.g. `'["Cash","Debit","Credit Cards"]'`. Split on `","`, trim each element, `JSON.stringify`. Consumer code calls `JSON.parse` on this column; raw comma-separated text breaks the parse and falls back to the full string. |
| `business_hours` | `business_hours` | parse text → JSONB | CSV: multi-line text `"Monday – Thursday: 4 PM – 10 PM\nFriday – Saturday: 2 PM – 11 PM"`. DB: JSONB `{"monday": {"open": "HH:MM", "close": "HH:MM"} \| null, …}`. Apply the same parsing logic as `parseBusinessHours` in `index.html` and then convert each day's 12-hour times to 24-hour `HH:MM` using `parse12hToHHMM` (already implemented in `venues.ts`). |
| `happy_hour_times` | `hh_times` | copy as-is | Both CSV and DB store this as multi-line plain text. Consumer code calls `parseHhTimes` at read time; no transformation needed at import. |
| `happy_hour_tagline` | `hh_tagline` | copy as-is | |
| `happy_hour_food_details` | `hh_food_details` | copy as-is (plain text) | CSV is newline-separated item list. DB accepts both plain text and JSON. `parseSpecials` in `venues.ts` handles both formats; import can store plain text directly. |
| `happy_hour_drink_details` | `hh_drink_details` | copy as-is (plain text) | Same as above |
| _(none)_ | `region` | leave NULL | Not present in CSV |
| _(none)_ | `postal_code` | leave NULL | Not present in CSV |
| _(none)_ | `country` | `"CA"` or NULL | All known venues are in BC, Canada. Hardcode `"CA"` or leave NULL. **Ambiguous — document which is preferred.** |
| _(none)_ | `hours` | leave NULL | Legacy TEXT column; never used by consumer code; do not populate |
| _(none)_ | `is_published` | `TRUE` | CSV has no published flag; all imported rows should be published |
| _(none)_ | `created_by_operator_id` | NULL or import operator UUID | No CSV equivalent. Either leave NULL or assign to a dedicated "import" operator row. |
| _(none)_ | `updated_by_operator_id` | NULL | Same as above |

---

## Mapping: `events.beta.csv` → `events`

| CSV column | DB column | Transformation | Notes |
|---|---|---|---|
| `id` | `slug` | copy as-is | CSV id is already slug-style, e.g. `"kettle-river-brewing-sunday-taproom-trivia"` |
| _(none)_ | `id` | `gen_random_uuid()` | Auto-generated |
| `venue_id` | `venue_id` | slug → UUID lookup | CSV `venue_id` is a venue slug (e.g. `"kettle-river-brewing"`). DB column is a UUID FK → `venues.id`. **The import must resolve each venue slug to its UUID after venues are inserted.** |
| `title` | `title` | copy as-is | |
| `event_time` | `event_time` | copy as-is | Legacy plain-text field preserved verbatim for consumer display and backward compatibility |
| `event_frequency` | `event_frequency` | copy as-is | Legacy plain-text field: `"weekly"` or `"one-off"` |
| `event_frequency` | `recurrence` | map values | `"weekly"` → `"weekly"`, `"one-off"` → `"none"`. No other values appear in the CSV. |
| `event_time` | `start_time` | parse from string | Extract start time from `event_time`. Format: `"Sundays · 2–4 PM"` → `"2:00 PM"`. Format: `"Friday, Feb 27 · 9:30 PM"` → `"9:30 PM"`. Some entries have no parseable time (e.g. `"Sundays · evening"`, `"Tuesdays · showtimes vary"`): set `NULL`. |
| `event_time` | `end_time` | parse from string | Extract end time from `event_time` range if present. `"Sundays · 2–4 PM"` → `"4:00 PM"`. No end time for point-in-time entries (e.g. `"9:30 PM"` alone): set `NULL`. |
| `event_time` + `event_frequency` | `first_date` | derive date | See **first_date derivation** section below |
| `description` | `description` | copy as-is | |
| _(none)_ | `image_url` | leave NULL | Not in CSV |
| _(none)_ | `is_published` | `TRUE` | CSV has no published flag |
| _(none)_ | `created_by_operator_id` | NULL | No CSV equivalent |
| _(none)_ | `updated_by_operator_id` | NULL | No CSV equivalent |

### first_date derivation

`first_date` is used by the consumer app to derive day-of-week for recurring
events and to sort/filter one-off events. Derivation depends on
`event_frequency`:

**`event_frequency = "weekly"`**

The `event_time` string encodes a day name, e.g. `"Sundays · 2–4 PM"`,
`"Mondays & Wednesdays · 8:30 PM"`. Extract the first day name, find the next
calendar date on which that day occurs (from the import date forward), and
store it as `first_date`.

Special cases:
- `"Mondays & Wednesdays · 8:30 PM"` — two days. Use the first (Monday) for
  `first_date`; the second day is not captured in the structured columns.
  **Ambiguous: the import script should document how multi-day weekly events
  are handled.**
- `"Tuesdays · showtimes vary"` — unparseable time; set `start_time`/`end_time`
  to NULL but still derive `first_date` from the day name.
- `"Sundays · Noon–2 PM"` — "Noon" must be treated as "12:00 PM".
- `"Tuesdays · 5 PM–close"` — "close" has no fixed time; set `end_time` NULL.

**`event_frequency = "one-off"`**

The `event_time` string contains a full date, e.g.:
- `"Friday, Feb 27 · 9:30 PM"` — parse day-of-week + month + day. Year is
  **absent from the string**; derive from the event slug if possible (e.g.
  `"kelowna-oflannigans-pub-linus-2026-02-27"` contains `2026-02-27`), or
  infer from context (events in the CSV appear to be 2025/2026).
  **Ambiguous: the import script must define the year-resolution strategy.**
- `"Saturday, Jan 24 · 6:00 PM"` — same issue.
- `"Sunday, Feb 9 · Doors open 2:00 PM"` — "Doors open" is a prefix before
  the time; the time parser must skip the label.

---

## Import Order and Key Relationships

```
1. Insert venues (venues.beta.csv)
      → captures generated UUID per slug

2. Build slug → UUID map in memory

3. Insert events (events.beta.csv)
      → resolve each event's venue_id slug to UUID using the map from step 2
      → events whose venue_id slug is not found in the map must be skipped
         or flagged as errors
```

### Slug uniqueness

Both `venues.slug` and `events.slug` carry a UNIQUE constraint. The import
must verify there are no duplicate `id` values within each CSV before
inserting. Duplicate slugs will cause constraint violations.

---

## Fields in CSV Not Currently in Supabase

| CSV field | Gap | Recommendation |
|---|---|---|
| `area` (venues) | No DB column | Add `area TEXT` column in a migration before import, or accept data loss |

---

## Fields in Supabase Not Covered by CSV

| DB column | Gap | Import action |
|---|---|---|
| `venues.region` | Not in CSV | Leave NULL |
| `venues.postal_code` | Not in CSV | Leave NULL |
| `venues.country` | Not in CSV | Hardcode `"CA"` or leave NULL (decision required) |
| `venues.hours` | Legacy unused column | Leave NULL |
| `events.image_url` | Not in CSV | Leave NULL |

---

## Transformation Reference: `business_hours` (CSV text → JSONB)

CSV input format (multi-line cell):
```
Monday – Thursday: 4 PM – 10 PM
Friday – Saturday: 2 PM – 11 PM
Sunday: 2 PM – 10 PM
```

Target JSONB shape (migration 003 spec):
```json
{
  "monday":    { "open": "16:00", "close": "22:00" },
  "tuesday":   { "open": "16:00", "close": "22:00" },
  "wednesday": { "open": "16:00", "close": "22:00" },
  "thursday":  { "open": "16:00", "close": "22:00" },
  "friday":    { "open": "14:00", "close": "23:00" },
  "saturday":  { "open": "14:00", "close": "23:00" },
  "sunday":    { "open": "14:00", "close": "22:00" }
}
```

Steps:
1. Split on `\n`; trim each line.
2. Find the day/time separator colon (skip colons inside times like `2:30`) —
   same logic as `parseHappyHourTimes` / `parseBusinessHours` in `index.html`.
3. Expand day ranges (`"Monday – Thursday"`, `"Daily"`) using `expandDayRange`
   logic already in `venues.ts`.
4. Parse each 12-hour time with `parse12hToHHMM` (already in `venues.ts`).
5. Map `"close"` / `"closing"` to `"23:00"` (matches existing convention).
6. Days absent from the CSV text → set to `null` (closed).
7. Output object keys must be **lowercase** day names (migration 003 spec).

The `parse12hToHHMM` and `expandDayRange` functions in
`operator-admin/src/lib/data/venues.ts` already implement steps 3–5 and should
be reused directly by the import script (or ported to the script's language).

---

## Transformation Reference: `payment_types` (CSV text → JSON array string)

CSV input: `"Cash, Debit, Credit Cards"`

DB target (TEXT column storing a JSON array):
`'["Cash","Debit","Credit Cards"]'`

Steps:
1. Split on `","`.
2. Trim each element.
3. Filter out empty strings.
4. `JSON.stringify(array)` → store resulting string in the TEXT column.

Consumer code reads this back with `JSON.parse`; the plain comma-separated
string is a fallback but produces a single-element array equal to the whole
string, which is incorrect.

---

## Transformation Reference: `hh_food_details` / `hh_drink_details`

CSV input (newline-separated items in a quoted cell):
```
Select appetizers discounted
Late-night snack specials
```

DB target: store plain text as-is. The column accepts both plain text and a
JSON array string (`[{name, price?, notes?}]`). The consumer's `parseSpecials`
function handles both formats. For CSV import, store plain text directly — no
serialization to JSON is required.

---

## Ambiguities — Decisions Required Before Writing the Import Script

| # | Issue | Options |
|---|---|---|
| 1 | **`first_date` year for one-off events** | (a) Extract year from event slug (reliable for slugs containing `YYYY-MM-DD`); (b) hardcode current year at import time; (c) leave NULL and rely on `event_time` legacy text only |
| 2 | **`first_date` for weekly events** | (a) Next upcoming occurrence from import date; (b) sentinel date (epoch of that weekday); (c) NULL — rely on `recurrence` + `event_time` text |
| 3 | **Multi-day weekly events** (e.g. `"Mondays & Wednesdays"`) | (a) Store first day in `first_date`; (b) create two separate event rows, one per day; (c) leave `first_date` NULL |
| 4 | **`country` for all venues** | Hardcode `"CA"` (all known venues are in BC) or leave NULL |
| 5 | **`area` data loss** | Accept loss (no DB column); OR add `area TEXT` to venues schema via migration before running import |
| 6 | **`created_by_operator_id`** | Leave NULL; OR create a dedicated "csv-import" operator row and assign its UUID |
| 7 | **Venues in `venues.working.csv` not in `venues.beta.csv`** | Determine if working CSV contains additional venues not yet in beta CSV; merge or ignore |
