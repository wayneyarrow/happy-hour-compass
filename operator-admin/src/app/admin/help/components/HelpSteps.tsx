import type { HelpStep } from "@/lib/helpCenter/types";
import HelpScreenshot from "./HelpScreenshot";
import HelpGoodToKnow from "./HelpGoodToKnow";

/** Shared numbered-steps renderer for both How-To articles and Getting Started. */
export default function HelpSteps({ steps }: { steps: HelpStep[] }) {
  return (
    <ol className="space-y-6">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3.5">
          <span
            className="shrink-0 w-7 h-7 rounded-full bg-amber-50 text-amber-600 text-sm font-semibold flex items-center justify-center"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="text-lg font-semibold text-gray-900">{step.title}</h3>
            {step.body.map((paragraph, pi) => (
              <p key={pi} className="text-sm text-gray-600 leading-relaxed mt-1">
                {paragraph}
              </p>
            ))}
            {step.items && step.items.length > 0 && (
              <div className="mt-3 space-y-3">
                {step.items.map((item, ii) => (
                  <div key={ii}>
                    <p className="text-sm font-semibold text-gray-900">{item.heading}</p>
                    <p className="text-sm text-gray-600 leading-relaxed mt-0.5">{item.text}</p>
                  </div>
                ))}
              </div>
            )}
            {step.list && step.list.length > 0 && (
              <ul className="space-y-1.5 mt-2">
                {step.list.map((item, li) => (
                  <li key={li} className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
            {step.afterList?.map((paragraph, pi) => (
              <p key={pi} className="text-sm text-gray-600 leading-relaxed mt-2">
                {paragraph}
              </p>
            ))}
            {step.note && <HelpGoodToKnow note={step.note} />}
            {step.screenshot && <HelpScreenshot screenshot={step.screenshot} />}
          </div>
        </li>
      ))}
    </ol>
  );
}
