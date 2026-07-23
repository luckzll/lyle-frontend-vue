import { defineConfig, devices } from '@playwright/test'

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const baseURL = externalBaseURL || 'http://127.0.0.1:4173'
const playwrightPort = Number(process.env.PLAYWRIGHT_PORT || new URL(baseURL).port || 4173)

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox-v63',
      testMatch: /(?:v63-login|v62-unified-attachments)\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit-v63',
      testMatch: /(?:v63-login|v62-unified-attachments)\.spec\.ts/,
      use: { ...devices['Desktop Safari'] }
    }
  ],
  webServer: {
    command: `npx vite --host 0.0.0.0 --port ${playwrightPort}`,
    url: baseURL,
    // The regression suite depends on deterministic build-time feature flags.
    // Reusing a developer's Vite server can silently disable V5/V6 routes and
    // redirect every deep-link test to the execution center instead.
    reuseExistingServer: Boolean(externalBaseURL),
    timeout: 60_000,
    env: {
      ...process.env,
      VITE_AGENT_TASK_ENABLED: 'true',
      VITE_AGENT_TASK_ENABLED_USERS: '*',
      VITE_MISSION_ENABLED: 'true',
      VITE_MISSION_ENABLED_USERS: '*'
    }
  }
})
