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
      {/*
        SavedVenueList owns the sticky header (with search toggle) + content.
        Full venue/event lists passed server-side so client-side lookup mirrors
        the original renderSavedPage() in-memory pattern.
      */}
      <SavedVenueList allVenues={venues} allEvents={events} />
    </main>
  );
}
