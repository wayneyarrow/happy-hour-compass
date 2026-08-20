/**
 * Partially masks an email address for safe inclusion in logs/error
 * messages — enough to support debugging (domain stays visible, first
 * couple of local-part characters stay visible) without writing a
 * consumer's full email into logs unnecessarily.
 *
 * "wayne.yarrow@gmail.com" -> "wa**********@gmail.com"
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visibleLength = Math.min(2, local.length);
  const visible = local.slice(0, visibleLength);
  const masked = "*".repeat(Math.max(local.length - visibleLength, 1));

  return `${visible}${masked}@${domain}`;
}
