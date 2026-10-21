import { defineConfig } from '@playwright/test'

// End-to-end tests run against the REAL CareCircle server (FastAPI + SQLite) on a throw-away database, driven through the real UI in the
// Chrome that is already installed. Only the AI endpoints are stubbed inside the tests, so no Bedrock calls are made.
// `npm run e2e`
const API = 8010
const UI = 5174
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,           // one shared database: tests restore what they change and use unique names
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${UI}`, channel: 'chrome', headless: true, viewport: { width: 1600, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: `cd .. && CARECIRCLE_DB=$(mktemp -d)/e2e.db PORT=${API} CARECIRCLE_DEMO_TIME=09:00 CARECIRCLE_SCRYPT_N=1024 CARECIRCLE_SECRET=e2e-secret uv run carecircle`,
      url: `http://127.0.0.1:${API}/api/health`, reuseExistingServer: false, timeout: 60_000,
    },
    { command: `API_PORT=${API} npm run dev -- --port ${UI} --strictPort`, url: `http://localhost:${UI}`, reuseExistingServer: false, timeout: 30_000 },
  ],
})
