import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:5000',
    browserName: 'chromium',
    channel: undefined,
    headless: true,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});