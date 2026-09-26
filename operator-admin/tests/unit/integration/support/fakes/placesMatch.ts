// Boundary fake for "@/lib/google/placesMatch": the Google Places API.
// The real confidence gate and field mappers still run.
import { world } from "../world";
import type { GoogleMatch } from "../../../../../src/lib/google/placesMatch";
export * from "../../../../../src/lib/google/placesMatch";

export async function searchGooglePlace(): Promise<GoogleMatch | null> {
  return (world.googleCandidate as GoogleMatch | null) ?? null;
}
