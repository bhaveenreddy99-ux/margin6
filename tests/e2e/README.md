# Playwright Smoke Suite

This suite is intentionally small. It checks the highest-value authenticated flows without coupling tests to exact row counts or unstable fixture assumptions:

- app shell boot
- sidebar navigation
- list management
- inventory
- invoices and invoice review
- dashboard
- recipes

## Auth

Use the simplest safe auth path that fits your environment:

1. Set `E2E_EMAIL` and `E2E_PASSWORD` to let Playwright log in through the existing `/login` page.
2. Or point `PLAYWRIGHT_AUTH_FILE` at an existing Playwright storage state file.

If neither is available, the authenticated smoke specs are skipped with a clear message.

## Running locally

If `E2E_BASE_URL` is not set, the Playwright config starts the local Vite dev server automatically on `http://127.0.0.1:4173`.

```bash
E2E_EMAIL="test@example.com" E2E_PASSWORD="password" npm run test:e2e
```

To run against an already-hosted environment instead:

```bash
E2E_BASE_URL="https://your-env.example.com" E2E_EMAIL="test@example.com" E2E_PASSWORD="password" npm run test:e2e
```

Headed mode:

```bash
npm run test:e2e:headed
```

## Notes

- Failure artifacts keep trace, video, screenshot, and runtime logs.
- Inventory editing is only exercised when an in-progress session already exists.
- Invoice review is only opened when a reviewable invoice is already present.
