import Link from "next/link";
import { getPublishedEventsForConsumer } from "@/lib/data/events";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getPublishedEventsForConsumer();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto py-6 px-4">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Events</h1>

        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No events listed yet.</p>
        ) : (
          <ul className="space-y-4">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/event/${event.id}`}
                  className="block bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 transition-colors"
                >
                  {event.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.imageUrl}
                      alt={event.title}
                      className="w-full object-cover"
                      style={{ maxHeight: "160px" }}
                    />
                  )}
                  <div className="p-4">
                    <p className="text-xs text-gray-400 mb-0.5">
                      {event.venueName}
                    </p>
                    <p className="font-medium text-gray-900">{event.title}</p>
                    {event.nextOccurrenceLabel && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {event.nextOccurrenceLabel}
                      </p>
                    )}
                    {event.description && (
                      <p className="text-sm text-gray-600 mt-1.5 line-clamp-2">
                        {event.description}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
