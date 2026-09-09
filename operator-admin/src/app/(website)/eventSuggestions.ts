import { getPublishedEventsForWebsite, type WebsiteEventListItem } from "@/lib/data/events";
import { eventMatchesSearch } from "@/lib/eventSearch";
import { getEventTypeLabel, getEventTypeEmoji } from "@/lib/eventTypes";
import { buildEventPublicPath } from "@/lib/publicEventUrl";
import type { Market } from "@/lib/markets";

/**
 * Homepage Events-mode autocomplete — the Events equivalent of
 * venueSuggestions.ts (venues) and dailySpecialSuggestions.ts (Daily
 * Specials). Matching is delegated to eventMatchesSearch()
 * (src/lib/eventSearch.ts) — the same matcher /website-events's `?q=`
 * results filter uses (EventSearchResults.tsx), so there is one Event
 * text-matching definition, not two.
 *
 * Eligibility is inherited unmodified from getPublishedEventsForWebsite()
 * (published event + active-market scoping + past one-off events
 * excluded) — the exact rules the /website-events results page itself
 * already uses. No second "consumer-visible Event" definition here.
 */

export type EventSuggestion = {
  id: string;
  title: string;
  venueName: string;
  /** e.g. "Fridays 8:00–10:00 PM" — reuses WebsiteEventListItem.nextOccurrenceLabel, the same occurrence-formatting helper EventSearchCard renders. */
  occurrenceLabel: string;
  /** Emoji for the event's type, e.g. "🧠" for Trivia — "" when untyped/unknown. Purely decorative context, mirrors EventSearchCard's typeEmoji. */
  typeEmoji: string;
  /**
   * Same destination EventSearchCard.tsx links to: the canonical
   * market/city/slug path when resolvable, else the UUID-compatibility
   * route — never a second, new destination invented for this task (see
   * this task's "do not expand scope into unrelated Event venue-page
   * navigation changes" instruction).
   */
  href: string;
};

const DEFAULT_SUGGESTION_LIMIT = 8;

/** Pure — builds one suggestion from an already-fetched, already-eligible Event. Always resolvable (falls back to the UUID route), never null. */
export function toEventSuggestion(event: WebsiteEventListItem): EventSuggestion {
  const href =
    buildEventPublicPath({
      marketSlug: event.marketSlug,
      citySlug: event.citySlug,
      eventSlug: event.slug,
    }) ?? `/website-events/${event.id}`;

  return {
    id: event.id,
    title: event.title,
    venueName: event.venueName,
    occurrenceLabel: event.nextOccurrenceLabel,
    typeEmoji: getEventTypeEmoji(event.eventType),
    href,
  };
}

/**
 * Searches published, in-market, upcoming Events by title/description/
 * event type label (e.g. "trivia" matches a Trivia-type event even when
 * the word never appears in its title/description).
 * getPublishedEventsForWebsite() already applies market scoping and
 * excludes past one-off events before returning.
 */
export async function searchEventSuggestions(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<EventSuggestion[]> {
  if (!rawQuery.trim()) return [];

  const events = await getPublishedEventsForWebsite(market);
  const matched = events.filter((e) =>
    eventMatchesSearch(
      { title: e.title, description: e.description, eventTypeLabel: getEventTypeLabel(e.eventType) },
      rawQuery
    )
  );

  return matched.slice(0, limit).map(toEventSuggestion);
}
