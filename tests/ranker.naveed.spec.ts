// tests/ranker.spec.ts
//
// Checks the total badge-count distribution on a known Scholar profile.
// Uses the extension-aware Playwright fixture.

import { test as base, expect } from './fixtures/extensionContext';

const test = process.env.PWTEST_MODE === 'ci' ? base.skip : base;

// ───────────────────────────────
// CONFIG
// ───────────────────────────────
const PROFILE = 'https://scholar.google.com/citations?hl=en&user=6ZB86uYAAAAJ';

const EXPECTED = {
  'A★': 4,
  A: 3,
  B: 3,
  C: 1,
  // “N/A” is ignored
};

// ───────────────────────────────
// TEST
// ───────────────────────────────
test('overall badge distribution is correct for Naveed Bhatti', async ({ page }) => {
  // Inject script to append "PhD" to the author's name before the extension runs
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('gsc_prf_in');
      if (el && el.textContent && !/PhD/.test(el.textContent)) {
        el.textContent += ' PhD';
      }
    });
  });
  // 1 — open profile, let network settle
  await page.goto(PROFILE, { waitUntil: 'networkidle' });

  // 2 — reload once so content-script runs on a clean DOM
  await page.reload({ waitUntil: 'networkidle' });

  // 3 — wait until extension banner disappears
  await page.waitForSelector('#sr-status-banner', {
    state:   'detached',
    timeout: 20_000,
  });

  // 4 — wait until at least one badge exists
  const badgeSel = 'span[class*=rank-badge]';
  await expect
    .poll(() => page.locator(badgeSel).count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // 5 — zero-initialise counters
  const counts = Object.fromEntries(
    Object.keys(EXPECTED).map(k => [k, 0]),
  ) as Record<string, number>;

  // 6 — tally badge texts
  for (const raw of await page.locator(badgeSel).allTextContents()) {
    let label = raw.trim().toUpperCase();

    // normalise ASCII star → Unicode star
    if (label === 'A*') label = 'A★';

    if (label in counts) counts[label]++;
  }

  // 7 — assert each rank bucket
  for (const [rank, want] of Object.entries(EXPECTED)) {
    expect(counts[rank], `rank "${rank}"`).toBe(want);
  }
});
