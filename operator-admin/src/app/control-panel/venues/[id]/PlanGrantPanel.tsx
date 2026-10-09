"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPlanGrantAction,
  changePlanGrantEndAction,
  revokePlanGrantAction,
  type PlanGrantActionState,
} from "./planGrantActions";
import { formatDate, formatDateTime } from "@/lib/controlPanelDateTime";
import { PLAN_LABELS, type OperatorPlan } from "@/lib/plans";
import {
  GRANT_STATUS_LABELS,
  GRANT_TYPE_LABELS,
  type AccessSource,
  type GrantStatus,
  type PlanGrant,
} from "@/lib/planGrants/grantState";
import { lastAccessDateLabel } from "@/lib/planGrants/grantDates";

export type PlanGrantPanelGrant = PlanGrant & { status: GrantStatus };

type Props = {
  venueId: string;
  isClaimed: boolean;
  isCancelled: boolean;
  billingPlan: OperatorPlan;
  billingDescription: string;
  effectivePlan: OperatorPlan;
  source: AccessSource;
  contentEnforced: boolean;
  /** The grant lookup failed — show an error, never an empty list or create form. */
  grantDataUnavailable: boolean;
  grants: PlanGrantPanelGrant[];
};

const INITIAL: PlanGrantActionState = { success: false };

const PLAN_BADGE: Record<string, string> = {
  enterprise: "bg-purple-100 text-purple-700 border border-purple-300",
  premium:    "bg-amber-100 text-amber-700 border border-amber-300",
  pro:        "bg-sky-100 text-sky-700 border border-sky-300",
  free:       "bg-gray-100 text-gray-500 border border-gray-300",
};

const STATUS_BADGE: Record<GrantStatus, string> = {
  scheduled:               "bg-blue-50 text-blue-700 border border-blue-200",
  active:                  "bg-green-100 text-green-700 border border-green-300",
  expired:                 "bg-gray-100 text-gray-600 border border-gray-300",
  revoked:                 "bg-rose-50 text-rose-700 border border-rose-200",
  cancelled_before_start:  "bg-gray-100 text-gray-600 border border-gray-300",
  ended_ownership_changed: "bg-gray-100 text-gray-600 border border-gray-300",
  ended_venue_cancelled:   "bg-gray-100 text-gray-600 border border-gray-300",
  invalidated:             "bg-gray-100 text-gray-600 border border-gray-300",
};

function Badge({ label, classes }: { label: string; classes: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>{label}</span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="text-gray-400 w-44 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0">{children}</dd>
    </div>
  );
}

function useRefreshOnSuccess(state: PlanGrantActionState, onSuccess?: () => void) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (state.success && !done.current) {
      done.current = true;
      onSuccess?.();
      router.refresh();
    }
    if (!state.success) done.current = false;
  }, [state.success, router, onSuccess]);
}

function ErrorBox({ state }: { state: PlanGrantActionState }) {
  if (state.success || !state.error) return null;
  return <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{state.error}</div>;
}

function endText(endsAt: string | null): string {
  return endsAt ? `Access through ${lastAccessDateLabel(endsAt)}` : "No expiry";
}

// ── Open grant (active or scheduled) ──────────────────────────────────────────

