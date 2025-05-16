// scholar-ranker/content.ts

// Define the TARGET structure for a CORE entry after processing
interface CoreEntry {
  title: string;    // Full venue name
  acronym: string;  // Venue acronym
  rank: string;     // CORE rank (A*, A, B, C)
}

// Define the ranks we care about for counting and display
const VALID_RANKS = ["A*", "A", "B", "C"];
const IGNORE_KEYWORDS = ["poster", "demo", "abstract", "extended abstract", "doctoral consortium", "doctoral symposium", "computer communication review"];

const STATUS_ELEMENT_ID = 'scholar-ranker-status-progress';
const SUMMARY_PANEL_ID = 'scholar-ranker-summary';


console.log("Google Scholar Ranker: Content script loaded.");

async function expandAllPublications(statusElement: HTMLElement): Promise<void> {
  console.log("Google Scholar Ranker: Attempting to expand all publications...");
  const showMoreButtonId = 'gsc_bpf_more';
  const publicationsTableBodySelector = '#gsc_a_b';

  let attempts = 0;
  const maxAttempts = 30;

  const statusTextElement = statusElement.querySelector('.gsr-status-text') as HTMLElement | null;

  while (attempts < maxAttempts) {
    const showMoreButton = document.getElementById(showMoreButtonId) as HTMLButtonElement | null;

    if (!showMoreButton || showMoreButton.disabled) {
      console.log("Google Scholar Ranker: 'Show more' button not found or disabled.");
      if (statusTextElement) statusTextElement.textContent = "All publications loaded.";
      await new Promise(resolve => setTimeout(resolve, 500));
      break;
    }

    if (statusTextElement) statusTextElement.textContent = `Expanding publications... (click ${attempts + 1})`;

    const tableBody = document.querySelector(publicationsTableBodySelector);
    if (!tableBody) {
        console.error("Google Scholar Ranker: Publications table body not found.");
        if (statusTextElement) statusTextElement.textContent = "Error finding table.";
        break;
    }

    const contentLoadedPromise = new Promise<void>((resolve) => {
      const observer = new MutationObserver((mutationsList, obs) => {
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            const newRows = Array.from(mutation.addedNodes).filter(node => node.nodeName === 'TR' && (node as HTMLElement).classList.contains('gsc_a_tr'));
            if (newRows.length > 0) {
                obs.disconnect();
                resolve();
                return;
            }
          }
        }
      });
      observer.observe(tableBody, { childList: true, subtree: false });
      showMoreButton.click();
      setTimeout(() => { 
        observer.disconnect();
        resolve();
      }, 5000);
    });

    await contentLoadedPromise;
    await new Promise(resolve => setTimeout(resolve, 750 + Math.random() * 500));
    attempts++;
  }

  if (attempts >= maxAttempts) {
    console.warn("Google Scholar Ranker: Reached max attempts for 'Show more'.");
    if (statusTextElement) statusTextElement.textContent = "Max expansion attempts.";
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function loadCoreData(): Promise<CoreEntry[]> {
  try {
    const url = chrome.runtime.getURL('core_data.json');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch core_data.json: ${response.statusText} (URL: ${url})`);
    const jsonData = await response.json();
    if (!Array.isArray(jsonData)) {
      console.error("CORE data is not an array. Data received:", jsonData);
      return [];
    }
    return (jsonData as any[]).map((rawEntry) => {
      const entry: CoreEntry = { title: "", acronym: "", rank: "N/A" };
      if (typeof rawEntry["International Conference on Advanced Communications and Computation"] === 'string') entry.title = rawEntry["International Conference on Advanced Communications and Computation"];
      else if (typeof rawEntry.title === 'string') entry.title = rawEntry.title;
      else if (typeof rawEntry.Title === 'string') entry.title = rawEntry.Title;
      else if (typeof rawEntry.JournalTitle === 'string') entry.title = rawEntry.JournalTitle;
      else if (typeof rawEntry["Full Journal Title"] === 'string') entry.title = rawEntry["Full Journal Title"];
      else if (typeof rawEntry["Full Name"] === 'string') entry.title = rawEntry["Full Name"];
      else if (typeof rawEntry.source === 'string') entry.title = rawEntry.source;

      if (typeof rawEntry.INFOCOMP === 'string') entry.acronym = rawEntry.INFOCOMP;
      else if (typeof rawEntry.acronym === 'string') entry.acronym = rawEntry.acronym;
      else if (typeof rawEntry.Acronym === 'string') entry.acronym = rawEntry.Acronym;
      else if (typeof rawEntry.ConferenceAcro === 'string') entry.acronym = rawEntry.ConferenceAcro;
      else if (typeof rawEntry.Abbreviation === 'string') entry.acronym = rawEntry.Abbreviation;

      let foundRank: string | undefined = undefined;
      if (typeof rawEntry.Unranked === 'string') foundRank = rawEntry.Unranked;
      else if (typeof rawEntry.rank === 'string') foundRank = rawEntry.rank;
      else if (typeof rawEntry.Rank === 'string') foundRank = rawEntry.Rank;
      else if (typeof rawEntry.CORE_Rating === 'string') foundRank = rawEntry.CORE_Rating;
      else if (typeof rawEntry["CORE Rank"] === 'string') foundRank = rawEntry["CORE Rank"];
      else if (typeof rawEntry.Rating === 'string') foundRank = rawEntry.Rating;

      if (foundRank) {
        const upperRank = foundRank.toUpperCase().trim();
        if (VALID_RANKS.includes(upperRank)) entry.rank = upperRank;
      }
      entry.title = String(entry.title || "").trim();
      entry.acronym = String(entry.acronym || "").trim();
      return (entry.title || entry.acronym) ? entry : null;
    }).filter(entry => entry !== null) as CoreEntry[];
  } catch (error) {
    console.error("Error loading or parsing CORE data:", error);
    return [];
  }
}

async function fetchAndExtractVenueName(publicationUrl: string): Promise<string | null> {
  try {
    const response = await fetch(publicationUrl);
    if (!response.ok) {
      console.warn(`Failed to fetch ${publicationUrl}: ${response.statusText} (${response.status})`);
      return null;
    }
    const htmlText = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    let venueNameFromDetail = '';
    const targetLabels = ['conference', 'proceedings', 'book title', 'series', 'source', 'publication', 'book', 'journal'];

    const sectionsOci = doc.querySelectorAll('#gsc_oci_table div.gs_scl');
    if (sectionsOci.length > 0) {
      for (const section of sectionsOci) {
        const fieldEl = section.querySelector('div.gsc_oci_field');
        const valueEl = section.querySelector('div.gsc_oci_value');
        if (fieldEl && valueEl && targetLabels.includes(fieldEl.textContent?.trim().toLowerCase() || '')) {
          venueNameFromDetail = valueEl.textContent?.trim() || '';
          if (venueNameFromDetail) break;
        }
      }
    }
    if (!venueNameFromDetail) {
      const rowsVcd = doc.querySelectorAll('#gsc_vcd_table tr');
      for (const row of rowsVcd) {
        const fieldEl = row.querySelector('td.gsc_vcd_field');
        const valueEl = row.querySelector('td.gsc_vcd_value');
        if (fieldEl && valueEl && targetLabels.includes(fieldEl.textContent?.trim().toLowerCase() || '')) {
          venueNameFromDetail = valueEl.textContent?.trim() || '';
          if (venueNameFromDetail) break;
        }
      }
    }
    return venueNameFromDetail || null;
  } catch (error) {
    console.error(`Error fetching or parsing ${publicationUrl}:`, error);
    return null;
  }
}

function cleanTextForComparison(text: string): string {
    if (!text) return "";
    let cleanedText = text.toLowerCase();

    cleanedText = cleanedText.replace(/ & /g, " and "); 
    cleanedText = cleanedText.replace(/&/g, " and ");   // some authors have used '&' instead 'and' in conference title

    
    cleanedText = cleanedText.replace(/[.,\/#!$%\^;\*:{}<>=\-_`~?"“()]/g, " "); 
    cleanedText = cleanedText.replace(/\s+/g, ' '); 
    return cleanedText.trim();
}

function findRankForVenue(venueName: string, coreData: CoreEntry[]): string {
    const normalizedScholarVenueName = venueName.toLowerCase().trim();
    

    if (!normalizedScholarVenueName) return "N/A";

    
    const specificExclusions: string[] = [
        "sigcomm computer communication review",
    ];
    for (const exclusion of specificExclusions) {
        if (normalizedScholarVenueName.includes(exclusion)) {
            return "N/A";
        }
    }
    
    const extractedScholarAcronyms = extractPotentialAcronymsFromText(venueName);
    if (extractedScholarAcronyms.length > 0) {
        
        
        for (const scholarAcro of extractedScholarAcronyms) {
            for (const entry of coreData) {
                if (entry.acronym) {
                    const coreAcro = entry.acronym.toLowerCase().trim();
                    if (coreAcro && coreAcro === scholarAcro) {
                        
                        return VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A";
                    }
                }
            }
        }
    } else {
        console.log(`ACRONYM_MATCH_ATTEMPT: No acronyms extracted for GS Venue: "${venueName}"`);
    }


    // --- 2. Full name substring match ---
    
    const gsCleanedForSubstring = cleanTextForComparison(normalizedScholarVenueName);
    

    let bestMatchRank: string | null = null;
    let longestMatchLength = 0;
    let bestMatchingCoreTitleOriginal = ""; 
    let bestMatchingCoreTitleProcessed = ""; 


    const orgPrefixesToIgnore = [
        "acm/ieee", "ieee/acm", // Combined first
        "acm sigplan", "acm sigops", "acm sigbed", // More specific ACM SIGs
        "acm", "ieee", "sigplan", "sigops", "sigbed", "usenix", "international" // General orgs/SIGs
    ];

    for (const entry of coreData) {
        if (entry.title) {
            let coreTitleForMatch = cleanTextForComparison(entry.title);
            const originalCoreTitleCleaned = coreTitleForMatch; // Save before stripping orgs

            let strippedSomething;
            do {
                strippedSomething = false;
                for (const prefix of orgPrefixesToIgnore) {
                    if (coreTitleForMatch.startsWith(prefix + " ") || coreTitleForMatch === prefix) {
                        coreTitleForMatch = coreTitleForMatch.substring(prefix.length).trim();
                        strippedSomething = true;
                    }
                }
            } while (strippedSomething && coreTitleForMatch.length > 0);
            coreTitleForMatch = coreTitleForMatch.trim();

            
           

            if (gsCleanedForSubstring && coreTitleForMatch && coreTitleForMatch.length > 5) {
                if (gsCleanedForSubstring.includes(coreTitleForMatch)) {
                    
                    if (coreTitleForMatch.length > longestMatchLength) {
                        longestMatchLength = coreTitleForMatch.length;
                        bestMatchRank = VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A";
                        bestMatchingCoreTitleOriginal = entry.title;
                        bestMatchingCoreTitleProcessed = coreTitleForMatch;
                        
                    }
                }
            }
        }
    }

    if (bestMatchRank !== null) {
        return bestMatchRank;
    }

    console.log(`--- NO MATCH FOUND for GS Venue: "${venueName}" (GS Cleaned: "${gsCleanedForSubstring}", GS Acronyms: [${extractedScholarAcronyms.join(', ')}]) ---`);
    return "N/A";
}



function extractPotentialAcronymsFromText(scholarVenueName: string): string[] {
    const acronyms: Set<string> = new Set();
    const lowerVenueName = scholarVenueName.toLowerCase();

    const parentheticalMatches = lowerVenueName.match(/\(([^)]+)\)/g);
    if (parentheticalMatches) {
        parentheticalMatches.forEach(match => {
            const contentInParen = match.slice(1, -1).trim();
            const parts = contentInParen.split(/[\s\-‑,.;:]+/);
            if (parts.length > 0) {
                const firstPart = parts[0];
                if (firstPart.length >= 2 && firstPart.length <= 12 && /^[a-z][a-z0-9]*$/.test(firstPart) && !/^\d+$/.test(firstPart) && firstPart !== "was" && firstPart !== "formerly") {
                    acronyms.add(firstPart);
                }
            }
            if (contentInParen.length >= 2 && contentInParen.length <=12 && /^[a-z][a-z0-9]*$/.test(contentInParen) && !/^\d+$/.test(contentInParen)) {
                acronyms.add(contentInParen);
            }
        });
    }

    let textWithoutParens = lowerVenueName.replace(/\s*\([^)]*\)\s*/g, ' ');
    textWithoutParens = textWithoutParens.replace(/\b(proceedings\s*(of\s*)?(the\s*)?|proc\.\s*(of\s*)?(the\s*)?|journal\s*of\s*(the\s*)?)\b/gi, ' ');
    const words = textWithoutParens.split(/[\s.,:;\-‑\/&]+/);
    const commonNonAcronyms = new Set([
        'proc', 'data', 'proceedings', 'journal', 'conference', 'conf', 'symposium', 'symp', 'workshop', 'ws', 'international', 'intl', 'natl', 'national', 'annual', 'acm', 'ieee', 'usenix', 'sig', 'vol', 'volume', 'no', 'number', 'pp', 'page', 'pages', 'part', 'edition', 'of', 'the', 'on', 'in', 'and', 'for', 'to', 'at', 'st', 'nd', 'rd', 'th', 'springer', 'elsevier', 'wiley', 'press', 'extended', 'abstract', 'abstracts', 'poster', 'session', 'sessions', 'doctoral', 'companion', 'joint', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'advances', 'systems', 'networks', 'computing', 'applications', 'technology', 'technologies', 'research', 'science', 'sciences', 'engineering', 'management', 'information', 'communication', 'communications', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'transactions', 'letters', 'advances', 'bulletin', 'archive', 'archives', 'series', 'chapter', 'section', 'tutorial', 'tutorials', 'report', 'technical', 'tech', ...(Array.from({length: 65}, (_, i) => (1980 + i).toString()))
    ]);
    for (const word of words) {
        const cleanWord = word.trim();
        if (cleanWord.length >= 2 && cleanWord.length <= 12 && /^[a-z][a-z0-9\-]*[a-z0-9]$/.test(cleanWord) && !/^[0-9\-]+$/.test(cleanWord) && !commonNonAcronyms.has(cleanWord)) {
            acronyms.add(cleanWord);
        }
    }
    return Array.from(acronyms);
}

