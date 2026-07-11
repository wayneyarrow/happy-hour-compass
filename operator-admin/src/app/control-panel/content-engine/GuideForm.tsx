"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { slugify } from "@/lib/slugify";
import type { MarketRecord, CityRecord, NeighbourhoodRecord } from "@/lib/geo/types";
import type { ContentGuideDetail, GuideType, GuideStatus } from "@/lib/data/contentGuides";
import type { GuideAttachmentItem } from "@/lib/data/contentGuideAttachments";
import type { FaqLibraryItem, GuideFaqAnswer } from "@/lib/data/faqLibraryTypes";
import {
  generateGuideSeo,
  getCanonicalUrlWarning,
  getMetaDescriptionWarning,
  getMetaTitleWarning,
  type SeoFieldKey,
} from "@/lib/seo/contentGuideSeo";
import {
  getChannelRecommendations,
  type DistributionChannelKey,
} from "@/lib/data/contentGuideDistributionShared";
import { createGuideAction, updateGuideAction, type GuideFormState } from "./actions";
import HeroImageField from "./HeroImageField";
import AttachmentsSelector from "./AttachmentsSelector";
import GuideFaqsSelector from "./GuideFaqsSelector";

/**
 * Shared create/edit form for Content Engine guides (Card 2 + touch-up,
 * Card 3 venue/event attachments, Card 4 SEO automation, Card 6B
 * distribution eligibility, Card 7 status simplification, Guide Experience
 * V2 Card 2A editorial sections, Card 2C FAQ architecture).
 *
 * Scope: guide details, content fields, hero image (upload or URL),
 * keywords, status, venue/event attachments, FAQs, SEO fields, and
 * distribution channel eligibility. No related-guides curation outside the
 * FAQ answer's own optional related guide — see
 * docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md and the Card 6B task for the
 * full guardrail list. Distribution here is eligibility (editorial intent)
 * only — actual merchandising/ordering is a Discover Management concern,
 * not this form's. The "Preview Guide" action lives in the edit page's
 * header (content-engine/[id]/edit/page.tsx), not in this form.
 *
 * Card 7 replaced the old draft/scheduled/published/expired Status model
 * with a plain draft/published toggle — no more scheduling, no more
 * publish/expiry date inputs. See the Status section below and its
 * GuideForm-level state (status only; publishAt/expireAt state and the
 * isoToInputValue() helper that supported them were removed).
 *
 * Card 2A replaced the old single free-text Body field with three
 * structured editorial sections (optional heading + body each) as the
 * Content section's primary authoring surface. `body` is no longer
 * rendered as an editable field and is never re-submitted (see actions.ts)
 * — a guide with pre-existing body content shows a small non-destructive
 * note instead, via the read-only `legacyBody` snapshot below.
 *
 * Card 2C added the FAQs section (GuideFaqsSelector): a structured
 * question/answer picker sourced from the FAQ Library
 * (control-panel/content-engine/faq-library), replacing the free-form FAQ
 * idea from the original product spec. This is CMS foundation only — no
 * public FAQ rendering yet.
 */

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  mode: "create" | "edit";
  initialGuide?: ContentGuideDetail | null;
  initialAttachments?: GuideAttachmentItem[];
  initialChannels?: DistributionChannelKey[];
  initialFaqs?: GuideFaqAnswer[];
  markets: MarketRecord[];
  cities: CityRecord[];
  neighbourhoods: NeighbourhoodRecord[];
  faqLibrary: FaqLibraryItem[];
  relatedGuideOptions: { id: string; title: string }[];
};

const GUIDE_TYPE_OPTIONS: { value: GuideType; label: string }[] = [
  { value: "venue_guide", label: "Venue Guide" },
  { value: "event_guide", label: "Event Guide" },
];

