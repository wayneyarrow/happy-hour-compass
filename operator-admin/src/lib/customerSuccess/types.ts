/**
 * Shared types for the Customer Success foundation (Phase 1A).
 *
 * See supabase/migrations/093_customer_success_foundation.sql for the
 * underlying schema (customer_success_events / customer_success_baselines)
 * and this directory's other modules for the venue-view-milestone detector.
 *
 * Phase 1A implements exactly one event type: venue_view_milestone. The
 * "Future examples" list from the Phase 1A task (first daily special
 * published, first event published, profile incomplete, venue inactive,
 * event-view milestones, venue anniversary) is not implemented — extending
 * CustomerSuccessEventType and the matching database CHECK constraints
 * (see migration 093's header) is how a future phase adds one.
 */

/** Allowed values for customer_success_events.event_type / customer_success_baselines.event_type. */
export type CustomerSuccessEventType = "venue_view_milestone";

/** Allowed values for customer_success_events.communication_status. */
export type CommunicationStatus = "pending" | "superseded" | "sent" | "skipped" | "failed";
