"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { MembershipRow, MembershipRole } from "@/lib/memberships";
import {
  inviteUserAction,
  removeMemberAction,
  cancelInviteAction,
} from "./actions";
import type { OperatorPlan } from "@/lib/plans";
import { PLAN_LABELS } from "@/lib/plans";

// ── Props ─────────────────────────────────────────────────────────────────────

export type UsersClientProps = {
  operatorId:      string;
  currentEmail:    string;
  currentRole:     MembershipRole | null;
  memberships:     MembershipRow[];
  plan:            OperatorPlan;
  userLimit:       number;
  totalCount:      number;
};

// ── Small shared components ───────────────────────────────────────────────────

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

function UserInitials({ name, email }: { name: string | null; email: string }) {
  const label = name?.trim() || email;
  const parts = label.split(/[\s@]+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : label.slice(0, 2).toUpperCase();

  return (
    <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold shrink-0 select-none">
      {initials}
    </div>
  );
}

// ── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({
  operatorId,
  onClose,
  onSuccess,
}: {
  operatorId:  string;
  onClose:     () => void;
  onSuccess:   () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email,    setEmail]    = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPending, onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await inviteUserAction(
        operatorId,
        email,
        fullName || null
      );
      if (result.ok) {
        onSuccess();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        aria-hidden="true"
        onClick={() => { if (!isPending) onClose(); }}
      />
      {/* Dialog */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Invite user"
      >
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Invite team member</h2>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="Close"
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invite-name">
                Full name
              </label>
              <input
                id="invite-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invite-email">
                Email address <span className="text-red-500">*</span>
              </label>
              <input
                id="invite-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className={inputClass}
              />
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
              >
                {isPending ? "Sending invite…" : "Send invite"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ── Inline confirm button ─────────────────────────────────────────────────────

function ConfirmAction({
  label,
  confirmLabel,
  onConfirm,
  isPending,
  danger = false,
}: {
  label:        string;
  confirmLabel: string;
  onConfirm:    () => void;
  isPending:    boolean;
  danger?:      boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-gray-500 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500">Sure?</span>
      <button
        type="button"
        onClick={() => { setConfirming(false); onConfirm(); }}
        disabled={isPending}
        className={`text-xs font-semibold px-2 py-1 rounded transition-colors disabled:opacity-50 ${
          danger
            ? "text-red-700 bg-red-50 hover:bg-red-100"
            : "text-gray-700 bg-gray-100 hover:bg-gray-200"
        }`}
      >
        {isPending ? "…" : confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1"
      >
        No
      </button>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UsersClient({
  operatorId,
  currentEmail,
  currentRole,
  memberships,
  plan,
  userLimit,
  totalCount,
}: UsersClientProps) {
  const router = useRouter();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null);
  const [actionError,  setActionError]  = useState<string | null>(null);
  const [isPending,    startTransition] = useTransition();
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setActionError(null);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMsg(null), 5000);
    router.refresh();
  }

  useEffect(() => {
    return () => { if (successTimerRef.current) clearTimeout(successTimerRef.current); };
  }, []);

  const isOwner    = currentRole === "owner";
  const isMember   = currentRole === "member";
  const isAtLimit  = userLimit !== Infinity && totalCount >= userLimit;

  const activeMembers  = memberships.filter((m) => m.status === "active");
  const pendingInvites = memberships.filter((m) => m.status === "invited");

  function handleRemove(membershipId: string) {
    startTransition(async () => {
      const result = await removeMemberAction(operatorId, membershipId);
      if (result.ok) {
        showSuccess("Team member removed.");
      } else {
        setActionError(result.error ?? "Something went wrong.");
      }
    });
  }

  function handleCancelInvite(membershipId: string) {
    startTransition(async () => {
      const result = await cancelInviteAction(operatorId, membershipId);
      if (result.ok) {
        showSuccess("Invitation cancelled.");
      } else {
        setActionError(result.error ?? "Something went wrong.");
      }
    });
  }

  const limitLabel =
    userLimit === Infinity
      ? `${totalCount} users`
      : `${totalCount} of ${userLimit} ${userLimit === 1 ? "user" : "users"} used`;

  return (
    <div className="max-w-2xl">
      {/* Success toast */}
      {successMsg && (
        <div
          className="fixed top-4 right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl shadow-lg text-sm text-emerald-700 font-medium"
          role="status"
        >
          <CheckIcon className="text-emerald-500" />
          {successMsg}
        </div>
      )}

      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Users</h2>
          <p className="text-sm text-gray-500">
            Manage team members who can access your operator account.
          </p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={() => { setActionError(null); setIsInviteOpen(true); }}
            disabled={isAtLimit}
            title={isAtLimit ? `Your ${PLAN_LABELS[plan]} plan is at its user limit. Upgrade to add more.` : undefined}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed shrink-0"
          >
            Invite User
          </button>
        )}
      </div>

      {/* Non-owner notice */}
      {isMember && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 text-sm text-blue-700">
          You have view-only access. Only the account owner can invite or remove users.
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
          {actionError}
        </div>
      )}

      {/* ── Usage card ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">
            Plan Usage
          </p>
          <p className="text-sm font-medium text-gray-700">{limitLabel}</p>
          {isAtLimit && isOwner && (
            <p className="text-xs text-amber-600 mt-0.5">
              Upgrade your plan to invite more team members.
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs text-gray-500">
            {PLAN_LABELS[plan]} Plan
          </span>
        </div>
      </div>

      {/* ── Active users ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Active Users</h3>
          <span className="text-xs text-gray-400">{activeMembers.length}</span>
        </div>
        <ul className="divide-y divide-gray-50">
          {activeMembers.map((m) => {
            const isMe     = m.email.toLowerCase() === currentEmail.toLowerCase();
            const isThisOwner = m.role === "owner";

            return (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3.5">
                <UserInitials name={m.full_name} email={m.email} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {m.full_name ?? m.email}
                    </span>
                    {isThisOwner && (
                      <span className="inline-flex items-center text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">
                        Owner
                      </span>
                    )}
                    {isMe && (
                      <span className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                        You
                      </span>
                    )}
                  </div>
                  {m.full_name && (
                    <p className="text-xs text-gray-400 truncate">{m.email}</p>
                  )}
                </div>
                {/* Remove button — owner only, can't remove self or another owner */}
                {isOwner && !isThisOwner && !isMe && (
                  <ConfirmAction
                    label="Remove"
                    confirmLabel="Remove"
                    onConfirm={() => handleRemove(m.id)}
                    isPending={isPending}
                    danger
                  />
                )}
              </li>
            );
          })}
          {activeMembers.length === 0 && (
            <li className="px-5 py-6 text-sm text-gray-400 text-center">
              No active users yet.
            </li>
          )}
        </ul>
      </div>

      {/* ── Pending invitations ────────────────────────────────────────────── */}
      {(pendingInvites.length > 0 || isOwner) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Pending Invitations</h3>
              {pendingInvites.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Pending invites count toward your plan limit.
                </p>
              )}
            </div>
            <span className="text-xs text-gray-400">{pendingInvites.length}</span>
          </div>
          {pendingInvites.length > 0 ? (
            <ul className="divide-y divide-gray-50">
              {pendingInvites.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-700 truncate">
                        {m.full_name ? `${m.full_name} (${m.email})` : m.email}
                      </span>
                      <span className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 shrink-0">
                        Pending
                      </span>
                    </div>
                  </div>
                  {isOwner && (
                    <ConfirmAction
                      label="Cancel"
                      confirmLabel="Cancel invite"
                      onConfirm={() => handleCancelInvite(m.id)}
                      isPending={isPending}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-6 text-sm text-gray-400 text-center">
              No pending invitations.
            </div>
          )}
        </div>
      )}

      {/* Invite modal */}
      {isInviteOpen && (
        <InviteModal
          operatorId={operatorId}
          onClose={() => setIsInviteOpen(false)}
          onSuccess={() => {
            setIsInviteOpen(false);
            showSuccess("Invitation sent.");
          }}
        />
      )}
    </div>
  );
}
