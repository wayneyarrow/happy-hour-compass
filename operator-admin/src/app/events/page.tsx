import { getPublishedEventsForConsumer } from "@/lib/data/events";
import { EventsDiscovery } from "../EventsDiscovery";
import { ConsumerNav } from "../ConsumerNav";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getPublishedEventsForConsumer();

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <EventsDiscovery events={events} />
      <ConsumerNav />
    </main>
  );
}
