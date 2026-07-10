"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MarketRecord, CityRecord } from "@/lib/geo/types";
import type {
  CollectionDetail,
  CollectionType,
  CollectionStatus,
  AlgorithmKey,
} from "@/lib/data/collectionsShared";
import { ALGORITHM_KEYS, ALGORITHM_COLLECTION_TYPE } from "@/lib/data/collectionsShared";
import type { GuideCandidate } from "@/lib/data/collections";
import { RAIL_LABELS, type RailKey } from "@/lib/data/discoverOverridesShared";
import { createCollectionAction, updateCollectionAction, type CollectionFormState } from "./actions";
import ResolvedCollectionTable, { type MembershipRow } from "./ResolvedCollectionTable";
import CollectionGuidePicker, { type GuideMembershipRow } from "./CollectionGuidePicker";
import CollectionUsageSection from "./CollectionUsageSection";

/**
 * Shared create/edit form for Collections Management V1
 * (docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md), following the same
 * one-page sectioned editor pattern as GuideForm.tsx.
 *
 * Create mode intentionally omits Resolved Collection and Homepage Usage —
 * per the approved workflow (Collection list -> Create Collection -> dedicated
 * editor -> Save), a new Collection is created with just its core fields
 * (name, geography, curation method), then redirects into the full editor
 * (mode="edit") for curation. The submit button's label makes that next step
 * explicit (e.g. "Create Collection & Choose Venues" / "...& Generate")
 * rather than leaving the admin at a dead end.
 *
 * Resolved Collection (this replaced an earlier, disconnected split between
 * a "Content Membership" picker and a separate read-only "Preview" section —
 * browser QA found that confusing). It's now one section:
 *   - Manual Collections: the section IS the membership list (search, add,
 *     remove, reorder) — no separate preview needed.
 *   - Algorithmic Collections: an explicit "Generate Collection" action
 *     resolves the algorithm against the Collection's current (possibly
 *     unsaved) settings and overrides — see ResolvedCollectionTable.tsx and
 *     actions.ts's generateCollectionResultAction. Nothing here is labeled
 *     "Preview" — there is no public Collection landing page yet to preview
 *     against (see product spec, "Collection Landing Pages"); this is purely
 *     the admin's working area for building the Collection's contents.
 *
 * After create/save, the server action redirects back to this page with a
 * `#collection-content` URL fragment so the browser lands the admin directly
 * on this section (the content picker for Manual, the Generate action for
 * Algorithmic) rather than at the top of a long form with no clear next step.
 */

const TYPE_OPTIONS: { value: CollectionType; label: string }[] = [
  { value: "venue", label: "Venue Collection" },
  { value: "event", label: "Event Collection" },
  { value: "guide", label: "Guide Collection" },
];

