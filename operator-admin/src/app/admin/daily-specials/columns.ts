/**
 * Shared Daily Specials Operator Admin column-select string.
 *
 * Deliberately its own plain module — no "use client"/"use server"
 * directive — so it is safely importable from BOTH page.tsx (a Server
 * Component) and DailySpecialsManager.tsx (a Client Component).
 *
 * THE BUG THIS FIXES: this constant previously lived inside
 * DailySpecialsManager.tsx ("use client"). page.tsx imported it from
 * there to build its own server-side query. Under Next.js's React Server
 * Components client-boundary transform, a "use client" module's exports
 * are replaced, on the SERVER build, with client-reference objects rather
 * than their real values — so page.tsx's Supabase `.select(DAILY_SPECIAL_COLUMNS)`
 * call was actually passed a reference object, not a string. Supabase's
 * query builder calls string methods (`.split(',')`) on whatever `.select()`
 * receives, producing the runtime error:
 *   "(intermediate value)(intermediate value)(intermediate value).split is
 *   not a function"
 * This never surfaced in DailySpecialsManager.tsx's own use of the constant
 * (its refreshList()) because that usage never crosses the client boundary
 * — the constant was defined and consumed in the same "use client" module.
 *
 * Fix: a plain module has no RSC boundary at all, so both callers now get
 * the real string, in both environments, from one shared source of truth
 * (avoiding two independently-maintained copies of this column list).
 *
 * Must include every field DailySpecialForm reads from DailySpecialRow so
 * the edit form hydrates correctly — see src/app/admin/daily-specials/
 * formState.ts's DailySpecialRow (an alias of Phase 1's DailySpecialDbRow).
 *
 * NOTE: this is a separate, Operator-Admin-specific column list from
 * src/lib/data/dailySpecials.ts's own local DAILY_SPECIAL_COLUMNS constant
 * (used by the general-purpose venue/consumer read helpers) — same name,
 * different module, different purpose, not accidentally duplicated. That
 * file has no RSC directive of its own and was unaffected by this bug (its
 * constant is defined and consumed in the same plain module).
 */
export const DAILY_SPECIAL_COLUMNS =
  "id, venue_id, title, offer_type, short_summary, description, conditions, image_url, " +
  "schedule_type, one_time_date, days_of_week, recurrence_start_date, recurrence_end_date, " +
  "time_mode, start_time, end_mode, end_time, " +
  "is_published, is_seeded_special, source_url, last_verified_at, " +
  "created_by_operator_id, updated_by_operator_id, created_at, updated_at";