function displayRankBadgeAfterTitle(rowElement: HTMLElement, rank: string) {
    const titleCell = rowElement.querySelector('td.gsc_a_t');
    if (titleCell) {
        const oldBadge = titleCell.querySelector('span.gsr-rank-badge-inline');
        oldBadge?.remove();
    }

    if (!VALID_RANKS.includes(rank)) {
        return;
    }

    const titleLinkElement = rowElement.querySelector('td.gsc_a_t a.gsc_a_at');
    if (!titleLinkElement) {
        return;
    }

    const badge = document.createElement('span');
    badge.classList.add('gsr-rank-badge-inline');
    badge.textContent = rank;
    badge.style.display = 'inline-block';
    badge.style.padding = '1px 5px';
    badge.style.marginLeft = '8px';
    badge.style.fontSize = '0.8em';
    badge.style.fontWeight = 'bold';
    badge.style.color = '#000000';
    badge.style.border = '1px solid #ccc';
    badge.style.borderRadius = '3px';
    switch (rank) {
        case "A*": badge.style.backgroundColor = '#FFD700'; badge.style.borderColor = '#B8860B'; break;
        case "A":  badge.style.backgroundColor = '#90EE90'; badge.style.borderColor = '#3CB371'; break;
        case "B":  badge.style.backgroundColor = '#ADFF2F'; badge.style.borderColor = '#7FFF00'; break;
        case "C":  badge.style.backgroundColor = '#FFA07A'; badge.style.borderColor = '#FA8072'; break;
    }
    titleLinkElement.insertAdjacentElement('afterend', badge);
}

