import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { ClaimForm } from "./ClaimForm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClaimPage({ params }: PageProps) {
  const { id } = await params;

  // Fetch venue name + claimed_at — service-role to bypass RLS (same as venue detail)
  const supabase = createAdminClient();

  // Try slug first, fall back to UUID — mirrors getVenueWithEventsForConsumerById
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function queryVenue(field: "slug" | "id"): Promise<Record<string, any> | null> {
    const { data } = await supabase
      .from("venues")
      .select("name, claimed_at")
      .eq(field, id)
      .eq("is_published", true)
      .maybeSingle();
    return data ?? null;
  }

  const venue = (await queryVenue("slug")) ?? (await queryVenue("id"));

  if (!venue) {
    notFound();
  }

  // Venue already claimed — silently redirect back; do not show "already claimed" message
  if (venue.claimed_at) {
    redirect(`/venue/${id}`);
  }

  return (
    <main className="bg-gray-50 min-h-full">
      {/* Header — matches venue detail header pattern exactly */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        <Link
          href={`/venue/${id}`}
          className="text-blue-500 text-2xl font-bold leading-none shrink-0"
          aria-label="Back to venue"
        >
          ←
        </Link>
        <h1 className="flex-1 text-[18px] font-bold text-gray-900 ml-3 truncate">
          Claim this venue
        </h1>
      </div>

      {/* Form — client component handles state, validation, and success view */}
      <ClaimForm venueRouteParam={id} venueName={venue.name as string} />
    </main>
  );
}
