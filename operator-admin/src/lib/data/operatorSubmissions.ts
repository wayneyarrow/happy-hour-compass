import { createAdminClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One entry in the internal notes log for a submission. */
export type SubmissionNote = {
  id: string;
  submission_id: string;
  note: string;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
};

/** Minimal shape for the list view — only columns needed for fast triage. */
export type OperatorSubmissionRow = {
  id: string;
  submitted_at: string;
  updated_at: string;
  venue_name: string;
  city: string | null;
  province: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  position: string | null;
  status: string;
  match_status: string;
  venue_id: string | null;
  email_domain_matches_website: boolean | null;
  is_public_email_domain: boolean | null;
  role_trust_level: string | null;
};

/** Linked venue shape for the detail view. */
export type LinkedVenue = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  is_published: boolean;
  claimed_by: string | null;
  created_by_operator_id: string | null;
};

/** Full submission shape for the detail view. */
export type OperatorSubmissionDetail = {
  id: string;
  submitted_at: string;
  updated_at: string;
  // Submitter identity
  first_name: string | null;
  last_name: string | null;
  email: string;
  position: string | null;
  // Business info submitted in the form
  venue_name: string;
  street_address: string | null;
  city: string | null;
  province: string | null;
  // Optional contact / notes
  website: string | null;
  additional_notes: string | null;
  rejection_notes: string | null;
  // Match / routing outcome
  status: string;
  match_status: string;
  place_id: string | null;
  google_match_json: Record<string, unknown> | null;
  venue_id: string | null;
  // Trust signals (stored at submit time, informational only)
  ip_address: string | null;
  email_domain_matches_website: boolean | null;
  is_public_email_domain: boolean | null;
  role_trust_level: string | null;
  geo_ip_country: string | null;
  geo_ip_region: string | null;
  geo_ip_matches_business_region: boolean | null;
  // Founder review fields (migration 020)
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  more_info_requested_at: string | null;
  rejected_at: string | null;
  // More-info form fields (migration 021) — founder-review-only
  more_info_completed_at: string | null;
  info_phone: string | null;
  info_website: string | null;
  info_socials: Record<string, string> | null;
  info_relationship: string | null;
  info_additional_notes: string | null;
  info_preferred_contact: string | null;
  // Linked venue (fetched separately via venue_id)
  venue: LinkedVenue | null;
};

// ── Tab → status filter ───────────────────────────────────────────────────────

const NEEDS_REVIEW_STATUSES = ["double_claim", "rejected_by_user", "no_match", "needs_more_info", "info_submitted"];

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Fetches operator submissions for the list view, filtered by tab.
 *
 * tab values:
 *   "needs_review"   → double_claim | rejected_by_user | no_match
 *   "confirmed_auto" → confirmed_auto
 *   "all"            → no filter (every row)
 */
export async function getOperatorSubmissions(tab: string): Promise<{
  submissions: OperatorSubmissionRow[];
  error: string | null;
}> {
  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("operator_submissions")
    .select(
      `id, submitted_at, updated_at, venue_name, city, province,
       first_name, last_name, email, position,
       status, match_status, venue_id,
       email_domain_matches_website, is_public_email_domain, role_trust_level`
    )
    .order("submitted_at", { ascending: false });

  if (tab === "needs_review") {
    query = query.in("status", NEEDS_REVIEW_STATUSES);
  } else if (tab === "confirmed_auto") {
    query = query.eq("status", "confirmed_auto");
  }
  // "all" → no additional filter

  const { data, error } = await query;

  if (error) {
    console.error("[getOperatorSubmissions]", error.message);
    return { submissions: [], error: "Failed to load submissions." };
  }

  const submissions: OperatorSubmissionRow[] = (data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: Record<string, any>) => ({
      id:                          row.id as string,
      submitted_at:                row.submitted_at as string,
      updated_at:                  row.updated_at as string,
      venue_name:                  row.venue_name as string,
      city:                        row.city as string | null,
      province:                    row.province as string | null,
      first_name:                  row.first_name as string | null,
      last_name:                   row.last_name as string | null,
      email:                       row.email as string,
      position:                    row.position as string | null,
      status:                      row.status as string,
      match_status:                row.match_status as string,
      venue_id:                    row.venue_id as string | null,
      email_domain_matches_website: row.email_domain_matches_website as boolean | null,
      is_public_email_domain:       row.is_public_email_domain as boolean | null,
      role_trust_level:             row.role_trust_level as string | null,
    })
  );

  return { submissions, error: null };
}

/**
 * Fetches a single operator submission with all columns plus the linked venue.
 * Returns null submission (not an error) when the id doesn't exist.
 */
