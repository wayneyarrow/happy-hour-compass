"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import DailySpecialForm from "./DailySpecialForm";
import type { DailySpecialRow } from "./formState";
import { deleteDailySpecialAction } from "./actions";
import type { OperatorPlan } from "@/lib/plans";
import { OFFER_TYPE_LABELS, coerceDailySpecialRow } from "@/lib/dailySpecialTypes";
import { scheduleSummary, timeSummary, validitySummary } from "./summaryLabels";
import { DAILY_SPECIAL_COLUMNS } from "./columns";

// ── Filter & Sort ─────────────────────────────────────────────────────────────

type FilterOption = "all" | "published" | "draft" | "one_time" | "weekly";
type SortOption = "updated" | "title";

const FILTERS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "one_time", label: "One-time" },
  { value: "weekly", label: "Weekly" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title A-Z" },
];

const EMPTY_MESSAGES: Record<FilterOption, string> = {
  all: "No Daily Specials yet",
  published: "No published Daily Specials.",
  draft: "No draft Daily Specials.",
  one_time: "No one-time Daily Specials.",
  weekly: "No weekly Daily Specials.",
};

function applyFilter(specials: DailySpecialRow[], filter: FilterOption): DailySpecialRow[] {
  switch (filter) {
    case "published":
      return specials.filter((s) => s.is_published);
    case "draft":
      return specials.filter((s) => !s.is_published);
    case "one_time":
      return specials.filter((s) => s.schedule_type === "one_time");
    case "weekly":
      return specials.filter((s) => s.schedule_type === "weekly");
    default:
      return specials;
  }
}

function applySort(specials: DailySpecialRow[], sort: SortOption): DailySpecialRow[] {
  return [...specials].sort((a, b) => {
    if (sort === "title") {
      return (a.title ?? "").localeCompare(b.title ?? "");
    }
    const aT = a.updated_at ?? a.created_at ?? "";
    const bT = b.updated_at ?? b.created_at ?? "";
    return bT > aT ? 1 : bT < aT ? -1 : 0;
  });
}

/** Builds the schedule/time preview line shown in each list row. Falls back gracefully if a row's stored combination is somehow unreadable. */
function specialRowPreview(row: DailySpecialRow): string | null {
  const special = coerceDailySpecialRow(row);
  if (!special) return null;
  const schedule = scheduleSummary(special.schedule);
  const time = timeSummary(special.time);
  const validity = validitySummary(special.schedule);
  const parts = [schedule, time];
  if (validity) parts.push(validity);
  return parts.filter(Boolean).join(" · ");
}

// ── Component ─────────────────────────────────────────────────────────────────

export type Mode = "idle" | "creating" | "editing";

/**
 * Pure decision for the selection/mode to land on after a successful save.
 * CREATE clears the selection and returns to the neutral "no Special
 * selected" state; EDIT keeps the saved Special selected with the form
 * still open. Extracted as a standalone, directly-testable function rather
 * than left inline in handleSaved() — same rationale as
 * src/lib/dailySpecialAuthorization.ts's extraction: this is the one piece
 * of the save flow with no async/Supabase call of its own, so it's the
 * piece a real unit test (not just a component-level assertion, which this
 * codebase's plain node:test runner has no DOM to exercise anyway) can
 * cover directly. Importable from a plain Node test despite this file
 * being "use client" — that RSC boundary transform only applies inside
 * Next.js's own build, never to a direct Node/tsx import of the module.
 */
export function resolveAfterSave(
  wasCreating: boolean,
  savedSpecialId: string
): { selectedId: string | null; mode: Mode } {
  return wasCreating
    ? { selectedId: null, mode: "idle" }
    : { selectedId: savedSpecialId, mode: "editing" };
}

