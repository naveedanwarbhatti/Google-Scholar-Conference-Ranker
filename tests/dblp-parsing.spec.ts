import { test, expect } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';

// Minimal PACM HCI publication snippet
const XML = `<?xml version="1.0"?>
<dblpperson>
  <r>
    <article key="journals/pacmhci/Example23">
      <title>Sample Paper</title>
      <year>2023</year>
      <number>CSCW</number>
      <journal>Proc. ACM Hum.-Comput. Interact.</journal>
      <url>db/journals/pacmhci/pacmhci23.html</url>
    </article>
  </r>
</dblpperson>`;

test('PACM HCI issue used as acronym when stream data missing', async () => {
  const doc = new DOMParser().parseFromString(XML, 'application/xml');
  const item = doc.getElementsByTagName('article')[0]!;

  const venueElements = ['booktitle', 'journal', 'series', 'school'];
  let rawVenue: string | null = null;
  for (const tag of venueElements) {
    const txt = item.getElementsByTagName(tag)[0]?.textContent?.trim();
    if (txt) { rawVenue = txt; break; }
  }
  const issue = item.getElementsByTagName('number')[0]?.textContent?.trim();

  let acronym: string | null = null;

  // Simulate stream metadata fetch failure -> acronym remains null

  if (!acronym && rawVenue?.startsWith('Proc. ACM') && issue && /^[A-Za-z]{2,}$/.test(issue)) {
    acronym = issue;
  }

  expect(acronym).toBe('CSCW');
});
