import { getPublishedEventsForConsumer } from "@/lib/data/events";
import { EventsDiscovery } from "../EventsDiscovery";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getPublishedEventsForConsumer();

  return (
    <main className="bg-gray-50">
      <EventsDiscovery events={events} />
    </main>
  );
}
