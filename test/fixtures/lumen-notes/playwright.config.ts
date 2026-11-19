import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.WEB_PORT ?? 5173);
const baseURL = process.env.BASE_URL ?? `http://localhost:${webPort}`;
const external = Boolean(process.env.BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === "1",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : [
        { command: "npm run dev -w @lumen/api", url: "http://localhost:8787/api/greeting", reuseExistingServer: true },
        { command: "npm run dev -w @lumen/web", url: baseURL, reuseExistingServer: true },
      ],
});
