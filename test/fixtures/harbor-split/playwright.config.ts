import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:5180" },
  webServer: { command: "npm run dev -w @harbor/client", url: "http://localhost:5180" },
});