// Matches the existing Operator Admin success-toast convention (see
// src/app/admin/users/UsersClient.tsx / src/app/admin/subscription/
// ChangePlanModal.tsx) — fixed top-right, emerald, role="status", 5s
// auto-dismiss. No shared <Toast> component exists in this codebase for
// either of those to reuse either, so this follows the same inline
// pattern rather than introducing a new one.
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 shrink-0 ${className ?? ""}`}
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

type Props = {
  initialSpecials: DailySpecialRow[];
  venueId: string;
  operatorPlan: OperatorPlan;
  isOwner: boolean;
  /** True only for founder impersonation of an unclaimed venue (Case B). */
  isUnclaimedVenueSupportMode: boolean;
};

export default function DailySpecialsManager({
  initialSpecials,
  venueId,
  operatorPlan,
  isOwner,
  isUnclaimedVenueSupportMode,
}: Props) {
  const router = useRouter();
  const [specials, setSpecials] = useState<DailySpecialRow[]>(initialSpecials);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const [activeSort, setActiveSort] = useState<SortOption>("updated");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showSuccessToast(message: string) {
    setSuccessMessage(message);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMessage(null), 5000);
  }

  const selectedSpecial = specials.find((s) => s.id === selectedId) ?? null;

  const visibleSpecials = useMemo(
    () => applySort(applyFilter(specials, activeFilter), activeSort),
    [specials, activeFilter, activeSort]
  );

  const handleSelectSpecial = (id: string) => {
    setSelectedId(id);
    setMode("editing");
  };

  const handleNewSpecial = () => {
    setSelectedId(null);
    setMode("creating");
  };

  const refreshList = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("daily_specials")
      .select(DAILY_SPECIAL_COLUMNS)
      .eq("venue_id", venueId)
      .order("updated_at", { ascending: false });
    setSpecials((data as unknown as DailySpecialRow[]) ?? []);
  };

  // After a successful save, behaviour differs by what was being saved:
  //   - CREATE: the new Special appears in the (refreshed) list, but the
  //     selection is cleared and the right pane returns to the neutral
  //     "No Daily Special selected" state — a completed creation should
  //     feel finished, not like it silently dropped the operator into an
  //     open edit session. The operator clicks the new card if they want
  //     to keep editing or add an image.
  //   - EDIT: the edited Special stays selected and the form stays open —
  //     unchanged from before.
  // `mode` here reflects whichever mode was active when the form that
  // triggered this callback was rendered ("creating" vs "editing") — it
  // does not change while a save is in flight.
  const handleSaved = async (savedSpecialId: string) => {
    const wasCreating = mode === "creating";
    await refreshList();
    const next = resolveAfterSave(wasCreating, savedSpecialId);
    setSelectedId(next.selectedId);
    setMode(next.mode);
    if (wasCreating) showSuccessToast("Daily Special created.");
  };

  const handleCancelCreate = () => {
    setSelectedId(null);
    setMode("idle");
  };

  const handleDelete = async () => {
    if (!selectedId) return;

    // Grandfathered seeded recurring specials, on the Free plan, warn that
    // deleting permanently gives up the operator's one grandfathered
    // recurring-special slot — they'd need Pro/Premium to create another.
    // Deletion itself is otherwise unrestricted by plan (see deleteDailySpecialAction).
    const isGrandfatheredSeededRecurring =
      !!selectedSpecial &&
      selectedSpecial.is_seeded_special &&
      selectedSpecial.schedule_type === "weekly" &&
      operatorPlan === "free";

    const confirmMessage = isGrandfatheredSeededRecurring
      ? "Delete recurring Daily Special?\n\n" +
        "This recurring Daily Special was provided by Happy Hour Compass when your venue was added to the platform.\n\n" +
        "Because your venue is on the Free plan, deleting this recurring Daily Special permanently removes your grandfathered recurring Daily Special. You won't be able to create another recurring Daily Special unless you upgrade to Pro or Premium.\n\n" +
        "This action cannot be undone."
      : "Delete this Daily Special? This action cannot be undone.";

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteDailySpecialAction(selectedId, venueId);
      router.refresh();
      setSelectedId(null);
      setMode("idle");
      setSpecials((prev) => prev.filter((s) => s.id !== selectedId));
    } catch (err) {
      console.error("[DailySpecialsManager] Delete failed:", err);
      alert("Failed to delete Daily Special. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6 items-start">

      {/* Success toast */}
      {successMessage && (
        <div
          className="fixed top-4 right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl shadow-lg text-sm text-emerald-700 font-medium"
          role="status"
        >
          <CheckIcon className="text-emerald-500" />
          {successMessage}
        </div>
      )}

      {/* ── Left panel: special list ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Your Daily Specials
          </h3>
          <button
            type="button"
            onClick={handleNewSpecial}
            className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
          >
            + New Daily Special
          </button>
        </div>

        {specials.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveFilter(value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    activeFilter === value
                      ? "bg-amber-500 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={activeSort}
              onChange={(e) => setActiveSort(e.target.value as SortOption)}
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        )}

        {visibleSpecials.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-resting px-6 py-10 text-center">
            <p className="text-sm font-medium text-gray-600">{EMPTY_MESSAGES[activeFilter]}</p>
            {activeFilter === "all" ? (
              <p className="text-xs text-gray-400 mt-1">
                Click &ldquo;+ New Daily Special&rdquo; to create your first one.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className="mt-2 text-xs text-amber-600 hover:text-amber-700 font-medium"
              >
                Show all Daily Specials
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-resting overflow-hidden">
            <ul className="divide-y divide-gray-100">
              {visibleSpecials.map((special) => {
                const isSelected = special.id === selectedId;
                const preview = specialRowPreview(special);

                return (
                  <li key={special.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectSpecial(special.id)}
                      className={`w-full text-left px-4 py-3 transition-colors border-l-[3px] ${
                        isSelected ? "bg-amber-50 border-l-amber-500" : "border-l-transparent hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium truncate ${isSelected ? "text-amber-800" : "text-gray-800"}`}>
                            {special.title || <span className="text-gray-400 italic">Untitled</span>}
                          </p>
                          {special.offer_type && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {OFFER_TYPE_LABELS[special.offer_type as keyof typeof OFFER_TYPE_LABELS] ?? special.offer_type}
                            </p>
                          )}
                          {preview && <p className="text-xs text-gray-400 truncate">{preview}</p>}
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                            special.is_published ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {special.is_published ? "Published" : "Draft"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* ── Right panel ──────────────────────────────────────────────────── */}
      <div>
        {mode === "idle" ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-resting px-8 py-12 text-center">
            <p className="text-sm font-semibold text-gray-700">No Daily Special selected</p>
            <p className="text-sm text-gray-400 mt-1.5">
              Choose a Daily Special on the left or create a new one to get started.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {mode === "creating" ? "New Daily Special" : "Edit Daily Special"}
              </h3>
              {mode === "editing" && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="text-sm font-semibold text-red-700 hover:text-red-800 border border-red-300 hover:border-red-400 hover:bg-red-50 rounded-full px-3 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? "Deleting…" : "Delete Daily Special"}
                </button>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
              {/* key={selectedId ?? "new"} forces a clean remount whenever the
                  selection changes, giving DailySpecialForm a fresh empty
                  state for "New Daily Special" and a clean hydration cycle
                  when switching between rows. */}
              <DailySpecialForm
                key={selectedId ?? "new"}
                initialSpecial={selectedSpecial}
                venueId={venueId}
                operatorPlan={operatorPlan}
                isOwner={isOwner}
                isUnclaimedVenueSupportMode={isUnclaimedVenueSupportMode}
                onSaved={handleSaved}
                onCancel={mode === "creating" ? handleCancelCreate : undefined}
              />
            </div>
          </>
        )}
      </div>

    </div>
  );
}
