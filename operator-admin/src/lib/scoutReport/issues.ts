/**
 * Failure classification for the Scout report — pure.
 *
 * A failed or partial read is recorded as an issue with a plain-English
 * cause and whether a retry could plausibly help. Only potentially
 * transient failures suggest a retry; limits and code-level problems say
 * that retrying won't fix them.
 */

import { IncompleteReadError, ReportTooLargeError } from "@/lib/data/searchDiscoveryReport";
import { TruncatedResultError } from "./strictViewCounts";

export type IssueKind = "transient" | "persistent" | "unknown";

export type ReportIssue = {
  /** What could not be read, e.g. "Venue views" or "Section". */
  part: string;
  message: string;
  kind: IssueKind;
  retryAdvice: string;
};

const TRANSIENT_RE = /timeout|timed out|fetch failed|network|ECONN|ETIMEDOUT|socket|503|502|504|rate limit|too many requests|temporarily/i;

export function classifyFailure(part: string, e: unknown): ReportIssue {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof ReportTooLargeError) {
    return { part, message, kind: "persistent", retryAdvice: "The window holds more rows than the report can read completely. Retrying won't help; the aggregation needs to move into SQL." };
  }
  if (e instanceof TruncatedResultError) {
    return { part, message, kind: "persistent", retryAdvice: "A database response hit its row limit. Retrying won't help; this needs a code change." };
  }
  if (e instanceof IncompleteReadError) {
    return { part, message, kind: "transient", retryAdvice: "Rows changed while they were being read. One retry in a few minutes is likely to succeed." };
  }
  if (/appears to have failed|inconsistent read/.test(message)) {
    return { part, message, kind: "transient", retryAdvice: "Two reads of the same counts disagreed, most likely a momentary query failure. One retry in a few minutes may succeed." };
  }
  if (TRANSIENT_RE.test(message)) {
    return { part, message, kind: "transient", retryAdvice: "This looks like a temporary connection or database problem. One retry in a few minutes may succeed." };
  }
  return { part, message, kind: "unknown", retryAdvice: "The cause isn't clear. One retry is reasonable; if it fails the same way, report the message instead of retrying again." };
}
