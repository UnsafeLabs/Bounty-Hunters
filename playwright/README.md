# Playwright E2E Tests

This directory contains end-to-end tests for the T3 Code web application using Playwright.

## Prerequisites

Make sure the web app is running:

```bash
cd ../t3code
bun run dev:web
```

The web app typically runs on http://localhost:5733.

## Running Tests

```bash
# Install Playwright browsers (first time only)
npm run install

# Run tests
npm test

# Run tests in headed mode (see the browser)
npm run test:headed

# Open Playwright UI
npm run test:ui
```

## Test Structure

- `tests/app-loading.spec.ts` - Tests that the application loads correctly
- `tests/command-palette.spec.ts` - Tests for the command palette functionality