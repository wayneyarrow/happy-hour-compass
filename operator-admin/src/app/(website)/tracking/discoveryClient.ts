"use client";

import type { DiscoveryEventPayload } from "@/lib/discoveryTracking/discoveryEvents";
import { MAX_DISCOVERY_EVENTS_PER_REQUEST } from "@/lib/discoveryTracking/discoveryEvents";

/**
 * Fire-and-forget transport for website_discovery_events
 * (/api/track/discovery). Impressions/exposures are batched (flushed after
 * FLUSH_DELAY_MS, at MAX_DISCOVERY_EVENTS_PER_REQUEST, or when the page is
 * hidden/unloaded); clicks flush immediately. Every request uses keepalive
 * so it survives the navigation a click triggers. Failures are ignored —
 * tracking must never affect the visitor.
 */

const ENDPOINT = "/api/track/discovery";
const FLUSH_DELAY_MS = 1500;

const queue: DiscoveryEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleListenersInstalled = false;

function post(events: DiscoveryEventPayload[]): void {
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ events }),
    }).catch(() => {});
  } catch {
    // Tracking must never throw.
  }
}

export function flushDiscoveryEvents(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (queue.length > 0) {
    post(queue.splice(0, MAX_DISCOVERY_EVENTS_PER_REQUEST));
  }
}

function installLifecycleListeners(): void {
  if (lifecycleListenersInstalled || typeof window === "undefined") return;
  lifecycleListenersInstalled = true;
  window.addEventListener("pagehide", flushDiscoveryEvents);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDiscoveryEvents();
  });
}

export function sendDiscoveryEvent(event: DiscoveryEventPayload, options?: { immediate?: boolean }): void {
  if (typeof window === "undefined") return;
  installLifecycleListeners();
  queue.push(event);
  if (options?.immediate || queue.length >= MAX_DISCOVERY_EVENTS_PER_REQUEST) {
    flushDiscoveryEvents();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flushDiscoveryEvents, FLUSH_DELAY_MS);
  }
}
