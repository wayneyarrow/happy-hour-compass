import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateHhcErrorReference,
  isValidHhcErrorReference,
  HHC_ERROR_REFERENCE_ALPHABET,
  HHC_ERROR_REFERENCE_PATTERN,
  type RandomByteSource,
} from "../../../src/lib/observability/errorReference";

// ── Format ───────────────────────────────────────────────────────────────────

test("generateHhcErrorReference has the HHC- prefix", () => {
  const ref = generateHhcErrorReference();
  assert.match(ref, /^HHC-/);
});

test("generateHhcErrorReference defaults to 5 random characters after the prefix (HHC-XXXXX)", () => {
  const ref = generateHhcErrorReference();
  assert.equal(ref.length, "HHC-".length + 5);
});

test("generateHhcErrorReference supports a different explicit length for extra collision resistance", () => {
  const ref = generateHhcErrorReference(7);
  assert.equal(ref.length, "HHC-".length + 7);
  assert.match(ref, HHC_ERROR_REFERENCE_PATTERN);
});

test("generateHhcErrorReference rejects an out-of-range length", () => {
  assert.throws(() => generateHhcErrorReference(3));
  assert.throws(() => generateHhcErrorReference(9));
  assert.throws(() => generateHhcErrorReference(4.5));
});

// ── Character set ────────────────────────────────────────────────────────────

test("every generated character comes from the unambiguous alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const ref = generateHhcErrorReference();
    const suffix = ref.slice("HHC-".length);
    for (const char of suffix) {
      assert.ok(
        HHC_ERROR_REFERENCE_ALPHABET.includes(char),
        `character "${char}" in "${ref}" is not in the allowed alphabet`
      );
    }
  }
});

test("visually ambiguous characters never appear: 0, O, 1, I, L", () => {
  const ambiguous = ["0", "O", "1", "I", "L"];
  for (const char of ambiguous) {
    assert.ok(
      !HHC_ERROR_REFERENCE_ALPHABET.includes(char),
      `alphabet must not contain "${char}"`
    );
  }

  // Also confirm across many real generated values, not just the alphabet
  // definition, in case a future refactor stops reading from the alphabet.
  for (let i = 0; i < 200; i++) {
    const ref = generateHhcErrorReference();
    for (const char of ambiguous) {
      assert.ok(!ref.includes(char), `generated reference "${ref}" contains ambiguous character "${char}"`);
    }
  }
});

test("the reference is always uppercase", () => {
  const ref = generateHhcErrorReference();
  assert.equal(ref, ref.toUpperCase());
});

// ── Independence / randomness ────────────────────────────────────────────────

test("repeated calls produce independent values, not a fixed/counter-based sequence", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    seen.add(generateHhcErrorReference());
  }
  // Not asserting perfect uniqueness (this is a correlation id, not a
  // uniqueness guarantee) — but 200 draws from ~28.6M combinations should
  // overwhelmingly produce distinct values, proving it isn't static/looping.
  assert.ok(seen.size > 190, `expected mostly-distinct values, got ${seen.size}/200 unique`);
});

test("does not encode any recognizable UUID, timestamp, or sequential pattern", () => {
  const ref = generateHhcErrorReference();
  assert.doesNotMatch(ref, /-{2,}/); // no UUID-like extra dashes
  assert.doesNotMatch(ref, /\d{4,}/); // no long digit runs resembling a timestamp
});

// ── Validation helper ────────────────────────────────────────────────────────

test("isValidHhcErrorReference accepts a freshly generated reference at the default and a custom length", () => {
  assert.equal(isValidHhcErrorReference(generateHhcErrorReference()), true);
  assert.equal(isValidHhcErrorReference(generateHhcErrorReference(6)), true);
});

test("isValidHhcErrorReference rejects malformed values", () => {
  assert.equal(isValidHhcErrorReference("HHC-7X4"), false); // too short (below MIN_LENGTH)
  assert.equal(isValidHhcErrorReference("hhc-7X42M"), false); // lowercase prefix
  assert.equal(isValidHhcErrorReference("HHC-7O42M"), false); // ambiguous char (O)
  assert.equal(isValidHhcErrorReference("HHC7X42M"), false); // missing dash
  assert.equal(isValidHhcErrorReference(""), false);
  assert.equal(isValidHhcErrorReference("not an hhc id"), false);
});

