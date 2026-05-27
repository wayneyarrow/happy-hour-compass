/**
 * Industry Reads — feed fetching, parsing, scoring, and filtering.
 *
 * Pure module — no React, no Next.js UI APIs, no side effects beyond fetch.
 *
 * Architecture:
 *   - FEED_SOURCES defines the operator-focused publications to aggregate
 *   - Keyword tables drive relevance scoring (+/-)
 *   - Competitor and hard-exclusion tables gate out irrelevant content
 *   - fetchAndFilter() runs all feeds in parallel, scores/deduplicates,
 *     and returns the top 3–5 articles (or FALLBACK_ARTICLES if < MIN pass)
 *   - getIndustryReads() is the cached public export (6-hour TTL via unstable_cache)
 *
 * To add a source: append to FEED_SOURCES.
 * To adjust scoring: edit the keyword tables below.
 * To add a metric or competitor: append to the respective array.
 */

import { unstable_cache } from "next/cache";

// ── Public types ──────────────────────────────────────────────────────────────

export type IndustryArticle = {
  title: string;
  url: string;
  sourceName: string;
  /** ISO 8601 string — safe to serialise across server/client boundary. */
  publishedAt: string;
  excerpt?: string;
};

// ── Feed sources ──────────────────────────────────────────────────────────────

const FEED_SOURCES: ReadonlyArray<{ name: string; url: string }> = [
  { name: "Restaurant Business", url: "https://www.restaurantbusinessonline.com/rss.xml" },
  { name: "Restaurant Dive",     url: "https://www.restaurantdive.com/feeds/news/" },
  { name: "FSR Magazine",        url: "https://www.fsrmagazine.com/rss.xml" },
  { name: "Bar & Restaurant",    url: "https://www.barandrestaurant.com/rss.xml" },
  { name: "SevenFifty Daily",    url: "https://daily.sevenfifty.com/feed/" },
];

// ── Scoring tables ────────────────────────────────────────────────────────────

const POSITIVE_KEYWORDS: ReadonlyArray<string> = [
  "marketing", "promotion", "promotions", "sales", "revenue",
  "customer", "customers", "retention", "loyalty", "traffic",
  "foot traffic", "happy hour", "menu", "pricing", "social media",
  "trend", "trends", "beverage", "cocktail", "wine", "beer",
  "staffing", "operations", "profit", "growth", "events", "seasonal",
];

// Each phrase adds +3 on top of any constituent keyword matches.
const STRONG_VALUE_PHRASES: ReadonlyArray<string> = [
  "restaurant marketing", "restaurant growth", "increase sales", "drive traffic",
  "customer engagement", "menu optimization", "happy hour strategy", "guest experience",
];

const NEGATIVE_KEYWORDS: ReadonlyArray<string> = [
  "lawsuit", "merger", "acquisition", "earnings", "stock", "investor",
  "ipo", "executive appointment", "ceo appointment", "bankruptcy",
  "franchise deal", "recall", "politics",
];

// ── Exclusion tables ──────────────────────────────────────────────────────────

// Any article whose text contains one of these phrases is silently dropped
// before scoring, regardless of positive matches elsewhere.
const HARD_EXCLUSIONS: ReadonlyArray<string> = [
  "celebrity chef", "stock market", "quarterly earnings",
  "investor relations", "acquisition announcement", "executive reshuffle",
];

// Competitor platform keywords — strong negative scoring per mention.
// NOTE: POS/vendor tools (Toast, Lightspeed, Square, Clover) are intentionally
// excluded from this list; they may contain useful operator content.
const COMPETITOR_KEYWORDS: ReadonlyArray<string> = [
  "yelp", "opentable", "resy", "tripadvisor", "doordash", "ubereats",
  "skip the dishes", "grubhub", "eatstreet", "restaurantji",
  "happycow", "zomato",
];

// Exclusion phrasing that signals a competitor-comparison article.
const COMPARISON_PATTERNS: ReadonlyArray<string> = [
  "alternative to", " vs.", " versus ", "compare ",
  "best restaurant app", "restaurant discovery platform",
];

// ── Thresholds ────────────────────────────────────────────────────────────────

const MIN_SCORE    = 0;
const MAX_ARTICLES = 10; // Cache stores up to 10; homepage slices to 3, CP review shows all.
const MIN_ARTICLES = 3;  // Fall back to curated if fewer pass filtering.

// ── Fallback curated content ──────────────────────────────────────────────────
// Shown when live feed filtering produces < MIN_ARTICLES results.
// These are stable section/category pages rather than individual articles,
// so they remain valid indefinitely and always return 200.

const FALLBACK_ARTICLES: IndustryArticle[] = [
  {
    title: "Restaurant Business: Marketing & Operations",
    url: "https://www.restaurantbusinessonline.com/marketing",
    sourceName: "Restaurant Business",
    publishedAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    excerpt:
      "The latest marketing strategies and operational insights for restaurant operators.",
  },
  {
    title: "FSR Magazine: Operations & Best Practices",
    url: "https://www.fsrmagazine.com/operations",
    sourceName: "FSR Magazine",
    publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    excerpt:
      "Expert resources covering operations, staffing, menu development, and guest experience.",
  },
  {
    title: "SevenFifty Daily: Beverage Trends & Bar Programs",
    url: "https://daily.sevenfifty.com",
    sourceName: "SevenFifty Daily",
    publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    excerpt:
      "Insights on beverage trends, spirits, wine, and building a stronger bar program.",
  },
];

