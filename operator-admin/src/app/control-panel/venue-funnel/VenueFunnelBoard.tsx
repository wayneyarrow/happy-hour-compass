"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FunnelLane, VenueFunnelCard } from "@/lib/data/venueFunnel";
import { formatDate } from "@/lib/controlPanelDateTime";

/**
 * Venue Funnel board — read-only Kanban view. Lane assignment is entirely
 * server-derived (src/lib/data/venueFunnel.ts); there is deliberately no
 * drag-and-drop here — a card's lane reflects system state, not a manual
 * placement, so moving one would be meaningless (and immediately reverted
 * on next load).
 *
 * Filters (city / published / plan) are client-side only, over the already-
 * loaded lane data — no re-query, matching the "keep V1 filters minimal"
 * product decision.
 */

const PLAN_BADGE: Record<string, string> = {
  enterprise: "bg-purple-100 text-purple-700 border border-purple-300",
  premium:    "bg-amber-100  text-amber-700  border border-amber-300",
  pro:        "bg-sky-100    text-sky-700    border border-sky-300",
  free:       "bg-gray-100   text-gray-500   border border-gray-300",
};

const PLAN_LABEL: Record<string, string> = {
  enterprise: "Enterprise",
  premium:    "Premium",
  pro:        "Pro",
  free:       "Free",
};

// Explains exactly where a Claim Submitted card sits within that one lane —
// the lane itself never splits by status (Phase 2C product decision).
const CLAIM_STATUS_LABEL: Record<string, string> = {
  pending:         "Pending",
  needs_more_info: "Needs More Info",
  info_submitted:  "Info Submitted",
};

// Lanes worth calling out visually as bottlenecks — restrained (border tint
// only), not a rainbow dashboard.
const WARNING_LANES = new Set(["setup_stalled"]);

function Badge({ label, classes }: { label: string; classes: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${classes}`}>
      {label}
    </span>
  );
}

function CardLink({ card }: { card: VenueFunnelCard }) {
  const href = card.venueDetailUrl ?? card.reviewUrl;
  if (!href) return null;
  return (
    <Link
      href={href}
      className="text-xs font-medium text-amber-700 hover:text-amber-800 whitespace-nowrap"
    >
      {card.kind === "venue" ? "View Venue →" : card.kind === "claim" ? "Review Claim →" : "Review Submission →"}
    </Link>
  );
}

function FunnelCardView({ card }: { card: VenueFunnelCard }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-resting p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate" title={card.name}>{card.name}</p>
          {card.city && <p className="text-xs text-gray-400 truncate">{card.city}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {card.kind !== "venue" && (
          <Badge
            label={card.kind === "claim" ? "Claim" : "Submission"}
            classes="bg-slate-100 text-slate-600 border border-slate-300"
          />
        )}
        {card.claimStatus && (
          <Badge
            label={CLAIM_STATUS_LABEL[card.claimStatus] ?? card.claimStatus}
            classes="bg-amber-50 text-amber-700 border border-amber-200"
          />
        )}
        {card.isPublished === true && (
          <Badge label="Published" classes="bg-green-100 text-green-700 border border-green-300" />
        )}
        {card.isPublished === false && (
          <Badge label="Unpublished" classes="bg-gray-100 text-gray-600 border border-gray-300" />
        )}
        {card.plan && (
          <Badge label={PLAN_LABEL[card.plan] ?? card.plan} classes={PLAN_BADGE[card.plan] ?? PLAN_BADGE.free} />
        )}
        {card.subscriptionStatus === "past_due" && (
          <Badge label="Past Due" classes="bg-red-100 text-red-700 border border-red-300" />
        )}
        {card.onboardingCompletionMode === "manual" && (
          <Badge label="Complete — Manual" classes="bg-purple-100 text-purple-700 border border-purple-300" />
        )}
        {card.possiblyInactive && (
          <Badge label="No recent activity" classes="bg-amber-50 text-amber-700 border border-amber-200" />
        )}
      </div>

      {(card.setupHealthScorePct !== null || card.missingItemsCount !== null) && (
        <p className="text-xs text-gray-500">
          {card.setupHealthScorePct !== null && <>Setup {card.setupHealthScorePct}%</>}
          {card.setupHealthScorePct !== null && card.missingItemsCount !== null && " · "}
          {card.missingItemsCount !== null && (
            <>{card.missingItemsCount === 0 ? "No missing items" : `${card.missingItemsCount} missing item${card.missingItemsCount === 1 ? "" : "s"}`}</>
          )}
        </p>
      )}

      {(card.operatorName || card.operatorEmail) && (
        <p className="text-xs text-gray-500 truncate" title={card.operatorEmail ?? undefined}>
          {card.operatorName ?? card.operatorEmail}
        </p>
      )}

      {card.operatorLastSeenAt && (
        <p className="text-[11px] text-gray-400">Operator last seen {formatDate(card.operatorLastSeenAt)}</p>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-gray-400">
          {card.ageDays !== null && card.ageLabel ? `${card.ageDays}d — ${card.ageLabel}` : ""}
        </span>
        <CardLink card={card} />
      </div>
    </div>
  );
}

function LaneColumn({ lane }: { lane: FunnelLane }) {
  const isWarning = WARNING_LANES.has(lane.key);
  return (
    <div className="w-72 shrink-0 flex flex-col">
      <div
        className={`flex items-center justify-between px-3 py-2 rounded-t-lg border ${
          isWarning
            ? "bg-red-50 border-red-200"
            : "bg-slate-100 border-slate-200"
        }`}
      >
        <h2 className={`text-sm font-semibold ${isWarning ? "text-red-700" : "text-slate-700"}`}>{lane.label}</h2>
        <span
          className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs font-semibold ${
            isWarning ? "bg-red-200 text-red-800" : "bg-slate-200 text-slate-700"
          }`}
        >
          {lane.cards.length}
        </span>
      </div>
      <div className="flex-1 border border-t-0 border-slate-200 rounded-b-lg bg-slate-50 p-2 space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto">
        {lane.cards.length === 0 ? (
          <p className="text-xs text-gray-400 italic text-center py-6">No venues</p>
        ) : (
          lane.cards.map((card) => <FunnelCardView key={`${card.kind}-${card.id}`} card={card} />)
        )}
      </div>
    </div>
  );
}

