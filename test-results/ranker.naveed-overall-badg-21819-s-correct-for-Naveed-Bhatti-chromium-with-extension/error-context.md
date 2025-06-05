# Test info

- Name: overall badge distribution is correct for Naveed Bhatti
- Location: C:\Users\Naveed Bhatti\Documents\Google-Scholar-Conference-Ranker-Testing\tests\ranker.naveed.spec.ts:24:1

# Error details

```
Error: rank "A★"

expect(received).toBe(expected) // Object.is equality

Expected: 4
Received: 1
    at C:\Users\Naveed Bhatti\Documents\Google-Scholar-Conference-Ranker-Testing\tests\ranker.naveed.spec.ts:60:44
```

# Test source

```ts
   1 | // tests/ranker.spec.ts
   2 | //
   3 | // Checks the total badge-count distribution on a known Scholar profile.
   4 | // Uses the extension-aware Playwright fixture.
   5 |
   6 | import { test, expect } from './fixtures/extensionContext';
   7 |
   8 | // ───────────────────────────────
   9 | // CONFIG
  10 | // ───────────────────────────────
  11 | const PROFILE = 'https://scholar.google.com/citations?hl=en&user=6ZB86uYAAAAJ';
  12 |
  13 | const EXPECTED = {
  14 |   'A★': 4,
  15 |   A: 3,
  16 |   B: 3,
  17 |   C: 1,
  18 |   // “N/A” is ignored
  19 | };
  20 |
  21 | // ───────────────────────────────
  22 | // TEST
  23 | // ───────────────────────────────
  24 | test('overall badge distribution is correct for Naveed Bhatti', async ({ page }) => {
  25 |   // 1 — open profile, let network settle
  26 |   await page.goto(PROFILE, { waitUntil: 'networkidle' });
  27 |
  28 |   // 2 — reload once so content-script runs on a clean DOM
  29 |   await page.reload({ waitUntil: 'networkidle' });
  30 |
  31 |   // 3 — wait until extension banner disappears
  32 |   await page.waitForSelector('#sr-status-banner', {
  33 |     state:   'detached',
  34 |     timeout: 20_000,
  35 |   });
  36 |
  37 |   // 4 — wait until at least one badge exists
  38 |   const badgeSel = 'span[class*=rank-badge]';
  39 |   await expect
  40 |     .poll(() => page.locator(badgeSel).count(), { timeout: 20_000 })
  41 |     .toBeGreaterThan(0);
  42 |
  43 |   // 5 — zero-initialise counters
  44 |   const counts = Object.fromEntries(
  45 |     Object.keys(EXPECTED).map(k => [k, 0]),
  46 |   ) as Record<string, number>;
  47 |
  48 |   // 6 — tally badge texts
  49 |   for (const raw of await page.locator(badgeSel).allTextContents()) {
  50 |     let label = raw.trim().toUpperCase();
  51 |
  52 |     // normalise ASCII star → Unicode star
  53 |     if (label === 'A*') label = 'A★';
  54 |
  55 |     if (label in counts) counts[label]++;
  56 |   }
  57 |
  58 |   // 7 — assert each rank bucket
  59 |   for (const [rank, want] of Object.entries(EXPECTED)) {
> 60 |     expect(counts[rank], `rank "${rank}"`).toBe(want);
     |                                            ^ Error: rank "A★"
  61 |   }
  62 | });
  63 |
```