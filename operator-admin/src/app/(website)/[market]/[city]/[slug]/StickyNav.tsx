"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";

type Section = { id: string; label: string };

type Props = {
  sections: Section[];
  /**
   * Venue name shown as subtle, non-interactive context to the left of the
   * section tabs — so a visitor who lands scrolled deep into the page (most
   * notably via a Daily Special deep link, where the venue's own <h1> is
   * long above the fold) still always knows which venue they're on. Purely
   * presentational; omitting it (undefined) reproduces the previous
   * tabs-only layout exactly.
   */
  venueName?: string;
};

/**
 * Maps a hash fragment's raw id (no leading "#") to the top-level section
 * id that owns it, for sections whose content has its own finer-grained
 * anchors than the section itself.
 *
 * Today the only such case is an individual Daily Special
 * (`daily-special-<uuid>`, singular — see DailySpecialsSection.tsx), which
 * belongs to the `daily-specials` (plural) top-level section. A hash that
 * already names a top-level section (e.g. "happy-hour") maps to itself.
 * Anything unrecognized returns null and is ignored by the caller.
 *
 * Deliberately a prefix check, not an exact id lookup against every
 * possible Daily Special id — that would require the full specials list
 * here just to resolve a hash, when the id shape itself already carries
 * enough information. This is "the smallest robust mapping" the shape of
 * the id supports; if another section grows its own child anchors later,
 * add one more prefix branch here rather than restructuring this function.
 */
export function parentSectionIdForHash(rawId: string): string | null {
  if (!rawId) return null;
  if (rawId.startsWith("daily-special-")) return "daily-specials";
  return rawId;
}

/**
 * Sticky horizontal section nav for the website Venue Detail page.
 * Sticks below the WebsiteHeader (h-16 mobile / h-[72px] desktop).
 * Active section tracks scroll position via IntersectionObserver.
 */
