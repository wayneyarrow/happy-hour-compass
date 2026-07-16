import type { ReactNode } from "react";
import Image from "next/image";

/**
 * The four-step visual walkthrough for Claim Your Venue. Each step pairs a
 * short, action-oriented text block with its production screenshot in a
 * two-column row; rows alternate which side the screenshot sits on across
 * the four steps (text/image, then image/text, ...) purely via `md:order-*`
 * — the same technique ProductTour already uses to place its visual, just
 * applied every other row instead of driven by a tab. Mobile ignores the
 * `md:order-*` classes entirely, so the DOM's natural order (number, heading,
 * copy, then image) is what renders — exactly the fixed mobile sequence this
 * page calls for, regardless of which side a step's image sits on desktop.
 *
 * Images render at their real intrinsic width/height (via next/image's
 * width+height, not `fill`), scaled responsively with `w-full h-auto` — this
 * preserves each screenshot's own aspect ratio exactly, with no cropping, no
 * object-fit, and no fixed aspect-ratio box to fight. Framing (rounded-2xl,
 * border, shadow) matches the treatment already used for photography on
 * /business (e.g. the hero and "Why HHC Exists" images) — no browser-chrome
 * bar, since these screenshots already carry their own real UI chrome and a
 * fabricated one isn't one of the border/radius/shadow options this page
 * calls for.
 */

export type ClaimJourneyStep = {
  number: number;
  title: ReactNode;
  description: ReactNode;
  image: { src: string; alt: string; width: number; height: number };
};

type Props = {
  steps: readonly ClaimJourneyStep[];
};

const IMAGE_FRAME_CLASS =
  "w-full h-auto rounded-2xl border border-gray-200 shadow-[0_24px_64px_rgba(0,0,0,0.10),0_4px_16px_rgba(0,0,0,0.06)]";

export function ClaimJourneySteps({ steps }: Props) {
  return (
    <div>
      {steps.map((step, i) => {
        const imageOnLeft = i % 2 === 1;
        return (
          <div key={step.number}>
            <div className="grid md:grid-cols-2 gap-8 md:gap-14 items-center">
              <div className={imageOnLeft ? "md:order-2" : undefined}>
                <div
                  className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 font-bold text-base flex items-center justify-center mb-5"
                  aria-hidden="true"
                >
                  {step.number}
                </div>
                <h3 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">
                  {step.title}
                </h3>
                <div className="mt-3 text-base text-gray-500 leading-relaxed">
                  {step.description}
                </div>
              </div>
              <div className={imageOnLeft ? "md:order-1" : undefined}>
                <Image
                  src={step.image.src}
                  alt={step.image.alt}
                  width={step.image.width}
                  height={step.image.height}
                  sizes="(min-width: 768px) 50vw, 100vw"
                  className={IMAGE_FRAME_CLASS}
                />
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="my-8 md:my-12 border-t border-gray-200" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
