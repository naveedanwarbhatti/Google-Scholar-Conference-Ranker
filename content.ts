// scholar-ranker/content.ts

interface CoreEntry {
  title: string;
  acronym: string;
  rank: string;
}

const VALID_RANKS = ["A*", "A", "B", "C"];
const IGNORE_KEYWORDS = ["workshop", "transactions", "journal", "poster", "demo", "abstract", "extended abstract", "doctoral consortium", "doctoral symposium", "computer communication review"];

const STATUS_ELEMENT_ID = 'scholar-ranker-status-progress';
const SUMMARY_PANEL_ID = 'scholar-ranker-summary';

console.log("Google Scholar Ranker: Content script loaded.");

const coreDataCache: Record<string, CoreEntry[]> = {};

// --- START: expandAllPublications function ---
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
      setTimeout(() => { // Fallback timeout
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
// --- END: expandAllPublications function ---


function getCoreDataFileForYear(pubYear: number | null): string { // Changed return type, will always return a string
    if (pubYear === null) {
       
        return 'core/CORE_2023.json'; // Default to newest if year is unknown
    }

    if (pubYear >= 2023) return 'core/CORE_2023.json';
    if (pubYear >= 2021) return 'core/CORE_2021.json'; // Covers 2021-2022
    if (pubYear >= 2020) return 'core/CORE_2020.json'; // Covers 2020
    if (pubYear >= 2018) return 'core/CORE_2018.json'; // Covers 2018-2019
    if (pubYear >= 2017) return 'core/CORE_2017.json'; // Covers 2017
    // For any year 2014, 2015, 2016, or *anything before 2014*
    if (pubYear <= 2016) { // This condition now covers 2014-2016 AND anything before 2014
        return 'core/CORE_2014.json';
    }

    // Fallback for any unexpected scenario (e.g., if a future year isn't explicitly handled above yet,
    // though the >= 2023 condition should catch those).
    // Defaulting to the oldest available (2014) as per your new requirement for pre-2014 years.
    console.warn(`Publication year ${pubYear} did not match specific ranges, defaulting to most recent one.`);
    return 'core/CORE_2023.json';
}

async function loadCoreDataForFile(coreDataFile: string): Promise<CoreEntry[]> {
    if (coreDataCache[coreDataFile]) {
        return coreDataCache[coreDataFile];
    }
    console.log(`Loading CORE data from: ${coreDataFile}`);
    try {
        const url = chrome.runtime.getURL(coreDataFile);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${coreDataFile}: ${response.statusText} (URL: ${url})`);
        const jsonData = await response.json();
        if (!Array.isArray(jsonData)) {
            console.error(`CORE data from ${coreDataFile} is not an array. Data received:`, jsonData);
            return [];
        }
        const parsedData = (jsonData as any[]).map((rawEntry) => {
            const entry: CoreEntry = { title: "", acronym: "", rank: "N/A" };
            let potentialTitleKey = "International Conference on Advanced Communications and Computation";
            let potentialAcronymKey = "INFOCOMP";
            if (coreDataFile.includes('2018') || coreDataFile.includes('2017') || coreDataFile.includes('2014')) {
                potentialTitleKey = "Information Retrieval Facility Conference";
                potentialAcronymKey = "IRFC";
            }
            if (typeof rawEntry[potentialTitleKey] === 'string') entry.title = rawEntry[potentialTitleKey];
            else if (typeof rawEntry.title === 'string') entry.title = rawEntry.title;
            else if (typeof rawEntry.Title === 'string') entry.title = rawEntry.Title;
            if (typeof rawEntry[potentialAcronymKey] === 'string') entry.acronym = rawEntry[potentialAcronymKey];
            else if (typeof rawEntry.acronym === 'string') entry.acronym = rawEntry.acronym;
            else if (typeof rawEntry.Acronym === 'string') entry.acronym = rawEntry.Acronym;
            let foundRank: string | undefined = undefined;
            if (typeof rawEntry.Unranked === 'string') foundRank = rawEntry.Unranked;
            else if (typeof rawEntry.rank === 'string') foundRank = rawEntry.rank;
            else if (typeof rawEntry.CORE_Rating === 'string') foundRank = rawEntry.CORE_Rating;
            else if (typeof rawEntry.Rating === 'string') foundRank = rawEntry.Rating;
            if (foundRank) {
                const upperRank = foundRank.toUpperCase().trim();
                if (VALID_RANKS.includes(upperRank)) entry.rank = upperRank;
            }
            entry.title = String(entry.title || "").trim();
            entry.acronym = String(entry.acronym || "").trim();
            return (entry.title || entry.acronym) ? entry : null;
        }).filter(entry => entry !== null) as CoreEntry[];
        coreDataCache[coreDataFile] = parsedData;
        return parsedData;
    } catch (error) {
        console.error(`Error loading or parsing CORE data from ${coreDataFile}:`, error);
        return [];
    }
}

interface VenueAndYear {
    venueName: string | null;
    publicationYear: number | null;
}

async function fetchVenueAndYear(publicationUrl: string): Promise<VenueAndYear> {
    let venueName: string | null = null;
    let publicationYear: number | null = null;
    try {
        const response = await fetch(publicationUrl);
        if (!response.ok) {
            console.warn(`Failed to fetch ${publicationUrl}: ${response.statusText} (${response.status})`);
            return { venueName, publicationYear };
        }
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const targetLabels = ['journal', 'conference', 'proceedings', 'book title', 'series', 'source', 'publication', 'book'];
        const yearLabel = 'publication date';
        let foundInOci = false;
        const sectionsOci = doc.querySelectorAll('#gsc_oci_table div.gs_scl');
        if (sectionsOci.length > 0) {
            for (const section of sectionsOci) {
                const fieldEl = section.querySelector('div.gsc_oci_field');
                const valueEl = section.querySelector('div.gsc_oci_value');
                if (fieldEl && valueEl) {
                    const label = fieldEl.textContent?.trim().toLowerCase() || '';
                    if (!venueName && targetLabels.includes(label)) {
                        venueName = valueEl.textContent?.trim() || null;
                        foundInOci = true;
                    }
                    if (!publicationYear && label === yearLabel) {
                        const yearText = valueEl.textContent?.trim().split('/')[0];
                        if (yearText && /^\d{4}$/.test(yearText)) {
                            publicationYear = parseInt(yearText, 10);
                        }
                        foundInOci = true;
                    }
                }
                if (venueName && publicationYear) break;
            }
        }
        if (!venueName || !publicationYear || !foundInOci) {
            const rowsVcd = doc.querySelectorAll('#gsc_vcd_table tr');
            for (const row of rowsVcd) {
                const fieldEl = row.querySelector('td.gsc_vcd_field');
                const valueEl = row.querySelector('td.gsc_vcd_value');
                if (fieldEl && valueEl) {
                    const label = fieldEl.textContent?.trim().toLowerCase() || '';
                    if (!venueName && targetLabels.includes(label)) {
                        venueName = valueEl.textContent?.trim() || null;
                    }
                    if (!publicationYear && label === yearLabel) {
                        const yearText = valueEl.textContent?.trim().split('/')[0];
                        if (yearText && /^\d{4}$/.test(yearText)) {
                            publicationYear = parseInt(yearText, 10);
                        }
                    }
                }
                if (venueName && publicationYear) break;
            }
        }
        
    } catch (error) {
        console.error(`Error fetching or parsing ${publicationUrl}:`, error);
    }
    return { venueName, publicationYear };
}

function cleanTextForComparison(text: string, isGoogleScholarVenue: boolean = false): string {
    if (!text) return "";
    let cleanedText = text.toLowerCase();

    // Normalize "&" and "&" to " and "
    cleanedText = cleanedText.replace(/&/g, " and ");
    cleanedText = cleanedText.replace(/&/g, " and ");

    // Remove general punctuation (including parentheses now)
    cleanedText = cleanedText.replace(/[.,\/#!$%\^;\*:{}<>=\-_`~?"“()]/g, " ");

    if (isGoogleScholarVenue) {
        // For Google Scholar venue strings, try to remove leading years or edition numbers
        // Matches: "2010 ", "9th ", "20th " at the beginning of the string
        cleanedText = cleanedText.replace(/^(\d{4}\s+|\d{1,2}(st|nd|rd|th)\s+)/, "");
    }

    // Normalize multiple spaces to a single space and trim
    cleanedText = cleanedText.replace(/\s+/g, ' ');
    return cleanedText.trim();
}

function findRankForVenue(venueName: string, coreData: CoreEntry[]): string {
    const normalizedScholarVenueName = venueName.toLowerCase().trim();
    // console.log(`--- Evaluating GS Venue: "${venueName}" (Normalized: "${normalizedScholarVenueName}") ---`);

    if (!normalizedScholarVenueName) {
        // console.log("GS Venue is empty, returning N/A.");
        return "N/A";
    }

    const specificExclusions: string[] = ["sigcomm computer communication review"];
    for (const exclusion of specificExclusions) {
        if (normalizedScholarVenueName.includes(exclusion)) {
            // console.log(`SPECIFIC EXCLUSION: GS Venue "${venueName}" contains "${exclusion}". Assigning N/A.`);
            return "N/A";
        }
    }

    const extractedScholarAcronyms = extractPotentialAcronymsFromText(venueName);
    if (extractedScholarAcronyms.length > 0) {
        // console.log(`ACRONYM_MATCH_ATTEMPT: Extracted GS Acronyms: [${extractedScholarAcronyms.join(', ')}] for GS Venue: "${venueName}"`);
        for (const scholarAcro of extractedScholarAcronyms) {
            for (const entry of coreData) {
                if (entry.acronym) {
                    const coreAcro = entry.acronym.toLowerCase().trim();
                    if (coreAcro && coreAcro === scholarAcro) {
                        // console.log(`!!! ACRONYM MATCH FOUND !!! GS Acro: "${scholarAcro}" matched CORE Acro: "${coreAcro}" (CORE Title: "${entry.title}", Rank: ${entry.rank})`);
                        return VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A";
                    }
                }
            }
        }
        // console.log(`ACRONYM_MATCH_ATTEMPT: No matching CORE acronym found.`);
    } else {
        // console.log(`ACRONYM_MATCH_ATTEMPT: No acronyms extracted for GS Venue: "${venueName}"`);
    }

    // Pass `true` for isGoogleScholarVenue when cleaning the GS string
    const gsCleanedForSubstring = cleanTextForComparison(normalizedScholarVenueName, true);
    // console.log(`FULL_NAME_MATCH_ATTEMPT: Starting for GS Venue: "${venueName}"`);
    // console.log(`  GS Venue Cleaned for Substring Match: "${gsCleanedForSubstring}"`);

    let bestMatchRank: string | null = null;
    let longestMatchLength = 0;
    let bestMatchingCoreTitleOriginal = "";
    // let bestMatchingCoreTitleProcessed = "";
    // let bestMatchingCoreAcronym = "";

    const orgPrefixesToIgnore = [
        "acm/ieee", "ieee/acm",
        "acm sigplan", "acm sigops", "acm sigbed",
        "acm", "ieee", "sigplan", "sigops", "sigbed", "usenix", "international"
    ];

    for (const entry of coreData) {
        if (entry.title) {
            // Pass `false` (or omit) for CORE titles, we only want to strip org prefixes from them later.
            let coreTitleForMatch = cleanTextForComparison(entry.title, false);
            // const originalCoreTitleCleaned = coreTitleForMatch;

            let strippedSomething;
            // let logStripping = (entry.acronym === "LCTES" || entry.title.toLowerCase().includes("data centric engineering"));
            // if(logStripping) console.log(`  STRIP_DEBUG_CORE_ENTRY: Title: "${entry.title}", Acro: "${entry.acronym}", Initial clean: "${coreTitleForMatch}"`);
            do {
                strippedSomething = false;
                for (const prefix of orgPrefixesToIgnore) {
                    if (coreTitleForMatch.startsWith(prefix + " ") || coreTitleForMatch === prefix) {
                        // const oldCoreTitle = coreTitleForMatch;
                        coreTitleForMatch = coreTitleForMatch.substring(prefix.length).trim();
                        // if(logStripping) console.log(`    Stripped "${prefix}" -> "${coreTitleForMatch}" (from "${oldCoreTitle}")`);
                        strippedSomething = true;
                    }
                }
            } while (strippedSomething && coreTitleForMatch.length > 0);
            coreTitleForMatch = coreTitleForMatch.trim();
            // if(logStripping && originalCoreTitleCleaned !== coreTitleForMatch) console.log(`    Final after stripping: "${coreTitleForMatch}"`);

            if (gsCleanedForSubstring && coreTitleForMatch && coreTitleForMatch.length > 5) {
                if (gsCleanedForSubstring.includes(coreTitleForMatch)) {
                    // console.log(`    POTENTIAL Full name substring match: GS Cleaned: "${gsCleanedForSubstring}", CORE Original: "${entry.title}", CORE Stripped: "${coreTitleForMatch}", Rank: ${entry.rank}`);
                    if (coreTitleForMatch.length > longestMatchLength) {
                        longestMatchLength = coreTitleForMatch.length;
                        bestMatchRank = VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A";
                        bestMatchingCoreTitleOriginal = entry.title;
                        // bestMatchingCoreTitleProcessed = coreTitleForMatch;
                        // bestMatchingCoreAcronym = entry.acronym;
                        // console.log(`      ==> NEW BEST Substring Match: Length ${longestMatchLength}, Rank ${bestMatchRank}, CORE Title: "${entry.title}", CORE Acro: "${entry.acronym}"`);
                    }
                }
            }
        }
    }

    if (bestMatchRank !== null) {
        // console.log(`!!! BEST FULL NAME SUBSTRING MATCH CHOSEN for GS Venue: "${venueName}" !!!`);
        // console.log(`  Matched with CORE Title: "${bestMatchingCoreTitleOriginal}" (Acro: ${bestMatchingCoreAcronym})`);
        // console.log(`  (Processed CORE Title for match: "${bestMatchingCoreTitleProcessed}")`);
        // console.log(`  (GS Venue processed for match: "${gsCleanedForSubstring}")`);
        // console.log(`  Longest matched part length: ${longestMatchLength}, Assigned Rank: ${bestMatchRank}`);
        return bestMatchRank;
    }

    // console.log(`--- NO MATCH FOUND for GS Venue: "${venueName}" (GS Cleaned: "${gsCleanedForSubstring}", GS Acronyms: [${extractedScholarAcronyms.join(', ')}]) ---`);
    return "N/A";
}

function extractPotentialAcronymsFromText(scholarVenueName: string): string[] {
    const acronyms: Set<string> = new Set();
    const originalVenueName = scholarVenueName;
    const parentheticalMatches = originalVenueName.match(/\(([^)]+)\)/g);
    if (parentheticalMatches) {
        parentheticalMatches.forEach(match => {
            const contentInParen = match.slice(1, -1).trim();
            const potentialAcronymsInParen = contentInParen.match(/([A-Z]{2,}[0-9']*\b|[A-Z]+[0-9]+[A-Z0-9]*\b|[A-Z][A-Z0-9]{1,9}\b)/g);
            if (potentialAcronymsInParen) {
                potentialAcronymsInParen.forEach(pAcronym => {
                    let cleanedParenAcronym = pAcronym.replace(/'\d{2,4}$/, '').replace(/'s$/, '');
                    if (cleanedParenAcronym.length >= 2 && cleanedParenAcronym.length <= 12 && !/^\d+$/.test(cleanedParenAcronym) ) {
                         acronyms.add(cleanedParenAcronym.toLowerCase());
                    }
                });
            } else {
                if (contentInParen.length >= 2 && contentInParen.length <= 12 && /^[A-Za-z0-9]+$/.test(contentInParen) && !contentInParen.includes(" ") && !contentInParen.includes("-") && !/^\d+$/.test(contentInParen) && contentInParen.toLowerCase() !== "was" && contentInParen.toLowerCase() !== "formerly") {
                     acronyms.add(contentInParen.toLowerCase());
                }
            }
        });
    }
    let textWithoutParens = originalVenueName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    textWithoutParens = textWithoutParens.replace(/\b(Proceedings\s+of\s+the|Proc\.\s+of\s+the|International\s+Conference\s+on|Intl\.\s+Conf\.\s+on|Conference\s+on|Symposium\s+on|Workshop\s+on|Journal\s+of)\b/gi, ' ').trim();
    const words = textWithoutParens.split(/[\s\-‑\/.,:;&]+/);
    const commonNonAcronyms = new Set(['proc', 'data', 'services','models', 'security', 'time','proceedings', 'journal', 'conference', 'conf', 'symposium', 'symp', 'workshop', 'ws', 'international', 'intl', 'natl', 'national', 'annual', 'vol', 'volume', 'no', 'number', 'pp', 'page', 'pages', 'part', 'edition', 'of', 'the', 'on', 'in', 'and', 'for', 'to', 'at', 'st', 'nd', 'rd', 'th', 'springer', 'elsevier', 'wiley', 'press', 'extended', 'abstract', 'abstracts', 'poster', 'session', 'sessions', 'doctoral', 'companion', 'joint', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'advances', 'systems', 'networks', 'computing', 'applications', 'technology', 'technologies', 'research', 'science', 'sciences', 'engineering', 'management', 'information', 'communication', 'communications', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'transactions', 'letters', 'advances', 'bulletin', 'archive', 'archives', 'series', 'chapter', 'section', 'tutorial', 'tutorials', 'report', 'technical', 'tech', ...(Array.from({length: 75}, (_, i) => (1970 + i).toString()))]);
    words.forEach(word => {
        const cleanWordOriginalCase = word.trim();
        if (cleanWordOriginalCase.length >= 2 && cleanWordOriginalCase.length <= 12 && !/^\d+$/.test(cleanWordOriginalCase)) {
            if ( (!commonNonAcronyms.has(cleanWordOriginalCase.toLowerCase())) && ( /^[A-Z0-9]+$/.test(cleanWordOriginalCase) || /^[A-Z][a-z]+[A-Z]+[A-Za-z0-9]*$/.test(cleanWordOriginalCase))) {
                acronyms.add(cleanWordOriginalCase.toLowerCase());
            }
        }
    });
    if (acronyms.size === 0 && originalVenueName.length >= 2 && originalVenueName.length <= 10 && !originalVenueName.includes(" ") && /^[A-Za-z0-9]+$/.test(originalVenueName) && !/^\d+$/.test(originalVenueName) && !commonNonAcronyms.has(originalVenueName.toLowerCase())) {
        acronyms.add(originalVenueName.toLowerCase());
    }
    return Array.from(acronyms);
}

function displayRankBadgeAfterTitle(rowElement: HTMLElement, rank: string) {
    const titleCell = rowElement.querySelector('td.gsc_a_t');
    if (titleCell) { const oldBadge = titleCell.querySelector('span.gsr-rank-badge-inline'); oldBadge?.remove(); }
    if (!VALID_RANKS.includes(rank)) return;
    const titleLinkElement = rowElement.querySelector('td.gsc_a_t a.gsc_a_at');
    if (!titleLinkElement) return;
    const badge = document.createElement('span');
    badge.classList.add('gsr-rank-badge-inline'); badge.textContent = rank;
    badge.style.display = 'inline-block'; badge.style.padding = '1px 5px'; badge.style.marginLeft = '8px';
    badge.style.fontSize = '0.8em'; badge.style.fontWeight = 'bold'; badge.style.color = '#000000';
    badge.style.border = '1px solid #ccc'; badge.style.borderRadius = '3px';
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
    const container = document.createElement('div'); container.id = STATUS_ELEMENT_ID;
    container.classList.add('gsc_rsb_s', 'gsc_prf_pnl'); container.style.padding = '10px'; container.style.marginBottom = '15px';
    const title = document.createElement('div'); title.textContent = "CORE Rank Processing";
    title.style.fontSize = '14px'; title.style.fontWeight = 'bold'; title.style.color = '#777'; title.style.marginBottom = '8px';
    container.appendChild(title);
    const progressBarOuter = document.createElement('div');
    progressBarOuter.style.width = '100%'; progressBarOuter.style.backgroundColor = '#e0e0e0'; progressBarOuter.style.borderRadius = '4px'; progressBarOuter.style.height = '10px'; progressBarOuter.style.overflow = 'hidden';
    container.appendChild(progressBarOuter);
    const progressBarInner = document.createElement('div'); progressBarInner.classList.add('gsr-progress-bar-inner');
    progressBarInner.style.width = '0%'; progressBarInner.style.height = '100%'; progressBarInner.style.backgroundColor = '#76C7C0'; progressBarInner.style.transition = 'width 0.2s ease-out';
    progressBarOuter.appendChild(progressBarInner);
    const statusText = document.createElement('div'); statusText.classList.add('gsr-status-text'); statusText.textContent = initialMessage;
    statusText.style.marginTop = '5px'; statusText.style.fontSize = '12px'; statusText.style.color = '#555'; statusText.style.textAlign = 'center';
    container.appendChild(statusText);
    const gsBdy = document.getElementById('gs_bdy');
    if (!gsBdy) { document.body.prepend(container); return container; }
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
        if (profileTableContainer) profileTableContainer.before(container); else document.body.prepend(container);
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
    const panel = document.createElement('div'); panel.id = SUMMARY_PANEL_ID;
    panel.classList.add('gsc_rsb_s', 'gsc_prf_pnl'); panel.style.padding = '10px'; panel.style.marginBottom = '15px';
    const headerDiv = document.createElement('div'); headerDiv.style.display = 'flex'; headerDiv.style.alignItems = 'center';
    headerDiv.style.fontSize = '14px'; headerDiv.style.fontWeight = 'bold'; headerDiv.style.color = '#777';
    headerDiv.style.marginBottom = '10px'; headerDiv.style.paddingBottom = '5px'; headerDiv.style.borderBottom = '1px solid #e0e0e0';
    const summaryTitle = document.createElement('span'); summaryTitle.textContent = 'CORE Rank Summary'; headerDiv.appendChild(summaryTitle);
    const betaLabel = document.createElement('span'); betaLabel.textContent = 'BETA';
    betaLabel.style.marginLeft = '8px'; betaLabel.style.padding = '1px 6px'; betaLabel.style.fontSize = '0.75em';
    betaLabel.style.fontWeight = '600'; betaLabel.style.color = '#fff'; betaLabel.style.backgroundColor = '#6c757d';
    betaLabel.style.borderRadius = '10px'; betaLabel.style.verticalAlign = 'middle'; betaLabel.style.cursor = 'help';
    betaLabel.setAttribute('title', "Developed by Naveed Anwar Bhatti.\nIt is free and open source.\nWe are currently using CORE2023 rankings only.\nHelp us spot inconsistencies!\nFor any issues, please click on “Report Bug”.");
    headerDiv.appendChild(betaLabel);
    const reportBugLink = document.createElement('a'); reportBugLink.href = "https://forms.office.com/r/PbSzWaQmpJ"; reportBugLink.target = "_blank";
    reportBugLink.style.marginLeft = '10px'; reportBugLink.style.textDecoration = 'none'; reportBugLink.style.color = '#D32F2F';
    reportBugLink.style.fontSize = '0.75em'; reportBugLink.style.fontWeight = 'normal'; reportBugLink.style.verticalAlign = 'middle';
    reportBugLink.textContent = 'Report Bug'; reportBugLink.setAttribute('title', 'Report a bug or inconsistency (opens new tab)');
    headerDiv.appendChild(reportBugLink);
    let content = headerDiv.outerHTML;
    content += '<ul style="list-style: none; padding: 0; margin:0; margin-top: 8px;">';
    for (const rank of ["A*", "A", "B", "C", "N/A"]) {
        const count = rankCounts[rank] || 0; let rankDisplay = rank;
        if (VALID_RANKS.includes(rank)) {
            const badgeSpan = document.createElement('span'); badgeSpan.textContent = rank;
            badgeSpan.style.display = 'inline-block'; badgeSpan.style.padding = '0px 4px'; badgeSpan.style.marginRight = '8px';
            badgeSpan.style.fontSize = '0.9em'; badgeSpan.style.fontWeight = 'bold'; badgeSpan.style.color = '#000000';
            badgeSpan.style.border = '1px solid #ccc'; badgeSpan.style.borderRadius = '3px'; badgeSpan.style.minWidth = '25px'; badgeSpan.style.textAlign = 'center';
            switch (rank) {
                case "A*": badgeSpan.style.backgroundColor = '#FFD700'; badgeSpan.style.borderColor = '#B8860B'; break;
                case "A":  badgeSpan.style.backgroundColor = '#90EE90'; badgeSpan.style.borderColor = '#3CB371'; break;
                case "B":  badgeSpan.style.backgroundColor = '#ADFF2F'; badgeSpan.style.borderColor = '#7FFF00'; break;
                case "C":  badgeSpan.style.backgroundColor = '#FFA07A'; badgeSpan.style.borderColor = '#FA8072'; break;
            }
            rankDisplay = badgeSpan.outerHTML;
        } else { rankDisplay = `<span style="display:inline-block; width: 30px; font-weight:bold; margin-right: 8px;">${rank}:</span>`; }
        content += `<li style="font-size:13px; margin-bottom: 5px; display: flex; align-items: center;">${rankDisplay}<span style="margin-left: ${VALID_RANKS.includes(rank) ? '0' : '5px'};">${count} papers</span></li>`;
    }
    panel.innerHTML = content + '</ul>';
    if (parentOfStatus && existingStatusElement) { parentOfStatus.replaceChild(panel, existingStatusElement); }
    else {
        const gsBdy = document.getElementById('gs_bdy'); const rightSidebarContainer = gsBdy?.querySelector('div.gsc_rsb');
        if (rightSidebarContainer) {
            const publicAccessElement = rightSidebarContainer.querySelector('#gsc_rsb_mnd'); const coauthorsElement = rightSidebarContainer.querySelector('#gsc_rsb_co');
            const citedByElement = rightSidebarContainer.querySelector('#gsc_rsb_cit');
            if (publicAccessElement) rightSidebarContainer.insertBefore(panel, publicAccessElement);
            else if (coauthorsElement) rightSidebarContainer.insertBefore(panel, coauthorsElement);
            else if (citedByElement?.nextSibling) rightSidebarContainer.insertBefore(panel, citedByElement.nextSibling);
            else if (citedByElement) citedByElement.parentNode?.appendChild(panel);
            else rightSidebarContainer.prepend(panel);
        } else {
            const profileTableContainer = document.getElementById('gsc_a_c');
            if (profileTableContainer) profileTableContainer.before(panel); else document.body.prepend(panel);
        }
    }
}

async function main() {
  console.log("Google Scholar Ranker: main() started.");
  const statusElement = createStatusElement("Initializing Scholar Ranker...");

  (statusElement.querySelector('.gsr-status-text') as HTMLElement).textContent = "Expanding publications...";
  await expandAllPublications(statusElement); // Function definition needs to be present

  const publicationLinkElements: { url: string, rowElement: HTMLElement, titleText: string, yearFromProfile: number | null }[] = [];
  document.querySelectorAll('tr.gsc_a_tr').forEach(row => {
    const linkEl = row.querySelector('td.gsc_a_t a.gsc_a_at');
    const yearEl = row.querySelector('td.gsc_a_y span.gsc_a_h');
    let yearFromProfile: number | null = null;
    if (yearEl?.textContent && /^\d{4}$/.test(yearEl.textContent.trim())) {
        yearFromProfile = parseInt(yearEl.textContent.trim(), 10);
    }
    if (linkEl instanceof HTMLAnchorElement && linkEl.href) {
      publicationLinkElements.push({
        url: linkEl.href,
        rowElement: row as HTMLElement,
        titleText: linkEl.textContent?.toLowerCase() || "",
        yearFromProfile: yearFromProfile
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
  const CONCURRENCY_LIMIT = 5;

  const processPublication = async (pubInfo: { url: string, rowElement: HTMLElement, titleText: string, yearFromProfile: number | null }): Promise<{ rank: string, rowElement: HTMLElement }> => {
    try {
      const { venueName, publicationYear: yearFromDetail } = await fetchVenueAndYear(pubInfo.url);
      const effectiveYear = yearFromDetail !== null ? yearFromDetail : pubInfo.yearFromProfile;
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
          const coreDataFile = getCoreDataFileForYear(effectiveYear);
          if (coreDataFile) {
            const yearSpecificCoreData = await loadCoreDataForFile(coreDataFile);
            if (yearSpecificCoreData.length > 0) {
              currentRank = findRankForVenue(venueName, yearSpecificCoreData);
            } else {
              console.warn(`No CORE data loaded or available for file: ${coreDataFile} (Year: ${effectiveYear})`);
            }
          } else {
            console.warn(`No CORE data file determined for publication year: ${effectiveYear}`);
          }
        }
      } else if (!venueName?.trim() && !ignoreFound) {
        currentRank = "N/A";
      }
      return { rank: currentRank, rowElement: pubInfo.rowElement };
    } catch (error) {
      console.warn(`Error processing publication ${pubInfo.url}:`, error);
      return { rank: "N/A", rowElement: pubInfo.rowElement };
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