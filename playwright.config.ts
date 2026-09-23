import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  outputDir: 'test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    browserName: 'chromium',
    channel: 'msedge',
    viewport: { width: 1180, height: 820 },
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: true },
  reporter: 'list',
});
