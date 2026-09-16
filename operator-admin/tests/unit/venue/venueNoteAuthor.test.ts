/**
 * Phase 1C correction: Customer Success system activity must not render an
 * "Unknown" author, while every existing note source's authorship behavior
 * must stay byte-for-byte the same. resolveNoteAuthor() (extracted from
 * VenueNotesSection.tsx's NoteEntry) is the single place this precedence
 * lives, so it's tested directly here rather than via React rendering (this
 * repo has no React/jsdom test infra, and adding one for a one-line
 * precedence rule would be disproportionate).
 *
 * Imports from ./venueNoteDisplay, not ./venueNotes — resolveNoteAuthor()
 * was moved to that pure, client-safe module as part of the Phase 1C build
 * fix (a "use client" component importing it as a runtime value from the
 * server-only venueNotes.ts broke `next build`). This test both exercises
 * the real import path VenueNotesSection.tsx now uses and guards against a
 * regression back to the server module.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNoteAuthor } from "../../../src/lib/data/venueNoteDisplay";
import { CUSTOMER_SUCCESS_ACTIVITY_AUTHOR_LABEL } from "../../../src/lib/customerSuccess/customerSuccessMilestoneNotes";

test("Customer Success activity (author_label set) renders the system label, not 'Unknown'", () => {
  const author = resolveNoteAuthor({
    author_label: CUSTOMER_SUCCESS_ACTIVITY_AUTHOR_LABEL,
    created_by_email: null,
    created_by: null,
  });
  assert.equal(author, "Happy Hour Compass");
  assert.notEqual(author, "Unknown");
});

test("a manual note with a real created_by_email is unaffected (existing behavior)", () => {
  const author = resolveNoteAuthor({
    author_label: undefined,
    created_by_email: "wayne@happyhourcompass.com",
    created_by: "11111111-2222-3333-4444-555555555555",
  });
  assert.equal(author, "wayne@happyhourcompass.com");
});

test("a note with only created_by (no email) falls back to a truncated uid (existing behavior)", () => {
  const author = resolveNoteAuthor({
    author_label: undefined,
    created_by_email: null,
    created_by: "11111111-2222-3333-4444-555555555555",
  });
  assert.equal(author, "uid:11111111");
});

test("a genuinely authorless real note (e.g. automated claim/submission activity) still renders 'Unknown' — unchanged", () => {
  const author = resolveNoteAuthor({
    author_label: undefined,
    created_by_email: null,
    created_by: null,
  });
  assert.equal(author, "Unknown");
});

test("author_label takes precedence even if created_by_email is somehow also set", () => {
  const author = resolveNoteAuthor({
    author_label: "Happy Hour Compass",
    created_by_email: "someone@example.com",
    created_by: null,
  });
  assert.equal(author, "Happy Hour Compass");
});
