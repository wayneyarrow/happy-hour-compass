/**
 * Feature flags for the Happy Hour Compass app.
 *
 * Toggle USE_SUPABASE_VENUES to switch the consumer home page between:
 *   true  → load published venues from Supabase (live DB)
 *   false → load venues from the local venues.beta.csv file (legacy path)
 */
export const USE_SUPABASE_VENUES = true;
