/**
 * Saved Items — shared client-safe abstraction layer.
 *
 * All save/unsave/read operations must go through this module.
 * UI components must never directly read from or write to localStorage.
 *
 * V1: localStorage only. Account sync is not yet wired.
 *
 * Future sync model:
 *   1. User saves locally while anonymous.
 *   2. User creates account.
 *   3. Local saves merge into consumer_saved_venues / consumer_saved_events.
 *   4. Local storage is cleared after successful sync.
 *   5. Future reads prefer account-backed saves when logged in.
 */

const STORAGE_KEY = "hhc_saved_v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SavedItem = {
  id: string;
  savedAt: string; // ISO 8601
};

export type SavedItemsStore = {
  version: 1;
  savedVenues: SavedItem[];
  savedEvents: SavedItem[];
  savedGuides: SavedItem[];
};

export type SavedCounts = {
  venues: number;
  events: number;
  guides: number;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isServer(): boolean {
  return typeof window === "undefined";
}

function emptyStore(): SavedItemsStore {
  return { version: 1, savedVenues: [], savedEvents: [], savedGuides: [] };
}

function readStore(): SavedItemsStore {
  if (isServer()) return emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    // Validate shape — fall back to empty store if corrupt or wrong version.
    // savedGuides is validated separately (defaulted to []) rather than
    // required, so existing hhc_saved_v1 data written before Guides support
    // existed — which has no savedGuides key at all — still loads instead of
    // being discarded as "corrupt".
    if (
      parsed &&
      parsed.version === 1 &&
      Array.isArray(parsed.savedVenues) &&
      Array.isArray(parsed.savedEvents)
    ) {
      return {
        version: 1,
        savedVenues: parsed.savedVenues,
        savedEvents: parsed.savedEvents,
        savedGuides: Array.isArray(parsed.savedGuides) ? parsed.savedGuides : [],
      };
    }
    return emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store: SavedItemsStore): void {
  if (isServer()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent("hhc:savedChanged"));
  } catch {
    // localStorage can be unavailable (private mode quota, etc.) — fail silently.
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the full saved items store. Returns an empty store on SSR. */
export function getLocalSavedItems(): SavedItemsStore {
  return readStore();
}

/** Returns all saved venue IDs in insertion order (most-recent-saved last). */
export function getSavedVenueIds(): string[] {
  return readStore().savedVenues.map((v) => v.id);
}

/** Returns all saved event IDs in insertion order (most-recent-saved last). */
export function getSavedEventIds(): string[] {
  return readStore().savedEvents.map((e) => e.id);
}

/** Returns all saved guide IDs in insertion order (most-recent-saved last). */
export function getSavedGuideIds(): string[] {
  return readStore().savedGuides.map((g) => g.id);
}

/** Returns counts of saved venues, events, and guides. */
export function getSavedCounts(): SavedCounts {
  const store = readStore();
  return {
    venues: store.savedVenues.length,
    events: store.savedEvents.length,
    guides: store.savedGuides.length,
  };
}

/** Returns true if the venue is currently saved locally. */
export function isVenueSaved(venueId: string): boolean {
  return readStore().savedVenues.some((v) => v.id === venueId);
}

/** Returns true if the event is currently saved locally. */
export function isEventSaved(eventId: string): boolean {
  return readStore().savedEvents.some((e) => e.id === eventId);
}

/** Returns true if the guide is currently saved locally. */
export function isGuideSaved(guideId: string): boolean {
  return readStore().savedGuides.some((g) => g.id === guideId);
}

/**
 * Saves a venue. No-op if already saved (prevents duplicates).
 * Returns true if the item was newly added, false if it was already present.
 */
export function saveVenue(venueId: string): boolean {
  const store = readStore();
  if (store.savedVenues.some((v) => v.id === venueId)) return false;
  store.savedVenues.push({ id: venueId, savedAt: new Date().toISOString() });
  writeStore(store);
  return true;
}

/**
 * Removes a saved venue. No-op if not present.
 * Returns true if the item was removed, false if it was not found.
 */
export function unsaveVenue(venueId: string): boolean {
  const store = readStore();
  const before = store.savedVenues.length;
  store.savedVenues = store.savedVenues.filter((v) => v.id !== venueId);
  if (store.savedVenues.length === before) return false;
  writeStore(store);
  return true;
}

/**
 * Saves an event. No-op if already saved.
 * Returns true if the item was newly added, false if it was already present.
 */
export function saveEvent(eventId: string): boolean {
  const store = readStore();
  if (store.savedEvents.some((e) => e.id === eventId)) return false;
  store.savedEvents.push({ id: eventId, savedAt: new Date().toISOString() });
  writeStore(store);
  return true;
}

/**
 * Removes a saved event. No-op if not present.
 * Returns true if the item was removed, false if it was not found.
 */
export function unsaveEvent(eventId: string): boolean {
  const store = readStore();
  const before = store.savedEvents.length;
  store.savedEvents = store.savedEvents.filter((e) => e.id !== eventId);
  if (store.savedEvents.length === before) return false;
  writeStore(store);
  return true;
}

/**
 * Saves a guide. No-op if already saved.
 * Returns true if the item was newly added, false if it was already present.
 */
export function saveGuide(guideId: string): boolean {
  const store = readStore();
  if (store.savedGuides.some((g) => g.id === guideId)) return false;
  store.savedGuides.push({ id: guideId, savedAt: new Date().toISOString() });
  writeStore(store);
  return true;
}

/**
 * Removes a saved guide. No-op if not present.
 * Returns true if the item was removed, false if it was not found.
 */
export function unsaveGuide(guideId: string): boolean {
  const store = readStore();
  const before = store.savedGuides.length;
  store.savedGuides = store.savedGuides.filter((g) => g.id !== guideId);
  if (store.savedGuides.length === before) return false;
  writeStore(store);
  return true;
}

/**
 * Replaces a saved venue identifier (e.g. a legacy slug) with a new one (UUID).
 * Preserves the original savedAt timestamp.
 * No-op if oldId is not in the list or oldId === newId.
 * If newId already exists, the oldId entry is simply removed (no duplicate).
 * Returns true if the store was modified.
 */
export function migrateVenueId(oldId: string, newId: string): boolean {
  if (oldId === newId) return false;
  const store = readStore();
  const idx = store.savedVenues.findIndex((v) => v.id === oldId);
  if (idx === -1) return false;
  const alreadyExists = store.savedVenues.some((v) => v.id === newId);
  if (alreadyExists) {
    store.savedVenues.splice(idx, 1);
  } else {
    store.savedVenues[idx] = { ...store.savedVenues[idx], id: newId };
  }
  writeStore(store);
  return true;
}

/** Clears all locally saved items. Used after a successful account sync. */
export function clearLocalSavedItems(): void {
  if (isServer()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Fail silently.
  }
}
