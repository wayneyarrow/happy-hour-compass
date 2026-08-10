import type { HelpStep } from "@/lib/helpCenter/types";
import HelpScreenshot from "./HelpScreenshot";

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
            <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
            {step.body.map((paragraph, pi) => (
              <p key={pi} className="text-sm text-gray-600 leading-relaxed mt-1">
                {paragraph}
              </p>
            ))}
            {step.screenshot && <HelpScreenshot screenshot={step.screenshot} />}
          </div>
        </li>
      ))}
    </ol>
  );
}
