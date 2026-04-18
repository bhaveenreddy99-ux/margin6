import fs from "node:fs";
import path from "node:path";

type SmokeCredentials = {
  email: string;
  password: string;
};

export function getStorageStatePath(): string {
  if (process.env.PLAYWRIGHT_AUTH_FILE) {
    return path.resolve(process.env.PLAYWRIGHT_AUTH_FILE);
  }

  return path.resolve(process.cwd(), "playwright/.auth/user.json");
}

export function hasStoredAuthState(): boolean {
  return fs.existsSync(getStorageStatePath());
}

export function getSmokeCredentials(): SmokeCredentials | null {
  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export function getMissingAuthReason(): string | null {
  if (getSmokeCredentials() || hasStoredAuthState()) {
    return null;
  }

  return `Set E2E_EMAIL and E2E_PASSWORD, or point PLAYWRIGHT_AUTH_FILE at an existing Playwright storage state.`;
}
