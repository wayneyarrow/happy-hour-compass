import Link from "next/link";
import { getOperatorSubmissionById } from "@/lib/data/operatorSubmissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Submission Review" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month:  "short",
    day:    "numeric",
    year:   "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function na(value: string | null | undefined): React.ReactNode {
  if (value == null || value === "") {
    return <span className="text-gray-400 italic">Not available</span>;
  }
  return value;
}

// ── Status badges ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  confirmed_auto:        { label: "Confirmed auto",   classes: "bg-green-100 text-green-700" },
  double_claim:          { label: "Double claim",     classes: "bg-red-100 text-red-700" },
  rejected_by_user:      { label: "Rejected by user", classes: "bg-orange-100 text-orange-700" },
  no_match:              { label: "No match",         classes: "bg-gray-100 text-gray-600" },
  new:                   { label: "New",              classes: "bg-amber-100 text-amber-700" },
  approved:              { label: "Approved",         classes: "bg-green-100 text-green-700" },
  rejected:              { label: "Rejected",         classes: "bg-red-100 text-red-700" },
  converted_to_operator: { label: "Converted",        classes: "bg-blue-100 text-blue-700" },
};

const MATCH_STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  confirmed: { label: "Confirmed", classes: "bg-green-100 text-green-700" },
  rejected:  { label: "Rejected",  classes: "bg-orange-100 text-orange-700" },
  no_match:  { label: "No match",  classes: "bg-gray-100 text-gray-600" },
  pending:   { label: "Pending",   classes: "bg-amber-100 text-amber-700" },
};

function StatusBadge({ status, config }: {
  status: string;
  config: Record<string, { label: string; classes: string }>;
}) {
  const cfg = config[status] ?? { label: status, classes: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── Trust signal row (stored columns, not computed) ───────────────────────────

type StoredSignal = {
  label: string;
  value: boolean | string | null | undefined;
  /** Override the display text instead of true/false */
  display?: string;
  positiveWhen?: boolean; // what boolean value is considered positive
};

function StoredSignalRow({ signal }: { signal: StoredSignal }) {
  let dotClass = "bg-gray-300"; // unknown / null
  let displayText: string;

  if (signal.display !== undefined) {
    displayText = signal.display;
    // string value — use neutral dot
    dotClass = "bg-gray-400";
  } else if (typeof signal.value === "boolean") {
    const isPositive = signal.value === (signal.positiveWhen ?? true);
    dotClass = isPositive ? "bg-green-500" : "bg-red-400";
    displayText = signal.value ? "Yes" : "No";
  } else {
    displayText = signal.value ?? "Not available";
  }

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
      <span className="text-sm text-gray-500 w-44 shrink-0">{signal.label}</span>
      <span className={`text-sm font-medium ${signal.value == null ? "text-gray-400 italic" : "text-gray-800"}`}>
        {displayText}
      </span>
    </div>
  );
}

// ── Shared layout pieces ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="text-gray-400 w-36 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{children}</dd>
    </div>
  );
}

