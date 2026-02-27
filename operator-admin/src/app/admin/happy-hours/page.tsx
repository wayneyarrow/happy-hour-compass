import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import AccordionSection from "../venue/AccordionSection";
import HhTimesSection from "./HhTimesSection";
import TaglineForm from "./TaglineForm";
import HhTimesForm from "./HhTimesForm";
import SpecialsForm from "./SpecialsForm";
import type { HhItem } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

type HappyHoursVenueRow = {
  id: string;
  hh_tagline?: string | null;
  hh_times?: string | null;
  hh_food_details?: string | null;
  hh_drink_details?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses the hh_food_details / hh_drink_details TEXT column into structured
 * items for the SpecialsForm.
 *
 * Supports two formats:
 *   1. JSON array written by this UI:  [{"name":"Smash Burger","price":"13"}]
 *   2. Legacy newline-separated plain text (one item per line)
 *
 * Returns an empty array when the column is empty. The form component handles
 * showing the example row when the array is empty.
 */
function parseSpecials(raw: string | null | undefined): HhItem[] {
  if (!raw?.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          typeof item.name === "string"
      )
    ) {
      return parsed as HhItem[];
    }
  } catch {
    // Legacy plain text: split by newline into simple items
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .slice(0, 3)
      .map((line) => ({ name: line.trim() }));
  }

  return [];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminHappyHoursPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

  // Load this operator's single venue — select only the columns we need here.
  // Ownership enforced by created_by_operator_id filter (+ RLS).
  const { data: venueData, error: venueError } = operator
    ? await supabase
        .from("venues")
        .select("id, hh_tagline, hh_times, hh_food_details, hh_drink_details")
        .eq("created_by_operator_id", operator.id)
        .maybeSingle()
    : { data: null, error: null };

  const venue = venueData as HappyHoursVenueRow | null;

  const foodItems = parseSpecials(venue?.hh_food_details);
  const drinkItems = parseSpecials(venue?.hh_drink_details);

  return (
    <div className="max-w-2xl">
      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Happy Hour</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage your happy hour tagline, schedule, and food &amp; drink
          specials.
        </p>
      </div>

      {/* Operator error */}
      {operatorError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}

      {/* Venue fetch error */}
      {venueError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Error loading venue:</strong> {venueError.message}
        </div>
      )}

      {/* No venue found */}
      {!operatorError && !venueError && operator && !venue && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-600">
            We couldn&rsquo;t find a venue connected to your account.
          </p>
          <p className="text-xs text-gray-400 mt-1">Please contact support.</p>
        </div>
      )}

      {/* ── Happy hour sections ──────────────────────────────────────────── */}
      {!operatorError && operator && venue && (
        <div className="space-y-3">

          {/* Section 1: Tagline — expanded by default */}
          <AccordionSection title="Tagline" defaultOpen>
            <TaglineForm
              venueId={venue.id}
              initialTagline={venue.hh_tagline ?? ""}
            />
          </AccordionSection>

          {/* Section 2: Happy Hour Times — uses HhTimesSection (always mounted) */}
          <HhTimesSection
            title="Happy Hour Times"
            description="Set the days and times when your happy hour is active."
          >
            <HhTimesForm
              venueId={venue.id}
              initialHhTimes={venue.hh_times ?? null}
            />
          </HhTimesSection>

          {/* Section 3: Food specials */}
          <AccordionSection title="Food specials">
            <SpecialsForm
              venueId={venue.id}
              type="food"
              initialItems={foodItems}
            />
          </AccordionSection>

          {/* Section 4: Drink specials */}
          <AccordionSection title="Drink specials">
            <SpecialsForm
              venueId={venue.id}
              type="drink"
              initialItems={drinkItems}
            />
          </AccordionSection>

        </div>
      )}
    </div>
  );
}
