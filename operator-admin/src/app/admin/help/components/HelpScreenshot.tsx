import Image from "next/image";
import type { HelpScreenshot as HelpScreenshotData } from "@/lib/helpCenter/types";

/**
 * Shared screenshot presentation treatment for Help Center articles.
 * Responsive (fills its container, intrinsic aspect ratio preserved via
 * next/image width/height), width-constrained, and rounded/bordered to
 * match the rest of the Operator Admin card system (shadow-resting,
 * rounded-xl, border-gray-200). Uses next/image for the same optimized
 * loading behavior already used elsewhere in Operator Admin (e.g.
 * app/admin/layout.tsx's logo).
 */
export default function HelpScreenshot({ screenshot }: { screenshot: HelpScreenshotData }) {
  return (
    <div className="mt-3 max-w-2xl rounded-xl border border-gray-200 shadow-resting overflow-hidden bg-gray-50">
      <Image
        src={screenshot.src}
        alt={screenshot.alt}
        width={screenshot.width}
        height={screenshot.height}
        sizes="(max-width: 768px) 100vw, 640px"
        className="w-full h-auto"
      />
    </div>
  );
}