// ── Unbiased selection (rejection sampling) ─────────────────────────────────
//
// Dependency-injects a tiny fake RandomByteSource — the same narrow-DI
// pattern used elsewhere in this foundation (see reportOperationalError's
// injectable SentryCaptureClient) — so the rejection path can be proven
// deterministically without mocking global crypto or making the production
// API more complex than "an optional, test-only second parameter".

function fakeByteSource(bytes: number[]): RandomByteSource {
  let i = 0;
  return () => {
    if (i >= bytes.length) {
      throw new Error(`fakeByteSource: exhausted after ${bytes.length} draws`);
    }
    return bytes[i++];
  };
}

// generateHhcErrorReference's minimum length is 4 (unchanged by this
// amendment), so these tests can't ask for a single-character id directly.
// Instead: queue the bytes under test for the FIRST output character, pad
// with harmless valid bytes (0) for the remaining MIN_LENGTH-1 characters,
// and only assert on the first character of the suffix — that's the one
// actually exercising the rejection behavior under test.
const MIN_TEST_LENGTH = 4;

/** Mirrors errorReference.ts's own default (HHC-XXXXX) — kept as a named
 * constant here purely so the unbiasedness test's expected-count math reads
 * clearly; not exported from the module itself. */
const DEFAULT_TEST_REF_LENGTH = 5;

function firstSymbolFrom(leadingBytes: number[]): string {
  const bytes = [...leadingBytes, ...Array(MIN_TEST_LENGTH - 1).fill(0)];
  const ref = generateHhcErrorReference(MIN_TEST_LENGTH, fakeByteSource(bytes));
  return ref.slice("HHC-".length, "HHC-".length + 1);
}

test("a byte in the rejected [248,255] range is skipped, and generation proceeds using the next valid byte", () => {
  // 248 is the first rejected byte (256 isn't evenly divisible by 31); 5 is
  // a valid, in-range byte. Alphabet[5 % 31] = alphabet[5] = "8".
  assert.equal(firstSymbolFrom([248, 5]), HHC_ERROR_REFERENCE_ALPHABET[5]);
});

test("multiple consecutive rejected bytes are all skipped before an accepted one is used", () => {
  // 248, 250, 255 are all rejected (>= 248); 0 is the first accepted byte.
  assert.equal(firstSymbolFrom([248, 250, 255, 0]), HHC_ERROR_REFERENCE_ALPHABET[0]);
});

test("every byte in [0,247] is accepted on the first draw (no unnecessary rejection)", () => {
  for (const byte of [0, 1, 30, 31, 100, 247]) {
    assert.equal(
      firstSymbolFrom([byte]),
      HHC_ERROR_REFERENCE_ALPHABET[byte % HHC_ERROR_REFERENCE_ALPHABET.length]
    );
  }
});

test("every byte in the rejected [248,255] range is skipped, not just 248", () => {
  for (const rejected of [248, 249, 250, 251, 252, 253, 254, 255]) {
    assert.equal(firstSymbolFrom([rejected, 10]), HHC_ERROR_REFERENCE_ALPHABET[10]);
  }
});

test("selection is unbiased: over many trials, each alphabet symbol is chosen roughly equally often", () => {
  // Real crypto source (the production default), not the fake — proves the
  // actual default path is unbiased, not just the rejection mechanism in
  // isolation. Counts every character across every position of every
  // generated reference (default length 5).
  const counts = new Map<string, number>();
  const iterations = 2500; // 2500 * 5 = 12,500 symbol draws, ~403 expected per symbol
  for (let i = 0; i < iterations; i++) {
    const ref = generateHhcErrorReference();
    for (const symbol of ref.slice("HHC-".length)) {
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
  }

  assert.equal(counts.size, HHC_ERROR_REFERENCE_ALPHABET.length, "every symbol should appear at least once");

  const expected = (iterations * DEFAULT_TEST_REF_LENGTH) / HHC_ERROR_REFERENCE_ALPHABET.length;
  for (const [symbol, count] of counts) {
    // Generous tolerance (±40%) to keep this non-flaky — the point is
    // proving there's no *structural* bias (e.g. the old modulo skew
    // favoring 8 of the 31 symbols), not pinning an exact distribution.
    assert.ok(
      count > expected * 0.6 && count < expected * 1.4,
      `symbol "${symbol}" appeared ${count} times, expected roughly ${expected}`
    );
  }
});