function createStatusElement(initialMessage: string = "Initializing..."): HTMLElement {
    document.getElementById(STATUS_ELEMENT_ID)?.remove();

    const container = document.createElement('div');
    container.id = STATUS_ELEMENT_ID;
    container.classList.add('gsc_rsb_s', 'gsc_prf_pnl');
    container.style.padding = '10px';
    container.style.marginBottom = '15px';

    const title = document.createElement('div');
    title.textContent = "CORE Rank Processing";
    title.style.fontSize = '14px'; title.style.fontWeight = 'bold'; title.style.color = '#777';
    title.style.marginBottom = '8px';
    container.appendChild(title);

    const progressBarOuter = document.createElement('div');
    progressBarOuter.style.width = '100%'; progressBarOuter.style.backgroundColor = '#e0e0e0';
    progressBarOuter.style.borderRadius = '4px'; progressBarOuter.style.height = '10px';
    progressBarOuter.style.overflow = 'hidden';
    container.appendChild(progressBarOuter);

    const progressBarInner = document.createElement('div');
    progressBarInner.classList.add('gsr-progress-bar-inner');
    progressBarInner.style.width = '0%'; progressBarInner.style.height = '100%';
    progressBarInner.style.backgroundColor = '#76C7C0';
    progressBarInner.style.transition = 'width 0.2s ease-out';
    progressBarOuter.appendChild(progressBarInner);

    const statusText = document.createElement('div');
    statusText.classList.add('gsr-status-text');
    statusText.textContent = initialMessage;
    statusText.style.marginTop = '5px'; statusText.style.fontSize = '12px';
    statusText.style.color = '#555'; statusText.style.textAlign = 'center';
    container.appendChild(statusText);

    const gsBdy = document.getElementById('gs_bdy');
    if (!gsBdy) {
        document.body.prepend(container); return container;
    }
    const rightSidebarContainer = gsBdy.querySelector('div.gsc_rsb');
    if (rightSidebarContainer) {
        const citedByElement = rightSidebarContainer.querySelector('#gsc_rsb_cit');
        const publicAccessElement = rightSidebarContainer.querySelector('#gsc_rsb_mnd');
        const coauthorsElement = rightSidebarContainer.querySelector('#gsc_rsb_co');
        if (publicAccessElement) rightSidebarContainer.insertBefore(container, publicAccessElement);
        else if (coauthorsElement) rightSidebarContainer.insertBefore(container, coauthorsElement);
        else if (citedByElement?.nextSibling) rightSidebarContainer.insertBefore(container, citedByElement.nextSibling);
        else if (citedByElement) citedByElement.parentNode?.appendChild(container);
        else rightSidebarContainer.prepend(container);
    } else {
        const profileTableContainer = document.getElementById('gsc_a_c');
        if (profileTableContainer) profileTableContainer.before(container);
        else document.body.prepend(container);
    }
    return container;
}

