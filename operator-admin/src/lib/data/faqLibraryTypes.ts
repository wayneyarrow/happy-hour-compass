import type { GuideType } from "@/lib/data/contentGuides";

/**
 * Client-safe types and pure helpers for the FAQ Library & Content Engine
 * FAQ architecture (Card 2C). This file has NO runtime import of Supabase
 * or any other server-only module — it is safe to import from client
 * components (see GuideFaqsSelector.tsx).
 *
 * The `import type { GuideType } from "@/lib/data/contentGuides"` above is
 * erased entirely at compile time (type-only import), so it does not pull
 * that module's runtime Supabase import into any bundle that imports this
 * file — same reason GuideForm.tsx has always been able to safely
 * `import type { GuideType } from "@/lib/data/contentGuides"` despite being
 * a client component.
 *
 * Bug fix context: GuideFaqsSelector.tsx (a client component) used to
 * import `faqAppliesTo` as a *runtime* value from faqLibrary.ts. Because
 * that's a real (non-type) import, webpack had to include faqLibrary.ts's
 * entire module body in the client bundle graph — including its top-level
 * `import { createAdminClient } from "@/lib/supabase/server"`, which
 * imports `next/headers`, which cannot run in a client bundle. Moving the
 * pure, dependency-free pieces here (and having faqLibrary.ts re-export
 * them for existing server-side importers) fixes that without touching
 * product behavior.
 *
 * faqLibrary.ts (server-only, still imports createAdminClient) re-exports
 * everything in this file, so existing server-side call sites
 * (page.tsx/actions.ts importing `type FaqAppliesTo` etc. from
 * "@/lib/data/faqLibrary") keep working unchanged.
 */

export type FaqAppliesTo = "venue" | "event" | "both";

export type FaqLibraryItem = {
  id: string;
  question: string;
  category: string | null;
  applies_to: FaqAppliesTo;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type GuideFaqAnswer = {
  faqId: string;
  question: string;
  appliesTo: FaqAppliesTo;
  answer: string;
  relatedGuideId: string | null;
  relatedGuideTitle: string | null;
  displayOrder: number;
};

export function normalizeAppliesTo(value: string): FaqAppliesTo {
  return value === "venue" || value === "event" ? value : "both";
}

/** Returns whether a given guide type accepts a library question's applies_to value. */
export function faqAppliesTo(guideType: GuideType, appliesTo: FaqAppliesTo): boolean {
  if (appliesTo === "both") return true;
  return guideType === "venue_guide" ? appliesTo === "venue" : appliesTo === "event";
}
