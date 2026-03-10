import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getPublishedEventsForConsumer } from "@/lib/data/events";
import { SavedVenueList } from "./SavedVenueList";
// Always read fresh data — saved state must reflect current DB state.
export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const [venues, events] = await Promise.all([
    getPublishedVenuesForConsumer(),
    getPublishedEventsForConsumer(),
  ]);

  return (
    <main className="bg-gray-50">
      {/* Page header — matches original .page-header sticky */}
      <div className="sticky top-0 z-50 bg-white border-b border-gray-200 px-5 py-4 flex items-center">
        <h1 className="text-xl font-bold text-gray-900">Saved</h1>
      </div>

      <div className="px-5 py-5">
        {/*
          SavedVenueList reads savedVenues + savedEvents from localStorage
          and filters both lists to only show bookmarked items.
          Full lists are passed server-side so client-side lookup mirrors
          the original renderSavedPage() in-memory pattern.
        */}
        <SavedVenueList allVenues={venues} allEvents={events} />
      </div>
    </main>
  );
}
