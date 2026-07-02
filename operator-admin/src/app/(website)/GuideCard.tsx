import Link from "next/link";

/**
 * Shared Content Engine guide card — the same small link-card style used by
 * the guide detail page's "More Guides" section (Card 5), the public
 * guides library, and the homepage Featured Guides rail (both Card 6B).
 * Extracted here so all three stay visually identical without copy-pasting
 * the markup — per Card 6B Part 4's "reuse existing guide cards and
 * styling wherever practical."
 */

type Props = {
  title: string;
  href: string;
  heroImageUrl: string | null;
};

export function GuideCard({ title, href, heroImageUrl }: Props) {
  return (
    <Link
      href={href}
      className="block group rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="h-32 bg-gray-100 overflow-hidden">
        {heroImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImageUrl}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-900 line-clamp-2">{title}</p>
      </div>
    </Link>
  );
}
