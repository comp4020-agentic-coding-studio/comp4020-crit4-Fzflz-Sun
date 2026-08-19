import { defineConfig } from "@playwright/test";

// Runs against the built site (not the dev server) so it checks what
// actually ships — same principle as spec/invariants.test.ts. `pnpm preview`
// serves dist/ on a fixed port; webServer starts it and waits before tests run.
export default defineConfig({
  testDir: "e2e",
  webServer: {
    command: "pnpm preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:4173",
    actionTimeout: 5_000,
  },
  expect: {
    timeout: 5_000,
  },
  timeout: 8_000,
});