export function StickyNav({ sections, venueName }: Props) {
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id ?? "");
  const entryMap = useRef(new Map<string, IntersectionObserverEntry>());
  // Freeze sections at mount — they're derived from server data and never change client-side.
  const sectionsRef = useRef(sections);

  // Initial-hash arrival lock. Holds the section id an initial URL hash
  // resolved to (e.g. "daily-specials" for #daily-special-<uuid>) until the
  // visitor genuinely scrolls — see the observer callback and the
  // release-on-real-scroll-input effect below for the two halves of this.
  // null means "no lock" (either there was no initial hash, or the lock has
  // already been released) — the observer runs completely normally then,
  // same as before this correction.
  const initialHashLockRef = useRef<string | null>(null);

  // Resolve an initial hash (a direct #daily-special-<uuid> load, a pasted
  // URL, or a plain #<section-id> link) to the correct active tab BEFORE
  // the browser paints — a plain useEffect would still visibly flash the
  // default (first) tab for a frame first. window.location.hash is only
  // ever read client-side (this effect never runs during SSR), so this
  // can't itself cause a hydration mismatch — the server-rendered default
  // is what hydration reconciles against; this only adjusts state
  // afterward, before paint.
  useLayoutEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const mapped = parentSectionIdForHash(hash.slice(1));
    if (mapped && sectionsRef.current.some((s) => s.id === mapped)) {
      setActiveSection(mapped);
      // Arm the lock — see the observer effect for why this matters. The
      // browser's own native anchor scroll (and, for Daily Specials,
      // DailySpecialsSection's own post-sort scroll correction — see that
      // component) haven't necessarily run yet at this point, so the lock
      // must already be armed before the IntersectionObserver below gets
      // its first chance to fire.
      initialHashLockRef.current = mapped;
    }
  }, []);

  // Releases the initial-hash lock on the first GENUINE user scroll intent
  // — wheel, touch drag, or a scroll-relevant key — never on a bare
  // "scroll" event, which also fires for the deep-link's own programmatic
  // positioning (the native anchor jump and, for Daily Specials,
  // DailySpecialsSection's own scrollIntoView correction) and would
  // release the lock before it ever did anything. This is a deterministic
  // release tied to real input, not a timeout guessing when the
  // programmatic scroll has "settled."
  useEffect(() => {
    function release() {
      initialHashLockRef.current = null;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)
      ) {
        release();
      }
    }
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const secs = sectionsRef.current;
    if (secs.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entryMap.current.set(entry.target.id, entry);
        });

        // Among sections currently intersecting the observation band, the
        // active one is whichever started MOST RECENTLY relative to the
        // top of that band — i.e. the entry with the GREATEST (least
        // negative) boundingClientRect.top. Adjacent sections routinely
        // intersect at the same time right at their shared boundary (one
        // finishing, the next beginning); picking the smallest top there
        // would pick whichever section has been scrolled PAST THE
        // FURTHEST, which is the section leaving, not the one now in
        // view — that inversion was the actual cause of the sticky nav
        // showing "Happy Hour" active while the page was visibly
        // positioned at a Daily Special further down.
        const visible = secs.filter((s) => entryMap.current.get(s.id)?.isIntersecting);
        if (visible.length === 0) return;

        const topmost = visible.reduce((prev, curr) => {
          const prevTop = entryMap.current.get(prev.id)?.boundingClientRect.top ?? -Infinity;
          const currTop = entryMap.current.get(curr.id)?.boundingClientRect.top ?? -Infinity;
          return currTop > prevTop ? curr : prev;
        });

        // While the initial-hash lock is armed, the observer must not
        // override the arrival section — even the FIRST observer firing
        // right after a deep-link scroll can otherwise pick a neighboring
        // section over it. Concretely: landing on a short Daily Specials
        // section pins the clicked card near the top of the viewport,
        // which leaves the wrapping "daily-specials" section's own
        // bounding top slightly NEGATIVE (its heading, above the card, is
        // now off-screen) while the very next section ("info") already
        // starts far enough up to be positive-but-within-band — under the
        // "greatest top wins" rule above, that made the section the
        // visitor is actually AT lose to the one they merely border. The
        // lock keeps arrival intent authoritative until real scrolling
        // (see the wheel/touch/key effect above) proves the visitor has
        // actually moved on, at which point this reduces to exactly the
        // pre-existing behavior.
        if (initialHashLockRef.current) return;

        setActiveSection(topmost.id);
      },
      // Top inset accounts for header (72px) + sticky nav (~48px) + small buffer.
      // Bottom inset clips to the upper ~55% of the viewport so sections near the
      // bottom don't compete with those already anchored near the top.
      { rootMargin: "-124px 0px -45% 0px", threshold: 0 }
    );

    secs.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    // An explicit nav click is itself unambiguous user intent — release any
    // still-armed initial-hash lock so scroll-spy is fully back in normal
    // control afterward, same as if the visitor had scrolled by hand.
    initialHashLockRef.current = null;
    setActiveSection(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (sections.length === 0) return null;

  return (
    <div className="sticky top-16 md:top-[72px] z-40 -mx-6 lg:-mx-10 px-6 lg:px-10 bg-white border-b border-gray-100">
      <div className="flex items-center gap-3 min-w-0">
        {venueName && (
          <>
            {/* Subtle, non-interactive — deliberately not styled like a tab
                (no border, no active/hover state) so it reads as context,
                not another destination. Shrinks/truncates before it ever
                pushes the section tabs off-screen or causes overflow. */}
            <span
              className="shrink min-w-0 max-w-[38%] sm:max-w-[220px] truncate text-sm font-semibold text-gray-800 py-3.5"
              title={venueName}
            >
              {venueName}
            </span>
            <span className="shrink-0 w-px h-4 bg-gray-200" aria-hidden="true" />
          </>
        )}
        <div className="flex-1 min-w-0 flex items-center gap-0 overflow-x-auto scrollbar-hide">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(e) => handleClick(e, section.id)}
              className={[
                "shrink-0 px-4 py-3.5 text-sm font-medium border-b-2 transition-all duration-200 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500",
                activeSection === section.id
                  ? "text-gray-900 border-amber-500"
                  : "text-gray-500 border-transparent hover:text-gray-800 hover:border-gray-200",
              ].join(" ")}
            >
              {section.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
