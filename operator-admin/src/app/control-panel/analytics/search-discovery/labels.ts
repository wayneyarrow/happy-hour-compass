import type { NameMaps } from "@/lib/data/searchDiscoveryReport";

/** Readable labels for stable ids. Deleted/unknown records keep a short id so history stays traceable. */

const short = (id: string) => id.slice(0, 8);

export const SECTION_KIND_LABELS: Record<string, string> = {
  venue_collection: "Venue rail",
  event_collection: "Event rail",
  guide_collection: "Guide rail",
  daily_special_collection: "Today's Specials",
  venue_feature: "Venue feature",
  event_feature: "Event feature",
  guide_feature: "Guide feature",
};

/** Display order for grouping sections — comparable section types sit together. */
export const SECTION_KIND_ORDER = [
  "venue_collection",
  "daily_special_collection",
  "event_collection",
  "guide_collection",
  "venue_feature",
  "event_feature",
  "guide_feature",
];

export function sectionKindLabel(kind: string | null): string {
  return (kind && SECTION_KIND_LABELS[kind]) ?? "Unknown section type";
}

export function sectionTitle(names: NameMaps, id: string): { title: string; flags: string[] } {
  const s = names.sections.get(id);
  if (!s) {
    const removed = names.removedSections.get(id);
    return removed
      ? { title: removed.title, flags: ["removed section"] }
      : { title: `Deleted section · ${short(id)}`, flags: ["deleted"] };
  }
  const flags: string[] = [];
  if (!s.enabled) flags.push("disabled");
  if (!s.homepagePublished) flags.push("homepage not published");
  return { title: s.title, flags };
}

export function venueName(names: NameMaps, id: string): string {
  return names.venues.get(id) ?? `Deleted venue · ${short(id)}`;
}

export function guideTitle(names: NameMaps, id: string): string {
  return names.guides.get(id)?.title ?? `Deleted guide · ${short(id)}`;
}

export const ITEM_TYPE_LABELS: Record<string, string> = {
  venue: "Venue card",
  daily_special: "Daily Special card",
  event: "Event card",
  guide: "Guide card",
  suggestion: "Hero search suggestion",
};

export function itemName(names: NameMaps, type: string, id: string): string {
  if (type === "venue") return venueName(names, id);
  if (type === "guide") return guideTitle(names, id);
  if (type === "event") {
    const e = names.events.get(id);
    return e ? `${e.title}${e.venueId ? ` — ${venueName(names, e.venueId)}` : ""}` : `Deleted event · ${short(id)}`;
  }
  if (type === "daily_special") {
    const s = names.specials.get(id);
    return s ? `${s.title}${s.venueId ? ` — ${venueName(names, s.venueId)}` : ""}` : `Deleted Daily Special · ${short(id)}`;
  }
  return `${type} · ${short(id)}`;
}

export const GUIDE_BLOCK_LABELS: Record<string, string> = {
  venues: "Featured venues",
  events: "Featured events",
  related_guides: "More guides",
};

/** Placement key ("s:<id>", "g:<guide>:<block>", "hero") → label. */
export function placementLabel(names: NameMaps, key: string): string {
  if (key === "hero") return "Homepage hero";
  if (key.startsWith("s:")) {
    const id = key.slice(2);
    const { title } = sectionTitle(names, id);
    const kind = names.sections.get(id)?.kind;
    return `Homepage · ${title}${kind ? ` (${sectionKindLabel(kind)})` : ""}`;
  }
  if (key.startsWith("g:")) {
    const [, guideId, block] = key.split(":");
    return `Guide · ${guideTitle(names, guideId)} · ${GUIDE_BLOCK_LABELS[block] ?? block}`;
  }
  return key;
}

