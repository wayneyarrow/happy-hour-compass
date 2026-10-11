/**
 * Venue-name matching for the report's searchable venue picker. Pure and
 * client-safe. Case- and accent-insensitive; punctuation is ignored so
 * "obryans" finds "Kelly & Carlos O'Bryan's".
 *
 * Ranking: name starts with the query → a word starts with it → anywhere
 * in the name. Within a tier, venues with discovery activity in the current
 * range come first, then alphabetical.
 */

export type PickerVenue = { id: string; name: string; active: boolean };

export function normalizeVenueName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function filterVenues(query: string, venues: PickerVenue[], limit = 30): PickerVenue[] {
  const q = normalizeVenueName(query);
  const tierOf = (name: string): number | null => {
    if (!q) return 3;
    const n = normalizeVenueName(name);
    const compact = n.replace(/ /g, "");
    if (n.startsWith(q)) return 0;
    if (n.split(" ").some((w) => w.startsWith(q))) return 1;
    if (n.includes(q) || compact.includes(q.replace(/ /g, ""))) return 2;
    return null;
  };
  return venues
    .map((v) => ({ v, tier: tierOf(v.name) }))
    .filter((x): x is { v: PickerVenue; tier: number } => x.tier !== null)
    .sort((a, b) => a.tier - b.tier || Number(b.v.active) - Number(a.v.active) || a.v.name.localeCompare(b.v.name))
    .slice(0, limit)
    .map((x) => x.v);
}
