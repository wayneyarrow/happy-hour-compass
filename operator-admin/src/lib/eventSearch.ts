/**
 * Pure, framework-agnostic free-text matching for consumer-visible Events —
 * the Event equivalent of dailySpecialMatchesSearch() in
 * dailySpecialSchedule.ts. No I/O, no Supabase — directly unit-testable.
 *
 * This is the single source of truth for "does this Event match this
 * query" — both the homepage Hero's Events-mode autocomplete
 * (eventSuggestions.ts) and the /website-events `?q=` results filter
 * (EventSearchResults.tsx) call this same function, so there is exactly
 * one Event text-matching definition rather than two subtly different ones.
 *
 * Fields matched: title, description, and the event type's human-readable
 * label (so a query like "trivia" matches a Trivia-type event even when
 * the word "trivia" doesn't literally appear in its title/description) —
 * matching the fields actually present on WebsiteEventListItem
 * (src/lib/data/events.ts) and EVENT_TYPE_DEFS (src/lib/eventTypes.ts).
 */

export type EventSearchableContent = {
  title: string;
  description: string | null;
  /** Human-readable label for the event's type, e.g. "Trivia" — see getEventTypeLabel() in src/lib/eventTypes.ts. Pass null/"" when the event has no type. */
  eventTypeLabel: string | null;
};

export function eventMatchesSearch(content: EventSearchableContent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return (
    content.title.toLowerCase().includes(q) ||
    (content.description?.toLowerCase().includes(q) ?? false) ||
    (content.eventTypeLabel?.toLowerCase().includes(q) ?? false)
  );
}
