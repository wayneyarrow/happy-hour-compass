"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { MarketRecord, CityRecord } from "@/lib/geo/types";
import type {
  CollectionDetail,
  CollectionType,
  CollectionStatus,
  AlgorithmKey,
  CollectionUsageEntry,
} from "@/lib/data/collectionsShared";
import { ALGORITHM_KEYS, ALGORITHM_COLLECTION_TYPE } from "@/lib/data/collectionsShared";
import type { GuideCandidate } from "@/lib/data/collections";
import type { CollectionPreviewResult } from "@/lib/data/collectionsPreview";
import { RAIL_LABELS, type RailKey } from "@/lib/data/discoverOverridesShared";
import {
  createCollectionAction,
  updateCollectionAction,
  archiveCollectionAction,
  restoreCollectionAction,
  type CollectionFormState,
  type ArchiveActionState,
} from "./actions";
import ResolvedCollectionTable, { type MembershipRow } from "./ResolvedCollectionTable";
import CollectionGuidePicker, { type GuideMembershipRow } from "./CollectionGuidePicker";
import CollectionUsageSection from "./CollectionUsageSection";

/**
 * Shared create/edit form for Collections Management V1
 * (docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md), following the same
 * one-page sectioned editor pattern as GuideForm.tsx.
 *
 * Create mode has exactly one job: create the Collection shell (name,
 * geography, curation method) so it receives an id. It intentionally omits
 * Resolved Collection, Homepage Usage, Status, and Archive — those belong to
 * the full editor. Every new Collection is created as Draft (enforced
 * server-side in createCollectionAction, not just hidden here) so an editor
 * never has to decide Draft vs Published before any content exists. Create
 * mode stays a single column (no right rail) — the two-column layout below
 * is edit-mode only, since Homepage Usage/Checklist/Archive only make sense
 * once a Collection actually exists.
 *
 * Edit mode is a two-column desktop layout (single column on mobile/narrow
 * screens — no sticky positioning there): the main column is the
 * uninterrupted creation/refinement workflow (Details → Geography →
 * Curation Method → Resolved Collection → Status → Save Changes → Archive),
 * and a sticky right rail holds the Homepage Usage card and the Collection
 * Checklist, mirroring GuideForm.tsx's `grid-cols-[1fr_280px]` +
 * `lg:sticky lg:top-8` checklist pattern exactly. `mainColumnSections` below
 * is written once and rendered inside whichever outer wrapper the mode
 * needs — the actual section JSX is never duplicated between modes.
 *
 * On success, the create action redirects straight into the full editor
 * (mode="edit") with a `#collection-content` URL fragment so the browser
 * lands the admin directly on the Resolved Collection section. That native
 * hash-jump is instant/abrupt and depends on browser timing, so
 * `scrollToContentOnMount` (passed by the Edit page when `success=created`)
 * additionally triggers a JS-driven `scrollIntoView({behavior:"smooth"})`
 * once this component has hydrated — robust regardless of hydration timing,
 * and never a fixed pixel offset (`#collection-content`'s `scroll-mt-8`
 * class handles top spacing either way). No field is focused — only
 * scrolling — so keyboard focus stays exactly where the browser would
 * otherwise have put it.
 *
 * Resolved Collection (this replaced an earlier, disconnected split between
 * a "Content Membership" picker and a separate read-only "Preview" section —
 * browser QA found that confusing). It's now one section:
 *   - Manual Collections: the section IS the membership list (search, add,
 *     remove, reorder) — no separate preview needed.
 *   - Algorithmic Collections: resolved automatically (see resolvedResult/
 *     resolvedError below) — there is no "Generate"/"Regenerate" button
 *     anywhere in the normal Edit flow (see ResolvedCollectionTable.tsx's
 *     module docstring). Nothing here is labeled "Preview" — there is no
 *     public Collection landing page yet to preview against (see product
 *     spec, "Collection Landing Pages"); this is purely the admin's working
 *     area for editorially refining the Collection's contents.
 *
 * Create-mode Curation Method starts unselected (curationMode === null) —
 * the editor must deliberately pick Manual or Algorithmic rather than
 * silently inheriting a default. Because Resolved Collection/Usage/Status
 * are edit-only (gated below), the shared Save/Cancel row that follows the
 * Curation Method section is already the next thing rendered in create
 * mode — no separate "Create Collection" section exists to remove. That
 * button is gated by `canCreate` (mode="create" only) so it stays disabled
 * until the chosen method's own required fields are valid, and its label
 * reads "Continue" rather than "Save Changes" to reflect that it's the
 * create action, not a mid-editor save.
 *
 * Approved V1 product rule: "Algorithmic Collections are generated once
 * during creation." Item limit is required for Algorithmic Collections on
 * create — it's what that one generation runs against: clicking Continue
 * creates the Draft, and the Edit page's initial load resolves the base
 * pool automatically (see resolveCollectionPreviewById in
 * collectionsPreview.ts), seeding ResolvedCollectionTable with the result
 * via the resolvedResult/resolvedError props below — the editor lands on an
 * already-populated Resolved Collection, no manual click required. After
 * that first creation, Curation Method, Algorithm, and Item Limit are
 * locked: edit mode renders them as a read-only summary (see the Curation
 * Method section below), never an editable selector/dropdown/input, and
 * updateCollectionAction (actions.ts) enforces the lock server-side —
 * always preserving the Collection's own stored values, never reading
 * algorithm_key/item_limit from the submitted form at all. This applies to
 * Manual Collections too (Curation Method itself is locked in both
 * directions) for consistency — a Manual Collection can't be silently
 * switched to Algorithmic through Save Changes with no "generate once"
 * moment to match. The Edit page's initial load still resolves an
 * Algorithmic Collection's current base pool on *every* visit (not just
 * right after creation) — see collections/[id]/edit/page.tsx — since that's
 * necessary display/loading behavior (stored overrides need to be re-merged
 * with the algorithm's pool on every view), distinct from the removed
 * user-triggered regeneration.
 *
 * Archive lifecycle (migration 059) is deliberately separate from the
 * editorial `status` field — see collections.archived_at's migration
 * COMMENT for the full rationale. The Archive section (edit mode only,
 * bottom of the main column) is its own independent <form> — sibling to,
 * not nested inside, the Save Changes <form> (HTML forbids nested forms) —
 * so archiving/restoring never depends on or interferes with the rest of
 * the editor's unsaved state.
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
  /** The Edit page's own server-side resolution of an Algorithmic Collection's current base pool — passed on every Edit-page visit, not just after creation. See ResolvedCollectionTable's module docstring. */
  resolvedResult?: CollectionPreviewResult | null;
  /** A resolution failure from that same server-side load. */
  resolvedError?: string | null;
  /** True only right after a fresh create-and-redirect (`success=created`) — triggers the one-time smooth-scroll to Resolved Collection. See module docstring. */
  scrollToContentOnMount?: boolean;
};

