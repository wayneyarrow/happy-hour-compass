/**
 * Shared helper for deriving a consumer's combined display name from their
 * structured first_name/last_name — used everywhere a
 * consumer_profiles.display_name value needs to be computed from structured
 * data (signup, profile creation, account editing), so this join logic
 * exists in exactly one place rather than being duplicated at each call
 * site.
 *
 * Deliberately trivial: [first, last].filter(Boolean).join(" "), trimmed,
 * or null if nothing usable remains. No attempt to infer, split, or
 * culturally normalize name structure — that is explicitly out of scope
 * (see supabase/migrations/079_consumer_structured_names.sql's header
 * comment for the same reasoning applied to the historical backfill).
 */
export function buildConsumerDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string | null {
  const combined = [firstName, lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(" ")
    .trim();
  return combined || null;
}
