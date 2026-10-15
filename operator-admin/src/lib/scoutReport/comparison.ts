/**
 * Week-over-week comparison rules for the Scout report — pure, no I/O.
 *
 * Totals are always reported as established. A change (absolute and
 * percentage) is only calculated when both weeks are comparable; otherwise
 * it is null with the reason. Percentage change is also suppressed for
 * small samples.
 */

import type { Coverage, ReportWindow } from "./windows";

/** Below this many events in either week, no percentage change is given. */
export const SMALL_SAMPLE_MIN = 20;

export type Comparability = { comparable: boolean; reasons: string[] };

export type MetricComparison = {
  current: number | null;
  comparison: number | null;
  /** current − comparison; null unless comparable and both values exist. */
  absoluteChange: number | null;
  /** (current − comparison) ÷ comparison; null unless comparable, both exist and neither is a small sample. */
  percentChange: number | null;
  comparable: boolean;
  notes: string[];
};

export function combineComparability(...parts: Comparability[]): Comparability {
  return { comparable: parts.every((p) => p.comparable), reasons: parts.flatMap((p) => p.reasons) };
}

/** Comparable only when both weeks have full coverage. */
export function coverageComparability(current: Coverage, comparison: Coverage): Comparability {
  const reasons: string[] = [];
  if (current.status !== "full") reasons.push(`Reporting week coverage is ${current.status}.${current.note ? ` ${current.note}` : ""}`);
  if (comparison.status !== "full") reasons.push(`Comparison week coverage is ${comparison.status}.${comparison.note ? ` ${comparison.note}` : ""}`);
  return { comparable: reasons.length === 0, reasons };
}

type Side = "before" | "after" | "straddles";
function sideOf(w: Pick<ReportWindow, "startUtc" | "endUtc">, at: number): Side {
  if (Date.parse(w.endUtc) <= at) return "before";
  if (Date.parse(w.startUtc) >= at) return "after";
  return "straddles";
}

/**
 * For metrics whose established counting rule depends on the `environment`
 * label (views count legacy unlabelled rows plus production rows, and
 * exclude rows labelled staging/preview/development): the set of rows that
 * can be counted changed when labelling began. Two weeks are comparable only
 * when both are entirely on the same side of that moment.
 */
export function labellingComparability(
  current: Pick<ReportWindow, "startUtc" | "endUtc">,
  comparison: Pick<ReportWindow, "startUtc" | "endUtc">,
  labellingStartedAt: string | null
): Comparability {
  if (!labellingStartedAt) return { comparable: true, reasons: [] };
  const at = Date.parse(labellingStartedAt);
  const a = sideOf(current, at);
  const b = sideOf(comparison, at);
  if (a === b && a !== "straddles") return { comparable: true, reasons: [] };
  return {
    comparable: false,
    reasons: [
      `Environment labelling began at ${labellingStartedAt}. Rows recorded before then carry no environment label and are counted, as established, together with production rows; ` +
        "rows labelled staging, preview or development are not counted. The composition of the unlabelled rows cannot be determined from the data, " +
        "so totals on either side of this change are reported as established but are not compared.",
    ],
  };
}

export function compareMetric(current: number | null, comparison: number | null, comparability: Comparability): MetricComparison {
  const notes = [...comparability.reasons];
  let absoluteChange: number | null = null;
  let percentChange: number | null = null;
  if (current === null || comparison === null) {
    notes.push("A value is unavailable for one of the weeks, so no change is calculated (missing data is not treated as zero).");
  } else if (comparability.comparable) {
    absoluteChange = current - comparison;
    if (current < SMALL_SAMPLE_MIN || comparison < SMALL_SAMPLE_MIN) {
      notes.push(`Small sample (fewer than ${SMALL_SAMPLE_MIN} in a week) — percentage change suppressed.`);
    } else {
      percentChange = Math.round((absoluteChange / comparison) * 10_000) / 10_000;
    }
  }
  return { current, comparison, absoluteChange, percentChange, comparable: comparability.comparable && current !== null && comparison !== null, notes };
}
