"use client";

import { useMemo, useState, useTransition } from "react";
import {
  SECTION_KIND_LABELS,
  toSectionKind,
  type HomepageSection,
  type HomepageGuideFeatureCandidate,
} from "@/lib/data/homepagesShared";
import type { CollectionSummary } from "@/lib/data/collectionsShared";
import { removeSectionAction, moveSectionAction } from "./actions";
import SectionEditorPanel from "./SectionEditorPanel";

/**
 * Homepage Sections editor V1 — the editorial assembly tool described in
 * the Homepage Sections editor task. Not a page builder: editors add
 * Sections top-down from six predefined Section Types (Venue/Event/Guide
 * Collection or Feature), one at a time, then reorder with Move Up/Down.
 * No drag-and-drop, no display/CTA/layout configuration — see
 * SectionEditorPanel.tsx for the Add/Edit editor itself.
 *
 * Sections are independently, immediately persisted (create/edit/remove/
 * reorder all call a server action directly, mirroring
 * ResolvedCollectionTable.tsx's override-editing pattern) rather than
 * staged until HomepageForm's own "Save Changes" — "the section is
 * immediately added to the bottom of the Homepage" is the approved
 * behavior for Add, and Remove/Move Up/Move Down read the same way. Every
 * mutation returns the Homepage's full, freshly-reloaded Section list,
 * which becomes this component's new source of truth (see actions.ts's
 * module docstring for why refetching the whole list is safe and cheap
 * here).
 */

type HomepageGeography = { marketId: string; cityId: string | null };

type Props = {
  homepageId: string;
  homepageGeography: HomepageGeography;
  initialSections: HomepageSection[];
  assignableCollections: { venue: CollectionSummary[]; event: CollectionSummary[]; guide: CollectionSummary[] };
  assignableGuideFeatures: HomepageGuideFeatureCandidate[];
};

type PanelState = { mode: "create" } | { mode: "edit"; section: HomepageSection } | null;

function contentTypeLabel(section: HomepageSection): string {
  if (section.contentMode === "collection") return "Collection";
  return section.sectionType === "venue" ? "Venue" : section.sectionType === "event" ? "Event" : "Guide";
}

export default function HomepageSectionsEditor({
  homepageId,
  homepageGeography,
  initialSections,
  assignableCollections,
  assignableGuideFeatures,
}: Props) {
  const [sections, setSections] = useState<HomepageSection[]>(initialSections);
  const [panelState, setPanelState] = useState<PanelState>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ordered = useMemo(() => [...sections].sort((a, b) => a.displayOrder - b.displayOrder), [sections]);

  // "Already used on this Homepage" — excludes the Section currently being
  // edited, so its own existing content doesn't grey itself out.
  const usedIds = useMemo(() => {
    const collectionIds = new Set<string>();
    const venueIds = new Set<string>();
    const eventIds = new Set<string>();
    const guideIds = new Set<string>();
    const excludeId = panelState?.mode === "edit" ? panelState.section.id : null;
    for (const s of sections) {
      if (s.id === excludeId) continue;
      if (s.collectionId) collectionIds.add(s.collectionId);
      if (s.venueId) venueIds.add(s.venueId);
      if (s.eventId) eventIds.add(s.eventId);
      if (s.guideId) guideIds.add(s.guideId);
    }
    return { collectionIds, venueIds, eventIds, guideIds };
  }, [sections, panelState]);

  function handleMove(sectionId: string, direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      const result = await moveSectionAction(homepageId, sectionId, direction);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSections(result.sections);
    });
  }

  function handleRemove(section: HomepageSection) {
    const confirmed = confirm(
      `Remove "${section.title}" from this Homepage? This won't delete the underlying ${contentTypeLabel(section)}.`
    );
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await removeSectionAction(homepageId, section.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSections(result.sections);
    });
  }

  function handleSaved(newSections: HomepageSection[]) {
    setSections(newSections);
    setPanelState(null);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {ordered.length === 0 ? (
        <div className="border border-dashed border-gray-200 rounded-lg px-4 py-8 text-center">
          <p className="text-sm text-gray-500 mb-1">No Sections yet.</p>
          <p className="text-xs text-gray-400">Add a Section below to start assembling this Homepage.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {ordered.map((section, index) => {
            const kind = toSectionKind(section.sectionType, section.contentMode);
            const usingLabel =
              section.contentMode === "collection"
                ? section.collection?.name ?? null
                : section.feature?.name ?? null;
            return (
              <li
                key={section.id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 truncate">{section.title}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0 whitespace-nowrap">
                      {SECTION_KIND_LABELS[kind]}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 truncate">
                    <span className="text-gray-400">Using: </span>
                    <span className={usingLabel ? "text-gray-600" : "text-amber-600"}>
                      {usingLabel ?? "No content assigned yet"}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleMove(section.id, "up")}
                    disabled={index === 0 || isPending}
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label={`Move ${section.title} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(section.id, "down")}
                    disabled={index === ordered.length - 1 || isPending}
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label={`Move ${section.title} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelState({ mode: "edit", section })}
                    disabled={isPending}
                    className="ml-1 text-xs font-medium text-amber-600 hover:text-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(section)}
                    disabled={isPending}
                    className="ml-1 text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setPanelState({ mode: "create" })}
        className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
      >
        + Add Section
      </button>

      {panelState && (
        <SectionEditorPanel
          mode={panelState.mode}
          homepageId={homepageId}
          homepageGeography={homepageGeography}
          existingSection={panelState.mode === "edit" ? panelState.section : null}
          usedIds={usedIds}
          assignableCollections={assignableCollections}
          assignableGuideFeatures={assignableGuideFeatures}
          onClose={() => setPanelState(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
