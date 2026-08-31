"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import {
  searchGooglePlace,
  passesConfidenceGate,
  getGooglePlaceById,
  toVenueGoogleFields,
} from "@/lib/google/placesMatch";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VenueNoteState = {
  success?: true;
  error?: string;
  fieldError?: string;
};

export type VenueActionResult = { success: true } | { success: false; error: string };

/** Result of a manual "Search Google Places" attempt — NOT yet persisted. */
export type GoogleSearchState = {
  success?: true;
  error?: string;
  candidate?: {
    placeId: string;
    name: string | null;
    formattedAddress: string | null;
    rating: number | null;
    reviewCount: number | null;
  };
  /** Whether the candidate passes the same confidence gate used at intake/reconciliation. */
  confident?: boolean;
};

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getAdmin(): Promise<{ id: string; email: string | null } | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user || !await isControlPanelAdmin(user.email)) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

// ── Add venue note ────────────────────────────────────────────────────────────

/**
 * Appends a new internal note to venue_notes.
 * Notes are internal only — never surfaced to venue operators.
 * venueId is bound via .bind(null, venueId) — never read from FormData.
 */
export async function addVenueNoteAction(
  venueId: string,
  _prevState: VenueNoteState,
  formData: FormData
): Promise<VenueNoteState> {
  const note = (formData.get("note") as string | null)?.trim() ?? "";

  if (!note) {
    return { fieldError: "Note cannot be empty." };
  }

  const admin = await getAdmin();
  if (!admin) {
    return { error: "Session expired. Please sign in again." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note,
    created_by:       admin.id,
    created_by_email: admin.email,
  });

  if (error) {
    console.error("[addVenueNoteAction] Insert failed:", error.message);
    return { error: "Failed to save note. Please try again." };
  }

  revalidatePath(`/control-panel/venues/${venueId}`);
  return { success: true };
}

// ── Toggle Exclude From Discover ──────────────────────────────────────────────

/**
 * Toggles venues.exclude_from_discover from the venue detail page.
 * Appends an internal note and revalidates the venue detail, discover, and home pages.
 * venueId is bound via .bind(null, venueId).
 */
export async function updateVenueExcludeFromDiscoverAction(
  venueId: string,
  value: boolean
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("venues")
    .update({ exclude_from_discover: value })
    .eq("id", venueId);

  if (error) {
    console.error("[updateVenueExcludeFromDiscoverAction]", error.message);
    return { success: false, error: "Failed to update Exclude From Discover." };
  }

  const { error: noteError } = await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note:             value
      ? "Venue excluded from discover (all rails)."
      : "Venue restored to discover eligibility.",
    created_by:       admin.id,
    created_by_email: admin.email,
  });
  if (noteError) {
    console.error("[updateVenueExcludeFromDiscoverAction] Note insert failed:", noteError.message);
  }

  revalidatePath(`/control-panel/venues/${venueId}`);
  revalidatePath("/control-panel/discover");
  revalidatePath("/");
  return { success: true };
}

// ── Reactivate cancelled venue ────────────────────────────────────────────────

/**
 * Clears the cancellation fields on a venue, restoring it to an active
 * (but unpublished) state. Does NOT republish the venue.
 * Historical audit logs, venue notes, and plan_change_events are preserved.
 * venueId is bound via .bind(null, venueId) — never read from FormData.
 */
export async function reactivateVenueAction(
  venueId: string,
  _prevState: VenueActionResult,
  _formData: FormData
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const supabase = createAdminClient();

  // Fetch venue name + confirm it is actually cancelled.
  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, name, cancelled_at")
    .eq("id", venueId)
    .maybeSingle();

  if (fetchError || !venue) {
    return { success: false, error: "Venue not found." };
  }

  const v = venue as { id: string; name: string; cancelled_at: string | null };

  if (!v.cancelled_at) {
    return { success: false, error: "Venue is not cancelled." };
  }

  // Clear cancellation fields; keep is_published = false.
  const { error: updateError } = await supabase
    .from("venues")
    .update({
      cancelled_at:             null,
      cancellation_reason:      null,
      cancelled_by_operator_id: null,
    })
    .eq("id", venueId);

  if (updateError) {
    console.error("[reactivateVenueAction] Update failed:", updateError.message);
    return { success: false, error: "Failed to reactivate venue. Please try again." };
  }

  // Internal venue note (fire-and-forget, non-fatal).
  await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note:             `Venue reactivated by founder/admin (${admin.email}). Cancellation cleared. Venue remains unpublished.`,
    created_by:       admin.id,
    created_by_email: admin.email,
  }).then(({ error: noteErr }) => {
    if (noteErr) console.error("[reactivateVenueAction] Note insert failed:", noteErr.message);
  });

  // Audit log (fire-and-forget).
  await logAuditEvent({
    actorEmail: admin.email ?? "unknown",
    action:     "venue_reactivated",
    entityType: "venue",
    entityId:   venueId,
    entityName: v.name,
    details:    { previously_cancelled_at: v.cancelled_at },
  });

  revalidatePath(`/control-panel/venues/${venueId}`);
  revalidatePath("/control-panel/venues");
  return { success: true };
}

