import type { Scheduler } from "../../../src/lib/discoveryTracking/visibilityTimer";

/** Deterministic manual clock for timer-based rules. */
export function createFakeScheduler(): Scheduler & { advance: (ms: number) => void; now: () => number; pending: () => number } {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Infinity;
        for (const [id, t] of timers) if (t.at <= target && t.at < dueAt) { dueAt = t.at; dueId = id; }
        if (dueId === null) break;
        const t = timers.get(dueId)!;
        timers.delete(dueId);
        now = t.at;
        t.fn();
      }
      now = target;
    },
    now: () => now,
    pending: () => timers.size,
  };
}
