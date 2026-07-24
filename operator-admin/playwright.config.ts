import { defineConfig, devices } from "@playwright/test";

/**
 * Cross-browser compatibility audit for the public consumer website
 * (`src/app/(website)/` + `(consumer-auth)/`) only — see e2e/website/README.md.
 *
 * BASE_URL lets this run against a deployed environment (e.g. staging)
 * instead of the local dev server: `BASE_URL=https://staging.happyhourcompass.com npx playwright test`.
 * Without it, Playwright starts `npm run dev` against localhost and tears it down after the run.
 */
// Default to a dedicated port (not 3000) so this doesn't collide with a
// developer's already-running `npm run dev` on the default port.
const baseURL = process.env.BASE_URL || "http://127.0.0.1:3100";
const usingLocalServer = !process.env.BASE_URL;
const localPort = new URL(baseURL).port || "3100";

export default defineConfig({
  testDir: "./e2e/website",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: usingLocalServer
    ? {
        command: `npm run dev -- -p ${localPort}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
