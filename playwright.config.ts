import { defineConfig } from "@playwright/test";

// Supabase keys and the test user's credentials (E2E_EMAIL, E2E_PASSWORD)
process.loadEnvFile(".env");

// Unit tests (tests/unit) run on their own. End-to-end tests (tests/e2e) drive the Electron app
// against the Vite dev server (started here unless one is already running on 1420) and the
// agent server, signed in as a dedicated test user whose rows are wiped first. Run with
// `npm test`.
export default defineConfig({
  testDir: "tests",
  timeout: 180_000,
  expect: { timeout: 5_000 },
  workers: 1,
  outputDir: "test-results",
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
});
