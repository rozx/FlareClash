import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:8789", headless: true },
  projects: [
    { name: "desktop", use: { viewport: { width: 1024, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "node scripts/serve-admin.js",
    url: "http://127.0.0.1:8789/admin/",
    reuseExistingServer: false,
  },
});
