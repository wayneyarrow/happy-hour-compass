/**
 * Static metric definitions, source policies and limitations embedded in
 * every Scout export. They describe the ESTABLISHED rules as implemented —
 * the export does not harmonize them. Search & Discovery definitions follow
 * docs/analytics/SEARCH_DISCOVERY_TRACKING.md.
 */

import { RELEASE_QA_SESSION_IDS } from "@/lib/searchDiscoveryReporting/config";
import { VENUE_VIEW_MILESTONES } from "@/lib/customerSuccess/venueViewMilestones";
import { SMALL_SAMPLE_MIN } from "./comparison";

export type MetricDefinition = {
  label: string;
  unit: string;
  source: string;
  timestamp: string;
  counting: string;
  environmentPolicy: string;
  qaPolicy: string;
  legacyPolicy: string;
  agreesWith: string;
};

const VIEW_ENV = "Counts rows with no environment label (recorded before labelling began) and rows labelled production. Rows labelled staging, preview or development are not counted (migration 111 rule).";
const NO_QA = "No release-QA session exclusion (the established usage counts don't apply one).";

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  venueViews: {
    label: "Venue views",
    unit: "page views (rows), not unique visitors or sessions",
    source: "venue_view_events",
    timestamp: "viewed_at",
    counting: "One row each time a venue detail page renders its view tracker. Not de-duplicated by session.",
    environmentPolicy: VIEW_ENV,
    qaPolicy: NO_QA,
    legacyPolicy: "Unlabelled legacy rows are included, as established.",
    agreesWith: "Operator Admin Venue Views (same predicate, over a different window); Control Panel all-time venue views and Customer Success milestone counts (venue_view_counts RPC).",
  },
  eventViews: {
    label: "Event views",
    unit: "page views (rows)",
    source: "event_view_events (venue via events.venue_id at generation time)",
    timestamp: "viewed_at",
    counting: "One row each time an event detail page renders its view tracker. Not de-duplicated by session.",
    environmentPolicy: VIEW_ENV,
    qaPolicy: NO_QA,
    legacyPolicy: "Unlabelled legacy rows are included, as established.",
    agreesWith: "Operator Admin Event Views; Control Panel all-time event views (event_view_counts RPC).",
  },
  dailySpecialClicks: {
    label: "Daily Specials clicks",
    unit: "clicks (rows) — not views; Daily Special impressions are not recorded on this surface",
    source: "daily_special_click_events",
    timestamp: "clicked_at",
    counting: "One row per click on a Daily Special card in the Daily Specials search results (source = search_results). Homepage Today's Specials cards are reported under Search & Discovery instead.",
    environmentPolicy: "No environment filter — every environment is counted, as in the Control Panel Consumer Demand figure.",
    qaPolicy: NO_QA,
    legacyPolicy: "Unlabelled rows are included.",
    agreesWith: "Control Panel Analytics → Consumer Demand Daily Special clicks (same predicate, over a different window).",
  },
  intentActions: {
    label: "Intent actions",
    unit: "actions (rows)",
    source: "venue_click_events",
    timestamp: "clicked_at",
    counting: "One row per tracked action, by click_type: website, menu, hh_schedule_expand, business_hours_expand. Directions clicks are not stored in the database and are not reported.",
    environmentPolicy: "The table has no environment column — every environment is counted, as in Operator Admin.",
    qaPolicy: NO_QA,
    legacyPolicy: "Not applicable (no environment label).",
    agreesWith: "Operator Admin Intent metrics (same predicate per type, over a different window).",
  },
  saves: {
    label: "Saves",
    unit: "save actions (rows)",
    source: "venue_save_events (action = 'save')",
    timestamp: "saved_at",
    counting: "One row per save action. Unsaves are not subtracted. See saves.collection: collection is not established, so totals are reported as unavailable (null) until a tracking fix establishes reliable coverage — recorded rows alone never enable the metric.",
    environmentPolicy: "The table has no environment column — every environment is counted, as in Operator Admin.",
    qaPolicy: NO_QA,
    legacyPolicy: "Not applicable (no environment label).",
    agreesWith: "Operator Admin Saves (same predicate, over a different window).",
  },
  searchDiscovery: {
    label: "Search & Discovery",
    unit: "see docs/analytics/SEARCH_DISCOVERY_TRACKING.md",
    source: "website_search_events, website_discovery_events",
    timestamp: "searched_at / occurred_at",
    counting:
      "Computed by the Control Panel Search & Discovery report's own loaders and aggregation functions. Typed and URL (?q=) searches are ranked separately and never combined. Zero-result = 0 results, no other filters, and not flagged as a capped count. Item CTR = impressed combinations (page view + placement + item) with ≥1 matched click ÷ impressed combinations. Raw clicks are never a CTR numerator. Engagement = exposed page views with ≥1 section click ÷ exposed page views.",
    environmentPolicy: "environment = 'production' only.",
    qaPolicy: `Excludes the ${RELEASE_QA_SESSION_IDS.length} documented release-QA sessions by exact id (RELEASE_QA_SESSION_IDS).`,
    legacyPolicy: "Legacy rows (unlabelled searches, load-based venue_discover_events) are excluded and never combined with this data.",
    agreesWith: "Control Panel → Analytics → Search & Discovery, Production source, for the same window.",
  },
  milestones: {
    label: "Venue-view milestones",
    unit: "all-time venue views",
    source: "Customer Success milestone reader (computeVenueViewMilestoneDecisions — read-only) and customer_success_events",
    timestamp: "all-time, as of generation",
    counting: `Eligible venues (published, verified, operator-owned). All-time views from the venue_view_counts RPC, the same count the milestone detector uses. Thresholds: ${VENUE_VIEW_MILESTONES.join(", ")}. Approaching = views remaining are positive and no more than 10% of the next threshold.`,
    environmentPolicy: VIEW_ENV,
    qaPolicy: NO_QA,
    legacyPolicy: "Unlabelled legacy rows are included, as established.",
    agreesWith: "Customer Success milestone detection and the Control Panel venue page milestone notes.",
  },
};

