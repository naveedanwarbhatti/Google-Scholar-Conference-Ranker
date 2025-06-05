/**
 * playwright.config.ts
 * Spins up Chromium with the unpacked extension _and_
 * a profile that already has Developer-Mode switched on.
 */

import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── 1. Absolute paths ─────────────────────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, "build").replace(/\\/g, "/");

/* ── 2. Temporary profile with dev-mode enabled ─────────────────── */
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ranker-"));
fs.mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
fs.writeFileSync(
  path.join(userDataDir, "Default", "Preferences"),
  JSON.stringify({ extensions: { ui: { developer_mode: true } } }, null, 2)
);

/* ── 3. Unified Playwright config ───────────────────────────────── */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,

  use: {
    headless: process.env.PWTEST_MODE === 'ci' ? true : false,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: [
        `--user-data-dir=${userDataDir}`,          // persistent context
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    }
  },

  projects: [
    { name: "chromium-with-extension", use: { browserName: "chromium" } }
  ],
});
