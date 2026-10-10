"use client";

import Link from "next/link";
import { useRef, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import type { DiscoveryItemType } from "@/lib/discoveryTracking/discoveryEvents";
import { useDiscoveryTracker } from "./DiscoveryTrackingProvider";
import { useVisibleOnce } from "./useVisibleOnce";

/**
 * Wraps one discovery card (venue, event, guide or Daily Special) inside a
 * <DiscoveryPlacement>:
 *   - item_impression once it is ≥50% visible for ≥1s in a visible tab,
 *     once per page view per placement + item;
 *   - item_click when any link inside the card is activated (capture phase,
 *     so the card component itself needs no tracking code; buttons such as
 *     Save are not links and never count). Double-clicks within 1s count once.
 * `position` is read when the event fires, so it is always the position
 * currently shown. Renders a plain <div className> wrapper — pass the layout
 * classes the card's old wrapper had. Outside a tracked page it only renders.
 * When tracking is active the wrapper carries data-discovery-placement /
 * data-discovery-item / data-discovery-position so QA (and the e2e suite)
 * can map each recorded event to the card on screen.
 */
export function TrackedDiscoveryItem({
  itemType,
  itemId,
  position,
  className,
  children,
}: {
  itemType: DiscoveryItemType;
  itemId: string;
  position: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tracker = useDiscoveryTracker();
  const positionRef = useRef(position);
  positionRef.current = position;

  const itemKey = `${itemType}:${itemId}`;
  const impressionKey = tracker ? `impression|${tracker.placementKey}|${itemKey}` : "";

  useVisibleOnce(ref, {
    enabled: !!tracker,
    resetKey: impressionKey,
    onQualified: () => {
      if (!tracker || !tracker.claimOnce(impressionKey)) return;
      tracker.send({ eventType: "item_impression", itemType, itemId, position: positionRef.current });
    },
  });

  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (!tracker) return;
    const target = e.target as Element | null;
    const link = target?.closest?.("a[href]");
    if (!link || !e.currentTarget.contains(link)) return;
    if (!tracker.allowClick(`click|${tracker.placementKey}|${itemKey}`)) return;
    tracker.send(
      { eventType: "item_click", itemType, itemId, position: positionRef.current },
      { immediate: true }
    );
  }

  return (
    <div
      ref={ref}
      className={className}
      onClickCapture={onClickCapture}
      data-discovery-placement={tracker?.placementKey}
      data-discovery-item={tracker ? itemKey : undefined}
      data-discovery-position={tracker ? position : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Section exposure marker — wrap a section's heading row. Records
 * section_exposure once per page view when the marker is ≥50% visible for
 * ≥1s in a visible tab. This is the "section was seen" denominator.
 */
export function SectionExposureMarker({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const tracker = useDiscoveryTracker();
  const key = tracker ? `exposure|${tracker.placementKey}` : "";

  useVisibleOnce(ref, {
    enabled: !!tracker,
    resetKey: key,
    onQualified: () => {
      if (!tracker || !tracker.claimOnce(key)) return;
      tracker.send({ eventType: "section_exposure" });
    },
  });

  return (
    <div ref={ref} className={className} data-discovery-section={tracker?.placementKey}>
      {children}
    </div>
  );
}

/**
 * next/link that records view_all_click for the current placement before
 * navigating (never prevents or delays navigation). Double-clicks within 1s
 * count once.
 */
export function TrackedViewAllLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const tracker = useDiscoveryTracker();
  return (
    <Link
      href={href}
      {...props}
      onClick={(e) => {
        if (tracker && tracker.allowClick(`view_all|${tracker.placementKey}`)) {
          tracker.send({ eventType: "view_all_click", targetPath: href }, { immediate: true });
        }
        onClick?.(e);
      }}
    />
  );
}