// ── Google Identity — Founder manual fallback (Part 6/7) ─────────────────────
//
// Covers venues that automatic reconciliation (reconcileVenueGoogleIdentity,
// invoked from approveAndCreateVenueAction) either never ran for or couldn't
// confidently resolve. Uses the exact same searchGooglePlace() +
// passesConfidenceGate() as intake/reconciliation (src/lib/google/placesMatch.ts)
// so the standard shown to a founder here is never looser than the automatic
// path — but nothing is EVER persisted without an explicit founder click on
// "Confirm this listing". Never auto-attaches a nearby/parent/similarly named
// business.

/**
 * Runs a Google Places text search for founder review. Does NOT write to the
 * database — the founder must explicitly confirm the candidate via
 * confirmVenueGooglePlaceAction before anything is persisted.
 * venueId is bound via .bind(null, venueId).
 */
export async function searchVenueGooglePlaceAction(
  venueId: string,
  _prevState: GoogleSearchState,
  formData: FormData
): Promise<GoogleSearchState> {
  const admin = await getAdmin();
  if (!admin) return { error: "Session expired. Please sign in again." };

  const name          = (formData.get("name")           as string | null)?.trim() ?? "";
  const streetAddress = (formData.get("street_address")  as string | null)?.trim() ?? "";
  const city          = (formData.get("city")            as string | null)?.trim() ?? "";
  const province      = (formData.get("province")        as string | null)?.trim() ?? "";

  if (!name || !city || !province) {
    return { error: "Name, city, and province are required to search." };
  }

  const candidate = await searchGooglePlace(name, city, province);
  if (!candidate || !candidate.placeId) {
    return { error: "No Google Places result found for these details." };
  }

  const confident = passesConfidenceGate(
    { businessName: name, streetAddress, city, province },
    candidate
  );

  return {
    success: true,
    candidate: {
      placeId:          candidate.placeId,
      name:             candidate.name,
      formattedAddress: candidate.formattedAddress,
      rating:           candidate.rating,
      reviewCount:      candidate.reviewCount,
    },
    confident,
  };
}

/**
 * Persists a founder-confirmed Google Places match onto the venue.
 * Re-fetches the place fresh by ID (never trusts client-echoed rating/review
 * data from the earlier search step) before writing.
 * venueId is bound via .bind(null, venueId).
 */
export async function confirmVenueGooglePlaceAction(
  venueId: string,
  _prevState: VenueActionResult,
  formData: FormData
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const placeId = (formData.get("place_id") as string | null)?.trim() ?? "";
  if (!placeId) return { success: false, error: "Missing place ID — please search again." };

  const supabase = createAdminClient();

  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, name")
    .eq("id", venueId)
    .maybeSingle();

  if (fetchError || !venue) return { success: false, error: "Venue not found." };
  const v = venue as { id: string; name: string };

  const place = await getGooglePlaceById(placeId);
  if (!place || !place.placeId) {
    return { success: false, error: "Could not re-verify this Google listing. Please search again." };
  }

  const fields = toVenueGoogleFields(place);

  const { error } = await supabase.from("venues").update(fields).eq("id", venueId);
  if (error) {
    console.error("[confirmVenueGooglePlaceAction]", error.message);
    return { success: false, error: "Failed to save Google identity. Please try again." };
  }

  await supabase.from("venue_notes").insert({
    venue_id: venueId,
    note:
      `Founder manually confirmed Google identity — place_id ${fields.place_id}` +
      (fields.google_rating != null
        ? `, rating ${fields.google_rating} (${fields.google_review_count ?? 0} reviews).`
        : "."),
    created_by:       admin.id,
    created_by_email: admin.email,
  });

  await logAuditEvent({
    actorEmail: admin.email ?? "unknown",
    action:     "venue_google_identity_confirmed",
    entityType: "venue",
    entityId:   venueId,
    entityName: v.name,
    details: {
      place_id:            fields.place_id,
      google_rating:       fields.google_rating,
      google_review_count: fields.google_review_count,
    },
  });

  revalidatePath(`/control-panel/venues/${venueId}`);
  return { success: true };
}

