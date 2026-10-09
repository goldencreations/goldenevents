import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5181',
    trace: 'retain-on-failure',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run test:e2e:serve',
        url: 'http://localhost:5181/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['html', { open: 'never' }]],
});
