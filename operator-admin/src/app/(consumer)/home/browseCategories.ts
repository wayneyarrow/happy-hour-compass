// Shared category definitions for Browse sections.
// Pure data — no browser APIs. Safe to import from server and client components.
//
// imageUrl: optional path to a static asset (public/browse/<slug>.jpg).
//   When set, BrowseTile and BrowseHubCard use the image instead of the gradient.
//   V1 ships with gradients; swap to real photography by populating imageUrl.
//
// Note — Seafood tag quality: "Seafood" is seeded from HH food specials via
//   keyword regex, so a venue with a single prawn dish can receive it.
//   TODO (future): add a minimum-mention threshold (e.g. ≥2 distinct seafood items)
//   to the seeded tag generation before "Seafood" fires.

export type BrowseCategory = {
  label: string;
  slug: string;       // → /home/collections/[slug]
  emoji: string;
  bgColor: string;    // solid fallback (used if gradient/imageUrl unavailable)
  gradient: string;   // CSS gradient for tile backgrounds
  tag: string;        // exact value in seededTags / searchTags
  imageUrl?: string;  // optional static asset path — easy to add later
};

export const EXPERIENCE_CATEGORIES: BrowseCategory[] = [
  {
    label: "Patio",
    slug: "patio",
    emoji: "☀️",
    bgColor: "#fef3c7",
    gradient: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
    tag: "Patio",
  },
  {
    label: "Dog Friendly",
    slug: "dog-friendly",
    emoji: "🐕",
    bgColor: "#fce7f3",
    gradient: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)",
    tag: "Dog Friendly",
  },
  {
    label: "Trivia",
    slug: "trivia",
    emoji: "🧠",
    bgColor: "#ede9fe",
    gradient: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
    tag: "Trivia Nights",
  },
  {
    label: "Live Music",
    slug: "live-music",
    emoji: "🎸",
    bgColor: "#e0e7ff",
    gradient: "linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)",
    tag: "Live Music",
  },
  {
    label: "Sports Bar",
    slug: "sports-bar",
    emoji: "🏈",
    bgColor: "#dcfce7",
    gradient: "linear-gradient(135deg, #4ade80 0%, #16a34a 100%)",
    tag: "Sports Viewing",
  },
];

export const FOOD_CATEGORIES: BrowseCategory[] = [
  {
    label: "Pizza",
    slug: "pizza",
    emoji: "🍕",
    bgColor: "#fef2f2",
    gradient: "linear-gradient(135deg, #f87171 0%, #dc2626 100%)",
    tag: "Pizza",
  },
  {
    label: "Burgers",
    slug: "burgers",
    emoji: "🍔",
    bgColor: "#fff7ed",
    gradient: "linear-gradient(135deg, #fb923c 0%, #c2410c 100%)",
    tag: "Burgers",
  },
  {
    label: "Tacos",
    slug: "tacos",
    emoji: "🌮",
    bgColor: "#fef9c3",
    gradient: "linear-gradient(135deg, #facc15 0%, #ca8a04 100%)",
    tag: "Tacos",
  },
  {
    label: "Seafood",
    slug: "seafood",
    emoji: "🦞",
    bgColor: "#ecfeff",
    gradient: "linear-gradient(135deg, #38bdf8 0%, #0369a1 100%)",
    tag: "Seafood",
  },
];

export const DRINKS_CATEGORIES: BrowseCategory[] = [
  {
    label: "Craft Beer",
    slug: "craft-beer",
    emoji: "🍺",
    bgColor: "#fef3c7",
    gradient: "linear-gradient(135deg, #fbbf24 0%, #b45309 100%)",
    tag: "Craft Beer",
  },
  {
    label: "Cocktails",
    slug: "cocktails",
    emoji: "🍹",
    bgColor: "#fdf4ff",
    gradient: "linear-gradient(135deg, #e879f9 0%, #a21caf 100%)",
    tag: "Cocktails",
  },
  {
    label: "Wine",
    slug: "wine",
    emoji: "🍷",
    bgColor: "#fce7f3",
    gradient: "linear-gradient(135deg, #c084fc 0%, #7e22ce 100%)",
    tag: "Wine",
  },
];

export const BROWSE_HUBS: Record<string, { title: string; categories: BrowseCategory[] }> = {
  experience: { title: "Browse Experience", categories: EXPERIENCE_CATEGORIES },
  food:       { title: "Browse Food",       categories: FOOD_CATEGORIES       },
  drinks:     { title: "Browse Drinks",     categories: DRINKS_CATEGORIES     },
};
