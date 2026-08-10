import type { HelpSection as HelpSectionData } from "@/lib/helpCenter/types";
import HelpScreenshot from "./HelpScreenshot";

/**
 * Unnumbered content block — for lead-in / closing sections that fall
 * outside a How-To/Getting Started page's numbered step sequence (e.g.
 * Getting Started's intro "Start with Venue Growth & Readiness" section, or
 * a closing wrap-up section). Shares HelpSteps' step typography (no number
 * badge) so both read as one system.
 */
export default function HelpSection({ section }: { section: HelpSectionData }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900">{section.heading}</h3>
      {section.body.map((paragraph, i) => (
        <p key={i} className="text-sm text-gray-600 leading-relaxed mt-1">
          {paragraph}
        </p>
      ))}
      {section.listIntro && (
        <p className="text-sm font-semibold text-gray-900 mt-4">{section.listIntro}</p>
      )}
      {section.list && section.list.length > 0 && (
        <ul className="space-y-1.5 mt-2">
          {section.list.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      )}
      {section.afterList?.map((paragraph, i) => (
        <p
          key={i}
          className={`text-sm text-gray-600 leading-relaxed ${i === 0 ? "mt-4" : "mt-1"}`}
        >
          {paragraph}
        </p>
      ))}
      {section.screenshot && <HelpScreenshot screenshot={section.screenshot} />}
    </div>
  );
}
