/**
 * Data helper for Operator Analytics V2.
 *
 * Fetches all metrics for a venue over the last 30 days.
 * Uses createAdminClient() — all analytics tables are service-role only.
 * Individual query failures return null; the UI renders "—" for null values.
 */

import { createAdminClient } from "@/lib/supabase/server";

export type MostViewedEvent = {
  title: string;
  views: number;
};

export type OperatorAnalyticsV2Data = {
  // Visibility
  venueViews: number | null;
  eventViews: number | null;
  discoverImpressions: number | null;
  discoverClicks: number | null;
  // Engagement
  saves: number | null;
  mostViewedEvent: MostViewedEvent | null;
  topSearchTag: string | null;
  // Intent
  websiteClicks: number | null;
  menuClicks: number | null;
  hhScheduleExpands: number | null;
  businessHoursExpands: number | null;
};

const NULL_DATA: OperatorAnalyticsV2Data = {
  venueViews: null,
  eventViews: null,
  discoverImpressions: null,
  discoverClicks: null,
  saves: null,
  mostViewedEvent: null,
  topSearchTag: null,
  websiteClicks: null,
  menuClicks: null,
  hhScheduleExpands: null,
  businessHoursExpands: null,
};

function thirtyDaysAgo(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fetches all Operator Analytics V2 metrics for a venue.
 *
 * @param venueId   - UUID of the venue to query.
 * @param venueTags - The venue's configured search_tags (TEXT[] from venues).
 *                    Used to intersect with global tag frequency for Top Search Tag.
 */
export async function getOperatorAnalyticsV2(
  venueId: string,
  venueTags: string[]
): Promise<OperatorAnalyticsV2Data> {
  try {
    const admin = createAdminClient();
    const since = thirtyDaysAgo();

    // Phase 1: all independent queries in parallel
    const [
      venueViewsRes,
      discoverImpRes,
      discoverClickRes,
      savesRes,
      websiteClicksRes,
      menuClicksRes,
      hhExpandsRes,
      hoursExpandsRes,
      eventRowsRes,
    ] = await Promise.all([
      admin
        .from("venue_view_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .gte("viewed_at", since),
      admin
        .from("venue_discover_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("event_type", "impression")
        .gte("occurred_at", since),
      admin
        .from("venue_discover_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("event_type", "click")
        .gte("occurred_at", since),
      admin
        .from("venue_save_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("action", "save")
        .gte("saved_at", since),
      admin
        .from("venue_click_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("click_type", "website")
        .gte("clicked_at", since),
      admin
        .from("venue_click_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("click_type", "menu")
        .gte("clicked_at", since),
      admin
        .from("venue_click_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("click_type", "hh_schedule_expand")
        .gte("clicked_at", since),
      admin
        .from("venue_click_events")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("click_type", "business_hours_expand")
        .gte("clicked_at", since),
      // All events for this venue — needed to scope event_view_events queries below
      admin.from("events").select("id, title").eq("venue_id", venueId),
    ]);

    // Phase 2: event-scoped queries (depend on event IDs from Phase 1)
    const eventRows = (eventRowsRes.data ?? []) as Array<{
      id: string;
      title: string;
    }>;

    let eventViews: number | null = 0;
    let mostViewedEvent: MostViewedEvent | null = null;

    if (eventRows.length > 0) {
      const eventIds = eventRows.map((e) => e.id);
      // Cap at 10 000 rows — sufficient for V2 beta scale.
      const { data: viewRows } = await admin
        .from("event_view_events")
        .select("event_id")
        .in("event_id", eventIds)
        .gte("viewed_at", since)
        .limit(10000);

      if (viewRows !== null) {
        eventViews = viewRows.length;

        // Aggregate by event_id — Supabase JS client has no GROUP BY support.
        const counts: Record<string, number> = {};
        for (const row of viewRows) {
          counts[row.event_id] = (counts[row.event_id] ?? 0) + 1;
        }

        let maxViews = 0;
        let maxId: string | null = null;
        for (const [id, count] of Object.entries(counts)) {
          if (count > maxViews) {
            maxViews = count;
            maxId = id;
          }
        }

        if (maxId !== null && maxViews > 0) {
          const match = eventRows.find((e) => e.id === maxId);
          if (match) mostViewedEvent = { title: match.title, views: maxViews };
        }
      } else {
        eventViews = null;
      }
    }

    // Top search tag: intersect venue's own tags with global tag frequency log.
    // search_tag_events has no venue_id — it is a global consumer-side log.
    let topSearchTag: string | null = null;
    if (venueTags.length > 0) {
      const { data: tagRows } = await admin
        .from("search_tag_events")
        .select("tag")
        .in("tag", venueTags)
        .gte("searched_at", since)
        .limit(10000);

      if (tagRows && tagRows.length > 0) {
        const tagCounts: Record<string, number> = {};
        for (const row of tagRows) {
          tagCounts[row.tag] = (tagCounts[row.tag] ?? 0) + 1;
        }
        let maxCount = 0;
        for (const [tag, count] of Object.entries(tagCounts)) {
          if (count > maxCount) {
            maxCount = count;
            topSearchTag = tag;
          }
        }
      }
    }

    return {
      venueViews: venueViewsRes.count,
      eventViews,
      discoverImpressions: discoverImpRes.count,
      discoverClicks: discoverClickRes.count,
      saves: savesRes.count,
      mostViewedEvent,
      topSearchTag,
      websiteClicks: websiteClicksRes.count,
      menuClicks: menuClicksRes.count,
      hhScheduleExpands: hhExpandsRes.count,
      businessHoursExpands: hoursExpandsRes.count,
    };
  } catch {
    return NULL_DATA;
  }
}
