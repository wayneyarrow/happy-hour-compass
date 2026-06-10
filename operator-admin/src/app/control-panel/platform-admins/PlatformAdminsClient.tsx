"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { PlatformAdmin } from "@/lib/platformAdmins";
import {
  invitePlatformAdminAction,
  revokePlatformAdminAction,
  type InviteAdminState,
  type RevokeAdminState,
} from "./actions";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:  "bg-green-50 text-green-700 border border-green-200",
    invited: "bg-amber-50 text-amber-700 border border-amber-200",
    revoked: "bg-gray-100 text-gray-500 border border-gray-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? styles.revoked}`}>
      {status}
    </span>
  );
}

// ── Revoke button (per-row form) ──────────────────────────────────────────────

function RevokeButton({
  admin,
  isSelf,
  isOnlyActiveAdmin,
}: {
  admin: PlatformAdmin;
  isSelf: boolean;
  isOnlyActiveAdmin: boolean;
}) {
  const boundAction = revokePlatformAdminAction.bind(null, admin.id);
  const [state, formAction, isPending] = useActionState<RevokeAdminState, FormData>(boundAction, {});
  const router = useRouter();

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  if (admin.status === "revoked") return null;

  // Prevent the UI from offering self-revocation when no other active admin exists.
  if (isSelf && isOnlyActiveAdmin) {
    return (
      <p className="text-xs text-gray-400 whitespace-nowrap">
        At least one active admin required.
      </p>
    );
  }

  return (
    <form action={formAction}>
      {state.error && (
        <p className="text-xs text-red-600 mb-1">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="px-3 py-1 rounded-md text-xs font-medium bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        onClick={(e) => {
          if (!confirm(`Revoke access for ${admin.email}?`)) e.preventDefault();
        }}
      >
        {isPending ? "Revoking…" : "Revoke"}
      </button>
    </form>
  );
}

// ── Invite form ───────────────────────────────────────────────────────────────

function InviteForm() {
  const [state, formAction, isPending] = useActionState<InviteAdminState, FormData>(
    invitePlatformAdminAction,
    {}
  );
  const router = useRouter();

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Invite a platform admin</h2>
      <form action={formAction} className="flex gap-3 items-start">
        <div className="flex-1">
          <input
            type="email"
            name="email"
            required
            placeholder="admin@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
          />
          {state.error && (
            <p className="text-xs text-red-600 mt-1.5">{state.error}</p>
          )}
          {state.success && (
            <p className="text-xs text-green-700 mt-1.5">Invitation sent successfully.</p>
          )}
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {isPending ? "Sending…" : "Send invite"}
        </button>
      </form>
    </div>
  );
}

// ── Admin table ───────────────────────────────────────────────────────────────

function AdminTable({
  admins,
  currentEmail,
}: {
  admins: PlatformAdmin[];
  currentEmail: string;
}) {
  const activeAdminCount = admins.filter((a) => a.status === "active").length;

  if (admins.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No platform admins yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Invited by</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Accepted</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {admins.map((admin) => {
            const isSelf = admin.email.toLowerCase() === currentEmail.toLowerCase();
            return (
              <tr key={admin.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {admin.email}
                  {isSelf && (
                    <span className="ml-2 text-xs text-gray-400">(you)</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={admin.status} />
                </td>
                <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                  {admin.invited_by_email ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell whitespace-nowrap">
                  {admin.accepted_at
                    ? new Date(admin.accepted_at).toLocaleDateString("en-CA")
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <RevokeButton
                    admin={admin}
                    isSelf={isSelf}
                    isOnlyActiveAdmin={activeAdminCount === 1}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function PlatformAdminsClient({
  admins,
  currentEmail,
}: {
  admins: PlatformAdmin[];
  currentEmail: string;
}) {
  return (
    <div className="space-y-6">
      <InviteForm />
      <AdminTable admins={admins} currentEmail={currentEmail} />
    </div>
  );
}
