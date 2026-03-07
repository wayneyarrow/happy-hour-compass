import { notFound } from "next/navigation";
import { getVenueWithEventsForConsumerById } from "@/lib/data/venues";
import { VenueDistance } from "./VenueDistance";
import { VenueOpenStatus } from "./VenueOpenStatus";

// Never serve a stale version — preview mode must always read live DB data.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const HH_DAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Converts "HH:MM" (24h) to a short display string like "4 PM" or "4:30 PM". */
function fmt12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${mStr} ${ampm}`;
}

export default async function VenuePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  const isPreview =
    resolvedSearchParams.preview === "true" ||
    (Array.isArray(resolvedSearchParams.preview) &&
      resolvedSearchParams.preview.includes("true"));

  const venue = await getVenueWithEventsForConsumerById(id, {
    includeUnpublished: isPreview,
  });

  if (!venue) {
    notFound();
  }

  const [heroImage, ...additionalImages] = venue.images;

  // Days with at least one happy hour slot, in canonical Sun→Sat order.
  const hhActiveDays = HH_DAY_ORDER.filter(
    (day) => (venue.happyHourWeekly[day]?.length ?? 0) > 0
  );

  const hasHappyHourData =
    hhActiveDays.length > 0 ||
    venue.specialsFood.length > 0 ||
    venue.specialsDrinks.length > 0;

  const hasInfoData = [
    venue.address,
    venue.phone,
    venue.websiteUrl,
    venue.menuUrl,
    venue.paymentMethods,
  ].some(Boolean);

  const hasHoursData =
    hasHappyHourData ||
    Object.values(venue.hoursWeekly).some((h) => h !== "CLOSED");

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero image */}
      {heroImage && (
        <div className="w-full bg-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImage.url}
            alt={venue.name}
            className="w-full object-cover"
            style={{ maxHeight: "320px" }}
          />
        </div>
      )}

      <div className="max-w-md mx-auto py-6 px-4">
        {isPreview && (
          <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
            Preview mode — this venue may not be publicly visible yet.
          </div>
        )}

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {venue.name}
        </h1>

        {venue.city && (
          <p className="text-sm text-gray-500 mb-0.5">{venue.city}</p>
        )}

        {/* Status / meta line */}
        {(hasHoursData ||
          (venue.latitude !== null && venue.longitude !== null)) && (
          <p className="text-xs text-gray-400 mb-3">
            {hasHoursData && (
              <VenueOpenStatus hoursWeekly={venue.hoursWeekly} />
            )}
            {venue.latitude !== null && venue.longitude !== null && (
              <VenueDistance
                lat={venue.latitude}
                lng={venue.longitude}
                separator={hasHoursData ? " \u2022 " : ""}
              />
            )}
          </p>
        )}

        {venue.happyHourTagline && (
          <p className="text-base text-amber-700 mb-4">
            {venue.happyHourTagline}
          </p>
        )}

        {/* Action buttons */}
        {(venue.phone || venue.websiteUrl || venue.address) && (
          <div className="flex flex-wrap gap-2 mb-6">
            {venue.phone && (
              <a
                href={`tel:${venue.phone}`}
                className="inline-block px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Call
              </a>
            )}
            {venue.websiteUrl && (
              <a
                href={venue.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Website
              </a>
            )}
            {venue.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Directions
              </a>
            )}
          </div>
        )}

        {/* Additional images gallery */}
        {additionalImages.length > 0 && (
          <section className="mb-6">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {additionalImages.map((img, i) => (
                <div
                  key={i}
                  className="shrink-0 w-32 h-24 rounded-lg overflow-hidden bg-gray-200"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={`${venue.name} photo ${i + 2}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Info section */}
        {hasInfoData && (
          <section className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Info</h2>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {venue.address && (
                <div className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Address</p>
                  <p className="text-sm text-gray-800">{venue.address}</p>
                </div>
              )}
              {venue.phone && (
                <div className="px-4 py-3">
                  <a
                    href={`tel:${venue.phone}`}
                    className="text-sm text-amber-700 hover:underline"
                  >
                    {venue.phone}
                  </a>
                </div>
              )}
              {venue.websiteUrl && (
                <div className="px-4 py-3">
                  <a
                    href={venue.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-amber-700 hover:underline"
                  >
                    Website ↗
                  </a>
                </div>
              )}
              {venue.menuUrl && (
                <div className="px-4 py-3">
                  <a
                    href={venue.menuUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-amber-700 hover:underline"
                  >
                    Menu ↗
                  </a>
                </div>
              )}
              {venue.paymentMethods && (
                <div className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-0.5">Payment</p>
                  <p className="text-sm text-gray-800">{venue.paymentMethods}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Happy Hour section */}
        {hasHappyHourData && (
          <section className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Happy Hour
            </h2>
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
              {hhActiveDays.length > 0 && (
                <div className="space-y-1.5">
                  {hhActiveDays.map((day) => (
                    <div key={day} className="flex gap-3 text-sm">
                      <span className="w-8 shrink-0 text-gray-500">
                        {day.slice(0, 3)}
                      </span>
                      <span className="text-gray-800">
                        {venue.happyHourWeekly[day]
                          .map(
                            (s) =>
                              `${fmt12h(s.start)}\u2013${fmt12h(s.end)}`
                          )
                          .join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {venue.specialsFood.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    Food
                  </p>
                  <ul className="space-y-1">
                    {venue.specialsFood.map((item, i) => (
                      <li key={i} className="text-sm text-gray-800">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {venue.specialsDrinks.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    Drinks
                  </p>
                  <ul className="space-y-1">
                    {venue.specialsDrinks.map((item, i) => (
                      <li key={i} className="text-sm text-gray-800">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
