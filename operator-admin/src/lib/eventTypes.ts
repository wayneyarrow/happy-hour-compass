/**
 * Shared event type definitions for Happy Hour Compass.
 *
 * Used by:
 *   - Operator event creation/edit form (EventForm.tsx)
 *   - Consumer Events Search Results
 *   - Homepage event rails
 *   - Analytics and SEO pages
 *
 * Keep in sync with the CHECK constraint in migration 046_event_type.sql.
 */

export const EVENT_TYPE_DEFS = [
  { key: "live_music",    label: "Live Music",      emoji: "🎵" },
  { key: "dj_dance",     label: "DJ / Dance",       emoji: "🎧" },
  { key: "trivia",       label: "Trivia",            emoji: "🧠" },
  { key: "karaoke",      label: "Karaoke",           emoji: "🎤" },
  { key: "comedy",       label: "Comedy",            emoji: "😂" },
  { key: "sports",       label: "Sports",            emoji: "🏆" },
  { key: "food_drink",   label: "Food & Drink",      emoji: "🍻" },
  { key: "wine_tasting", label: "Wine / Tasting",    emoji: "🍷" },
  { key: "community",    label: "Community",         emoji: "🤝" },
  { key: "other",        label: "Other",             emoji: "📅" },
] as const;

export type EventTypeKey = (typeof EVENT_TYPE_DEFS)[number]["key"];

/** Select-friendly list — suitable for <option> elements or filter chips. */
export const EVENT_TYPE_OPTIONS: { value: EventTypeKey; label: string }[] =
  EVENT_TYPE_DEFS.map(({ key, label }) => ({ value: key, label }));

const LABEL_MAP = Object.fromEntries(
  EVENT_TYPE_DEFS.map(({ key, label }) => [key, label])
) as Record<string, string>;

const EMOJI_MAP = Object.fromEntries(
  EVENT_TYPE_DEFS.map(({ key, emoji }) => [key, emoji])
) as Record<string, string>;

/** Returns the human-readable label for an event type key. Empty string for unknown/null. */
export function getEventTypeLabel(key: string | null | undefined): string {
  if (!key) return "";
  return LABEL_MAP[key] ?? key;
}

/** Returns the emoji for an event type key. Empty string for unknown/null. */
export function getEventTypeEmoji(key: string | null | undefined): string {
  if (!key) return "";
  return EMOJI_MAP[key] ?? "";
}
