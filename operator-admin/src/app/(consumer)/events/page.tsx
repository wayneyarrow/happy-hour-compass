import type { Metadata } from "next";
import { getPublishedEventsForConsumer } from "@/lib/data/events";
import { EventsDiscovery } from "../EventsDiscovery";

export const metadata: Metadata = { title: "Events" };

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getPublishedEventsForConsumer();

  return (
    <main className="bg-gray-50">
      <EventsDiscovery events={events} />
    </main>
  );
}