export default function CollectionForm({
  mode,
  initialCollection,
  markets,
  cities,
  guideCandidates = [],
  resolvedResult = null,
  resolvedError = null,
  scrollToContentOnMount = false,
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
  // Edit mode always has a concrete, previously-saved method. Create mode
  // starts unselected (null) — neither radio is checked, Algorithmic
  // configuration stays hidden, and Continue stays disabled — until the
  // editor deliberately picks one (see module docstring).
  const [curationMode, setCurationMode] = useState<"manual" | "algorithmic" | null>(
    initialCollection ? (initialCollection.algorithmKey ? "algorithmic" : "manual") : null
  );
  const [algorithmKey, setAlgorithmKey] = useState<AlgorithmKey | "">(initialCollection?.algorithmKey ?? "");
  const [itemLimit, setItemLimit] = useState(initialCollection?.itemLimit?.toString() ?? "");
  const [status, setStatus] = useState<CollectionStatus>(initialCollection?.status ?? "draft");

  // Defensive re-sync: if a failed submit ever arrives after this component
  // re-mounted (so its local state no longer reflects what was submitted),
  // restore exactly what was attempted — including the chosen Published
  // status in edit mode — rather than silently showing stale initial values.
  // In the normal case (no remount) this is a no-op, since local state
  // already matches what was submitted.
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

  // ── Continue enablement (create mode only) ────────────────────────────────
  // Mirrors the server's own validation (createCollectionAction / parseItemLimit
  // in actions.ts) closely enough to gate the button responsively, without
  // being the source of truth — the server re-validates everything on submit
  // regardless of what this computes.
  //
  // Item limit is required for Algorithmic Collections on create — it drives
  // the one-time automatic generation that happens right after (see module
  // docstring). itemLimitFormatValid/itemLimitValid/curationMethodValid are
  // computed unconditionally but only ever consumed via `canCreate`, which
  // only gates the create-mode Continue button below — edit mode no longer
  // renders any algorithm_key/item_limit input at all (Curation Method is
  // locked, read-only there), so these are effectively inert in edit mode.
  // curationMethodValid is also reused below as the Collection Checklist's
  // "Curation method configured" item (always true in edit mode, since it's
  // locked-valid by construction there).
  const itemLimitFormatValid =
    itemLimit.trim() === "" || (Number.isInteger(Number(itemLimit)) && Number(itemLimit) > 0);
  const itemLimitValid =
    mode === "create" ? itemLimit.trim() !== "" && itemLimitFormatValid : itemLimitFormatValid;
  const curationMethodValid = isGuideType
    ? true
    : curationMode === "manual"
      ? true
      : curationMode === "algorithmic"
        ? Boolean(algorithmKey) && itemLimitValid
        : false; // curationMode === null — not yet deliberately chosen
  const canCreate =
    name.trim() !== "" && collectionType !== "" && marketId !== "" && curationMethodValid;

  function handleMarketChange(nextMarketId: string) {
    setMarketId(nextMarketId);
    const stillValid = cities.some((c) => c.id === cityId && c.marketId === nextMarketId);
    if (!stillValid) setCityId("");
  }

  function handleTypeChange(nextType: CollectionType) {
    const previousType = collectionType;
    setCollectionType(nextType);
    if (nextType === "guide") {
      // Guide Collections are manual-only in V1 — there's no choice to make,
      // so this is an implied default, not a deliberate pick.
      setCurationMode("manual");
      setAlgorithmKey("");
    } else {
      // Coming back from Guide, "manual" was only ever implied — require a
      // fresh, deliberate choice now that Algorithmic is available again.
      if (previousType === "guide") setCurationMode(null);
      // Algorithm options are type-specific — clear a now-incompatible selection.
      if (algorithmKey && ALGORITHM_COLLECTION_TYPE[algorithmKey] !== nextType) {
        setAlgorithmKey("");
      }
    }
  }

  function handleCurationModeChange(nextMode: "manual" | "algorithmic") {
    setCurationMode(nextMode);
    if (nextMode === "manual") setAlgorithmKey("");
  }

  // Membership rows, mapped from initialCollection for edit mode. reasonType
  // carries forward from the DB row (see MembershipRow's doc comment in
  // ResolvedCollectionTable.tsx) so a previously-saved manual add is still
  // recognized as manual — not merely re-derived from natural-pool membership.
  const initialVenueRows: MembershipRow[] = (initialCollection?.venueOverrides ?? []).map((o) => ({
    id: o.venueId, primaryLabel: o.venueName ?? "(unknown venue)", secondaryLabel: null, action: o.action, boost: o.boost, reasonType: o.reasonType,
  }));
  const initialEventRows: MembershipRow[] = (initialCollection?.eventOverrides ?? []).map((o) => ({
    id: o.eventId, primaryLabel: o.eventTitle ?? "(unknown event)", secondaryLabel: null, action: o.action, boost: o.boost, reasonType: o.reasonType,
  }));
  const initialGuideRows: GuideMembershipRow[] = (initialCollection?.guideItems ?? []).map((g) => {
    const candidate = guideCandidates.find((c) => c.id === g.guideId);
    return { id: g.guideId, title: g.guideTitle ?? "(unknown guide)", status: candidate?.status ?? "published" };
  });

  // Collection Checklist's "at least one resolved item" — initialized
  // directly from already-loaded data (no flash of "incomplete" before a
  // child effect corrects it — mirrors GuideForm.tsx's
  // `useState(initialAttachments.length)` convention), then kept live via
  // onResolvedCountChange/onRowsChange as the editor adds/excludes/removes
  // content (see ResolvedCollectionTable.tsx and CollectionGuidePicker.tsx).
  const initialResolvedCount = isGuideType
    ? initialGuideRows.length
    : algorithmic
      ? resolvedResult?.items.length ?? 0
      : (collectionType === "event" ? initialEventRows : initialVenueRows).filter((r) => r.action === "include").length;
  const [resolvedItemCount, setResolvedItemCount] = useState(initialResolvedCount);

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

  // Smooth-scroll to Resolved Collection right after a fresh create-and-
  // redirect — see module docstring. Runs once; no field is ever focused.
  useEffect(() => {
    if (!scrollToContentOnMount) return;
    document.getElementById("collection-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Collection Checklist (edit mode only — see render below) ─────────────
  // "Ready for homepage use" deliberately reuses the same signals the
  // server's own Publish validation checks (name/geography/curation method
  // valid + at least one resolved item — see updateCollectionAction's
  // Publishing validation block) rather than inventing a second ruleset, per
  // product ask.
  const nameComplete = name.trim() !== "";
  const geographyComplete = marketId !== "";
  const hasResolvedItem = resolvedItemCount > 0;
  const readyForHomepageUse = nameComplete && geographyComplete && curationMethodValid && hasResolvedItem;
  const checklist: ChecklistItem[] = [
    { label: "Collection name added", complete: nameComplete },
    { label: "Description added", complete: description.trim() !== "", optional: true },
    { label: "Geography selected", complete: geographyComplete },
    { label: "Curation method configured", complete: curationMethodValid },
    { label: "Collection contains at least one resolved item", complete: hasResolvedItem },
    { label: "Status selected", complete: true },
    { label: "Ready for homepage use", complete: readyForHomepageUse },
  ];

  const mainColumnSections = (
    <>
      {state.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">{state.error}</div>
      )}

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

      {/* Curation Method — locked after creation in edit mode (see module
          docstring). Create mode is unchanged: a deliberate Manual/
          Algorithmic choice, with Algorithm + Item Limit required for
          Algorithmic. */}
      <section className={sectionCls}>
        <h2 className={sectionTitleCls}>Curation Method</h2>
        {isGuideType ? (
          <p className="text-sm text-gray-500">
            Guide Collections are manual-only in V1 — there&apos;s no algorithmic guide feed yet.{" "}
            {mode === "edit"
              ? "Add and order guides directly in Resolved Collection below."
              : "You'll add and order guides on the next screen."}
          </p>
        ) : mode === "edit" ? (
          <div className="space-y-3">
            <div>
              <span className={labelCls}>Curation Method</span>
              <p className="text-sm text-slate-700 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                {algorithmic ? "Algorithmic" : "Manual"}
              </p>
            </div>
            {algorithmic && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className={labelCls}>Algorithm</span>
                  <p className="text-sm text-slate-700 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                    {algorithmKey ? RAIL_LABELS[algorithmKey as RailKey] : "—"}
                  </p>
                </div>
                <div>
                  <span className={labelCls}>Item Limit</span>
                  <p className="text-sm text-slate-700 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                    {itemLimit.trim() !== "" ? itemLimit : "Not set"}
                  </p>
                </div>
              </div>
            )}
            <p className={hintCls}>
              {algorithmic
                ? "This Collection was created Algorithmically — its setup is fixed. Curate the resolved " +
                  "items in Resolved Collection below."
                : "Curation Method can't be changed after creation. Add and order content in Resolved " +
                  "Collection below."}
            </p>
          </div>
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
              <p className={hintCls}>You&apos;ll select and order content entirely by hand on the next screen.</p>
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
                  <label className={labelCls} htmlFor="item_limit">Item Limit</label>
                  <input
                    id="item_limit"
                    name="item_limit"
                    type="number"
                    min={1}
                    value={itemLimit}
                    onChange={(e) => setItemLimit(e.target.value)}
                    placeholder="e.g. 12"
                    className={inputCls}
                  />
                  {err.item_limit && <p className={errorCls}>{err.item_limit}</p>}
                  {!err.item_limit && itemLimit.trim() !== "" && !itemLimitFormatValid && (
                    <p className={errorCls}>Item limit must be a positive whole number.</p>
                  )}
                </div>
                <p className={hintCls}>
                  This Collection will be generated automatically when you click Continue, and its setup —
                  Algorithm and Item Limit — is fixed after that. Manual includes, excludes, and boosts on
                  the next screen refine the result — they don&apos;t replace it.
                </p>
              </>
            )}
            {!curationMode && algorithmOptions.length === 0 && (
              <p className={hintCls}>No algorithms are available for this Collection Type yet.</p>
            )}
            {!curationMode && algorithmOptions.length > 0 && (
              <p className={hintCls}>Choose Manual or Algorithmic to continue.</p>
            )}
            {/* Manual mode always submits algorithm_key = "" (null) and no item_limit. */}
            {curationMode === "manual" && <input type="hidden" name="algorithm_key" value="" />}
          </>
        )}
        {isGuideType && mode === "create" && <input type="hidden" name="algorithm_key" value="" />}
      </section>

      {/* Resolved Collection — edit mode only. Manual: the membership
          picker itself. Algorithmic: the auto-resolved algorithm/manual
          result table (see module docstring — resolved automatically on
          every visit, no Generate/Regenerate button). Neither is a
          "preview" of a public page — no Collection landing page exists
          yet (see module docstring). */}
      {mode === "edit" && initialCollection && (
        <section id="collection-content" className={`${sectionCls} scroll-mt-8`}>
          <h2 className={sectionTitleCls}>Resolved Collection</h2>
          <p className={hintCls}>
            {algorithmic
              ? "This Collection's resolved items, from its Algorithmic setup — refine them with additions, " +
                "exclusions, boosts, and ordering."
              : "Add and order the content that belongs in this Collection."}
          </p>
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
              resolvedResult={resolvedResult}
              resolvedError={resolvedError}
              onResolvedCountChange={setResolvedItemCount}
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
              resolvedResult={resolvedResult}
              resolvedError={resolvedError}
              onResolvedCountChange={setResolvedItemCount}
            />
          )}
          {collectionType === "guide" && (
            <CollectionGuidePicker
              candidates={guideCandidates}
              initialRows={initialGuideRows}
              onRowsChange={setResolvedItemCount}
            />
          )}
        </section>
      )}

      {/* Status — edit mode only. Every new Collection is created as Draft
          (createCollectionAction ignores any submitted status); publishing
          is a decision made here, after content exists, never on the
          create page. */}
      {mode === "edit" && (
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
                A Collection can be Published without being assigned to a Homepage.
              </p>
              <p className={hintCls}>
                If publishing fails, nothing is saved and this Collection stays exactly as it was — fix the
                issue described above and try again, or choose Draft.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Continue (create) / Save Changes (edit). In create mode this
          renders directly below Curation Method — Resolved Collection and
          Status are edit-only, so nothing separates them (see module
          docstring). Continue is gated by `canCreate`; Save Changes keeps
          its existing isPending-only gating. Homepage Usage moved to the
          right rail (edit mode only) and never appears in this main
          column at all anymore. */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || (mode === "create" && !canCreate)}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {mode === "create"
            ? isPending ? "Creating…" : "Continue"
            : isPending ? "Saving…" : "Save Changes"}
        </button>
        <Link href="/control-panel/collections" className="px-5 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
          Cancel
        </Link>
      </div>
      {mode === "create" && (
        <p className="text-xs text-gray-400 -mt-3">
          This Collection is created as a Draft. You can add content and publish it on the next screen.
        </p>
      )}
    </>
  );

  if (mode === "edit" && initialCollection) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <form action={formAction} onChange={() => setDirty(true)} className="space-y-6">
            {mainColumnSections}
          </form>
          <ArchiveSection
            collectionId={initialCollection.id}
            collectionName={initialCollection.name}
            archivedAt={initialCollection.archivedAt}
            usageEntries={initialCollection.usage.entries}
          />
        </div>
        {/* Right rail — Homepage Usage above the Checklist, both inside one
            sticky container (desktop only; stacks naturally on mobile —
            `lg:sticky` never applies below the lg breakpoint). */}
        <div className="space-y-6 lg:sticky lg:top-8 lg:z-10">
          <CollectionUsageSection usage={initialCollection.usage} />
          <CollectionChecklist items={checklist} />
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} onChange={() => setDirty(true)} className="space-y-6 max-w-3xl">
      {mainColumnSections}
    </form>
  );
}

