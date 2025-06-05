# Test info

- Name: rank badges appear
- Location: C:\Users\Naveed Bhatti\Documents\Google-Scholar-Conference-Ranker\tests\extension-ui.spec.ts:8:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Test timeout of 60000ms exceeded
    at C:\Users\Naveed Bhatti\Documents\Google-Scholar-Conference-Ranker\tests\extension-ui.spec.ts:13:3
```

# Test source

```ts
   1 | // tests/extension-ui.spec.ts
   2 | //
   3 | // ✔ waits until at least one badge exists
   4 | // ✔ verifies every badge label is a known rank (A*, A, B, C, U, N/A)
   5 |
   6 | import { test, expect } from "./fixtures/extensionContext";
   7 |
   8 | test("rank badges appear", async ({ page }) => {
   9 |   await page.goto("https://scholar.google.com.pk/citations?hl=en&user=6ZB86uYAAAAJ");
  10 |
  11 |   // 1️⃣ wait until the extension has injected ≥1 badge
  12 |   const badges = page.locator("span[class*=rank-badge]");
> 13 |   await expect.poll(() => badges.count(), { timeout: 55_000 }).toBeGreaterThan(0);
     |   ^ Error: expect(received).toBeGreaterThan(expected)
  14 |
  15 |   // 2️⃣ validate badge text against a whitelist
  16 |   const allowed = new Set(["A*", "A", "B", "C", "U", "N/A"]);
  17 |   const texts   = (await badges.allTextContents())
  18 |                    .map(t => t.trim().toUpperCase());
  19 |
  20 |   const invalid = texts.filter(t => !allowed.has(t));
  21 |   expect(invalid, `Unexpected badge labels: ${invalid.join(", ")}`).toHaveLength(0);
  22 | });
  23 |
```