"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { slugify } from "@/lib/slugify";
import type { MarketRecord, CityRecord, NeighbourhoodRecord } from "@/lib/geo/types";
import type { ContentGuideDetail, GuideType, GuideStatus } from "@/lib/data/contentGuides";
import type { GuideAttachmentItem } from "@/lib/data/contentGuideAttachments";
import { createGuideAction, updateGuideAction, type GuideFormState } from "./actions";
import HeroImageField from "./HeroImageField";
import AttachmentsSelector from "./AttachmentsSelector";

/**
 * Shared create/edit form for Content Engine guides (Card 2 + touch-up, plus
 * Card 3 venue/event attachments).
 *
 * Scope: guide details, content fields, hero image (upload or URL),
 * keywords, status, publishing dates, and venue/event attachments only. No
 * FAQ, related guides, SEO automation, multiple/cropped images, or preview —
 * see docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md and the Card 3 task for
 * the full guardrail list.
 */

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  mode: "create" | "edit";
  initialGuide?: ContentGuideDetail | null;
  initialAttachments?: GuideAttachmentItem[];
  markets: MarketRecord[];
  cities: CityRecord[];
  neighbourhoods: NeighbourhoodRecord[];
};

const GUIDE_TYPE_OPTIONS: { value: GuideType; label: string }[] = [
  { value: "venue_guide", label: "Venue Guide" },
  { value: "event_guide", label: "Event Guide" },
];