export default function VenueFunnelBoard({ lanes }: { lanes: FunnelLane[] }) {
  const [city, setCity] = useState<string>("all");
  const [published, setPublished] = useState<"all" | "published" | "unpublished">("all");
  const [plan, setPlan] = useState<string>("all");

  const allCards = useMemo(() => lanes.flatMap((l) => l.cards), [lanes]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCards) if (c.city) set.add(c.city);
    return [...set].sort();
  }, [allCards]);

  const plans = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCards) if (c.plan) set.add(c.plan);
    return [...set];
  }, [allCards]);

  const filteredLanes = useMemo(() => {
    return lanes.map((lane) => ({
      ...lane,
      cards: lane.cards.filter((c) => {
        if (city !== "all" && c.city !== city) return false;
        if (published === "published" && c.isPublished !== true) return false;
        if (published === "unpublished" && c.isPublished !== false) return false;
        if (plan !== "all" && c.plan !== plan) return false;
        return true;
      }),
    }));
  }, [lanes, city, published, plan]);

  const totalCount = allCards.length;
  const filteredCount = filteredLanes.reduce((sum, l) => sum + l.cards.length, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="all">All Cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={published}
          onChange={(e) => setPublished(e.target.value as typeof published)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="all">Published + Unpublished</option>
          <option value="published">Published only</option>
          <option value="unpublished">Unpublished only</option>
        </select>

        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="all">All Plans</option>
          {plans.map((p) => (
            <option key={p} value={p}>{PLAN_LABEL[p] ?? p}</option>
          ))}
        </select>

        {filteredCount !== totalCount && (
          <span className="text-xs text-gray-400">
            Showing {filteredCount} of {totalCount}
          </span>
        )}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {filteredLanes.map((lane) => (
          <LaneColumn key={lane.key} lane={lane} />
        ))}
      </div>
    </div>
  );
}
