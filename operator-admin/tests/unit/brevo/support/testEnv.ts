const BREVO_ENV_KEYS = [
  "BREVO_API_KEY",
  "BREVO_CONSUMER_LIST_ID",
  "BREVO_TEST_EMAIL",
  "BREVO_WEBHOOK_TOKEN",
] as const;

type BrevoEnvKey = (typeof BREVO_ENV_KEYS)[number];

/**
 * Sets the given Brevo env vars for the duration of a test (deleting any
 * key not passed), returning a restore function that puts the previous
 * values back exactly as they were. Keeps tests independent regardless of
 * run order.
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
