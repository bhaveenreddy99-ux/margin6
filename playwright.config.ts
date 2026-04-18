import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const localBaseUrl = "http://127.0.0.1:4173";
const baseURL = process.env.E2E_BASE_URL ?? localBaseUrl;
const storageStatePath = process.env.PLAYWRIGHT_AUTH_FILE
  ? path.resolve(process.env.PLAYWRIGHT_AUTH_FILE)
  : path.resolve(process.cwd(), "playwright/.auth/user.json");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    storageState: fs.existsSync(storageStatePath) ? storageStatePath : undefined,
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