export async function getOperatorSubmissionById(id: string): Promise<{
  submission: OperatorSubmissionDetail | null;
  error: string | null;
}> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_submissions")
    .select(
      `id, submitted_at, updated_at,
       first_name, last_name, email, position,
       venue_name, street_address, city, province,
       website, additional_notes, rejection_notes,
       status, match_status, place_id, google_match_json, venue_id,
       ip_address,
       email_domain_matches_website, is_public_email_domain, role_trust_level,
       geo_ip_country, geo_ip_region, geo_ip_matches_business_region,
       review_notes, reviewed_by, reviewed_at, more_info_requested_at, rejected_at,
       more_info_completed_at,
       info_phone, info_website, info_socials, info_relationship,
       info_additional_notes, info_preferred_contact`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[getOperatorSubmissionById]", error.message);
    return { submission: null, error: "Failed to load submission." };
  }

  if (!data) {
    return { submission: null, error: null }; // not found — caller handles
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as Record<string, any>;
  const venueId = row.venue_id as string | null;

  // Fetch the linked venue separately when venue_id is present.
  let venue: LinkedVenue | null = null;
  if (venueId) {
    const { data: venueData } = await supabase
      .from("venues")
      .select("id, name, city, region, is_published, claimed_by, created_by_operator_id")
      .eq("id", venueId)
      .maybeSingle();

    if (venueData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = venueData as Record<string, any>;
      venue = {
        id:                     v.id as string,
        name:                   v.name as string,
        city:                   v.city as string | null,
        region:                 v.region as string | null,
        is_published:           v.is_published as boolean,
        claimed_by:             v.claimed_by as string | null,
        created_by_operator_id: v.created_by_operator_id as string | null,
      };
    }
  }

  const submission: OperatorSubmissionDetail = {
    id:                           row.id as string,
    submitted_at:                 row.submitted_at as string,
    updated_at:                   row.updated_at as string,
    first_name:                   row.first_name as string | null,
    last_name:                    row.last_name as string | null,
    email:                        row.email as string,
    position:                     row.position as string | null,
    venue_name:                   row.venue_name as string,
    street_address:               row.street_address as string | null,
    city:                         row.city as string | null,
    province:                     row.province as string | null,
    website:                      row.website as string | null,
    additional_notes:             row.additional_notes as string | null,
    rejection_notes:              row.rejection_notes as string | null,
    status:                       row.status as string,
    match_status:                 row.match_status as string,
    place_id:                     row.place_id as string | null,
    google_match_json:            row.google_match_json as Record<string, unknown> | null,
    venue_id:                     venueId,
    ip_address:                   row.ip_address as string | null,
    email_domain_matches_website: row.email_domain_matches_website as boolean | null,
    is_public_email_domain:       row.is_public_email_domain as boolean | null,
    role_trust_level:             row.role_trust_level as string | null,
    geo_ip_country:               row.geo_ip_country as string | null,
    geo_ip_region:                row.geo_ip_region as string | null,
    geo_ip_matches_business_region: row.geo_ip_matches_business_region as boolean | null,
    review_notes:                 row.review_notes as string | null,
    reviewed_by:                  row.reviewed_by as string | null,
    reviewed_at:                  row.reviewed_at as string | null,
    more_info_requested_at:       row.more_info_requested_at as string | null,
    rejected_at:                  row.rejected_at as string | null,
    more_info_completed_at:       row.more_info_completed_at as string | null,
    info_phone:                   row.info_phone as string | null,
    info_website:                 row.info_website as string | null,
    info_socials:                 row.info_socials as Record<string, string> | null,
    info_relationship:            row.info_relationship as string | null,
    info_additional_notes:        row.info_additional_notes as string | null,
    info_preferred_contact:       row.info_preferred_contact as string | null,
    venue,
  };

  return { submission, error: null };
}

/**
 * Fetches the internal notes log for a submission, newest first.
 * Returns an empty array (not an error) when there are no notes.
 */
export async function getSubmissionNotes(submissionId: string): Promise<{
  notes: SubmissionNote[];
  error: string | null;
}> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_submission_notes")
    .select("id, submission_id, note, created_by, created_by_email, created_at")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getSubmissionNotes]", error.message);
    return { notes: [], error: "Failed to load notes." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notes: SubmissionNote[] = (data ?? []).map((row: Record<string, any>) => ({
    id:               row.id as string,
    submission_id:    row.submission_id as string,
    note:             row.note as string,
    created_by:       row.created_by as string | null,
    created_by_email: row.created_by_email as string | null,
    created_at:       row.created_at as string,
  }));

  return { notes, error: null };
}
