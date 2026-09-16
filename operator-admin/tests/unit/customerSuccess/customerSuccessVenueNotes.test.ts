/**
 * Tests getCustomerSuccessNotesForVenue's Supabase query shape (Phase 1C) —
 * complements customerSuccessMilestoneNotes.test.ts, which covers the pure
 * per-status rendering. This file exercises the fetch/filter/ordering layer
 * against the same in-memory fake client the delivery pipeline's own tests
 * use, so no real Supabase connection is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeDeliveryClient, makeFakeCsEventRow } from "./support/fakeDeliveryClient";
import { getCustomerSuccessNotesForVenue } from "../../../src/lib/data/venueNotes";
import { CUSTOMER_SUCCESS_ACTIVITY_AUTHOR_LABEL } from "../../../src/lib/customerSuccess/customerSuccessMilestoneNotes";

test("excludes superseded events for the venue", async () => {
  const { client } = createFakeDeliveryClient({
    csEvents: [
      makeFakeCsEventRow({
        id: "e-sent",
        venue_id: "venue-1",
        milestone_value: 50,
        communication_status: "sent",
        sent_at: "2026-09-15T22:00:20.000Z",
        recipient_email: "a@b.com",
      }),
      makeFakeCsEventRow({
        id: "e-superseded",
        venue_id: "venue-1",
        milestone_value: 50,
        communication_status: "superseded",
        achieved_at: "2026-08-01T00:00:00.000Z",
      }),
    ],
  });

  const { notes } = await getCustomerSuccessNotesForVenue("venue-1", client as never);
  assert.equal(notes.length, 1);
  assert.match(notes[0].note, /sent to a@b\.com/);
});

test("excludes skipped events for the venue (query-level, Phase 1C correction)", async () => {
  const { client } = createFakeDeliveryClient({
    csEvents: [
      makeFakeCsEventRow({
        id: "e-sent",
        venue_id: "venue-1",
        milestone_value: 50,
        communication_status: "sent",
        sent_at: "2026-09-15T22:00:20.000Z",
        recipient_email: "a@b.com",
      }),
      makeFakeCsEventRow({
        id: "e-skipped",
        venue_id: "venue-1",
        milestone_value: 100,
        communication_status: "skipped",
        achieved_at: "2026-08-01T00:00:00.000Z",
      }),
    ],
  });

  const { notes } = await getCustomerSuccessNotesForVenue("venue-1", client as never);
  assert.equal(notes.length, 1);
  assert.match(notes[0].note, /sent to a@b\.com/);
});

test("excludes an unrecognized/future status defensively", async () => {
  const { client } = createFakeDeliveryClient({
    csEvents: [
      makeFakeCsEventRow({
        id: "e-mystery",
        venue_id: "venue-1",
        milestone_value: 50,
        communication_status: "some_future_status",
      }),
    ],
  });

  const { notes } = await getCustomerSuccessNotesForVenue("venue-1", client as never);
  assert.equal(notes.length, 0);
});

test("does not surface another venue's events", async () => {
  const { client } = createFakeDeliveryClient({
    csEvents: [
      makeFakeCsEventRow({
        id: "e-other-venue",
        venue_id: "venue-2",
        milestone_value: 100,
        communication_status: "sent",
        sent_at: "2026-09-15T22:00:20.000Z",
        recipient_email: "other@example.com",
      }),
    ],
  });

  const { notes } = await getCustomerSuccessNotesForVenue("venue-1", client as never);
  assert.equal(notes.length, 0);
});

test("read-only: fetching notes performs no writes and the source rows are untouched", async () => {
  const { client, csEvents } = createFakeDeliveryClient({
    csEvents: [
      makeFakeCsEventRow({
        id: "e-sent",
        venue_id: "venue-1",
        milestone_value: 50,
        communication_status: "sent",
        sent_at: "2026-09-15T22:00:20.000Z",
        recipient_email: "a@b.com",
        attempt_count: 1,
      }),
    ],
  });

  const before = JSON.stringify(csEvents);
  await getCustomerSuccessNotesForVenue("venue-1", client as never);
  const after = JSON.stringify(csEvents);
  assert.equal(before, after, "getCustomerSuccessNotesForVenue must never mutate customer_success_events");
});

test("returns each VenueNote shape ready to merge with manual/system notes, labeled with an intentional system author (not 'Unknown')", async () => {
  const { client } = createFakeDeliveryClient({
    csEvents: [
      makeFakeCsEventRow({
        id: "e-sent",
        venue_id: "venue-1",
        milestone_value: 50,
        communication_status: "sent",
        sent_at: "2026-09-15T22:00:20.000Z",
        recipient_email: "a@b.com",
      }),
    ],
  });

  const { notes } = await getCustomerSuccessNotesForVenue("venue-1", client as never);
  assert.equal(notes.length, 1);
  const [note] = notes;
  assert.equal(note.venue_id, "venue-1");
  assert.equal(note.created_by, null);
  assert.equal(note.created_by_email, null);
  assert.equal(note.author_label, CUSTOMER_SUCCESS_ACTIVITY_AUTHOR_LABEL);
  assert.equal(note.author_label, "Happy Hour Compass");
  assert.equal(note.created_at, "2026-09-15T22:00:20.000Z");
  assert.ok(note.id.startsWith("cs-"));
});

test("a row with no milestone_value (defensive) does not produce a note", async () => {
  const { client } = createFakeDeliveryClient({
    csEvents: [
      makeFakeCsEventRow({
        id: "e-no-milestone",
        venue_id: "venue-1",
        milestone_value: null,
        communication_status: "pending",
      }),
    ],
  });

  const { notes } = await getCustomerSuccessNotesForVenue("venue-1", client as never);
  assert.equal(notes.length, 0);
});
