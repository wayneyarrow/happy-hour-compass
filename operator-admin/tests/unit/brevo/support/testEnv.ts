const BREVO_ENV_KEYS = [
  "BREVO_API_KEY",
  "BREVO_CONSUMER_LIST_ID",
  "BREVO_TEST_EMAIL",
  "BREVO_WEBHOOK_TOKEN",
  // Not a Brevo-specific var, but the exact signal isProductionEnvironment()
  // (stagingGuard.ts) reads — managed here alongside the Brevo vars so
  // enqueue-time-guard tests can control "are we production" the same way
  // they control everything else Brevo-related.
  "VERCEL_ENV",
] as const;

type BrevoEnvKey = (typeof BREVO_ENV_KEYS)[number];

/**
 * Sets the given Brevo (+ VERCEL_ENV) env vars for the duration of a test
 * (deleting any key not passed), returning a restore function that puts the
 * previous values back exactly as they were. Keeps tests independent
 * regardless of run order.
 */
export function withBrevoEnv(overrides: Partial<Record<BrevoEnvKey, string | undefined>>): () => void {
  const saved: Partial<Record<BrevoEnvKey, string | undefined>> = {};
  for (const key of BREVO_ENV_KEYS) saved[key] = process.env[key];

  for (const key of BREVO_ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return () => {
    for (const key of BREVO_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
