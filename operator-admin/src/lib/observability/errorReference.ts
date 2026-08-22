/**
 * HHC error/reference ID generator — server-safe.
 *
 * Purpose: a short, customer-quotable, opaque token ("HHC-7X42M") that
 * correlates one customer-visible failure to its Sentry event, without
 * exposing anything internal. This is an OPERATIONAL CORRELATION id, not a
 * database key, a security token, or a global-uniqueness guarantee — it
 * only needs to be practically distinct across the small number of
 * unexpected-failure events HHC actually sees, searchable as a Sentry tag
 * (see reportOperationalError.ts).
 *
 * Deliberately NOT derived from any UUID, timestamp, user id, venue id,
 * place_id, or other internal identifier — it is pure randomness, so it can
 * never be reverse-engineered into something sensitive.
 */

/**
 * Unambiguous uppercase alphabet: digits 0/1 and letters I/L/O are excluded
 * because they're easy to misread or mistype (0 vs O, 1 vs I vs L) when a
 * customer is reading this off a screen and typing it into an email.
 * 31 symbols (8 digits + 23 letters).
 */
export const HHC_ERROR_REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const MIN_LENGTH = 4;
const MAX_LENGTH = 8;
const DEFAULT_LENGTH = 5;

/** Matches any reference this module could have generated, at any supported length. */
export const HHC_ERROR_REFERENCE_PATTERN = new RegExp(
  `^HHC-[${HHC_ERROR_REFERENCE_ALPHABET}]{${MIN_LENGTH},${MAX_LENGTH}}$`
);

// ── Unbiased random-symbol selection ────────────────────────────────────────
//
// 256 (the number of possible byte values) isn't evenly divisible by 31 (the
// alphabet length): 256 = 8×31 + 8. A plain `byte % 31` would give the first
// 8 symbols a slightly higher chance (9/256) than the remaining 23 (8/256).
// Rejection sampling removes that bias: only bytes in the largest range that
// *is* evenly divisible by 31 — [0, 247] — are used; a byte landing in the
// leftover [248, 255] range is discarded and another is drawn. Every symbol
// then has exactly equal probability.
const ALPHABET_LENGTH = HHC_ERROR_REFERENCE_ALPHABET.length;
const REJECTION_THRESHOLD = Math.floor(256 / ALPHABET_LENGTH) * ALPHABET_LENGTH; // 248

/** Returns one cryptographically random byte (0–255). */
export type RandomByteSource = () => number;

/**
 * Web Crypto's getRandomValues is available on globalThis.crypto in every
 * runtime this app executes in — Node.js (server actions), the Edge
 * runtime, and the browser — unlike node:crypto, which doesn't exist on
 * Edge. Using it here keeps this module safely importable from any of them,
 * even though today it's only called server-side.
 */
function cryptoRandomByte(): number {
  const buf = new Uint8Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0];
}

/**
 * Draws bytes from `randomByte` until one falls in the unbiased usable
 * range, and returns its corresponding alphabet index. Iterative (not
 * recursive) — bounded only by draw probability, never by call-stack depth,
 * so it can't blow the stack no matter how (implausibly) many rejections
 * occur in a row. With real crypto randomness the expected number of draws
 * is ~1.03 (8/256 ≈ 3% rejection chance per byte).
 */
function unbiasedAlphabetIndex(randomByte: RandomByteSource): number {
  while (true) {
    const byte = randomByte();
    if (byte < REJECTION_THRESHOLD) {
      return byte % ALPHABET_LENGTH;
    }
    // byte ∈ [248, 255] — discard and draw again.
  }
}

/**
 * Generates one HHC-XXXXX reference id.
 *
 * @param length Number of random characters after "HHC-". Defaults to 5
 *   (31^5 ≈ 28.6M combinations — plenty for correlating a low-volume stream
 *   of operational errors).
 * @param randomByte Test-only override for the byte source (defaults to
 *   Web Crypto). Production callers should never pass this — it exists so
 *   tests can deterministically prove the rejection-sampling behavior (feed
 *   a byte in the discarded [248,255] range and confirm it gets skipped)
 *   without reaching into the module's internals or mocking global crypto.
 */
export function generateHhcErrorReference(
  length: number = DEFAULT_LENGTH,
  randomByte: RandomByteSource = cryptoRandomByte
): string {
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new Error(
      `generateHhcErrorReference: length must be an integer between ${MIN_LENGTH} and ${MAX_LENGTH} (got ${length}).`
    );
  }

  let suffix = "";
  for (let i = 0; i < length; i++) {
    suffix += HHC_ERROR_REFERENCE_ALPHABET[unbiasedAlphabetIndex(randomByte)];
  }

  return `HHC-${suffix}`;
}

/** True if `value` has the exact shape a generated HHC reference always has. */
export function isValidHhcErrorReference(value: string): boolean {
  return HHC_ERROR_REFERENCE_PATTERN.test(value);
}