/**
 * Why saves are not reported as 0 (code review, 2026-10-15). An empty
 * venue_save_events table alone wouldn't prove anything; these code facts
 * do, and tests/unit/scoutReport/savesCollection.test.ts pins each one so
 * this assessment is revisited if any of them changes.
 */
export const SAVES_COLLECTION: {
  status: "not_established" | "established";
  assessedOn: string;
  reason: string;
  evidence: string[];
  operatorAdmin: string;
  notTheSameAs: string;
  followUp: string[];
} = {
  // Only a future tracking fix that establishes reliable coverage may change this.
  // Recorded rows alone never enable the metric: partial collection is not complete tracking.
  status: "not_established",
  assessedOn: "2026-10-15",
  reason:
    "Save tracking exists but is not working as written, so collection is not established. Saves are reported as unavailable (null) — not 0, and not from any rows that do get recorded — until a tracking fix establishes reliable coverage.",
  evidence: [
    "The public website's save button (SaveVenueButton) stores account and browser saves and never calls /api/track/venue-save.",
    "The consumer app's BookmarkButton calls /api/track/venue-save with the venue's public id, which is its slug; that endpoint accepts only a venue UUID and rejects the request, so nothing is stored.",
  ],
  operatorAdmin: "Operator Admin's Saves figure reads the same table and therefore shows 0. It is unchanged.",
  notTheSameAs:
    "Signed-in consumers' saved venues (consumer_saved_venues) are a separate store of current saved state, not save actions, and are not reported here.",
  followUp: [
    "Fix save tracking: the consumer BookmarkButton posts a slug that /api/track/venue-save rejects (UUID only), and the website SaveVenueButton never posts to it.",
    "Review Operator Admin's Saves figure, which shows 0 for every venue because nothing has been recorded.",
  ],
};

export const SOURCE_POLICY_SUMMARY = [
  "Each metric keeps its established environment, QA and legacy policy. They differ between metrics and are not harmonized — see definitions.",
  "Weekly figures use half-open windows [startUtc, endUtc) at Vancouver midnight on Mondays.",
  "Milestone counts are all-time as of generation; weekly view totals cover only their week. The two use different time horizons and are never added together.",
  `Week-over-week changes are only calculated when both weeks are comparable. Percentage change is suppressed below ${SMALL_SAMPLE_MIN} in either week.`,
  "Missing data or a failed query is reported as null with a reason, never as zero. A section that could not be read in full is marked incomplete or failed.",
];

export const LIMITATIONS = [
  "Clean Search & Discovery collection began October 10, 2026. Weeks before or overlapping that date have partial or no coverage.",
  "Rail vertical position on the page is not tracked; position means the 0-based card index within a placement as rendered.",
  "Placement-change history is not tracked; per-placement results can't be tied to a specific layout version.",
  "Placement lift is not measured or claimed.",
  "Homepage guide opens and activity inside guides are reported separately. No homepage-to-guide journey is inferred.",
  "Views are page renders, not unique visitors. A session is one browser tab, not a person.",
  "Directions clicks are not stored in the database and are not reported.",
  "Search terms are redacted where they look like an email address or phone number; their counts are kept.",
  "Venue, event, guide and section names are resolved at generation time.",
];
