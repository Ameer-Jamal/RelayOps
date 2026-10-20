import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4328", browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node --import tsx tests/fixtures/ui-server.ts", url: "http://127.0.0.1:4328/health", reuseExistingServer: false, timeout: 30000 }
});