function BackArrow() {
  return (
    <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function OperatorSubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { submission, error } = await getOperatorSubmissionById(id);

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!error && !submission) {
    return (
      <div className="max-w-2xl">
        <Link
          href="/control-panel/operator-submissions"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          <BackArrow />
          Back to Submissions
        </Link>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-base font-semibold text-slate-900 mb-1">Submission not found</p>
          <p className="text-sm text-gray-500">
            This submission may have been removed, or the ID is incorrect.
          </p>
        </div>
      </div>
    );
  }

  // ── Fetch error ──────────────────────────────────────────────────────────
  if (error || !submission) {
    return (
      <div className="max-w-2xl">
        <Link
          href="/control-panel/operator-submissions"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          <BackArrow />
          Back to Submissions
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          {error ?? "Something went wrong. Please try again."}
        </div>
      </div>
    );
  }

  // ── Parse google_match_json ───────────────────────────────────────────────
  const gm = submission.google_match_json as Record<string, unknown> | null;

  // ── Linked venue ownership state ──────────────────────────────────────────
  const venue = submission.venue;
  const venueClaimed =
    venue && (venue.claimed_by != null || venue.created_by_operator_id != null);

  return (
    <div className="max-w-6xl">
      {/* ── Back nav ──────────────────────────────────────────────────────── */}
      <Link
        href="/control-panel/operator-submissions"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <BackArrow />
        Back to Submissions
      </Link>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{submission.venue_name}</h1>
            <StatusBadge status={submission.status} config={STATUS_CONFIG} />
            <StatusBadge status={submission.match_status} config={MATCH_STATUS_CONFIG} />
          </div>
          <p className="text-xs text-gray-400 font-mono">{submission.id}</p>
        </div>
      </div>

      {/* ── Two-column layout ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">

        {/* ── Left column ────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* A. Submission Details */}
          <Section title="Submission Details">
            <dl className="space-y-2.5">
              <MetaRow label="Business name">
                <span className="font-medium">{submission.venue_name}</span>
              </MetaRow>
              <MetaRow label="Address">
                {[submission.street_address, submission.city, submission.province]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </MetaRow>
              <MetaRow label="Submitter">
                {[submission.first_name, submission.last_name].filter(Boolean).join(" ") || "—"}
              </MetaRow>
              <MetaRow label="Email">
                {submission.email ? (
                  <a href={`mailto:${submission.email}`} className="text-amber-700 hover:underline">
                    {submission.email}
                  </a>
                ) : "—"}
              </MetaRow>
              <MetaRow label="Position">{submission.position || "—"}</MetaRow>
              <MetaRow label="Website">
                {submission.website ? (
                  <a
                    href={submission.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-700 hover:underline break-all"
                  >
                    {submission.website}
                  </a>
                ) : "—"}
              </MetaRow>
              <MetaRow label="Additional notes">
                {submission.additional_notes || <span className="text-gray-400">None</span>}
              </MetaRow>
              <MetaRow label="Submitted">{fmt(submission.submitted_at, true)}</MetaRow>
            </dl>
          </Section>

          {/* B. Match / Routing Details */}
          <Section title="Match & Routing">
            <dl className="space-y-2.5">
              <MetaRow label="Match status">
                <StatusBadge status={submission.match_status} config={MATCH_STATUS_CONFIG} />
              </MetaRow>
              <MetaRow label="Routing status">
                <StatusBadge status={submission.status} config={STATUS_CONFIG} />
              </MetaRow>
              <MetaRow label="Place ID">
                {submission.place_id ? (
                  <span className="font-mono text-xs text-gray-700">{submission.place_id}</span>
                ) : (
                  <span className="text-gray-400">None</span>
                )}
              </MetaRow>
              {submission.rejection_notes && (
                <MetaRow label="Rejection notes">
                  <span className="text-orange-700">{submission.rejection_notes}</span>
                </MetaRow>
              )}
            </dl>
          </Section>

          {/* C. Google Match Summary */}
          {gm && (
            <Section title="Google Match">
              <dl className="space-y-2.5">
                <MetaRow label="Business name">
                  <span className="font-medium">{(gm.name as string | null) || "—"}</span>
                </MetaRow>
                <MetaRow label="Address">
                  {(gm.formattedAddress as string | null) || "—"}
                </MetaRow>
                <MetaRow label="Phone">
                  {(gm.phone as string | null) || "—"}
                </MetaRow>
                <MetaRow label="Website">
                  {gm.website ? (
                    <a
                      href={gm.website as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-700 hover:underline break-all"
                    >
                      {gm.website as string}
                    </a>
                  ) : "—"}
                </MetaRow>
                <MetaRow label="Place ID">
                  <span className="font-mono text-xs text-gray-700">
                    {(gm.placeId as string | null) || "—"}
                  </span>
                </MetaRow>
              </dl>

              {/* Raw JSON — collapsed by default */}
              <details className="mt-4">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                  Show raw JSON
                </summary>
                <pre className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto border border-gray-100 leading-relaxed">
                  {JSON.stringify(gm, null, 2)}
                </pre>
              </details>
            </Section>
          )}

        </div>

        {/* ── Right column ──────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Linked Venue */}
          {venue ? (
            <Section title="Linked Venue">
              <dl className="space-y-2.5 mb-4">
                <MetaRow label="Name">
                  <span className="font-medium">{venue.name}</span>
                </MetaRow>
                <MetaRow label="Location">
                  {[venue.city, venue.region].filter(Boolean).join(", ") || "—"}
                </MetaRow>
                <MetaRow label="Published">
                  {venue.is_published ? (
                    <span className="text-green-700 font-medium">Published</span>
                  ) : (
                    <span className="text-gray-500">Unpublished</span>
                  )}
                </MetaRow>
                <MetaRow label="Claimed">
                  {venueClaimed ? (
                    <span className="text-amber-700 font-medium">Claimed / owned</span>
                  ) : (
                    <span className="text-gray-500">Unclaimed</span>
                  )}
                </MetaRow>
              </dl>
              <Link
                href={`/control-panel/venues/${venue.id}`}
                className="inline-flex items-center text-xs font-medium text-amber-700 hover:text-amber-800 transition-colors"
              >
                View venue detail →
              </Link>
            </Section>
          ) : (
            <Section title="Linked Venue">
              <p className="text-sm text-gray-400 italic">No venue linked to this submission.</p>
            </Section>
          )}

          {/* D. Trust Signals */}
          <Section title="Trust Signals">
            <div className="-mt-1">
              <StoredSignalRow signal={{
                label: "Domain matches website",
                value: submission.email_domain_matches_website,
                positiveWhen: true,
              }} />
              <StoredSignalRow signal={{
                label: "Business email",
                value: submission.is_public_email_domain === null
                  ? null
                  : !submission.is_public_email_domain,
                positiveWhen: true,
              }} />
              <StoredSignalRow signal={{
                label: "Role trust level",
                value: submission.role_trust_level,
                display: submission.role_trust_level ?? undefined,
              }} />
            </div>
          </Section>

          {/* IP / Location */}
          <Section title="IP & Location">
            <dl className="space-y-2.5">
              <MetaRow label="IP address">
                <span className="font-mono text-xs">
                  {na(submission.ip_address)}
                </span>
              </MetaRow>
              <MetaRow label="GeoIP country">
                {na(submission.geo_ip_country)}
              </MetaRow>
              <MetaRow label="GeoIP region">
                {na(submission.geo_ip_region)}
              </MetaRow>
              <MetaRow label="Region matches venue">
                {submission.geo_ip_matches_business_region === null ? (
                  <span className="text-gray-400 italic">Not available</span>
                ) : submission.geo_ip_matches_business_region ? (
                  <span className="text-green-700 font-medium">Yes</span>
                ) : (
                  <span className="text-orange-700 font-medium">No</span>
                )}
              </MetaRow>
            </dl>
          </Section>

        </div>
      </div>
    </div>
  );
}
