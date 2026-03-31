import Link from "next/link";
import { getClaimById } from "@/lib/data/claims";
import { computeTrustSignals, type SignalStatus, type TrustSignal } from "@/lib/trustSignals";
import ReviewActionsPanel from "./ReviewActionsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claim Review" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function formatAddress(venue: {
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
} | null): string {
  if (!venue) return "—";
  return (
    [venue.address_line1, venue.city, venue.region, venue.postal_code]
      .filter(Boolean)
      .join(", ") || "—"
  );
}

// ── Status badge (claim status) ───────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  pending:         { label: "Pending",         classes: "bg-amber-100 text-amber-700" },
  approved:        { label: "Approved",        classes: "bg-green-100 text-green-700" },
  needs_more_info: { label: "Needs more info", classes: "bg-blue-100 text-blue-600" },
  rejected:        { label: "Rejected",        classes: "bg-red-100 text-red-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, classes: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── Trust signal row ──────────────────────────────────────────────────────────

const SIGNAL_STYLES: Record<SignalStatus, { dot: string; icon: React.ReactNode }> = {
  positive: {
    dot: "bg-green-500",
    icon: (
      <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    ),
  },
  warning: {
    dot: "bg-amber-400",
    icon: (
      <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  negative: {
    dot: "bg-red-500",
    icon: (
      <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
  neutral: {
    dot: "bg-gray-300",
    icon: (
      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
      </svg>
    ),
  },
};

function SignalRow({ signal }: { signal: TrustSignal }) {
  const style = SIGNAL_STYLES[signal.status];
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-50 border border-gray-200">
        {style.icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{signal.label}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{signal.detail}</p>
      </div>
    </div>
  );
}

// ── Metadata row helper ───────────────────────────────────────────────────────

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="text-gray-400 w-32 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{children}</dd>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { claim, error } = await getClaimById(id);

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!error && !claim) {
    return (
      <div className="max-w-2xl">
        <Link
          href="/control-panel/claims"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to Claims
        </Link>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-base font-semibold text-slate-900 mb-1">Claim not found</p>
          <p className="text-sm text-gray-500">
            This claim may have been removed, or the ID is incorrect.
          </p>
        </div>
      </div>
    );
  }

  // ── Fetch error ────────────────────────────────────────────────────────────
  if (error || !claim) {
    return (
      <div className="max-w-2xl">
        <Link
          href="/control-panel/claims"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to Claims
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          {error ?? "Something went wrong. Please try again."}
        </div>
      </div>
    );
  }

  const signals = await computeTrustSignals(claim);

  return (
    <div className="max-w-6xl">
      {/* ── Back nav ──────────────────────────────────────────────────────── */}
      <Link
        href="/control-panel/claims"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to Claims
      </Link>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-slate-900">Claim Review</h1>
            <StatusBadge status={claim.status} />
          </div>
          <p className="text-xs text-gray-400 font-mono">{claim.id}</p>
        </div>
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Claimant */}
          <Section title="Claimant">
            <dl className="space-y-2.5">
              <MetaRow label="Name">
                <span className="font-medium">{claim.first_name} {claim.last_name}</span>
              </MetaRow>
              <MetaRow label="Role">{claim.position}</MetaRow>
              <MetaRow label="Email">
                <a href={`mailto:${claim.email}`} className="text-amber-700 hover:underline">
                  {claim.email}
                </a>
              </MetaRow>
              <MetaRow label="Phone">{claim.phone || "—"}</MetaRow>
              <MetaRow label="IP address">
                <span className="font-mono text-xs">{claim.ip_address ?? "—"}</span>
              </MetaRow>
              <MetaRow label="Submitted">{fmt(claim.created_at, true)}</MetaRow>
              {claim.reviewed_at && (
                <>
                  <MetaRow label="Reviewed">{fmt(claim.reviewed_at, true)}</MetaRow>
                  {claim.reviewed_by && (
                    <MetaRow label="Reviewed by">
                      <span className="font-mono text-xs">{claim.reviewed_by}</span>
                    </MetaRow>
                  )}
                </>
              )}
            </dl>
          </Section>

          {/* Venue context */}
          <Section title="Venue">
            <dl className="space-y-2.5">
              <MetaRow label="Name">
                <span className="font-medium">{claim.venue?.name ?? "—"}</span>
              </MetaRow>
              <MetaRow label="Address">{formatAddress(claim.venue)}</MetaRow>
              <MetaRow label="Phone">{claim.venue?.phone ?? "—"}</MetaRow>
              <MetaRow label="Website">
                {claim.venue?.website_url ? (
                  <a
                    href={claim.venue.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-700 hover:underline break-all"
                  >
                    {claim.venue.website_url}
                  </a>
                ) : (
                  "—"
                )}
              </MetaRow>
              <MetaRow label="Claimed at">
                {claim.venue?.claimed_at ? (
                  <span className="text-amber-700 font-medium">
                    {fmt(claim.venue.claimed_at, true)}
                  </span>
                ) : (
                  <span className="text-gray-400">Not yet claimed</span>
                )}
              </MetaRow>
            </dl>
          </Section>

          {/* Review notes */}
          <Section title="Review notes">
            {claim.review_notes ? (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {claim.review_notes}
              </p>
            ) : (
              <p className="text-sm text-gray-400 italic">No review notes yet.</p>
            )}
          </Section>

          <ReviewActionsPanel
            claimId={claim.id}
            initialNotes={claim.review_notes}
            currentStatus={claim.status}
          />

        </div>

        {/* ── Right column: trust signals ──────────────────────────────────── */}
        <div>
          <Section title="Trust signals">
            <div className="divide-y divide-gray-100 -mt-1">
              {signals.map((signal) => (
                <SignalRow key={signal.key} signal={signal} />
              ))}
            </div>
          </Section>
        </div>

      </div>
    </div>
  );
}