// ── Collection Checklist ─────────────────────────────────────────────────────
//
// Mirrors GuideForm.tsx's CompletionChecklist visual/interaction pattern
// exactly (card chrome, "X of Y complete" summary, ✓/○ row markers,
// "does not block saving" footnote) — reused rather than reinvented, per
// product ask. Extended with a third `optional` state so an incomplete-but-
// optional item (Description) never reads as a real gap: it gets a
// deliberately different marker/copy ("–" + "(optional)"), and never counts
// against the "X of Y" summary denominator, so filling it in is never what
// takes the count to 100%. A complete item always shows the same green
// check regardless of whether it was required or optional — "done is done".
type ChecklistItem = { label: string; complete: boolean; optional?: boolean };

function CollectionChecklist({ items }: { items: ChecklistItem[] }) {
  const requiredItems = items.filter((i) => !i.optional);
  const doneCount = requiredItems.filter((i) => i.complete).length;
  return (
    // Sticky positioning is applied by the parent rail container (both cards
    // scroll together as one unit), not per-card — see CollectionForm's
    // render.
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-slate-900 mb-1">Collection Checklist</h2>
      <p className="text-xs text-gray-400 mb-4">{doneCount} of {requiredItems.length} required items complete</p>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-sm">
            <span
              className={`inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
                item.complete
                  ? "bg-green-100 text-green-600"
                  : item.optional
                    ? "bg-gray-50 text-gray-300"
                    : "bg-gray-100 text-gray-300"
              }`}
              aria-hidden="true"
            >
              {item.complete ? "✓" : item.optional ? "–" : "○"}
            </span>
            <span className={item.complete ? "text-gray-700" : "text-gray-400"}>
              {item.label}
              {item.optional && !item.complete && <span className="text-gray-300"> (optional)</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-gray-400">This checklist is a guide only — it does not block saving.</p>
    </div>
  );
}

// ── Archive / restore ─────────────────────────────────────────────────────────
//
// Edit mode only, rendered as an independent <form> — sibling to, not
// nested inside, the Save Changes <form> above (HTML forbids nested forms).
// Mirrors the FAQ Library's isFaqInUse()-gated deleteFaqAction pattern (the
// "in use" protection precedent this reuses) — see archiveCollectionAction/
// archiveCollection (actions.ts / collections.ts) for the authoritative,
// server-side "not currently used by any Homepage" check; usageEntries here
// is only used to decide which of the three UI states to render and to list
// the blocking Homepage(s) by name.

type ArchiveSectionProps = {
  collectionId: string;
  collectionName: string;
  archivedAt: string | null;
  usageEntries: CollectionUsageEntry[];
};

function ArchiveSection({ collectionId, collectionName, archivedAt, usageEntries }: ArchiveSectionProps) {
  const router = useRouter();

  const boundArchive = archiveCollectionAction.bind(null, collectionId);
  const [archiveState, archiveFormAction, isArchivePending] = useActionState<ArchiveActionState, FormData>(
    boundArchive,
    {}
  );

  const boundRestore = restoreCollectionAction.bind(null, collectionId);
  const [restoreState, restoreFormAction, isRestorePending] = useActionState<ArchiveActionState, FormData>(
    boundRestore,
    {}
  );

  useEffect(() => {
    if (restoreState.success) router.refresh();
  }, [restoreState.success, router]);

  const confirmMessage =
    `Archive "${collectionName}"?\n\n` +
    "• It will disappear from the active Collections list.\n" +
    "• It will no longer be available for new Homepage Section assignments.\n" +
    "• Existing homepage usage must be removed before archiving" +
    (usageEntries.length === 0 ? " (this Collection isn't currently assigned to any Homepage)." : ".") +
    "\n\nThis can be undone later by restoring it.";

  return (
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>Archive</h2>

      {archivedAt ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            This Collection is archived — excluded from the active Collections list and unavailable for new
            Homepage Section assignments. It remains fully stored and can be restored at any time.
          </p>
          <form action={restoreFormAction}>
            <button
              type="submit"
              disabled={isRestorePending}
              className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRestorePending ? "Restoring…" : "Restore Collection"}
            </button>
          </form>
          {restoreState.error && <p className={errorCls}>{restoreState.error}</p>}
        </div>
      ) : usageEntries.length > 0 ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
          This Collection can&apos;t be archived while it&apos;s assigned to a Homepage:{" "}
          {usageEntries.map((e) => e.homepageName || e.homepageCityName || e.homepageMarketName).join(", ")}.
          Remove it from every section listed in Homepage Usage (right rail) first.
        </p>
      ) : (
        <div className="space-y-2">
          <p className={hintCls}>
            Archiving removes this Collection from active lists and new Homepage assignments without deleting
            it — it remains stored and can be restored at any time.
          </p>
          <form
            action={archiveFormAction}
            onSubmit={(e) => {
              if (!confirm(confirmMessage)) e.preventDefault();
            }}
          >
            <button
              type="submit"
              disabled={isArchivePending}
              className="px-4 py-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isArchivePending ? "Archiving…" : "Archive Collection"}
            </button>
          </form>
          {archiveState.error && <p className={errorCls}>{archiveState.error}</p>}
        </div>
      )}
    </section>
  );
}