function OpenGrantCard({ venueId, grant }: { venueId: string; grant: PlanGrantPanelGrant }) {
  const [mode, setMode] = useState<"none" | "end" | "revoke">("none");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundEnd = (changePlanGrantEndAction as any).bind(null, venueId, grant.id, grant.endsAt);
  const [endState, endAction, endPending] = useActionState<PlanGrantActionState, FormData>(boundEnd, INITIAL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundRevoke = (revokePlanGrantAction as any).bind(null, venueId, grant.id);
  const [revokeState, revokeAction, revokePending] = useActionState<PlanGrantActionState, FormData>(boundRevoke, INITIAL);

  useRefreshOnSuccess(endState, () => setMode("none"));
  useRefreshOnSuccess(revokeState, () => setMode("none"));

  const isScheduled = grant.status === "scheduled";
  const pending = endPending || revokePending;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge label={`${PLAN_LABELS[grant.planCode]} ${GRANT_TYPE_LABELS[grant.grantType]}`} classes={PLAN_BADGE[grant.planCode]} />
        <Badge label={GRANT_STATUS_LABELS[grant.status]} classes={STATUS_BADGE[grant.status]} />
        <Badge label="Non-paying" classes="bg-white text-gray-600 border border-gray-300" />
      </div>
      <dl className="space-y-1.5">
        <Row label={isScheduled ? "Starts" : "Started"}>{formatDateTime(grant.startsAt)}</Row>
        <Row label="Ends">{endText(grant.endsAt)}</Row>
        <Row label="Reason"><span className="whitespace-pre-wrap">{grant.reason}</span></Row>
        <Row label="Granted by">{grant.createdByEmail} · {formatDate(grant.createdAt)}</Row>
      </dl>

      {(endState.success || revokeState.success) && (
        <p className="text-sm text-green-700">{endState.message ?? revokeState.message}</p>
      )}

      {mode === "none" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("end")}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-white disabled:opacity-40"
          >
            {grant.endsAt ? "Change end date" : "Add expiry"}
          </button>
          <button
            type="button"
            onClick={() => setMode("revoke")}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
          >
            {isScheduled ? "Cancel scheduled grant" : "Revoke"}
          </button>
        </div>
      )}

      {mode === "end" && (
        <form action={endAction} className="space-y-2 border-t border-gray-200 pt-3">
          <ErrorBox state={endState} />
          <label className="block text-xs text-gray-500">
            Last day of access <span className="text-red-500">*</span>
          </label>
          <input type="date" name="endDate" required className="text-sm border border-gray-300 rounded-lg px-3 py-1.5" />
          <label className="block text-xs text-gray-500">Note (optional)</label>
          <textarea name="note" rows={2} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
          <p className="text-xs text-gray-400">Dates are Pacific time. Access continues through the whole of the chosen day.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-40">
              {endPending ? "Saving…" : "Save end date"}
            </button>
            <button type="button" onClick={() => setMode("none")} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "revoke" && (
        <form action={revokeAction} className="space-y-2 border-t border-gray-200 pt-3">
          <ErrorBox state={revokeState} />
          <label className="block text-xs text-gray-500">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea name="reason" rows={2} required className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
          <p className="text-xs text-gray-400">
            {isScheduled
              ? "The grant will never start. Public content is not affected."
              : "Access returns to the venue's billing plan immediately. Content above that plan is preserved but paused publicly. A paid subscription is never affected."}
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40">
              {revokePending ? "Saving…" : isScheduled ? "Cancel grant" : "Revoke grant"}
            </button>
            <button type="button" onClick={() => setMode("none")} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────────────────────

function CreateGrantForm({ venueId }: { venueId: string }) {
  const [open, setOpen] = useState(false);
  const [grantType, setGrantType] = useState<"comp" | "trial">("comp");
  const [startMode, setStartMode] = useState<"now" | "scheduled">("now");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bound = (createPlanGrantAction as any).bind(null, venueId);
  const [state, action, pending] = useActionState<PlanGrantActionState, FormData>(bound, INITIAL);
  useRefreshOnSuccess(state, () => setOpen(false));

  if (!open) {
    return (
      <div className="space-y-2">
        {state.success && state.message && <p className="text-sm text-green-700">{state.message}</p>}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg"
        >
          Grant Pro or Premium access
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-gray-200 p-4">
      <ErrorBox state={state} />
      <div className="flex flex-wrap gap-6">
        <fieldset>
          <legend className="text-xs text-gray-500 mb-1">Plan</legend>
          <select name="planCode" defaultValue="premium" className="text-sm border border-gray-300 rounded-lg px-3 py-1.5">
            <option value="premium">Premium</option>
            <option value="pro">Pro</option>
          </select>
        </fieldset>
        <fieldset>
          <legend className="text-xs text-gray-500 mb-1">Type</legend>
          <div className="flex gap-3 text-sm">
            {(["comp", "trial"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5">
                <input type="radio" name="grantType" value={t} checked={grantType === t} onChange={() => setGrantType(t)} />
                {GRANT_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs text-gray-500 mb-1">Start</legend>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="startMode" value="now" checked={startMode === "now"} onChange={() => setStartMode("now")} />
              Start now
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="startMode" value="scheduled" checked={startMode === "scheduled"} onChange={() => setStartMode("scheduled")} />
              Scheduled
            </label>
          </div>
        </fieldset>
      </div>

      {startMode === "scheduled" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Start date <span className="text-red-500">*</span></label>
          <input type="date" name="startDate" required className="text-sm border border-gray-300 rounded-lg px-3 py-1.5" />
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Last day of access {grantType === "trial" ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional — leave blank for no expiry)</span>}
        </label>
        <input type="date" name="endDate" required={grantType === "trial"} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5" />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Internal reason <span className="text-red-500">*</span></label>
        <textarea name="reason" rows={2} required className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" placeholder="e.g. Launch partner — complimentary Premium." />
      </div>

      <p className="text-xs text-gray-400">
        Dates are Pacific time. No card, no Stripe subscription, and never counted as revenue. Once the grant starts,
        this venue&rsquo;s public content follows its effective plan permanently: when the grant ends, content above the
        billing plan is preserved but paused publicly. A scheduled grant changes nothing until its start date.
      </p>

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-40">
          {pending ? "Saving…" : startMode === "scheduled" ? "Schedule grant" : "Grant access"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function PlanGrantPanel(props: Props) {
  const openGrant = props.grants.find((g) => g.status === "active" || g.status === "scheduled") ?? null;
  const history = props.grants.filter((g) => g !== openGrant);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6 space-y-5">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Plan &amp; Access</h2>

      <dl className="space-y-2.5">
        <Row label="Billing plan">
          <span className="inline-flex items-center gap-2 flex-wrap">
            <Badge label={PLAN_LABELS[props.billingPlan]} classes={PLAN_BADGE[props.billingPlan]} />
            <span className="text-xs text-gray-500">{props.billingDescription}</span>
          </span>
        </Row>
        <Row label="Effective plan">
          <span className="inline-flex items-center gap-2 flex-wrap">
            <Badge label={PLAN_LABELS[props.effectivePlan]} classes={PLAN_BADGE[props.effectivePlan]} />
            <span className="text-xs text-gray-500">
              {props.source === "grant" ? "From an active grant (non-paying)" : props.source === "subscription" ? "From the billing plan" : "Free"}
            </span>
          </span>
        </Row>
        <Row label="Public content limits">
          {props.contentEnforced ? (
            <span className="text-gray-800">Applied — follows the effective plan (grant recipient)</span>
          ) : (
            <span className="text-gray-500">Not applied (no grant has started)</span>
          )}
        </Row>
      </dl>

      {props.grantDataUnavailable ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          Grant data couldn&rsquo;t be loaded, so this venue&rsquo;s grants and effective plan may be incomplete.
          Refresh to try again before granting or changing access.
        </div>
      ) : openGrant ? (
        <OpenGrantCard venueId={props.venueId} grant={openGrant} />
      ) : !props.isClaimed ? (
        <p className="text-sm text-gray-500">Grants are only available on claimed, operator-owned venues. This venue must be claimed first.</p>
      ) : props.isCancelled ? (
        <p className="text-sm text-gray-500">This venue is cancelled. Reactivate it before granting access.</p>
      ) : (
        <CreateGrantForm venueId={props.venueId} />
      )}

      {history.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Grant history</p>
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {history.map((g) => (
              <li key={g.id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-800">{PLAN_LABELS[g.planCode]} {GRANT_TYPE_LABELS[g.grantType]}</span>
                <Badge label={GRANT_STATUS_LABELS[g.status]} classes={STATUS_BADGE[g.status]} />
                <span className="text-xs text-gray-500">
                  {formatDate(g.startsAt)} → {g.revokedAt ? formatDate(g.revokedAt) : g.endsAt ? lastAccessDateLabel(g.endsAt) : "no expiry"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