function updateStatusElement(statusContainer: HTMLElement, processed: number, total: number) {
    const progressBarInner = statusContainer.querySelector('.gsr-progress-bar-inner') as HTMLElement | null;
    const statusText = statusContainer.querySelector('.gsr-status-text') as HTMLElement | null;
    const percentage = total > 0 ? (processed / total) * 100 : 0;

    if (progressBarInner) progressBarInner.style.width = `${percentage}%`;
    if (statusText) statusText.textContent = `Processing ${processed} / ${total}...`;
}



function displaySummaryPanel(rankCounts: Record<string, number>) {
    const existingStatusElement = document.getElementById(STATUS_ELEMENT_ID);
    const parentOfStatus = existingStatusElement?.parentNode;
    document.getElementById(SUMMARY_PANEL_ID)?.remove(); 

    const panel = document.createElement('div');
    panel.id = SUMMARY_PANEL_ID;
    panel.classList.add('gsc_rsb_s', 'gsc_prf_pnl');
    panel.style.padding = '10px';
    panel.style.marginBottom = '15px';

    
    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.fontSize = '14px';
    headerDiv.style.fontWeight = 'bold';
    headerDiv.style.color = '#777';
    headerDiv.style.marginBottom = '10px';
    headerDiv.style.paddingBottom = '5px';
    headerDiv.style.borderBottom = '1px solid #e0e0e0';

    const summaryTitle = document.createElement('span');
    summaryTitle.textContent = 'CORE Rank Summary';
    headerDiv.appendChild(summaryTitle);

    
    const betaLabel = document.createElement('span');
    betaLabel.textContent = 'BETA';
    betaLabel.style.marginLeft = '8px';
    betaLabel.style.padding = '1px 6px';
    betaLabel.style.fontSize = '0.75em';
    betaLabel.style.fontWeight = '600';
    betaLabel.style.color = '#fff';
    betaLabel.style.backgroundColor = '#6c757d';
    betaLabel.style.borderRadius = '10px';
    betaLabel.style.verticalAlign = 'middle';
    betaLabel.style.cursor = 'help'; 
    betaLabel.setAttribute('title', 
		"Developed by Naveed Anwar Bhatti.\n" +
		"It is free and open source.\n" +
        "We are currently using CORE2023 rankings only.\n" +
        "Help us spot inconsistencies!\n" +
        "For any issues, please click on “Report Bug”."
    );
    headerDiv.appendChild(betaLabel);

    
    const reportBugLink = document.createElement('a');
    reportBugLink.href = "https://forms.office.com/r/PbSzWaQmpJ";
    reportBugLink.target = "_blank";
    reportBugLink.style.marginLeft = '10px'; 
    reportBugLink.style.textDecoration = 'none';
    reportBugLink.style.color = '#D32F2F';      
    reportBugLink.style.fontSize = '0.75em';    
    reportBugLink.style.fontWeight = 'normal'; 
    reportBugLink.style.verticalAlign = 'middle';
    reportBugLink.textContent = 'Report Bug';
    reportBugLink.setAttribute('title', 'Report a bug or inconsistency (opens new tab)');
    headerDiv.appendChild(reportBugLink);
    // --- END: Header ---

    let content = headerDiv.outerHTML;
    content += '<ul style="list-style: none; padding: 0; margin:0; margin-top: 8px;">';
    for (const rank of ["A*", "A", "B", "C", "N/A"]) {
        const count = rankCounts[rank] || 0;
        let rankDisplay = rank;
        if (VALID_RANKS.includes(rank)) {
            const badgeSpan = document.createElement('span');
            badgeSpan.textContent = rank;
            badgeSpan.style.display = 'inline-block'; badgeSpan.style.padding = '0px 4px';
            badgeSpan.style.marginRight = '8px'; badgeSpan.style.fontSize = '0.9em';
            badgeSpan.style.fontWeight = 'bold'; badgeSpan.style.color = '#000000';
            badgeSpan.style.border = '1px solid #ccc'; badgeSpan.style.borderRadius = '3px';
            badgeSpan.style.minWidth = '25px'; badgeSpan.style.textAlign = 'center';
            switch (rank) {
                case "A*": badgeSpan.style.backgroundColor = '#FFD700'; badgeSpan.style.borderColor = '#B8860B'; break;
                case "A":  badgeSpan.style.backgroundColor = '#90EE90'; badgeSpan.style.borderColor = '#3CB371'; break;
                case "B":  badgeSpan.style.backgroundColor = '#ADFF2F'; badgeSpan.style.borderColor = '#7FFF00'; break;
                case "C":  badgeSpan.style.backgroundColor = '#FFA07A'; badgeSpan.style.borderColor = '#FA8072'; break;
            }
            rankDisplay = badgeSpan.outerHTML;
        } else {
            rankDisplay = `<span style="display:inline-block; width: 30px; font-weight:bold; margin-right: 8px;">${rank}:</span>`;
        }
        content += `<li style="font-size:13px; margin-bottom: 5px; display: flex; align-items: center;">
                      ${rankDisplay}
                      <span style="margin-left: ${VALID_RANKS.includes(rank) ? '0' : '5px'};">${count} papers</span></li>`;
    }
    panel.innerHTML = content + '</ul>';

    if (parentOfStatus && existingStatusElement) {
        parentOfStatus.replaceChild(panel, existingStatusElement);
    } else {
        const gsBdy = document.getElementById('gs_bdy');
        const rightSidebarContainer = gsBdy?.querySelector('div.gsc_rsb');
        if (rightSidebarContainer) {
            const publicAccessElement = rightSidebarContainer.querySelector('#gsc_rsb_mnd');
            const coauthorsElement = rightSidebarContainer.querySelector('#gsc_rsb_co');
            const citedByElement = rightSidebarContainer.querySelector('#gsc_rsb_cit');
            if (publicAccessElement) rightSidebarContainer.insertBefore(panel, publicAccessElement);
            else if (coauthorsElement) rightSidebarContainer.insertBefore(panel, coauthorsElement);
            else if (citedByElement?.nextSibling) rightSidebarContainer.insertBefore(panel, citedByElement.nextSibling);
            else if (citedByElement) citedByElement.parentNode?.appendChild(panel);
            else rightSidebarContainer.prepend(panel);
        } else {
            const profileTableContainer = document.getElementById('gsc_a_c');
            if (profileTableContainer) profileTableContainer.before(panel);
            else document.body.prepend(panel);
        }
    }
}


