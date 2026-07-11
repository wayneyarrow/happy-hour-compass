"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { MarketRecord, CityRecord } from "@/lib/geo/types";
import type {
  HomepageDetail,
  HomepageStatus,
  HomepageSummary,
  HomepageGuideFeatureCandidate,
} from "@/lib/data/homepages";
import type { CollectionSummary } from "@/lib/data/collectionsShared";
import {
  generateHomepageSeo,
  homepageDisplayName,
  getHomepageCanonicalUrlWarning,
  getMetaTitleWarning,
  getMetaDescriptionWarning,
  type SeoFieldKey,
} from "@/lib/seo/homepageSeo";
import { createHomepageAction, updateHomepageAction, type HomepageFormState } from "./actions";
import HomepageSectionsEditor from "./HomepageSectionsEditor";

/**
 * Shared create/edit form for Homepage Management V1
 * (docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md), following the same
 * top-to-bottom Continue pattern already established by
 * CollectionForm.tsx — browser QA found the original bottom-of-page Save
 * button forced editors to jump down to create an incomplete Homepage, then
 * scroll back up to keep building it. This form corrects that:
 *
 *   Create mode: Geography -> Homepage Details (read-only, generated name)
 *   -> Continue. Nothing else renders in create mode — Homepage Sections,
 *   SEO, and Status only make sense once the Homepage actually exists, same
 *   reasoning CollectionForm.tsx uses for gating Resolved Collection/Status
 *   to edit-only.
 *
 *   Edit mode: Geography -> Homepage Details -> Homepage Sections (the
 *   editorial assembly tool — see HomepageSectionsEditor.tsx) -> SEO ->
 *   Status -> Save Changes.
 *
 * Geography comes first in both modes because it drives everything below
 * it: the generated Homepage Name, the generated SEO defaults, and (later)
 * which Collections/Guides/Venues/Events are eligible for its Sections.
 *
 * Homepage Name is fully system-generated from geography and is never a
 * user-editable field — there is no `name` form input at all (see the
 * read-only display in Homepage Details below). createHomepageAction /
 * updateHomepageAction (actions.ts) independently compute and persist the
 * name server-side from the submitted market_id/city_id, so this is
 * enforced end-to-end, not just hidden in the UI.
 *
 * On success, createHomepageAction redirects straight into the full editor
 * (mode="edit") with a `#homepage-sections` URL fragment so the browser
 * lands the admin on the Homepage Sections area — the next logical step.
 * That native hash-jump is instant/abrupt and depends on browser timing, so
 * `scrollToSectionsOnMount` (passed by the Edit page when `success=created`)
 * additionally triggers a JS-driven `scrollIntoView({behavior:"smooth"})`
 * once this component has hydrated, mirroring CollectionForm.tsx's
 * identical `scrollToContentOnMount` pattern exactly.
 *
 * Geography availability: existingHomepages (every Homepage regardless of
 * status — both Draft and Published reserve their geography) is used to
 * disable, not hide, any Market/City destination that already has a
 * Homepage — editors need to see *why* an option is unavailable, not
 * wonder where it went. The Homepage currently being edited is excluded
 * from its own "taken" set so its existing geography stays selectable.
 * This is purely a responsive UI guide — createHomepage/updateHomepage's
 * own server-side duplicate-geography check (the DB's partial unique
 * indexes, translated to a friendly error) remains the source of truth.
 */

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  mode: "create" | "edit";
  initialHomepage?: HomepageDetail | null;
  markets: MarketRecord[];
  cities: CityRecord[];
  /** Every existing Homepage (Draft + Published) — used only to disable already-taken geography destinations. */
  existingHomepages?: HomepageSummary[];
  /** True only right after a fresh create-and-redirect (`success=created`) — triggers the one-time smooth-scroll to Homepage Sections. See module docstring. */
  scrollToSectionsOnMount?: boolean;
  /** Published Collections eligible for this Homepage's geography, by Section content-kind — edit mode only. See HomepageSectionsEditor.tsx. */
  assignableCollections?: { venue: CollectionSummary[]; event: CollectionSummary[]; guide: CollectionSummary[] };
  /** Published Guides eligible to feature on this Homepage's geography — edit mode only. */
  assignableGuideFeatures?: HomepageGuideFeatureCandidate[];
};

