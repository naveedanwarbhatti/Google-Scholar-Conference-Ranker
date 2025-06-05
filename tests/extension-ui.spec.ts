// tests/extension-ui.spec.ts
//
// ✔ waits until at least one badge exists
// ✔ verifies every badge label is a known rank (A*, A, B, C, U, N/A)

import { test, expect } from "./fixtures/extensionContext";

test("rank badges appear", async ({ page }) => {
  await page.goto("https://scholar.google.com.pk/citations?hl=en&user=6ZB86uYAAAAJ");

  // 1️⃣ wait until the extension has injected ≥1 badge
  const badges = page.locator("span[class*=rank-badge]");
  await expect.poll(() => badges.count(), { timeout: 55_000 }).toBeGreaterThan(0);

  // 2️⃣ validate badge text against a whitelist
  const allowed = new Set(["A*", "A", "B", "C", "U", "N/A"]);
  const texts   = (await badges.allTextContents())
                   .map(t => t.trim().toUpperCase());

  const invalid = texts.filter(t => !allowed.has(t));
  expect(invalid, `Unexpected badge labels: ${invalid.join(", ")}`).toHaveLength(0);
});
