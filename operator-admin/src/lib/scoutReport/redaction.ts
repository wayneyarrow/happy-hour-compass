/**
 * Search-term redaction for the Scout export — pure, no I/O.
 *
 * Search terms are free text typed by visitors. Before a term is serialized
 * into the export, anything that looks like an email address or a phone
 * number is replaced. Aggregate counts for the term are kept unchanged.
 *
 * Deliberately conservative: any run of 7+ digits (spaces, dots, dashes,
 * parentheses and a leading + allowed between them) is treated as a phone
 * number, so a long numeric term may be redacted too.
 */

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_RE = /\+?\(?\d(?:[\s().-]*\d){6,}\)?/g;

export const EMAIL_PLACEHOLDER = "[email redacted]";
export const PHONE_PLACEHOLDER = "[phone redacted]";

export function redactSearchTerm(term: string): { term: string; redacted: boolean } {
  const out = term.replace(EMAIL_RE, EMAIL_PLACEHOLDER).replace(PHONE_RE, PHONE_PLACEHOLDER);
  return { term: out, redacted: out !== term };
}
