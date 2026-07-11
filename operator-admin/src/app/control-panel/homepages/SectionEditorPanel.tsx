"use client";

import { useState, useTransition } from "react";
import {
  HOMEPAGE_SECTION_KINDS,
  SECTION_KIND_LABELS,
  toSectionKind,
  fromSectionKind,
  type HomepageSection,
  type HomepageSectionKind,
  type HomepageGuideFeatureCandidate,
} from "@/lib/data/homepagesShared";
import type { CollectionSummary } from "@/lib/data/collectionsShared";
import {
  createSectionAction,
  updateSectionAction,
  searchHomepageVenueFeatureCandidatesAction,
  searchHomepageEventFeatureCandidatesAction,
} from "./actions";
import FeatureContentPicker from "./FeatureContentPicker";
import GuideFeaturePicker from "./GuideFeaturePicker";

/**
 * The Add Section / Edit Section drawer — the same editor reopens for both
 * (approved behavior: "Edit should reopen the same editor used during
 * creation"). Structure mirrors the one existing slide-over precedent in
 * this codebase (control-panel/settings/HhReviewTable.tsx's HhFixPanel):
 * backdrop + right-side panel + header + scrollable body + footer. No
 * nested <form> — this lives inside HomepageForm's outer <form>, so it uses
 * plain controlled inputs and type="button" throughout, exactly like
 * ResolvedCollectionTable.tsx / AttachmentsSelector.tsx / CollectionGuidePicker.tsx.
 *
 * Section Type is chosen once, at creation, and locked afterward (shown as
 * read-only text in edit mode) — the approved behavior only allows changing
 * the heading and the selected content on Edit, never the Section Type.
 */

type HomepageGeography = { marketId: string; cityId: string | null };

type UsedIds = {
  collectionIds: Set<string>;
  venueIds: Set<string>;
  eventIds: Set<string>;
  guideIds: Set<string>;
};

type Props = {
  mode: "create" | "edit";
  homepageId: string;
  homepageGeography: HomepageGeography;
  existingSection: HomepageSection | null;
  usedIds: UsedIds;
  assignableCollections: { venue: CollectionSummary[]; event: CollectionSummary[]; guide: CollectionSummary[] };
  assignableGuideFeatures: HomepageGuideFeatureCandidate[];
  onClose: () => void;
  onSaved: (sections: HomepageSection[]) => void;
};

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none disabled:bg-gray-50 disabled:text-gray-400";
const labelCls = "block text-sm font-medium text-gray-700 mb-1";