/**
 * Marks a venue as a legitimate Google-identity exception — HHC has
 * determined it has no independent Google listing of its own (e.g. a hotel
 * lounge indexed only under the hotel). Clears any existing place_id/rating
 * so a mismatched prior attachment can also be corrected through this same
 * action. Automatic reconciliation skips exempt venues until a founder
 * deliberately clears the exemption (clearVenueGoogleIdentityExemptionAction).
 * venueId is bound via .bind(null, venueId).
 */
export async function markVenueGoogleIdentityExemptAction(
  venueId: string,
  _prevState: VenueActionResult,
  formData: FormData
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const reason = (formData.get("reason") as string | null)?.trim() || null;

  const supabase = createAdminClient();
  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, name, place_id")
    .eq("id", venueId)
    .maybeSingle();

  if (fetchError || !venue) return { success: false, error: "Venue not found." };
  const v = venue as { id: string; name: string; place_id: string | null };

  const { error } = await supabase
    .from("venues")
    .update({
      google_identity_status: "exempt",
      google_identity_reason: reason,
      place_id:            null,
      google_rating:        null,
      google_review_count:  null,
    })
    .eq("id", venueId);

  if (error) {
    console.error("[markVenueGoogleIdentityExemptAction]", error.message);
    return { success: false, error: "Failed to mark venue exempt. Please try again." };
  }

  await supabase.from("venue_notes").insert({
    venue_id: venueId,
    note:
      (v.place_id
        ? "Founder cleared a previously attached Google identity and marked this venue as a "
        : "Founder marked this venue as a ") +
      "legitimate Google-identity exception (no independent Google listing)." +
      (reason ? ` Reason: ${reason}` : ""),
    created_by:       admin.id,
    created_by_email: admin.email,
  });

  await logAuditEvent({
    actorEmail: admin.email ?? "unknown",
    action:     "venue_google_identity_exempted",
    entityType: "venue",
    entityId:   venueId,
    entityName: v.name,
    details:    { reason, previous_place_id: v.place_id },
  });

  revalidatePath(`/control-panel/venues/${venueId}`);
  return { success: true };
}

/**
 * Clears a Google-identity exemption, returning the venue to "unmatched" and
 * making it eligible for reconciliation again. The only way an exempt venue
 * can ever become eligible again — deliberate, founder-only.
 * venueId is bound via .bind(null, venueId).
 */
export async function clearVenueGoogleIdentityExemptionAction(
  venueId: string,
  _prevState: VenueActionResult,
  _formData: FormData
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const supabase = createAdminClient();
  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, name, google_identity_status")
    .eq("id", venueId)
    .maybeSingle();

  if (fetchError || !venue) return { success: false, error: "Venue not found." };
  const v = venue as { id: string; name: string; google_identity_status: string | null };

  if (v.google_identity_status !== "exempt") {
    return { success: false, error: "This venue is not currently marked exempt." };
  }

  const { error } = await supabase
    .from("venues")
    .update({ google_identity_status: "unmatched", google_identity_reason: null })
    .eq("id", venueId);

  if (error) {
    console.error("[clearVenueGoogleIdentityExemptionAction]", error.message);
    return { success: false, error: "Failed to clear exemption. Please try again." };
  }

  await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note:             "Founder cleared the Google-identity exemption — venue is eligible for reconciliation again.",
    created_by:       admin.id,
    created_by_email: admin.email,
  });

  await logAuditEvent({
    actorEmail: admin.email ?? "unknown",
    action:     "venue_google_identity_exemption_cleared",
    entityType: "venue",
    entityId:   venueId,
    entityName: v.name,
  });

  revalidatePath(`/control-panel/venues/${venueId}`);
  return { success: true };
}

// ── Manual Onboarding Completion Override (Phase 1B) ──────────────────────────
//
// Founder/Admin-only, durable override so a venue can be treated as
// onboarding-complete even when the strict automatic requirements (happy
// hour times, business hours, an operator photo, food AND drink specials,
// published) don't legitimately apply — e.g. a drink-only bar with no food
// menu to add. Effective onboarding completion is automaticComplete OR
// manualOverrideActive (computeEffectiveOnboarding(), homepagePhase.ts) —
// this never falsifies the underlying readiness signals or setup-health
// percentage, so a manually-completed venue can still show missing items.
// Reversible: clearOnboardingOverrideAction() below returns the venue to the
// normal dynamic onboarding calculation.

