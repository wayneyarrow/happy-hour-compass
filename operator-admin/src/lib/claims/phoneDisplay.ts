/**
 * Presentation only: shows a North American 10-digit phone (optionally with
 * a leading 1 / +1) as "(250) 766-3408". Anything else — an extension,
 * too few/many digits, an international number — is returned trimmed and
 * otherwise unchanged. Stored phone values are never rewritten with this.
 */
export function formatPhoneForDisplay(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/[a-z]/i.test(value)) return value;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return value;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