// Card 7: status is binary. Scheduled/expired are gone from the V1
// editorial workflow — see GuideForm's module docstring.
const STATUS_OPTIONS: { value: GuideStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  initialChannels = [],
  initialFaqs = [],
  markets,
  cities,
  neighbourhoods,
  faqLibrary,
  relatedGuideOptions,
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
  const [teaser, setTeaser] = useState(initialGuide?.teaser ?? "");
  // Legacy free-text body (Card 2/3) — no longer editable here (Guide
  // Experience V2 Card 2A). Never re-submitted (see actions.ts), so this is
  // a read-only snapshot used only to show the legacy-content note below.
  const legacyBody = initialGuide?.body ?? "";
  const [section1Heading, setSection1Heading] = useState(initialGuide?.editorial_section_1_heading ?? "");
  const [section1Body, setSection1Body] = useState(initialGuide?.editorial_section_1_body ?? "");
  const [section2Heading, setSection2Heading] = useState(initialGuide?.editorial_section_2_heading ?? "");
  const [section2Body, setSection2Body] = useState(initialGuide?.editorial_section_2_body ?? "");
  const [section3Heading, setSection3Heading] = useState(initialGuide?.editorial_section_3_heading ?? "");
  const [section3Body, setSection3Body] = useState(initialGuide?.editorial_section_3_body ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(initialGuide?.hero_image_url ?? "");
  const [status, setStatus] = useState<GuideStatus>(initialGuide?.status ?? "draft");

  // ── SEO fields (Card 4) ───────────────────────────────────────────────────
  // Each field auto-fills from generateGuideSeo() until the admin edits that
  // specific field directly — seoTouched tracks that per field, same pattern
  // as slugTouched above. A field with an existing saved value counts as
  // touched on load so an old guide's SEO copy is never silently rewritten;
  // an empty field on load is untouched, so a suggestion appears immediately.
  const [pageTitle, setPageTitle] = useState(initialGuide?.page_title ?? "");
  const [metaTitle, setMetaTitle] = useState(initialGuide?.meta_title ?? "");
  const [metaDescription, setMetaDescription] = useState(initialGuide?.meta_description ?? "");
  const [ogTitle, setOgTitle] = useState(initialGuide?.og_title ?? "");
  const [ogDescription, setOgDescription] = useState(initialGuide?.og_description ?? "");
  const [canonicalUrl, setCanonicalUrl] = useState(initialGuide?.canonical_url ?? "");
  const [seoTouched, setSeoTouched] = useState<Record<SeoFieldKey, boolean>>({
    page_title: Boolean(initialGuide?.page_title?.trim()),
    meta_title: Boolean(initialGuide?.meta_title?.trim()),
    meta_description: Boolean(initialGuide?.meta_description?.trim()),
    og_title: Boolean(initialGuide?.og_title?.trim()),
    og_description: Boolean(initialGuide?.og_description?.trim()),
    canonical_url: Boolean(initialGuide?.canonical_url?.trim()),
  });

  // ── Cascading geography ──────────────────────────────────────────────────
  const filteredCities = useMemo(
    () => cities.filter((c) => c.marketId === marketId),
    [cities, marketId]
  );
  const filteredNeighbourhoods = useMemo(
    () => neighbourhoods.filter((n) => n.cityId === cityId),
    [neighbourhoods, cityId]
  );
  const selectedMarket = markets.find((m) => m.id === marketId) ?? null;
  const selectedCityForSeo = cities.find((c) => c.id === cityId) ?? null;
  const selectedNeighbourhoodForSeo = neighbourhoods.find((n) => n.id === neighbourhoodId) ?? null;

  const generatedSeo = useMemo(
    () =>
      generateGuideSeo({
        guideType,
        marketName: selectedMarket?.name ?? "",
        marketSlug: selectedMarket?.slug ?? "",
        cityName: selectedCityForSeo?.name ?? "",
        neighbourhoodName: selectedNeighbourhoodForSeo?.name ?? null,
        title,
        slug,
        primaryKeyword,
        secondaryKeywords: secondaryKeywords.split(/[\n,]/).map((k) => k.trim()).filter(Boolean),
        intro,
        editorialSection1Body: section1Body,
        body: legacyBody,
      }),
    [
      guideType, selectedMarket, selectedCityForSeo, selectedNeighbourhoodForSeo,
      title, slug, primaryKeyword, secondaryKeywords, intro, section1Body, legacyBody,
    ]
  );

  // Applies the current suggestion to any field the admin hasn't manually
  // edited yet — runs on every input change, so untouched fields stay live.
  useEffect(() => {
    if (!seoTouched.page_title) setPageTitle(generatedSeo.page_title.value);
    if (!seoTouched.meta_title) setMetaTitle(generatedSeo.meta_title.value);
    if (!seoTouched.meta_description) setMetaDescription(generatedSeo.meta_description.value);
    if (!seoTouched.og_title) setOgTitle(generatedSeo.og_title.value);
    if (!seoTouched.og_description) setOgDescription(generatedSeo.og_description.value);
    if (!seoTouched.canonical_url) setCanonicalUrl(generatedSeo.canonical_url.value);
  }, [generatedSeo, seoTouched]);

  const SEO_SETTERS: Record<SeoFieldKey, (value: string) => void> = {
    page_title: setPageTitle,
    meta_title: setMetaTitle,
    meta_description: setMetaDescription,
    og_title: setOgTitle,
    og_description: setOgDescription,
    canonical_url: setCanonicalUrl,
  };

  function handleSeoFieldChange(field: SeoFieldKey, value: string) {
    setSeoTouched((prev) => ({ ...prev, [field]: true }));
    SEO_SETTERS[field](value);
  }

  /** Clears touched state on every SEO field — the effect above then
   * re-fills all of them from the current inputs on the next render. */
  function regenerateSeo() {
    setSeoTouched({
      page_title: false,
      meta_title: false,
      meta_description: false,
      og_title: false,
      og_description: false,
      canonical_url: false,
    });
  }

  const metaTitleWarning = getMetaTitleWarning(metaTitle);
  const metaDescriptionWarning = getMetaDescriptionWarning(metaDescription);
  const canonicalUrlWarning = getCanonicalUrlWarning(canonicalUrl);

  // ── Related Content count (Card 7A) ──────────────────────────────────────
  // AttachmentsSelector owns its own selection state internally; this is
  // just a live count reported up for the Guide Completeness checklist's
  // "Related Content" item. Doesn't affect saving — attachment_ids (the
  // actual persisted value) is still read straight from AttachmentsSelector's
  // own hidden input at submit time.
  const [attachmentCount, setAttachmentCount] = useState(initialAttachments.length);

  // ── FAQs (Card 2C touch-up) ───────────────────────────────────────────────
  // GuideFaqsSelector owns its own row state internally; this is just a live
  // mirror (question id + answer only) reported up for the Guide
  // Completeness checklist's "Frequently Asked Questions" item. Doesn't
  // affect saving — the hidden "guide_faqs" input GuideFaqsSelector renders
  // is still what's actually submitted.
  const [faqRows, setFaqRows] = useState<{ faqId: string; answer: string }[]>(() =>
    initialFaqs.map((f) => ({ faqId: f.faqId, answer: f.answer }))
  );

  // ── Distribution (Card 6B) ────────────────────────────────────────────────
  // Editorial intent only — this is eligibility, not placement. An editor
  // can freely check/uncheck regardless of what the recommendation says;
  // recommendations never auto-select or auto-deselect a channel.
  const [channels, setChannels] = useState<DistributionChannelKey[]>(initialChannels);
  const channelRecommendations = getChannelRecommendations({
    marketName: selectedMarket?.name ?? "",
  });

  function toggleChannel(key: DistributionChannelKey) {
    setChannels((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

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

  // FAQ checklist completeness (FAQ Checklist Polish): at least one FAQ row
  // exists, and every row present has both a selected library question and
  // a non-empty answer — a single dangling incomplete row (question picked
  // but no answer yet, or vice versa) keeps the whole item incomplete,
  // rather than counting only the valid rows. This is stricter than
  // saveGuideFaqs, which silently drops incomplete rows at save time — the
  // checklist is a guide only, so it's free to nudge for a cleaner state
  // than what's strictly required to save. The optional Related Guide field
  // is intentionally not part of this check.
  const faqsComplete =
    faqRows.length > 0 &&
    faqRows.every((r) => r.faqId.trim() !== "" && r.answer.trim() !== "");

  // ── Completion checklist (local, non-blocking) ───────────────────────────
  // Card 7A: order and labels mirror the editor's own section sequence and
  // titles. "Guide Details" consolidates the Location, Title & Slug, and
  // Keywords sections into one checklist line (those remain three separate
  // section cards in the form below — only the checklist groups them).
  // "SEO" was removed from the checklist per the Card 7A spec; the SEO
  // section itself is unchanged. "Related Content" is new — see
  // attachmentCount above for how it's populated. "Frequently Asked
  // Questions" mirrors the FAQs section's position in the form, directly
  // below Content — see faqsComplete above for how it's computed.
  const checklist: ChecklistItem[] = [
    { label: "Guide Type", complete: guideType !== "" },
    {
      label: "Guide Details",
      complete:
        marketId !== "" &&
        cityId !== "" &&
        title.trim() !== "" &&
        slug.trim() !== "" &&
        primaryKeyword.trim() !== "",
    },
    {
      label: "Content",
      // Intro (Standfirst) plus at least one editorial section body — or,
      // for guides created before Card 2A, existing legacy body content
      // that hasn't been migrated into editorial sections yet.
      complete:
        intro.trim() !== "" &&
        (section1Body.trim() !== "" ||
          section2Body.trim() !== "" ||
          section3Body.trim() !== "" ||
          legacyBody.trim() !== ""),
    },
    { label: "Frequently Asked Questions (3–6 recommended)", complete: faqsComplete },
    // Matches the editor's own validation: at least one attached venue/event
    // is enough — guideType !== "" guards the edge case where an editor
    // clears the guide type after having attached items under the old type.
    { label: "Related Content", complete: guideType !== "" && attachmentCount > 0 },
    { label: "Hero Image", complete: heroImageUrl.trim() !== "" },
    { label: "Distribution", complete: channels.length > 0 },
    // Status always has a valid value (defaults to "draft"), so unlike the
    // old draft/scheduled/published/expired model — where this checked
    // "if scheduled, is a publish date set" — there's no incomplete state
    // left to detect. Always complete.
    { label: "Status", complete: true },
  ];

  const err = state.fieldErrors ?? {};

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
              <label className={labelCls} htmlFor="intro">Introduction (Standfirst)</label>
              <textarea
                id="intro"
                name="intro"
                rows={3}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                className={inputCls}
              />
              <p className={hintCls}>
                Appears as the large, bold opening paragraph at the top of the public guide
                layout — keep it short and compelling.
              </p>
            </div>

            <div>
              <label className={labelCls} htmlFor="teaser">
                Teaser <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="teaser"
                name="teaser"
                rows={2}
                value={teaser}
                onChange={(e) => setTeaser(e.target.value)}
                className={inputCls}
              />
              <p className={hintCls}>
                A short, compelling sentence used when this venue, event, or guide is featured
                throughout Happy Hour Compass. Aim for one sentence that encourages someone to
                click and learn more.
              </p>
            </div>

            {legacyBody.trim() !== "" && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                This guide has existing Body content from the previous editor. It&apos;s preserved
                and still used by the public page for now, but is no longer editable here — move
                it into the Editorial Sections below when you&apos;re ready.
              </p>
            )}

            <div className="pt-1">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Editorial Section 1</h3>
              <div className="space-y-3">
                <div>
                  <label className={labelCls} htmlFor="editorial_section_1_heading">
                    Heading <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="editorial_section_1_heading"
                    name="editorial_section_1_heading"
                    type="text"
                    value={section1Heading}
                    onChange={(e) => setSection1Heading(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="editorial_section_1_body">Body</label>
                  <textarea
                    id="editorial_section_1_body"
                    name="editorial_section_1_body"
                    rows={6}
                    value={section1Body}
                    onChange={(e) => setSection1Body(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Editorial Section 2</h3>
              <div className="space-y-3">
                <div>
                  <label className={labelCls} htmlFor="editorial_section_2_heading">
                    Heading <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="editorial_section_2_heading"
                    name="editorial_section_2_heading"
                    type="text"
                    value={section2Heading}
                    onChange={(e) => setSection2Heading(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="editorial_section_2_body">Body</label>
                  <textarea
                    id="editorial_section_2_body"
                    name="editorial_section_2_body"
                    rows={6}
                    value={section2Body}
                    onChange={(e) => setSection2Body(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Editorial Section 3</h3>
              <div className="space-y-3">
                <div>
                  <label className={labelCls} htmlFor="editorial_section_3_heading">
                    Heading <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="editorial_section_3_heading"
                    name="editorial_section_3_heading"
                    type="text"
                    value={section3Heading}
                    onChange={(e) => setSection3Heading(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="editorial_section_3_body">Body</label>
                  <textarea
                    id="editorial_section_3_body"
                    name="editorial_section_3_body"
                    rows={6}
                    value={section3Body}
                    onChange={(e) => setSection3Body(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <p className={hintCls}>
              Structured editing only — no HTML or drag-and-drop layout tools. A section with no
              body is left out of the guide entirely; headings are optional.
            </p>
          </section>

          {/* FAQs (Card 2C) — structured question/answer picker, CMS foundation only.
              Rendering on the public guide page is a later card. */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>FAQs</h2>
            <p className={hintCls}>
              Answer questions from the FAQ Library for this guide. Only active questions for the
              selected guide type are shown. Manage the library itself under Content Engine →
              FAQ Library.
            </p>
            <GuideFaqsSelector
              guideType={guideType}
              faqLibrary={faqLibrary}
              relatedGuideOptions={relatedGuideOptions}
              initialFaqs={initialFaqs}
              onFaqsChange={setFaqRows}
            />
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
                onSelectionChange={setAttachmentCount}
              />
            )}
          </section>

          {/* Distribution */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Distribution</h2>
            <p className={hintCls}>
              Choose where this guide is eligible to appear. This is editorial intent only —
              Discover Management decides what&apos;s actually merchandised, and where.
            </p>
            <input type="hidden" name="distribution_channels" value={channels.join(",")} />
            <div className="space-y-2">
              {channelRecommendations.map((rec) => (
                <label
                  key={rec.channelKey}
                  className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={channels.includes(rec.channelKey)}
                    onChange={() => toggleChannel(rec.channelKey)}
                    className="mt-0.5 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-800">{rec.label}</span>
                    {rec.reason && (
                      <span className="ml-2 text-xs font-medium text-emerald-600">{rec.reason}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* Hero Image */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Hero Image</h2>
            <HeroImageField value={heroImageUrl} onChange={setHeroImageUrl} disabled={isPending} />
          </section>

          {/* SEO */}
          <section className={sectionCls}>
            <div className="flex items-center justify-between gap-3">
              <h2 className={sectionTitleCls}>SEO</h2>
              <button
                type="button"
                onClick={regenerateSeo}
                className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                Regenerate from guide inputs
              </button>
            </div>
            <p className={hintCls}>
              Generated automatically from the title, keywords, content, and location above.
              Editing a field takes manual control of it — it stops updating until you regenerate.
            </p>

            <div>
              <label className={labelCls} htmlFor="page_title">Page Title</label>
              <input
                id="page_title"
                name="page_title"
                type="text"
                value={pageTitle}
                onChange={(e) => handleSeoFieldChange("page_title", e.target.value)}
                className={inputCls}
              />
              <p className={hintCls}>Generated from: {generatedSeo.page_title.generatedFrom.join(", ")}</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="meta_title">Meta Title</label>
              <input
                id="meta_title"
                name="meta_title"
                type="text"
                value={metaTitle}
                onChange={(e) => handleSeoFieldChange("meta_title", e.target.value)}
                className={inputCls}
              />
              <p className={hintCls}>Generated from: {generatedSeo.meta_title.generatedFrom.join(", ")}</p>
              {metaTitleWarning && <p className="mt-1 text-xs text-amber-600">{metaTitleWarning}</p>}
            </div>

            <div>
              <label className={labelCls} htmlFor="meta_description">Meta Description</label>
              <textarea
                id="meta_description"
                name="meta_description"
                rows={2}
                value={metaDescription}
                onChange={(e) => handleSeoFieldChange("meta_description", e.target.value)}
                className={inputCls}
              />
              <p className={hintCls}>Generated from: {generatedSeo.meta_description.generatedFrom.join(", ")}</p>
              {metaDescriptionWarning && <p className="mt-1 text-xs text-amber-600">{metaDescriptionWarning}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls} htmlFor="og_title">OG Title</label>
                <input
                  id="og_title"
                  name="og_title"
                  type="text"
                  value={ogTitle}
                  onChange={(e) => handleSeoFieldChange("og_title", e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>Generated from: {generatedSeo.og_title.generatedFrom.join(", ")}</p>
              </div>
              <div>
                <label className={labelCls} htmlFor="canonical_url">Canonical URL</label>
                <input
                  id="canonical_url"
                  name="canonical_url"
                  type="text"
                  value={canonicalUrl}
                  onChange={(e) => handleSeoFieldChange("canonical_url", e.target.value)}
                  placeholder="/{market}/guides/{guide-slug}"
                  className={inputCls}
                />
                <p className={hintCls}>Generated from: {generatedSeo.canonical_url.generatedFrom.join(", ")}</p>
                {canonicalUrlWarning && <p className="mt-1 text-xs text-amber-600">{canonicalUrlWarning}</p>}
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="og_description">OG Description</label>
              <textarea
                id="og_description"
                name="og_description"
                rows={2}
                value={ogDescription}
                onChange={(e) => handleSeoFieldChange("og_description", e.target.value)}
                className={inputCls}
              />
              <p className={hintCls}>Generated from: {generatedSeo.og_description.generatedFrom.join(", ")}</p>
            </div>
          </section>

          {/* Status */}
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Status</h2>
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
              <div className="mt-2 space-y-1.5">
                <p className={hintCls}>
                  Draft guides are not public. They can only be viewed via Preview Guide, above.
                </p>
                <p className={hintCls}>
                  Published guides are immediately live at their public URL. Discover Management
                  controls where a published guide is promoted or surfaced (Guides Library,
                  homepage sections, etc.) — not whether its direct URL exists.
                </p>
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