// ── RSS parsing ───────────────────────────────────────────────────────────────

interface RawItem {
  title: string;
  url: string;
  pubDate: string;
  description: string;
  sourceName: string;
}

/** Extracts plain-text content from a named XML tag, handling CDATA. */
function extractTag(xml: string, tag: string): string {
  const cdataMatch = xml.match(
    new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, "i")
  );
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<`, "i"));
  return plainMatch ? plainMatch[1].trim() : "";
}

function extractLink(block: string, isAtom: boolean): string {
  if (isAtom) {
    const altMatch = block.match(
      /<link[^>]+rel=['"]alternate['"][^>]+href=['"]([^'"]+)['"]/i
    );
    if (altMatch) return altMatch[1];
    const hrefMatch = block.match(/<link[^>]+href=['"]([^'"]+)['"]/i);
    if (hrefMatch) return hrefMatch[1];
  }
  const rssMatch = block.match(/<link>([^<]+)<\/link>/i);
  return rssMatch ? rssMatch[1].trim() : "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(text: string): string {
  return decodeEntities(stripHtml(text));
}

function truncateExcerpt(text: string, maxLen = 120): string {
  const clean = cleanText(text);
  if (clean.length <= maxLen) return clean;
  const trimmed = clean.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(" ");
  return (lastSpace > 80 ? trimmed.slice(0, lastSpace) : trimmed) + "…";
}

function parseRssFeed(xml: string, sourceName: string): RawItem[] {
  const isAtom = /<feed[\s>]/i.test(xml);
  const tag = isAtom ? "entry" : "item";
  const blocks = xml.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, "gi")) ?? [];

  return blocks
    .map((block) => ({
      title: cleanText(extractTag(block, "title")),
      url: extractLink(block, isAtom),
      pubDate:
        extractTag(block, isAtom ? "published" : "pubDate") ||
        extractTag(block, "updated") ||
        new Date().toISOString(),
      description:
        cleanText(extractTag(block, "description")) ||
        cleanText(extractTag(block, "summary")) ||
        "",
      sourceName,
    }))
    .filter((item) => item.title.length > 0 && item.url.startsWith("http"));
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function isHardExcluded(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  return (
    HARD_EXCLUSIONS.some((p) => text.includes(p)) ||
    COMPARISON_PATTERNS.some((p) => text.includes(p))
  );
}

function scoreArticle(title: string, description: string): number {
  const text = `${title} ${description}`.toLowerCase();
  let score = 0;

  for (const kw of POSITIVE_KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }
  for (const phrase of STRONG_VALUE_PHRASES) {
    if (text.includes(phrase)) score += 3;
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    if (text.includes(kw)) score -= 3;
  }
  for (const kw of COMPETITOR_KEYWORDS) {
    const count = (text.match(new RegExp(kw, "gi")) ?? []).length;
    if (count > 0) {
      score -= 3;                    // base penalty for any mention
      score -= (count - 1) * 2;     // additional penalty per repeated mention
    }
  }

  return score;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDuplicate(title: string, seen: string[]): boolean {
  const norm = normaliseTitle(title);
  return seen.some((s) => {
    if (norm === s) return true;
    const [longer, shorter] =
      norm.length >= s.length ? [norm, s] : [s, norm];
    return longer.includes(shorter) && shorter.length / longer.length >= 0.7;
  });
}

// ── Feed fetching ─────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;

async function fetchFeed(source: { name: string; url: string }): Promise<RawItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      cache: "no-store", // unstable_cache handles our TTL — bypass Next.js fetch cache
      headers: { "User-Agent": "HappyHourCompass/1.0 (operator-dashboard)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssFeed(xml, source.name);
  } catch {
    return []; // timeout, network error, or parse failure — silently skip
  } finally {
    clearTimeout(timer);
  }
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

async function fetchAndFilter(): Promise<IndustryArticle[]> {
  const settled = await Promise.allSettled(FEED_SOURCES.map(fetchFeed));
  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  const seenTitles: string[] = [];

  const filtered = all
    .filter((item) => !isHardExcluded(item.title, item.description))
    .map((item) => ({
      ...item,
      score: scoreArticle(item.title, item.description),
    }))
    .filter((item) => item.score >= MIN_SCORE)
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
    )
    .filter((item) => {
      if (isDuplicate(item.title, seenTitles)) return false;
      seenTitles.push(normaliseTitle(item.title));
      return true;
    })
    .slice(0, MAX_ARTICLES);

  if (filtered.length < MIN_ARTICLES) {
    return FALLBACK_ARTICLES;
  }

  return filtered.map((item) => ({
    title: item.title,
    url: item.url,
    sourceName: item.sourceName,
    publishedAt: new Date(item.pubDate).toISOString(),
    excerpt: item.description ? truncateExcerpt(item.description) : undefined,
  }));
}

// ── Public cached export ──────────────────────────────────────────────────────

/**
 * Returns up to MAX_ARTICLES scored + filtered industry articles.
 * Falls back to FALLBACK_ARTICLES when < MIN_ARTICLES pass the filter.
 * Cached for 6 hours; a stale-while-revalidate refresh runs in the background.
 */
export const getIndustryReads = unstable_cache(fetchAndFilter, ["industry-reads-v1"], {
  revalidate: 6 * 60 * 60, // 6 hours
});
