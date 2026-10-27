import Link from "next/link";

/**
 * Fallback route into the site's content when the homepage's editorial
 * Sections can't be shown (no JavaScript, a stalled or interrupted stream,
 * or a shared Section failure). Each linked listing page renders its full
 * content without JavaScript.
 */
export function HomepageBrowseLinks() {
  return (
    <p className="max-w-7xl mx-auto px-6 lg:px-10 text-lg text-gray-600">
      Browse{" "}
      <Link href="/website-happy-hours" className="font-semibold text-amber-600 hover:text-amber-700">happy hours</Link>,{" "}
      <Link href="/website-daily-specials" className="font-semibold text-amber-600 hover:text-amber-700">daily specials</Link> and{" "}
      <Link href="/website-events" className="font-semibold text-amber-600 hover:text-amber-700">events</Link>.
    </p>
  );
}
