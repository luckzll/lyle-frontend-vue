import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
const playwrightPort = Number(process.env.PLAYWRIGHT_PORT || new URL(baseURL).port || 5173)

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
    }
  ],
  webServer: {
    command: `npx vite --host 0.0.0.0 --port ${playwrightPort}`,
    url: baseURL,
    reuseExistingServer: true,
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