async function main() {
  console.log("Google Scholar Ranker: main() started.");
  const statusElement = createStatusElement("Initializing Scholar Ranker...");

  const coreData = await loadCoreData();
  if (!coreData || coreData.length === 0) {
    const statusText = statusElement.querySelector('.gsr-status-text') as HTMLElement | null;
    if (statusText) statusText.textContent = "Error loading CORE data. Check console.";
    const progressBarInner = statusElement.querySelector('.gsr-progress-bar-inner') as HTMLElement | null;
    if(progressBarInner) progressBarInner.style.backgroundColor = 'red';
    return;
  }
  console.log(`Loaded ${coreData.length} CORE entries.`);
  (statusElement.querySelector('.gsr-status-text') as HTMLElement).textContent = "Expanding publications...";

  await expandAllPublications(statusElement);

  const publicationLinkElements: { url: string, rowElement: HTMLElement, titleText: string }[] = [];
  document.querySelectorAll('tr.gsc_a_tr').forEach(row => {
    const linkEl = row.querySelector('td.gsc_a_t a.gsc_a_at');
    if (linkEl instanceof HTMLAnchorElement && linkEl.href) {
      publicationLinkElements.push({
        url: linkEl.href,
        rowElement: row as HTMLElement,
        titleText: linkEl.textContent?.toLowerCase() || ""
      });
    }
  });

  if (publicationLinkElements.length === 0) {
    (statusElement.querySelector('.gsr-status-text') as HTMLElement).textContent = "No publications found.";
    return;
  }
  console.log(`Found ${publicationLinkElements.length} total publication links.`);
  updateStatusElement(statusElement, 0, publicationLinkElements.length);

  const rankCounts: Record<string, number> = { "A*": 0, "A": 0, "B": 0, "C": 0, "N/A": 0 };
  let processedCount = 0;

  const CONCURRENCY_LIMIT = 6;

  const processPublication = async (pubInfo: { url: string, rowElement: HTMLElement, titleText: string }): Promise<{ rank: string, rowElement: HTMLElement, error?: any }> => {
    try {
      const venueName = await fetchAndExtractVenueName(pubInfo.url);
      let currentRank = "N/A";
      let ignoreFound = false;
      for (const keyword of IGNORE_KEYWORDS) {
        if (pubInfo.titleText.includes(keyword)) {
          currentRank = "N/A"; ignoreFound = true; break;
        }
      }
      if (!ignoreFound && venueName?.trim()) {
        const lowerVenueName = venueName.toLowerCase();
        for (const keyword of IGNORE_KEYWORDS) {
          if (lowerVenueName.includes(keyword)) {
            currentRank = "N/A"; ignoreFound = true; break;
          }
        }
        if (!ignoreFound) {
          currentRank = findRankForVenue(venueName, coreData);
        }
      } else if (!venueName?.trim() && !ignoreFound) {
        currentRank = "N/A";
      }
      return { rank: currentRank, rowElement: pubInfo.rowElement };
    } catch (error) {
      console.warn(`Error processing publication ${pubInfo.url}:`, error);
      return { rank: "N/A", rowElement: pubInfo.rowElement, error: error };
    }
  };

  for (let i = 0; i < publicationLinkElements.length; i += CONCURRENCY_LIMIT) {
    const chunk = publicationLinkElements.slice(i, i + CONCURRENCY_LIMIT);
    const promises = chunk.map(pubInfo =>
      processPublication(pubInfo).then(result => {
        rankCounts[result.rank]++;
        displayRankBadgeAfterTitle(result.rowElement, result.rank);
        processedCount++;
        updateStatusElement(statusElement, processedCount, publicationLinkElements.length);
        return result;
      })
    );
    await Promise.all(promises);
  }

  console.log("Final Rank Counts:", rankCounts);
  displaySummaryPanel(rankCounts);
}

if (document.getElementById('gsc_a_b') && window.location.pathname.includes("/citations")) {
    setTimeout(() => {
        main().catch(error => {
            console.error("Google Scholar Ranker: Uncaught error in main():", error);
            const statusElem = document.getElementById(STATUS_ELEMENT_ID);
            if (statusElem) {
                const statusText = statusElem.querySelector('.gsr-status-text') as HTMLElement | null;
                if (statusText) statusText.textContent = "An error occurred. Check console.";
                const progressBarInner = statusElem.querySelector('.gsr-progress-bar-inner') as HTMLElement | null;
                if(progressBarInner) progressBarInner.style.backgroundColor = 'red';
            }
        });
    }, 500);
}