import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScoutReport } from "../../../src/lib/scoutReport/buildScoutReport";
import { classifyFailure } from "../../../src/lib/scoutReport/issues";
import { TruncatedResultError } from "../../../src/lib/scoutReport/strictViewCounts";
import { IncompleteReadError, ReportTooLargeError } from "../../../src/lib/data/searchDiscoveryReport";
import { describeDownload, parseSectionHeader } from "../../../src/lib/scoutReport/downloadMessage";
import { NOW, fakeDeps } from "./fixtures";

test("classification: limits and truncation are persistent; concurrent-read and connection errors transient; else unknown", () => {
  assert.equal(classifyFailure("x", new ReportTooLargeError("t", 150_001)).kind, "persistent");
  assert.equal(classifyFailure("x", new TruncatedResultError("venue_view_counts", 1000, 1400)).kind, "persistent");
  assert.equal(classifyFailure("x", new IncompleteReadError("t", 10, 9)).kind, "transient");
  assert.equal(classifyFailure("x", new Error("canceling statement due to statement timeout")).kind, "transient");
  assert.equal(classifyFailure("x", new Error("TypeError: fetch failed")).kind, "transient");
  assert.equal(classifyFailure("x", new Error("Milestone reader returned 0 … appears to have failed")).kind, "transient");
  assert.equal(classifyFailure("x", new Error('column "foo" does not exist')).kind, "unknown");
  assert.match(classifyFailure("x", new ReportTooLargeError("t", 150_001)).retryAdvice, /won't help/);
});

test("complete report: no retry needed, all sections listed as complete", async () => {
  const r = await buildScoutReport({ now: NOW, deps: fakeDeps().deps });
  assert.equal(r.completeness.status, "complete");
  assert.equal(r.completeness.retry, "not_needed");
  assert.deepEqual(Object.values(r.completeness.sections).map((s) => s.status), ["complete", "complete", "complete"]);
  assert.equal(r.completeness.guidance[0], "All sections are complete.");
});

test("a persistent failure: named, complete sections usable with caveats, retry NOT suggested", async () => {
  const { deps } = fakeDeps({ searchDiscovery: { loadDiscoveryRows: async () => { throw new ReportTooLargeError("website_discovery_events", 150_001); } } });
  const r = await buildScoutReport({ now: NOW, deps });
  const c = r.completeness;
  assert.equal(r.status, "incomplete");
  assert.equal(c.retry, "not_suggested");
  assert.equal(c.sections.searchDiscovery.status, "failed");
  assert.equal(c.sections.searchDiscovery.issues[0].kind, "persistent");
  const g = c.guidance.join(" ");
  assert.match(g, /INCOMPLETE\. Do not present it as a complete weekly report/);
  assert.match(g, /Failed \(no data\): Search & Discovery\./);
  assert.match(g, /Complete: Product usage, Customer success\. These sections may be used, with the caveat/);
  assert.match(g, /retrying is unlikely to help/);
  assert.doesNotMatch(g, /may produce a complete report/);
});

test("a transient failure suggests one retry; the dependent customer-success part inherits it", async () => {
  const { deps } = fakeDeps({ usage: { loadVenueViewRows: async () => { throw new Error("venue_view_events page 0 failed: statement timeout"); } } });
  const r = await buildScoutReport({ now: NOW, deps });
  assert.equal(r.completeness.retry, "suggested");
  assert.equal(r.completeness.sections.productUsage.status, "failed");
  assert.equal(r.completeness.sections.customerSuccess.status, "incomplete");
  assert.equal(r.sections.customerSuccess.issues[0].part, "Recent weekly views");
  assert.equal(r.sections.customerSuccess.issues[0].kind, "transient");
  assert.match(r.completeness.guidance.join(" "), /Incomplete \(some parts missing — see issues\): Customer success/);
  assert.match(r.completeness.guidance.join(" "), /one retry in a few minutes may produce a complete report/);
});

test("an unexplained failure: one retry is reasonable, then report — never 'retry until it works'", async () => {
  const { deps } = fakeDeps({ milestones: { loadEvents: async () => { throw new Error('relation "customer_success_events" does not exist'); } } });
  const r = await buildScoutReport({ now: NOW, deps });
  assert.equal(r.completeness.retry, "may_help");
  assert.match(r.completeness.guidance.join(" "), /if it fails the same way, report the issue instead of retrying again/);
});

test("unavailable metrics are listed but never make the report incomplete", async () => {
  const r = await buildScoutReport({ now: NOW, deps: fakeDeps().deps });
  assert.equal(r.status, "complete");
  assert.ok(r.completeness.unavailableMetrics.length > 0);
  assert.match(r.completeness.guidance.join(" "), /never treat them as zero/);
});

test("download wording: names failed/partial sections, caveats complete ones, retry only when suggested", () => {
  assert.deepEqual(parseSectionHeader("productUsage=complete,searchDiscovery=failed"), { productUsage: "complete", searchDiscovery: "failed" });
  assert.deepEqual(describeDownload("complete", "productUsage=complete", "not_needed"), { complete: true, lines: ["Complete."] });

  const persistent = describeDownload("incomplete", "productUsage=complete,searchDiscovery=failed,customerSuccess=incomplete", "not_suggested");
  assert.equal(persistent.complete, false);
  assert.deepEqual(persistent.lines, [
    "INCOMPLETE — don't treat this as a complete weekly report.",
    "Failed: Search & Discovery.",
    "Partly missing: Customer success.",
    "Usable with caveats: Product usage.",
    "The failure doesn't look temporary — retrying is unlikely to help. The file explains each issue.",
  ]);
  assert.match(describeDownload("incomplete", "productUsage=failed", "suggested").lines.at(-1)!, /one retry in a few minutes may help/);
  assert.match(describeDownload("incomplete", "productUsage=failed", "may_help").lines.at(-1)!, /if it fails the same way, report it/);
  // Missing headers never read as complete.
  assert.equal(describeDownload(null, null, null).complete, false);
});