const STATUS_OPTIONS: { value: HomepageStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

// ── Shared styles (mirrors CollectionForm.tsx / GuideForm.tsx) ───────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none disabled:bg-gray-50 disabled:text-gray-400";
const labelCls = "block text-sm font-medium text-gray-700 mb-1";
const hintCls = "mt-1 text-xs text-gray-400";
const errorCls = "mt-1 text-xs text-red-600";
const sectionCls = "bg-white rounded-xl border border-gray-200 p-6 space-y-4";
const sectionTitleCls = "text-base font-semibold text-slate-900";

// ── Main form ─────────────────────────────────────────────────────────────────

export default function HomepageForm({
  mode,
  initialHomepage,
  markets,
  cities,
  existingHomepages = [],
  scrollToSectionsOnMount = false,
  assignableCollections = { venue: [], event: [], guide: [] },
  assignableGuideFeatures = [],
}: Props) {
  const boundAction =
    mode === "create" ? createHomepageAction : updateHomepageAction.bind(null, initialHomepage!.id);
  const [state, formAction, isPending] = useActionState<HomepageFormState, FormData>(boundAction, {});

  // ── Geography ─────────────────────────────────────────────────────────────
  const [marketId, setMarketId] = useState(initialHomepage?.marketId ?? "");
  const [cityId, setCityId] = useState(initialHomepage?.cityId ?? "");
  const filteredCities = useMemo(() => cities.filter((c) => c.marketId === marketId), [cities, marketId]);
  const selectedMarket = markets.find((m) => m.id === marketId) ?? null;
  const selectedCity = cities.find((c) => c.id === cityId) ?? null;

  // ── Geography availability — see module docstring ─────────────────────────
  const otherHomepages = useMemo(
    () => existingHomepages.filter((h) => h.id !== initialHomepage?.id),
    [existingHomepages, initialHomepage]
  );
  const takenMarketHomepageIds = useMemo(
    () => new Set(otherHomepages.filter((h) => h.cityId === null).map((h) => h.marketId)),
    [otherHomepages]
  );
  const takenCityHomepageIds = useMemo(
    () => new Set(otherHomepages.filter((h) => h.cityId !== null).map((h) => h.cityId as string)),
    [otherHomepages]
  );
  const marketHomepageTaken = marketId !== "" && takenMarketHomepageIds.has(marketId);
  const cityHomepageTaken = cityId !== "" && takenCityHomepageIds.has(cityId);
  const destinationTaken = cityId === "" ? marketHomepageTaken : cityHomepageTaken;

  function handleMarketChange(nextMarketId: string) {
    setMarketId(nextMarketId);
    const stillValid = cities.some((c) => c.id === cityId && c.marketId === nextMarketId);
    if (!stillValid) setCityId("");
  }

  // ── Homepage Details — fully system-generated, never user-editable ───────
  const generatedName = useMemo(
    () => homepageDisplayName(selectedMarket?.name ?? "", selectedCity?.name ?? null),
    [selectedMarket, selectedCity]
  );

  // ── Status (edit only) ────────────────────────────────────────────────────
  const [status, setStatus] = useState<HomepageStatus>(initialHomepage?.status ?? "draft");

  // ── SEO fields ─────────────────────────────────────────────────────────────
  const [pageTitle, setPageTitle] = useState(initialHomepage?.pageTitle ?? "");
  const [metaTitle, setMetaTitle] = useState(initialHomepage?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(initialHomepage?.metaDescription ?? "");
  const [ogTitle, setOgTitle] = useState(initialHomepage?.ogTitle ?? "");
  const [ogDescription, setOgDescription] = useState(initialHomepage?.ogDescription ?? "");
  const [canonicalUrl, setCanonicalUrl] = useState(initialHomepage?.canonicalUrl ?? "");
  const [seoTouched, setSeoTouched] = useState<Record<SeoFieldKey, boolean>>({
    page_title: Boolean(initialHomepage?.pageTitle?.trim()),
    meta_title: Boolean(initialHomepage?.metaTitle?.trim()),
    meta_description: Boolean(initialHomepage?.metaDescription?.trim()),
    og_title: Boolean(initialHomepage?.ogTitle?.trim()),
    og_description: Boolean(initialHomepage?.ogDescription?.trim()),
    canonical_url: Boolean(initialHomepage?.canonicalUrl?.trim()),
  });

  const generatedSeo = useMemo(
    () =>
      generateHomepageSeo({
        marketName: selectedMarket?.name ?? "",
        marketSlug: selectedMarket?.slug ?? "",
        cityName: selectedCity?.name ?? null,
        citySlug: selectedCity?.slug ?? null,
      }),
    [selectedMarket, selectedCity]
  );

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
  const canonicalUrlWarning = getHomepageCanonicalUrlWarning(canonicalUrl, Boolean(cityId));

  // ── Defensive re-sync on a failed submit — see GuideForm/CollectionForm's
  // identical pattern for the rationale (restores exactly what was
  // attempted, including Status, rather than stale initial values). Name is
  // not restored here — it is never submitted and always re-derives from
  // marketId/cityId, which are restored below. ─────────────────────────────
  useEffect(() => {
    if (!state.values) return;
    setMarketId(state.values.marketId);
    setCityId(state.values.cityId ?? "");
    setStatus(state.values.status);
    setPageTitle(state.values.pageTitle ?? "");
    setMetaTitle(state.values.metaTitle ?? "");
    setMetaDescription(state.values.metaDescription ?? "");
    setOgTitle(state.values.ogTitle ?? "");
    setOgDescription(state.values.ogDescription ?? "");
    setCanonicalUrl(state.values.canonicalUrl ?? "");
    setSeoTouched({
      page_title: true,
      meta_title: true,
      meta_description: true,
      og_title: true,
      og_description: true,
      canonical_url: true,
    });
  }, [state]);

  // Smooth-scroll to Homepage Sections right after a fresh create — see
  // module docstring.
  useEffect(() => {
    if (!scrollToSectionsOnMount) return;
    document.getElementById("homepage-sections")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToSectionsOnMount]);

  const canCreate = marketId !== "" && !destinationTaken;
  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="max-w-3xl space-y-6">
      {state.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {/* Geography — comes first: it drives the generated name, SEO
          defaults, and future content availability. */}
      <section className={sectionCls}>
        <h2 className={sectionTitleCls}>Geography</h2>
        <p className={hintCls}>
          Every Homepage represents one geographic destination — a Market Homepage, or a City Homepage
          within a Market. This determines which Collections, Guides, Venues, and Events are eligible
          for its Sections later.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <label className={labelCls} htmlFor="city_id">
              City <span className="text-gray-400 font-normal">(optional — leave blank for a Market Homepage)</span>
            </label>
            <select
              id="city_id"
              name="city_id"
              value={cityId}
              onChange={(e) => setCityId(e.target.value)}
              disabled={!marketId}
              className={inputCls}
            >
              <option value="" disabled={marketId !== "" && marketHomepageTaken}>
                {!marketId
                  ? "Select a market first"
                  : marketHomepageTaken
                    ? "No City — Homepage already exists"
                    : "No City (Market Homepage)"}
              </option>
              {filteredCities.map((c) => {
                const taken = takenCityHomepageIds.has(c.id);
                return (
                  <option key={c.id} value={c.id} disabled={taken}>
                    {c.name}{taken ? " — Homepage already exists" : ""}
                  </option>
                );
              })}
            </select>
            {err.city_id && <p className={errorCls}>{err.city_id}</p>}
          </div>
        </div>
        {destinationTaken && (
          <p className="text-xs text-amber-600">
            {cityId
              ? "This City already has a Homepage — choose a different City."
              : "This Market already has a Homepage — choose a City for a City Homepage, or pick a different Market."}
          </p>
        )}
        {mode === "edit" && (
          <p className={hintCls}>
            Changing Market/City is blocked while any Section already has assigned content (a
            Collection, or a Feature Venue/Event/Guide).
          </p>
        )}
      </section>

      {/* Homepage Details — name is fully system-generated, never editable. */}
      <section className={sectionCls}>
        <h2 className={sectionTitleCls}>Homepage Details</h2>
        <div>
          <label className={labelCls} htmlFor="homepage_name">Homepage Name</label>
          <input
            id="homepage_name"
            type="text"
            value={generatedName || "Select a geography above to generate a name"}
            disabled
            className={inputCls}
          />
          <p className={hintCls}>
            System-generated from the geography selected above (e.g. &quot;Kelowna Homepage&quot;,
            &quot;Central Okanagan Homepage&quot;) — not editable.
          </p>
        </div>
      </section>

      {/* Continue — create mode only. This is the entire create step: pick
          geography, review the generated name, then create the Draft
          Homepage immediately and move into the full editor below. */}
      {mode === "create" && (
        <>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending || !canCreate}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? "Creating…" : "Continue"}
            </button>
            <Link href="/control-panel/homepages" className="px-5 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </Link>
          </div>
          <p className="text-xs text-gray-400 -mt-3">
            This creates the Homepage as a Draft with no Sections yet. You&apos;ll add Sections, SEO,
            and Status next.
          </p>
        </>
      )}

      {/* Homepage Sections — the editorial assembly tool. Edit mode only:
          this is the next working area right after Continue. */}
      {mode === "edit" && initialHomepage && (
        <section id="homepage-sections" className={`${sectionCls} scroll-mt-8`}>
          <h2 className={sectionTitleCls}>Homepage Sections</h2>
          <p className={hintCls}>
            Assemble reusable Collections or hand-picked Features into this Homepage. This is an
            editorial assembly tool, not a page builder — no display, CTA, or layout configuration.
          </p>
          <HomepageSectionsEditor
            homepageId={initialHomepage.id}
            homepageGeography={{ marketId: initialHomepage.marketId, cityId: initialHomepage.cityId }}
            initialSections={initialHomepage.sections}
            assignableCollections={assignableCollections}
            assignableGuideFeatures={assignableGuideFeatures}
          />
        </section>
      )}

      {/* SEO — edit mode only. */}
      {mode === "edit" && (
        <section className={sectionCls}>
          <div className="flex items-center justify-between gap-3">
            <h2 className={sectionTitleCls}>SEO</h2>
            <button
              type="button"
              onClick={regenerateSeo}
              className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Regenerate from geography
            </button>
          </div>
          <p className={hintCls}>
            Generated automatically from the geography above. Editing a field takes manual control of it
            — it stops updating until you regenerate.
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
            <p className={hintCls}>Generated from: {generatedSeo.page_title.generatedFrom.join(", ") || "—"}</p>
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
            <p className={hintCls}>Generated from: {generatedSeo.meta_title.generatedFrom.join(", ") || "—"}</p>
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
            <p className={hintCls}>Generated from: {generatedSeo.meta_description.generatedFrom.join(", ") || "—"}</p>
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
              <p className={hintCls}>Generated from: {generatedSeo.og_title.generatedFrom.join(", ") || "—"}</p>
            </div>
            <div>
              <label className={labelCls} htmlFor="canonical_url">Canonical URL</label>
              <input
                id="canonical_url"
                name="canonical_url"
                type="text"
                value={canonicalUrl}
                onChange={(e) => handleSeoFieldChange("canonical_url", e.target.value)}
                placeholder="/{market-slug}"
                className={inputCls}
              />
              <p className={hintCls}>Generated from: {generatedSeo.canonical_url.generatedFrom.join(", ") || "—"}</p>
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
            <p className={hintCls}>Generated from: {generatedSeo.og_description.generatedFrom.join(", ") || "—"}</p>
          </div>
        </section>
      )}

      {/* Status — edit mode only. Every new Homepage is created as Draft
          (createHomepageAction ignores any submitted status); publishing is
          a decision made here, after Sections and SEO are in place. */}
      {mode === "edit" && (
        <section className={sectionCls}>
          <h2 className={sectionTitleCls}>Status</h2>
          <div>
            <label className={labelCls} htmlFor="status">Status</label>
            <select
              id="status"
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as HomepageStatus)}
              className={inputCls}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {err.status && <p className={errorCls}>{err.status}</p>}
            <div className="mt-2 space-y-1.5">
              <p className={hintCls}>
                Draft Homepages are not public. Published Homepages become the live public page for
                their geography, per the City-first / Market-fallback rule.
              </p>
              <p className={hintCls}>
                Sections with no assigned content simply don&apos;t render — they&apos;re never an
                error state.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Save Changes / Cancel — edit mode only; create mode's Continue
          button (above) is the only submit control on that page. */}
      {mode === "edit" && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving…" : "Save Changes"}
          </button>
          <Link href="/control-panel/homepages" className="px-5 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </Link>
        </div>
      )}
    </form>
  );
}
