/**
 * Builds a `token_hash` recovery link — the safe alternative to Supabase's
 * raw `action_link` (the `.../auth/v1/verify?token=...` URL returned by
 * `admin.generateLink()`).
 *
 * `action_link` verifies (and consumes) the one-time recovery token the
 * instant it's *loaded*, with no user interaction — an email security
 * scanner or link-prefetcher that opens it before the person does silently
 * burns the token, so the person's own click then fails with an
 * already-used/expired error and no way to tell why. See CLAUDE.md's
 * Authentication & Email section for the full write-up, and the Casa de
 * Frida operator-login investigation this fixes.
 *
 * `hashedToken` is `linkData.properties.hashed_token` from
 * `admin.generateLink()` — the same value Supabase's own `{{ .TokenHash }}`
 * email-template variable would resolve to. Landing on `redirectTo` with
 * this query param does NOT verify anything by itself; the receiving page
 * must defer `supabase.auth.verifyOtp({ token_hash, type })` to an explicit
 * user action (see the "Continue" button pattern in
 * (consumer-auth)/account/reset-password/page.tsx and
 * operator/create-password/page.tsx) so a prefetch can't consume it first.
 *
 * Used by both requestConsumerPasswordReset
 * ((consumer-auth)/account/forgot-password/actions.ts) and
 * forgotPasswordAction (forgot-password/actions.ts) so the two flows share
 * one link shape rather than each hand-building the query string.
 */
export function buildTokenHashRecoveryLink(
  redirectTo: string,
  hashedToken: string,
  type: "recovery" = "recovery"
): string {
  return `${redirectTo}?token_hash=${hashedToken}&type=${type}`;
}