const STATUS_OPTIONS: { value: GuideStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "expired", label: "Expired" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts an ISO timestamp to a <input type="datetime-local"> value (local time, no seconds). */
function isoToInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none disabled:bg-gray-50 disabled:text-gray-400";
const labelCls = "block text-sm font-medium text-gray-700 mb-1";
const hintCls = "mt-1 text-xs text-gray-400";
const errorCls = "mt-1 text-xs text-red-600";
const sectionCls = "bg-white rounded-xl border border-gray-200 p-6 space-y-4";
const sectionTitleCls = "text-base font-semibold text-slate-900";

// ── Completion checklist ──────────────────────────────────────────────────────

type ChecklistItem = { label: string; complete: boolean };

function CompletionChecklist({ items }: { items: ChecklistItem[] }) {
  const doneCount = items.filter((i) => i.complete).length;
  return (
    // Sticky only from lg: up — below that the checklist stacks naturally
    // with the form instead of pinning to the viewport. top-8 matches the
    // main content area's own top padding (p-6 md:p-8) in
    // control-panel/layout.tsx, whose <main> is the scrolling ancestor (the
    // CP header sits outside it), so this offset sits flush with that
    // padding rather than fighting a fixed header.
    <div className="bg-white rounded-xl border border-gray-200 p-6 lg:sticky lg:top-8 lg:z-10">
      <h2 className="text-sm font-semibold text-slate-900 mb-1">Guide Completeness</h2>
      <p className="text-xs text-gray-400 mb-4">{doneCount} of {items.length} sections complete</p>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-sm">
            <span
              className={`inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
                item.complete ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-300"
              }`}
              aria-hidden="true"
            >
              {item.complete ? "✓" : "○"}
            </span>
            <span className={item.complete ? "text-gray-700" : "text-gray-400"}>{item.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-gray-400">
        This checklist is a guide only — it does not block saving.
      </p>
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

export default function GuideForm({
  mode,
  initialGuide,
  initialAttachments = [],
  markets,
  cities,
  neighbourhoods,
}: Props) {
  const boundAction =
    mode === "create" ? createGuideAction : updateGuideAction.bind(null, initialGuide!.id);
  const [state, formAction, isPending] = useActionState<GuideFormState, FormData>(boundAction, {});

  // ── Field state ──────────────────────────────────────────────────────────
  const [guideType, setGuideType] = useState<GuideType | "">(initialGuide?.guide_type ?? "");
  const [marketId, setMarketId] = useState(initialGuide?.market_id ?? "");
  const [cityId, setCityId] = useState(initialGuide?.city_id ?? "");
  const [neighbourhoodId, setNeighbourhoodId] = useState(initialGuide?.neighbourhood_id ?? "");
  const [title, setTitle] = useState(initialGuide?.title ?? "");
  const [slug, setSlug] = useState(initialGuide?.slug ?? "");
  // In edit mode the slug already belongs to a live URL — never auto-overwrite it.
  // In create mode, auto-fill from the title until the admin edits slug directly.
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [primaryKeyword, setPrimaryKeyword] = useState(initialGuide?.primary_keyword ?? "");
  const [secondaryKeywords, setSecondaryKeywords] = useState(
    (initialGuide?.secondary_keywords ?? []).join(", ")
  );
  const [intro, setIntro] = useState(initialGuide?.intro ?? "");
  const [body, setBody] = useState(initialGuide?.body ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(initialGuide?.hero_image_url ?? "");
  const [status, setStatus] = useState<GuideStatus>(initialGuide?.status ?? "draft");
  const [publishAt, setPublishAt] = useState(isoToInputValue(initialGuide?.publish_at ?? null));
  const [expireAt, setExpireAt] = useState(isoToInputValue(initialGuide?.expire_at ?? null));

  // ── Cascading geography ──────────────────────────────────────────────────
  const filteredCities = useMemo(
    () => cities.filter((c) => c.marketId === marketId),
    [cities, marketId]
  );
  const filteredNeighbourhoods = useMemo(
    () => neighbourhoods.filter((n) => n.cityId === cityId),
    [neighbourhoods, cityId]
  );

  function handleMarketChange(nextMarketId: string) {
    setMarketId(nextMarketId);
    const stillValid = cities.some((c) => c.id === cityId && c.marketId === nextMarketId);
    if (!stillValid) {
      setCityId("");
      setNeighbourhoodId("");
    }
  }

  function handleCityChange(nextCityId: string) {
    setCityId(nextCityId);
    const stillValid = neighbourhoods.some(
      (n) => n.id === neighbourhoodId && n.cityId === nextCityId
    );
    if (!stillValid) setNeighbourhoodId("");
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(value: string) {
    setSlug(value);
    setSlugTouched(true);
  }

  function regenerateSlugFromTitle() {
    setSlug(slugify(title));
    setSlugTouched(true);
  }

  // ── Completion checklist (local, non-blocking) ───────────────────────────
  const checklist: ChecklistItem[] = [
    { label: "Guide type", complete: guideType !== "" },
    { label: "Location", complete: marketId !== "" && cityId !== "" },
    { label: "Title and slug", complete: title.trim() !== "" && slug.trim() !== "" },
    { label: "Keywords", complete: primaryKeyword.trim() !== "" },
    { label: "Content", complete: intro.trim() !== "" && body.trim() !== "" },
    { label: "Hero image", complete: heroImageUrl.trim() !== "" },
    { label: "Publishing", complete: status !== "scheduled" || publishAt !== "" },
  ];

  const err = state.fieldErrors ?? {};
  const selectedMarket = markets.find((m) => m.id === marketId) ?? null;

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {/* Guide Type */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Guide Type</h2>
            <div>
              <label className={labelCls} htmlFor="guide_type">Type</label>
              <select
                id="guide_type"
                name="guide_type"
                value={guideType}
                onChange={(e) => setGuideType(e.target.value as GuideType)}
                className={inputCls}
              >
                <option value="">Select a guide type…</option>
                {GUIDE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {err.guide_type && <p className={errorCls}>{err.guide_type}</p>}
            </div>
          </section>

          {/* Location */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Location</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls} htmlFor="market_id">Market</label>
                <select
                  id="market_id"
                  name="market_id"
                  value={marketId}
                  onChange={(e) => handleMarketChange(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select a market…</option>
                  {markets.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                {err.market_id && <p className={errorCls}>{err.market_id}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor="city_id">City</label>
                <select
                  id="city_id"
                  name="city_id"
                  value={cityId}
                  onChange={(e) => handleCityChange(e.target.value)}
                  disabled={!marketId}
                  className={inputCls}
                >
                  <option value="">
                    {marketId ? "Select a city…" : "Select a market first"}
                  </option>
                  {filteredCities.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {err.city_id && <p className={errorCls}>{err.city_id}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor="neighbourhood_id">
                  Neighbourhood <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  id="neighbourhood_id"
                  name="neighbourhood_id"
                  value={neighbourhoodId}
                  onChange={(e) => setNeighbourhoodId(e.target.value)}
                  disabled={!cityId || filteredNeighbourhoods.length === 0}
                  className={inputCls}
                >
                  <option value="">
                    {filteredNeighbourhoods.length === 0 ? "None available" : "None"}
                  </option>
                  {filteredNeighbourhoods.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Title & Slug */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Title &amp; Slug</h2>
            <div>
              <label className={labelCls} htmlFor="title">Guide Title</label>
              <input
                id="title"
                name="title"
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. Best Happy Hour Patios in Kelowna"
                className={inputCls}
              />
              {err.title && <p className={errorCls}>{err.title}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="slug">Slug</label>
              <div className="flex gap-2">
                <input
                  id="slug"
                  name="slug"
                  type="text"
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="best-happy-hour-patios-in-kelowna"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={regenerateSlugFromTitle}
                  disabled={!title.trim()}
                  className="shrink-0 text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  Generate from title
                </button>
              </div>
              <p className={hintCls}>
                /{selectedMarket?.slug ?? "{market}"}/guides/{slug || "{guide-slug}"}
              </p>
              {err.slug && <p className={errorCls}>{err.slug}</p>}
            </div>
          </section>

          {/* Keywords */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Keywords</h2>
            <div>
              <label className={labelCls} htmlFor="primary_keyword">Primary Keyword</label>
              <input
                id="primary_keyword"
                name="primary_keyword"
                type="text"
                value={primaryKeyword}
                onChange={(e) => setPrimaryKeyword(e.target.value)}
                placeholder="happy hour patios kelowna"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="secondary_keywords">Secondary Keywords</label>
              <textarea
                id="secondary_keywords"
                name="secondary_keywords"
                rows={2}
                value={secondaryKeywords}
                onChange={(e) => setSecondaryKeywords(e.target.value)}
                placeholder="patio happy hour, kelowna drink specials, best patios kelowna"
                className={inputCls}
              />
              <p className={hintCls}>Separate with commas or new lines.</p>
            </div>
          </section>

          {/* Content */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Content</h2>
            <div>
              <label className={labelCls} htmlFor="intro">Introduction</label>
              <textarea
                id="intro"
                name="intro"
                rows={3}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="body">Body</label>
              <textarea
                id="body"
                name="body"
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className={inputCls}
              />
              <p className={hintCls}>Structured editing only — no HTML or drag-and-drop layout tools yet.</p>
            </div>
          </section>

          {/* Related Venues / Events */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>
              {guideType === "event_guide" ? "Related Events" : "Related Venues"}
            </h2>
            {guideType === "" ? (
              <p className="text-sm text-gray-400">
                Select a guide type above to attach venues or events.
              </p>
            ) : (
              <AttachmentsSelector
                key={guideType}
                kind={guideType === "event_guide" ? "event" : "venue"}
                marketId={marketId}
                cityId={cityId}
                neighbourhoodId={neighbourhoodId}
                initialSelected={
                  guideType === initialGuide?.guide_type ? initialAttachments : []
                }
              />
            )}
          </section>

          {/* Hero Image */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Hero Image</h2>
            <HeroImageField value={heroImageUrl} onChange={setHeroImageUrl} disabled={isPending} />
          </section>

          {/* Publishing */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Publishing</h2>
            <div>
              <label className={labelCls} htmlFor="status">Status</label>
              <select
                id="status"
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as GuideStatus)}
                className={inputCls}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {err.status && <p className={errorCls}>{err.status}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls} htmlFor="publish_at">
                  Publish Date{status === "scheduled" && <span className="text-red-500"> *</span>}
                </label>
                <input
                  id="publish_at"
                  name="publish_at"
                  type="datetime-local"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                  className={inputCls}
                />
                {err.publish_at && <p className={errorCls}>{err.publish_at}</p>}
              </div>
              <div>
                <label className={labelCls} htmlFor="expire_at">Expiry Date</label>
                <input
                  id="expire_at"
                  name="expire_at"
                  type="datetime-local"
                  value={expireAt}
                  onChange={(e) => setExpireAt(e.target.value)}
                  className={inputCls}
                />
                {err.expire_at && <p className={errorCls}>{err.expire_at}</p>}
              </div>
            </div>
          </section>

          {/* Save / Cancel */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending
                ? "Saving…"
                : mode === "create" ? "Create Guide" : "Save Changes"}
            </button>
            <Link
              href="/control-panel/content-engine"
              className="px-5 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </div>

        <CompletionChecklist items={checklist} />
      </div>
    </form>
  );
}