export default function SectionEditorPanel({
  mode,
  homepageId,
  homepageGeography,
  existingSection,
  usedIds,
  assignableCollections,
  assignableGuideFeatures,
  onClose,
  onSaved,
}: Props) {
  const [kind, setKind] = useState<HomepageSectionKind>(
    existingSection ? toSectionKind(existingSection.sectionType, existingSection.contentMode) : "venue_collection"
  );
  const { sectionType, contentMode } = fromSectionKind(kind);

  const [title, setTitle] = useState(existingSection?.title ?? "");
  const [collectionId, setCollectionId] = useState<string | null>(existingSection?.collectionId ?? null);
  const [featureId, setFeatureId] = useState<string | null>(
    existingSection ? existingSection.venueId ?? existingSection.eventId ?? existingSection.guideId ?? null : null
  );
  const [featureLabel, setFeatureLabel] = useState<string | null>(existingSection?.feature?.name ?? null);
  const [featureSecondaryLabel, setFeatureSecondaryLabel] = useState<string | null>(
    existingSection?.feature?.secondaryLabel ?? null
  );

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleKindChange(next: HomepageSectionKind) {
    setKind(next);
    // Content is only meaningful for the previously-selected kind — reset it
    // rather than risk submitting a venue id under a newly-chosen Event kind.
    setCollectionId(null);
    setFeatureId(null);
    setFeatureLabel(null);
    setFeatureSecondaryLabel(null);
  }

  const collectionCandidates = assignableCollections[sectionType];
  const contentSelected = contentMode === "collection" ? collectionId !== null : featureId !== null;
  const canSubmit = title.trim() !== "" && contentSelected;

  function handleSubmit() {
    setError(null);
    const content = {
      collectionId: contentMode === "collection" ? collectionId : null,
      venueId: contentMode === "feature" && sectionType === "venue" ? featureId : null,
      eventId: contentMode === "feature" && sectionType === "event" ? featureId : null,
      guideId: contentMode === "feature" && sectionType === "guide" ? featureId : null,
    };

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createSectionAction(homepageId, { sectionType, contentMode, title, ...content })
          : await updateSectionAction(homepageId, existingSection!.id, { title, ...content });

      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved(result.sections);
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {mode === "create" ? "Add Section" : "Edit Section"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {mode === "create"
                ? "Choose a Section Type, give it a public heading, then select the content to use."
                : "Change the public heading or select different compatible content."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Step 1 — Section Type (locked once created) */}
          <div>
            <label className={labelCls} htmlFor="section_kind">Section Type</label>
            {mode === "create" ? (
              <select
                id="section_kind"
                value={kind}
                onChange={(e) => handleKindChange(e.target.value as HomepageSectionKind)}
                className={inputCls}
              >
                {HOMEPAGE_SECTION_KINDS.map((k) => (
                  <option key={k} value={k}>{SECTION_KIND_LABELS[k]}</option>
                ))}
              </select>
            ) : (
              <p className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-gray-50">
                {SECTION_KIND_LABELS[kind]}
              </p>
            )}
          </div>

          {/* Step 2 — Public heading */}
          <div>
            <label className={labelCls} htmlFor="section_title">Public Heading</label>
            <input
              id="section_title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Patio Picks"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-gray-400">
              Shown to visitors on the public Homepage. Doesn&apos;t change the underlying{" "}
              {contentMode === "collection" ? "Collection" : "content"}&apos;s own name.
            </p>
          </div>

          {/* Step 3 — Content selection */}
          <div>
            <label className={labelCls}>
              {contentMode === "collection" ? "Collection" : "Content"}
            </label>

            {contentMode === "collection" && (
              collectionCandidates.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No published {sectionType} Collections available for this Homepage&apos;s geography.
                </p>
              ) : (
                <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                  {collectionCandidates.map((c) => {
                    const used = usedIds.collectionIds.has(c.id);
                    const isSelected = collectionId === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={used}
                          onClick={() => setCollectionId(c.id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                            used ? "opacity-50 cursor-not-allowed" : isSelected ? "bg-amber-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <span className="font-medium text-slate-800 truncate">{c.name}</span>
                          {used ? (
                            <span className="ml-2 text-xs font-medium text-amber-600 shrink-0">Already used on this Homepage</span>
                          ) : isSelected ? (
                            <span className="ml-2 text-xs font-medium text-amber-600 shrink-0">Selected</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}

            {contentMode === "feature" && sectionType === "venue" && (
              <FeatureContentPicker
                label="venue"
                marketId={homepageGeography.marketId}
                cityId={homepageGeography.cityId}
                searchAction={searchHomepageVenueFeatureCandidatesAction}
                usedIds={usedIds.venueIds}
                selected={featureId ? { id: featureId, label: featureLabel ?? "", secondaryLabel: featureSecondaryLabel } : null}
                onSelect={(c) => {
                  setFeatureId(c.id);
                  setFeatureLabel(c.label);
                  setFeatureSecondaryLabel(c.secondaryLabel);
                }}
                onClear={() => {
                  setFeatureId(null);
                  setFeatureLabel(null);
                  setFeatureSecondaryLabel(null);
                }}
              />
            )}

            {contentMode === "feature" && sectionType === "event" && (
              <FeatureContentPicker
                label="event"
                marketId={homepageGeography.marketId}
                cityId={homepageGeography.cityId}
                searchAction={searchHomepageEventFeatureCandidatesAction}
                usedIds={usedIds.eventIds}
                selected={featureId ? { id: featureId, label: featureLabel ?? "", secondaryLabel: featureSecondaryLabel } : null}
                onSelect={(c) => {
                  setFeatureId(c.id);
                  setFeatureLabel(c.label);
                  setFeatureSecondaryLabel(c.secondaryLabel);
                }}
                onClear={() => {
                  setFeatureId(null);
                  setFeatureLabel(null);
                  setFeatureSecondaryLabel(null);
                }}
              />
            )}

            {contentMode === "feature" && sectionType === "guide" && (
              <GuideFeaturePicker
                candidates={assignableGuideFeatures}
                usedIds={usedIds.guideIds}
                selected={featureId ? { id: featureId, label: featureLabel ?? "" } : null}
                onSelect={(c) => {
                  setFeatureId(c.id);
                  setFeatureLabel(c.label);
                }}
                onClear={() => {
                  setFeatureId(null);
                  setFeatureLabel(null);
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isPending}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving…" : mode === "create" ? "Add Section" : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
