/**
 * Numbered step list — a simple "1, 2, 3…" grid used to explain a short
 * process (horizontal on desktop, stacked on mobile via the responsive
 * grid). Pulled up from claim-your-venue/page.tsx so the business page's
 * "How It Works" section and any future business page can reuse the same
 * pattern instead of re-authoring the step markup.
 */

export type Step = {
  number: number;
  title: string;
  description: string;
};

type Props = {
  steps: readonly Step[];
  /** Heading level for each step title — match the page's heading hierarchy. Defaults to h3. */
  headingLevel?: "h2" | "h3";
};

export function NumberedStepList({ steps, headingLevel = "h3" }: Props) {
  const HeadingTag = headingLevel;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-10 text-left">
      {steps.map((step) => (
        <div key={step.number}>
          <div
            className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center mb-4"
            aria-hidden="true"
          >
            {step.number}
          </div>
          <HeadingTag className="text-base font-semibold text-gray-900">{step.title}</HeadingTag>
          <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{step.description}</p>
        </div>
      ))}
    </div>
  );
}
