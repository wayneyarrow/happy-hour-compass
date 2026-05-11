import { createAdminClient } from "@/lib/supabase/server";
import MoreInfoForm from "./MoreInfoForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify Your Venue — Happy Hour Compass" };

type Props = {
  params: Promise<{ token: string }>;
};

// ── Token states ──────────────────────────────────────────────────────────────

type TokenState = "invalid" | "expired" | "completed" | "error";

function InvalidView({ reason }: { reason: TokenState }) {
  const copy: Record<TokenState, { heading: string; body: string }> = {
    invalid: {
      heading: "Link not found",
      body: "This link doesn't look right. Please check the email and try again, or reply to that email if you need help.",
    },
    expired: {
      heading: "Link expired",
      body: "This link has expired. Please reply to the original email and we'll send you a new one.",
    },
    completed: {
      heading: "Already submitted",
      body: "Your additional details have already been submitted. We'll review your venue and be in touch soon.",
    },
    error: {
      heading: "Something went wrong",
      body: "We hit an unexpected error. Please try again in a few minutes, or reply to the original email for help.",
    },
  };

  const { heading, body } = copy[reason];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-8 py-12 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-6">
        <svg
          className="w-7 h-7 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <h1 className="text-[20px] font-bold text-gray-900 mb-3 leading-snug">{heading}</h1>
      <p className="text-[14px] text-gray-500 leading-relaxed max-w-[280px]">{body}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function MoreInfoPage({ params }: Props) {
  const { token } = await params;

  if (!token || token.length !== 64 || !/^[0-9a-f]+$/.test(token)) {
    return <InvalidView reason="invalid" />;
  }

  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSubmission, error } = await supabase
    .from("operator_submissions")
    .select(
      "id, venue_name, street_address, city, province, " +
      "first_name, last_name, email, position, " +
      "more_info_expires_at, more_info_completed_at"
    )
    .eq("more_info_token", token)
    .maybeSingle();

  const submission = rawSubmission as {
    id: string;
    venue_name: string | null;
    street_address: string | null;
    city: string | null;
    province: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    position: string | null;
    more_info_expires_at: string | null;
    more_info_completed_at: string | null;
  } | null;

  if (error) {
    console.error("[MoreInfoPage] Token lookup error:", error.message);
    return <InvalidView reason="error" />;
  }

  if (!submission) {
    return <InvalidView reason="invalid" />;
  }

  if (submission.more_info_completed_at) {
    return <InvalidView reason="completed" />;
  }

  const expiresAt = submission.more_info_expires_at
    ? new Date(submission.more_info_expires_at as string)
    : null;

  if (!expiresAt || expiresAt <= new Date()) {
    return <InvalidView reason="expired" />;
  }

  return (
    <MoreInfoForm
      token={token}
      initial={{
        venue_name:     (submission.venue_name     as string | null) ?? "",
        street_address: (submission.street_address as string | null) ?? "",
        city:           (submission.city           as string | null) ?? "",
        province:       (submission.province       as string | null) ?? "",
        first_name:     (submission.first_name     as string | null) ?? "",
        last_name:      (submission.last_name      as string | null) ?? "",
        email:          (submission.email          as string | null) ?? "",
        position:       (submission.position       as string | null) ?? "",
      }}
    />
  );
}
