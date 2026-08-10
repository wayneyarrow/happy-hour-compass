/**
 * Generic optional info section — used for "Before you start", "What
 * happens next?", and "Good to know". Renders nothing when there is no
 * content, so an article that omits a section never shows an empty heading.
 */
export default function HelpInfoSection({
  heading,
  paragraph,
  items,
}: {
  heading: string;
  paragraph?: string;
  items?: string[];
}) {
  const hasParagraph = !!paragraph;
  const hasItems = !!items && items.length > 0;
  if (!hasParagraph && !hasItems) return null;

  return (
    <div className="border-t border-gray-100 pt-5 mt-6 first:border-t-0 first:pt-0 first:mt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
        {heading}
      </h3>
      {hasParagraph && (
        <p className="text-sm text-gray-600 leading-relaxed">{paragraph}</p>
      )}
      {hasItems && (
        <ul className="space-y-1.5">
          {items!.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