const STATUS_OPTIONS: { value: CollectionStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none disabled:bg-gray-50 disabled:text-gray-400";
const labelCls = "block text-sm font-medium text-gray-700 mb-1";
const hintCls = "mt-1 text-xs text-gray-400";
const errorCls = "mt-1 text-xs text-red-600";
const sectionCls = "bg-white rounded-xl border border-gray-200 p-6 space-y-4";
const sectionTitleCls = "text-base font-semibold text-slate-900";

type Props = {
  mode: "create" | "edit";
  initialCollection?: CollectionDetail | null;
  markets: MarketRecord[];
  cities: CityRecord[];
  guideCandidates?: GuideCandidate[];
};

export default function CollectionForm({
  mode,
  initialCollection,
  markets,
  cities,
  guideCandidates = [],
}: Props) {
  const boundAction =
    mode === "create" ? createCollectionAction : updateCollectionAction.bind(null, initialCollection!.id);
  const [state, formAction, isPending] = useActionState<CollectionFormState, FormData>(boundAction, {});

  const [name, setName] = useState(initialCollection?.name ?? "");
  const [description, setDescription] = useState(initialCollection?.description ?? "");
  const [collectionType, setCollectionType] = useState<CollectionType | "">(
    initialCollection?.collectionType ?? ""
  );
  const [marketId, setMarketId] = useState(initialCollection?.marketId ?? "");
  const [cityId, setCityId] = useState(initialCollection?.cityId ?? "");
  const [curationMode, setCurationMode] = useState<"manual" | "algorithmic">(
    initialCollection?.algorithmKey ? "algorithmic" : "manual"
  );
  const [algorithmKey, setAlgorithmKey] = useState<AlgorithmKey | "">(initialCollection?.algorithmKey ?? "");
  const [itemLimit, setItemLimit] = useState(initialCollection?.itemLimit?.toString() ?? "");
  const [status, setStatus] = useState<CollectionStatus>(initialCollection?.status ?? "draft");

  // Defensive re-sync: if a failed submit ever arrives after this component
  // re-mounted (so its local state no longer reflects what was submitted),
  // restore exactly what was attempted — including the chosen Published
  // status — rather than silently showing stale initial values. In the
  // normal case (no remount) this is a no-op, since local state already
  // matches what was submitted.
  useEffect(() => {
    if (!state.values) return;
    setName(state.values.name);
    setDescription(state.values.description ?? "");
    setMarketId(state.values.marketId);
    setCityId(state.values.cityId ?? "");
    setAlgorithmKey((state.values.algorithmKey as AlgorithmKey) ?? "");
    setCurationMode(state.values.algorithmKey ? "algorithmic" : "manual");
    setItemLimit(state.values.itemLimit?.toString() ?? "");
    setStatus(state.values.status);
  }, [state]);

  const filteredCities = useMemo(() => cities.filter((c) => c.marketId === marketId), [cities, marketId]);
  const isGuideType = collectionType === "guide";
  const algorithmic = !isGuideType && curationMode === "algorithmic";
  const itemLimitNumber = itemLimit.trim() && Number.isFinite(Number(itemLimit)) ? Number(itemLimit) : null;
  const algorithmKeyValue: AlgorithmKey | null = algorithmic && algorithmKey ? algorithmKey : null;

  const algorithmOptions = useMemo(() => {
    if (!collectionType || collectionType === "guide") return [];
    return ALGORITHM_KEYS.filter((key) => ALGORITHM_COLLECTION_TYPE[key] === collectionType);
  }, [collectionType]);

  function handleMarketChange(nextMarketId: string) {
    setMarketId(nextMarketId);
    const stillValid = cities.some((c) => c.id === cityId && c.marketId === nextMarketId);
    if (!stillValid) setCityId("");
  }

  function handleTypeChange(nextType: CollectionType) {
    setCollectionType(nextType);
    // Algorithm options are type-specific — clear a now-incompatible selection.
    if (nextType === "guide") {
      setCurationMode("manual");
      setAlgorithmKey("");
    } else if (algorithmKey && ALGORITHM_COLLECTION_TYPE[algorithmKey] !== nextType) {
      setAlgorithmKey("");
    }
  }

  function handleCurationModeChange(nextMode: "manual" | "algorithmic") {
    setCurationMode(nextMode);
    if (nextMode === "manual") setAlgorithmKey("");
  }

  // Membership rows, mapped from initialCollection for edit mode
  const initialVenueRows: MembershipRow[] = (initialCollection?.venueOverrides ?? []).map((o) => ({
    id: o.venueId, primaryLabel: o.venueName ?? "(unknown venue)", secondaryLabel: null, action: o.action, boost: o.boost,
  }));
  const initialEventRows: MembershipRow[] = (initialCollection?.eventOverrides ?? []).map((o) => ({
    id: o.eventId, primaryLabel: o.eventTitle ?? "(unknown event)", secondaryLabel: null, action: o.action, boost: o.boost,
  }));
  const initialGuideRows: GuideMembershipRow[] = (initialCollection?.guideItems ?? []).map((g) => {
    const candidate = guideCandidates.find((c) => c.id === g.guideId);
    return { id: g.guideId, title: g.guideTitle ?? "(unknown guide)", status: candidate?.status ?? "published" };
  });

  const geographyChangedWithMembership =
    mode === "edit" &&
    initialCollection !== undefined &&
    initialCollection !== null &&
    (marketId !== initialCollection.marketId || cityId !== initialCollection.cityId) &&
    (initialCollection.venueOverrides.length > 0 ||
      initialCollection.eventOverrides.length > 0 ||
      initialCollection.guideItems.length > 0);

  const err = state.fieldErrors ?? {};

  // Warn before an accidental tab close / navigation away with unsaved edits.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Dynamic create-button label (Primary Goal #2/#3) ──────────────────────
  function createButtonLabel(): string {
    if (!collectionType) return "Create Collection";
    if (collectionType === "guide") return "Create Collection & Choose Guides";
    if (curationMode === "algorithmic") return "Create Collection & Generate";
    return collectionType === "venue" ? "Create Collection & Choose Venues" : "Create Collection & Choose Events";
  }

  return (
    <form action={formAction} onChange={() => setDirty(true)} className="space-y-6">
      {state.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">{state.error}</div>
      )}

      <div className="space-y-6 max-w-3xl">
        {/* Collection Details */}
        <section className={sectionCls}>
          <h2 className={sectionTitleCls}>Collection Details</h2>
          <div>
            <label className={labelCls} htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Patio Picks — Kelowna"
              className={inputCls}
            />
            {err.name && <p className={errorCls}>{err.name}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="description">
              Internal Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
            <p className={hintCls}>For administrators only — never shown publicly.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="collection_type">Collection Type</label>
            {mode === "edit" ? (
              <>
                <input type="hidden" name="collection_type" value={collectionType} />
                <p className="text-sm text-slate-700 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  {TYPE_OPTIONS.find((o) => o.value === collectionType)?.label}
                </p>
                <p className={hintCls}>
                  Collection Type can&apos;t be changed after creation — it determines which content and
                  algorithms are compatible. Create a new Collection for a different type.
                </p>
              </>
            ) : (
              <>
                <select
                  id="collection_type"
                  name="collection_type"
                  value={collectionType}
                  onChange={(e) => handleTypeChange(e.target.value as CollectionType)}
                  className={inputCls}
                >
                  <option value="">Select a Collection type…</option>
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {err.collection_type && <p className={errorCls}>{err.collection_type}</p>}
              </>
            )}
          </div>
        </section>

        {/* Geography */}
        <section className={sectionCls}>
          <h2 className={sectionTitleCls}>Geography</h2>
          <p className={hintCls}>
            A Market Collection may include content from any city in that market. A City Collection only
            includes content from that one city.
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
                City <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select
                id="city_id"
                name="city_id"
                value={cityId}
                onChange={(e) => setCityId(e.target.value)}
                disabled={!marketId}
                className={inputCls}
              >
                <option value="">{marketId ? "None — Market Collection" : "Select a market first"}</option>
                {filteredCities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className={hintCls}>
                {cityId ? "City Collection" : marketId ? "Market Collection" : "Select a market to continue."}
              </p>
            </div>
          </div>
          {geographyChangedWithMembership && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
              This Collection has existing content membership. Changing Market/City will be rejected on save —
              remove all content in Resolved Collection below first, save, then change geography.
            </p>
          )}
        </section>

        {/* Curation Method */}
        <section className={sectionCls}>
          <h2 className={sectionTitleCls}>Curation Method</h2>
          {isGuideType ? (
            <p className="text-sm text-gray-500">
              Guide Collections are manual-only in V1 — there&apos;s no algorithmic guide feed yet. Add and order
              guides directly in Resolved Collection below.
            </p>
          ) : (
            <>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="curation_mode_ui"
                    checked={curationMode === "manual"}
                    onChange={() => handleCurationModeChange("manual")}
                    className="text-amber-500 focus:ring-amber-400"
                  />
                  Manual
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="curation_mode_ui"
                    checked={curationMode === "algorithmic"}
                    onChange={() => handleCurationModeChange("algorithmic")}
                    disabled={algorithmOptions.length === 0}
                    className="text-amber-500 focus:ring-amber-400"
                  />
                  Algorithmic
                </label>
              </div>
              {curationMode === "manual" && (
                <p className={hintCls}>
                  Content is selected and ordered entirely by hand in Resolved Collection below.
                </p>
              )}
              {curationMode === "algorithmic" && (
                <>
                  <div>
                    <label className={labelCls} htmlFor="algorithm_key">Algorithm</label>
                    <select
                      id="algorithm_key"
                      name="algorithm_key"
                      value={algorithmKey}
                      onChange={(e) => setAlgorithmKey(e.target.value as AlgorithmKey)}
                      className={inputCls}
                    >
                      <option value="">Select an algorithm…</option>
                      {algorithmOptions.map((key) => (
                        <option key={key} value={key}>{RAIL_LABELS[key as RailKey]}</option>
                      ))}
                    </select>
                    {err.algorithm_key && <p className={errorCls}>{err.algorithm_key}</p>}
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="item_limit">
                      Item Limit <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      id="item_limit"
                      name="item_limit"
                      type="number"
                      min={1}
                      value={itemLimit}
                      onChange={(e) => setItemLimit(e.target.value)}
                      placeholder="No cap"
                      className={inputCls}
                    />
                    {err.item_limit && <p className={errorCls}>{err.item_limit}</p>}
                  </div>
                  <p className={hintCls}>
                    Generate the Collection below to run this algorithm now. Manual includes, excludes, and
                    boosts refine that result — they don&apos;t replace it. Changing the algorithm or item limit
                    after generating marks the result stale until you generate again.
                  </p>
                </>
              )}
              {!curationMode && algorithmOptions.length === 0 && (
                <p className={hintCls}>No algorithms are available for this Collection Type yet.</p>
              )}
              {/* Manual mode always submits algorithm_key = "" (null) and no item_limit. */}
              {curationMode === "manual" && <input type="hidden" name="algorithm_key" value="" />}
            </>
          )}
          {isGuideType && <input type="hidden" name="algorithm_key" value="" />}
        </section>

        {/* Resolved Collection — edit mode only. Manual: the membership
            picker itself. Algorithmic: Generate Collection + the merged
            algorithm/manual result table. Neither is a "preview" of a public
            page — no Collection landing page exists yet (see module
            docstring). */}
        {mode === "edit" && initialCollection && (
          <section id="collection-content" className={`${sectionCls} scroll-mt-8`}>
            <h2 className={sectionTitleCls}>Resolved Collection</h2>
            {collectionType === "venue" && (
              <ResolvedCollectionTable
                kind="venue"
                fieldName="venue_overrides"
                marketId={marketId}
                cityId={cityId || null}
                algorithmic={algorithmic}
                algorithmKey={algorithmKeyValue}
                itemLimit={itemLimitNumber}
                initialOverrideRows={initialVenueRows}
              />
            )}
            {collectionType === "event" && (
              <ResolvedCollectionTable
                kind="event"
                fieldName="event_overrides"
                marketId={marketId}
                cityId={cityId || null}
                algorithmic={algorithmic}
                algorithmKey={algorithmKeyValue}
                itemLimit={itemLimitNumber}
                initialOverrideRows={initialEventRows}
              />
            )}
            {collectionType === "guide" && (
              <CollectionGuidePicker candidates={guideCandidates} initialRows={initialGuideRows} />
            )}
          </section>
        )}

        {/* Usage — edit mode only, always read-only */}
        {mode === "edit" && initialCollection && (
          <section className={sectionCls}>
            <h2 className={sectionTitleCls}>Homepage Usage</h2>
            <CollectionUsageSection usage={initialCollection.usage} />
          </section>
        )}

        {/* Status */}
        <section className={sectionCls}>
          <h2 className={sectionTitleCls}>Status</h2>
          <div>
            <label className={labelCls} htmlFor="status">Status</label>
            <select
              id="status"
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as CollectionStatus)}
              className={inputCls}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {err.status && <p className={errorCls}>{err.status}</p>}
            <div className="mt-2 space-y-1.5">
              <p className={hintCls}>
                Draft Collections can be saved incomplete while you work — they&apos;re never assignable to a
                Homepage Section until Published.
              </p>
              <p className={hintCls}>
                Published requires at least one resolved item for the current geography and curation method.
                A Collection does not need to be used by any Homepage to be Published — Homepage assignment
                happens later, from Homepage Management.
              </p>
              <p className={hintCls}>
                If publishing fails, nothing is saved and this Collection stays exactly as it was — fix the
                issue described above and try again, or choose Draft.
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
            {isPending ? "Saving…" : mode === "create" ? createButtonLabel() : "Save Changes"}
          </button>
          <Link href="/control-panel/collections" className="px-5 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </Link>
        </div>
        {mode === "create" && (
          <p className="text-xs text-gray-400 -mt-3">
            The Collection is created first with these settings. Content selection and refinement happen on
            the next screen.
          </p>
        )}
      </div>
    </form>
  );
}