/**
 * Marks a venue onboarding-complete regardless of the automatic requirements.
 * A reason is required — this is a consequential override that changes what
 * the operator sees and how the venue is counted platform-wide.
 * venueId is bound via .bind(null, venueId).
 */
export async function markOnboardingCompleteAction(
  venueId: string,
  _prevState: VenueActionResult,
  formData: FormData
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  if (!reason) {
    return { success: false, error: "A reason is required to manually mark onboarding complete." };
  }

  const supabase = createAdminClient();

  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, name, onboarding_completed_override_at")
    .eq("id", venueId)
    .maybeSingle();

  if (fetchError || !venue) return { success: false, error: "Venue not found." };
  const v = venue as { id: string; name: string; onboarding_completed_override_at: string | null };

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("venues")
    .update({
      onboarding_completed_override_at:       now,
      onboarding_completed_override_by:       admin.id,
      onboarding_completed_override_by_email: admin.email,
      onboarding_completed_override_reason:   reason,
    })
    .eq("id", venueId);

  if (error) {
    console.error("[markOnboardingCompleteAction]", error.message);
    return { success: false, error: "Failed to mark onboarding complete. Please try again." };
  }

  await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note:             `Onboarding manually marked complete by Founder/Admin. Reason: ${reason}`,
    created_by:       admin.id,
    created_by_email: admin.email,
  });

  await logAuditEvent({
    actorEmail: admin.email ?? "unknown",
    action:     "venue_onboarding_manually_completed",
    entityType: "venue",
    entityId:   venueId,
    entityName: v.name,
    details:    { reason, previously_overridden: !!v.onboarding_completed_override_at },
  });

  revalidatePath(`/control-panel/venues/${venueId}`);
  revalidatePath("/control-panel");
  revalidatePath("/control-panel/action-center");
  revalidatePath("/control-panel/action-center/reports/active-still-onboarding");
  return { success: true };
}

/**
 * Clears a manual onboarding-completion override, returning the venue to the
 * normal dynamic onboarding calculation. If the automatic requirements are
 * still unmet, the venue immediately goes back to "still onboarding"
 * everywhere (operator homepage, Founder Dashboard, Action Center).
 * venueId is bound via .bind(null, venueId).
 */
export async function clearOnboardingOverrideAction(
  venueId: string,
  _prevState: VenueActionResult,
  formData: FormData
): Promise<VenueActionResult> {
  const admin = await getAdmin();
  if (!admin) return { success: false, error: "Session expired." };

  const clearReason = (formData.get("reason") as string | null)?.trim() || null;

  const supabase = createAdminClient();

  const { data: venue, error: fetchError } = await supabase
    .from("venues")
    .select("id, name, onboarding_completed_override_at")
    .eq("id", venueId)
    .maybeSingle();

  if (fetchError || !venue) return { success: false, error: "Venue not found." };
  const v = venue as { id: string; name: string; onboarding_completed_override_at: string | null };

  if (!v.onboarding_completed_override_at) {
    return { success: false, error: "This venue does not have a manual onboarding override." };
  }

  const { error } = await supabase
    .from("venues")
    .update({
      onboarding_completed_override_at:       null,
      onboarding_completed_override_by:       null,
      onboarding_completed_override_by_email: null,
      onboarding_completed_override_reason:   null,
    })
    .eq("id", venueId);

  if (error) {
    console.error("[clearOnboardingOverrideAction]", error.message);
    return { success: false, error: "Failed to clear manual onboarding completion. Please try again." };
  }

  await supabase.from("venue_notes").insert({
    venue_id:         venueId,
    note:
      "Manual onboarding completion cleared by Founder/Admin. Venue returned to automatic onboarding status." +
      (clearReason ? ` Reason: ${clearReason}` : ""),
    created_by:       admin.id,
    created_by_email: admin.email,
  });

  await logAuditEvent({
    actorEmail: admin.email ?? "unknown",
    action:     "venue_onboarding_override_cleared",
    entityType: "venue",
    entityId:   venueId,
    entityName: v.name,
    details:    { reason: clearReason, previous_override_at: v.onboarding_completed_override_at },
  });

  revalidatePath(`/control-panel/venues/${venueId}`);
  revalidatePath("/control-panel");
  revalidatePath("/control-panel/action-center");
  revalidatePath("/control-panel/action-center/reports/active-still-onboarding");
  return { success: true };
}
