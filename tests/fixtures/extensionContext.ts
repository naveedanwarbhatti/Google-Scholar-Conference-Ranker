// tests/fixtures/extensionContext.ts
//
// Playwright fixture that starts Chromium with the unpacked
// Google-Scholar-Conference-Ranker extension **and** a temporary profile
// where “Developer Mode” is already enabled.
//
// Usage in a spec:
//   import { test, expect } from "./fixtures/extensionContext";
//
//   test("rank badges appear", async ({ page }) => {
//     …
//   });

import { test as base, chromium, expect as baseExpect, BrowserContext } from "@playwright/test";
import fs   from "node:fs";
import os   from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── 1. ESM-safe dirname / filename ─────────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ── 2. Absolute path to the built extension ──────────────────────
   tests/fixtures  →  project-root/build                           */
const extensionPath = path.resolve(__dirname, "..", "..", "build");

/* ── 3. Temporary Chrome profile with Developer Mode ON ─────────── */
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ranker-profile-"));

const prefDir = path.join(userDataDir, "Default");
fs.mkdirSync(prefDir, { recursive: true });

fs.writeFileSync(
  path.join(prefDir, "Preferences"),
  JSON.stringify({ extensions: { ui: { developer_mode: true } } }, null, 2)
);

/* ── 4. Custom fixture definition ───────────────────────────────── */
type Fixtures = { context: BrowserContext };

export const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: process.env.PWTEST_MODE === 'ci' ? true : false,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    await use(context);
    await context.close();
  },

  // handy page fixture so tests can just inject { page }
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
});

export const expect = baseExpect;
