import type { ReactNode } from "react";

/**
 * Static copy + data for the public About Us page. Kept separate from
 * page.tsx the same way /business and /careers split content.tsx from
 * layout — page.tsx stays focused on structure, this file stays focused
 * on the words and the one piece of structured data (What We Believe).
 *
 * This is a first editorial draft (see page.tsx). Expect the copy here to
 * be revised before the design is treated as final.
 */

// ── Section 3: What We Believe ────────────────────────────────────────────────

export type Principle = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
};

function PrincipleIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" className="w-9 h-9">
      {children}
    </svg>
  );
}

export const PRINCIPLES: Principle[] = [
  {
    id: "hospitality-deserves-to-be-found",
    title: "Great hospitality deserves to be found",
    description:
      "Local restaurants and bars pour everything into the experience they offer. They shouldn't have to fight social media algorithms just to be seen.",
    icon: (
      // Compass-style marker — being found, the throughline of the page.
      <PrincipleIcon>
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
      </PrincipleIcon>
    ),
  },
  {
    id: "one-place-not-five",
    title: "Guests shouldn't have to search five different places",
    description:
      "Google, social media, restaurant websites, outdated blog posts — finding a great local happy hour shouldn't take that much work.",
    icon: (
      // Consolidation — many scattered marks collapsing into one.
      <PrincipleIcon>
        <circle cx="6" cy="6" r="2.25" />
        <circle cx="18" cy="6" r="2.25" />
        <circle cx="6" cy="18" r="2.25" />
        <circle cx="18" cy="18" r="2.25" />
        <circle cx="12" cy="12" r="2.75" fill="currentColor" stroke="none" />
      </PrincipleIcon>
    ),
  },
  {
    id: "software-removes-friction",
    title: "Good software should remove friction, not create it",
    description:
      "The best tool is the one you barely notice — it just helps you get where you're going, faster.",
    icon: (
      // Smooth path from A to B — friction removed, not added.
      <PrincipleIcon>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 17c3-6 6-9 8-9s3 2 3 4-1 3-2 3-1.5-1-1-2.5C13 9 16 6 20 6" />
        <circle cx="4" cy="17" r="1.25" fill="currentColor" stroke="none" />
        <circle cx="20" cy="6" r="1.25" fill="currentColor" stroke="none" />
      </PrincipleIcon>
    ),
  },
];
