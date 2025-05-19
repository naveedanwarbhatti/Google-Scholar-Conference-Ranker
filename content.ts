// scholar-ranker/content.ts

interface CoreEntry {
  title: string;
  acronym: string;
  rank: string;
}

// For caching individual publication ranks
interface PublicationRankInfo {
    titleText: string; // Normalized title from the link element on the profile page
    rank: string;
}

interface CachedProfileData {
    rankCounts: Record<string, number>;
    publicationRanks: PublicationRankInfo[]; // Stores ranks for individual publications
    timestamp: number; // Unix timestamp in milliseconds
}

const VALID_RANKS = ["A*", "A", "B", "C"];
const IGNORE_KEYWORDS = [
  "workshop", "transactions", "journal", "poster", "demo", "abstract",
  "extended abstract", "doctoral consortium", "doctoral symposium",
  "computer communication review", "companion", "adjunct", "technical report",
  "tech report", "industry track", "tutorial notes", "working notes"
];

const STATUS_ELEMENT_ID = 'scholar-ranker-status-progress';
const SUMMARY_PANEL_ID = 'scholar-ranker-summary';
const CACHE_PREFIX = 'scholarRanker_profile_';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

console.log("Google Scholar Ranker: Content script loaded (vOptionA_DynamicRestore_Final).");

const coreDataCache: Record<string, CoreEntry[]> = {};
let isMainProcessing = false;

// --- START: Globals for Option A dynamic restore ---
let activeCachedPublicationRanks: PublicationRankInfo[] | null = null;
let publicationTableObserver: MutationObserver | null = null;
let rankMapForObserver: Map<string, string> | null = null;
// --- END: Globals ---


// --- START: Caching Helper Functions ---
function getScholarUserId(): string | null {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user');
    // console.log("DEBUG: getScholarUserId() returned:", userId);
    return userId;
}

function getCacheKey(userId: string): string {
    return `${CACHE_PREFIX}${userId}`;
}

async function loadCachedData(userId: string): Promise<CachedProfileData | null> {
    const cacheKey = getCacheKey(userId);
    // console.log("DEBUG: loadCachedData - Attempting for key:", cacheKey);
    try {
        const result = await chrome.storage.local.get(cacheKey);
        if (chrome.runtime.lastError) {
            console.error("DEBUG: loadCachedData - chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
        if (result && result[cacheKey]) {
            const data = result[cacheKey] as CachedProfileData;
            const timeSinceCache = Date.now() - data.timestamp;
            if (timeSinceCache < CACHE_DURATION_MS) {
                if (Array.isArray(data.publicationRanks) && typeof data.rankCounts === 'object') {
                    // console.log("DEBUG: loadCachedData - Cache is FRESH for user", userId);
                    return data;
                } else {
                    console.warn("DEBUG: loadCachedData - Cached data structure invalid. Removing.");
                    await chrome.storage.local.remove(cacheKey);
                }
            } else {
                // console.log("DEBUG: loadCachedData - Cache STALE for user", userId);
                await chrome.storage.local.remove(cacheKey);
            }
        }
    } catch (error) {
        console.error("DEBUG: loadCachedData - Error:", error, "Key:", cacheKey);
    }
    return null;
}

async function saveCachedData(userId: string, rankCounts: Record<string, number>, publicationRanks: PublicationRankInfo[]): Promise<void> {
    const cacheKey = getCacheKey(userId);
    const dataToStore: CachedProfileData = {
        rankCounts,
        publicationRanks,
        timestamp: Date.now()
    };
    // console.log("DEBUG: saveCachedData - Attempting for key:", cacheKey, "Data points:", publicationRanks.length);
    try {
        await chrome.storage.local.set({ [cacheKey]: dataToStore });
        // console.log("DEBUG: saveCachedData - Success for user", userId);
        if (chrome.runtime.lastError) {
            console.error("DEBUG: saveCachedData - chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
    } catch (error) {
        console.error("DEBUG: saveCachedData - Error:", error, "Key:", cacheKey);
    }
}

async function clearCachedData(userId: string): Promise<void> {
    const cacheKey = getCacheKey(userId);
    // console.log("DEBUG: clearCachedData - Attempting for key:", cacheKey);
    try {
        await chrome.storage.local.remove(cacheKey);
        activeCachedPublicationRanks = null;
        rankMapForObserver = null;
        disconnectPublicationTableObserver();
        if (chrome.runtime.lastError) {
            console.error("DEBUG: clearCachedData - chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
    } catch (error) {
        console.error("DEBUG: clearCachedData - Error:", error, "Key:", cacheKey);
    }
}
// --- END: Caching Helper Functions ---


// --- START: expandAllPublications function ---
async function expandAllPublications(statusElement: HTMLElement): Promise<void> {
  // console.log("Google Scholar Ranker: Attempting to expand all publications...");
  const showMoreButtonId = 'gsc_bpf_more';
  const publicationsTableBodySelector = '#gsc_a_b';
  let attempts = 0;
  const maxAttempts = 30;
  const statusTextElement = statusElement.querySelector('.gsr-status-text') as HTMLElement | null;
  while (attempts < maxAttempts) {
    const showMoreButton = document.getElementById(showMoreButtonId) as HTMLButtonElement | null;
    if (!showMoreButton || showMoreButton.disabled) {
      if (statusTextElement && (statusTextElement.textContent||"").includes("Expanding")) { // Only update if it was expanding
         statusTextElement.textContent = "All publications loaded.";
      }
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
            if (newRows.length > 0) { obs.disconnect(); resolve(); return; }
          }
        }
      });
      observer.observe(tableBody, { childList: true, subtree: false });
      showMoreButton.click();
      setTimeout(() => { observer.disconnect(); resolve(); }, 5000);
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


// --- START: CORE Data, Venue Fetching, Cleaning, Matching ---
function getCoreDataFileForYear(pubYear: number | null): string {
    if (pubYear === null) { return 'core/CORE_2023.json'; }
    if (pubYear >= 2023) return 'core/CORE_2023.json';
    if (pubYear >= 2021) return 'core/CORE_2021.json';
    if (pubYear >= 2020) return 'core/CORE_2020.json';
    if (pubYear >= 2018) return 'core/CORE_2018.json';
    if (pubYear >= 2017) return 'core/CORE_2017.json';
    if (pubYear <= 2016) { return 'core/CORE_2014.json'; }
    // console.warn(`Publication year ${pubYear} did not match specific ranges, defaulting to most recent one.`);
    return 'core/CORE_2023.json';
}

function generateAcronymFromTitle(title: string): string {
    if (!title) return "";
    const words = title.split(/[\s\-‑\/.,:;&]+/); let acronym = "";
    for (const word of words) {
        if (word.length > 0 && word[0] === word[0].toUpperCase() && /^[A-Za-z]/.test(word[0])) { acronym += word[0]; }
        if (acronym.length >= 8) break;
    } return acronym.toUpperCase();
}

async function loadCoreDataForFile(coreDataFile: string): Promise<CoreEntry[]> {
    if (coreDataCache[coreDataFile]) { return coreDataCache[coreDataFile]; }
    // console.log(`Loading CORE data from: ${coreDataFile}`);
    try {
        const url = chrome.runtime.getURL(coreDataFile);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${coreDataFile}: ${response.statusText} (URL: ${url})`);
        const jsonData = await response.json();
        if (!Array.isArray(jsonData)) { console.error(`CORE data from ${coreDataFile} is not an array.`, jsonData); return []; }
        const parsedData = (jsonData as any[]).map((rawEntry) => {
            const entry: CoreEntry = { title: "", acronym: "", rank: "N/A" };
            let pTitleKey = "International Conference on Advanced Communications and Computation", pAcroKey = "INFOCOMP";
            if (coreDataFile.includes('2018') || coreDataFile.includes('2017') || coreDataFile.includes('2014')) {
                pTitleKey = "Information Retrieval Facility Conference"; pAcroKey = "IRFC";
            }
            if (typeof rawEntry[pTitleKey] === 'string') entry.title = rawEntry[pTitleKey];
            else if (typeof rawEntry.title === 'string') entry.title = rawEntry.title;
            else if (typeof rawEntry.Title === 'string') entry.title = rawEntry.Title;
            if (typeof rawEntry[pAcroKey] === 'string') entry.acronym = rawEntry[pAcroKey];
            else if (typeof rawEntry.acronym === 'string') entry.acronym = rawEntry.acronym;
            else if (typeof rawEntry.Acronym === 'string') entry.acronym = rawEntry.Acronym;
            let fRank: string | undefined;
            if (typeof rawEntry.Unranked === 'string') fRank = rawEntry.Unranked;
            else if (typeof rawEntry.rank === 'string') fRank = rawEntry.rank;
            else if (typeof rawEntry.CORE_Rating === 'string') fRank = rawEntry.CORE_Rating;
            else if (typeof rawEntry.Rating === 'string') fRank = rawEntry.Rating;
            if (fRank) { const uRank = fRank.toUpperCase().trim(); if (VALID_RANKS.includes(uRank)) entry.rank = uRank; }
            entry.title = String(entry.title || "").trim(); entry.acronym = String(entry.acronym || "").trim();
            if (!entry.acronym && entry.title) { const genAcro = generateAcronymFromTitle(entry.title); if (genAcro.length >= 2) entry.acronym = genAcro; }
            return (entry.title || entry.acronym) ? entry : null;
        }).filter(entry => entry !== null) as CoreEntry[];
        coreDataCache[coreDataFile] = parsedData; return parsedData;
    } catch (error) { console.error(`Error loading/parsing CORE data from ${coreDataFile}:`, error); return []; }
}

interface VenueAndYear { venueName: string | null; publicationYear: number | null; }

async function fetchVenueAndYear(publicationUrl: string): Promise<VenueAndYear> {
    let venueName: string | null = null, publicationYear: number | null = null;
    try {
        const response = await fetch(publicationUrl);
        if (!response.ok) { /* console.warn(`Failed to fetch ${publicationUrl}: ${response.statusText}`); */ return { venueName, publicationYear }; }
        const htmlText = await response.text(); const parser = new DOMParser(); const doc = parser.parseFromString(htmlText, 'text/html');
        const targetLabels = ['journal', 'conference', 'proceedings', 'book title', 'series', 'source', 'publication', 'book'], yearLabel = 'publication date';
        let foundInOci = false;
        const sectionsOci = doc.querySelectorAll('#gsc_oci_table div.gs_scl');
        if (sectionsOci.length > 0) {
            for (const section of sectionsOci) {
                const fieldEl = section.querySelector('div.gsc_oci_field'), valueEl = section.querySelector('div.gsc_oci_value');
                if (fieldEl && valueEl) {
                    const label = fieldEl.textContent?.trim().toLowerCase() || '';
                    if (!venueName && targetLabels.includes(label)) { venueName = valueEl.textContent?.trim() || null; foundInOci = true; }
                    if (!publicationYear && label === yearLabel) { const yT = valueEl.textContent?.trim().split('/')[0]; if (yT && /^\d{4}$/.test(yT)) publicationYear = parseInt(yT, 10); foundInOci = true; }
                } if (venueName && publicationYear) break;
            }
        }
        if (!venueName || !publicationYear || !foundInOci) {
            const rowsVcd = doc.querySelectorAll('#gsc_vcd_table tr');
            for (const row of rowsVcd) {
                const fieldEl = row.querySelector('td.gsc_vcd_field'), valueEl = row.querySelector('td.gsc_vcd_value');
                if (fieldEl && valueEl) {
                    const label = fieldEl.textContent?.trim().toLowerCase() || '';
                    if (!venueName && targetLabels.includes(label)) venueName = valueEl.textContent?.trim() || null;
                    if (!publicationYear && label === yearLabel) { const yT = valueEl.textContent?.trim().split('/')[0]; if (yT && /^\d{4}$/.test(yT)) publicationYear = parseInt(yT, 10); }
                } if (venueName && publicationYear) break;
            }
        }
    } catch (error) { console.error(`Error fetching/parsing ${publicationUrl}:`, error); }
    return { venueName, publicationYear };
}

const COMMON_ABBREVIATIONS: Record<string, string> = { "int'l": "international", "intl": "international", "conf\\.": "conference", "conf": "conference", "proc\\.": "proceedings", "proc": "proceedings", "symp\\.": "symposium", "symp": "symposium", "j\\.": "journal", "jour": "journal", "trans\\.": "transactions", "trans": "transactions", "annu\\.": "annual", "comput\\.": "computing", "commun\\.": "communications", "syst\\.": "systems", "sci\\.": "science", "tech\\.": "technical", "technol": "technology", "engin\\.": "engineering", "res\\.": "research", "adv\\.": "advances", "appl\\.": "applications", "lectures notes": "lecture notes", "lect notes": "lecture notes", "lncs": "lecture notes in computer science", };

function cleanTextForComparison(text: string, isGoogleScholarVenue: boolean = false): string {
    if (!text) return ""; let cleanedText = text.toLowerCase();
    for (const [abbr, expansion] of Object.entries(COMMON_ABBREVIATIONS)) { const regex = new RegExp(`\\b${abbr.replace('.', '\\.')}\\b`, 'gi'); cleanedText = cleanedText.replace(regex, expansion); }
    cleanedText = cleanedText.replace(/&/g, " and "); cleanedText = cleanedText.replace(/&/g, " and ");
    cleanedText = cleanedText.replace(/[\.,\/#!$%\^;\*:{}=\_`~?"“”()\[\]]/g, " "); cleanedText = cleanedText.replace(/\s-\s/g, " ");
    if (isGoogleScholarVenue) { cleanedText = cleanedText.replace(/^(\d{4}\s+|\d{1,2}(st|nd|rd|th)\s+)/, ""); cleanedText = cleanedText.replace(/,\s*\d{4}$/, ""); cleanedText = cleanedText.replace(/\(\d{4}\)$/, ""); }
    cleanedText = cleanedText.replace(/\s+/g, ' '); return cleanedText.trim();
}

const FUZZY_THRESHOLD = 0.90;

function jaroWinkler(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const m = (a: string, b: string) => {
    const bound = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    const match = new Array(a.length).fill(false), bMatch = new Array(b.length).fill(false); let matches = 0;
    for (let i = 0; i < a.length; i++) { const lo = Math.max(0, i - bound), hi = Math.min(i + bound + 1, b.length); for (let j = lo; j < hi; j++) if (!bMatch[j] && a[i] === b[j]) { match[i] = bMatch[j] = true; matches++; break; } }
    if (!matches) return {matches: 0, trans: 0}; let k = 0, trans = 0;
    for (let i = 0; i < a.length; i++) if (match[i]) { while (!bMatch[k]) k++; if (a[i] !== b[k]) trans++; k++; } return {matches, trans: trans / 2};
  };
  const {matches, trans} = m(s1, s2); if (!matches) return 0;
  const j = (matches / s1.length + matches / s2.length + (matches - trans) / matches) / 3;
  const l = Math.min(4, [...s1].findIndex((c, i) => c !== s2[i] || i >= s2.length)); return j + l * 0.1 * (1 - j);
}

const ORG_PREFIXES_TO_IGNORE = [ "acm/ieee", "ieee/acm", "acm-ieee", "ieee-acm", "acm sigplan", "acm sigops", "acm sigbed", "acm sigcomm", "acm sigmod", "acm sigarch", "acm sigsac", "acm", "ieee", "ifip", "usenix", "eurographics", "springer", "elsevier", "wiley", "sigplan", "sigops", "sigbed", "sigcomm", "sigmod", "sigarch", "sigsac", "international", "national", "annual" ];

function stripOrgPrefixes(text: string): string {
    let currentText = text; let strippedSomething;
    do { strippedSomething = false; for (const prefix of ORG_PREFIXES_TO_IGNORE) { if (currentText.startsWith(prefix + " ") || currentText === prefix) { currentText = currentText.substring(prefix.length).trim(); strippedSomething = true; } } } while (strippedSomething && currentText.length > 0);
    return currentText;
}

function findRankForVenue(venueName: string, coreData: CoreEntry[]): string {
    const scholarVenueLower = venueName.toLowerCase().trim(); if (!scholarVenueLower) return "N/A";
    const specificExclusions: string[] = ["sigcomm computer communication review"]; for (const exclusion of specificExclusions) { if (scholarVenueLower.includes(exclusion)) return "N/A"; }
    const extractedScholarAcronyms = extractPotentialAcronymsFromText(venueName);
    if (extractedScholarAcronyms.length > 0) { for (const scholarAcro of extractedScholarAcronyms) { for (const entry of coreData) { if (entry.acronym) { const coreAcro = entry.acronym.toLowerCase().trim(); if (coreAcro && coreAcro === scholarAcro) return VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A"; } } } }
    const gsCleanedForTitleMatch = cleanTextForComparison(scholarVenueLower, true); if (!gsCleanedForTitleMatch) return "N/A";
    let bestSubstringMatchRank: string | null = null, longestMatchLength = 0;
    for (const entry of coreData) { if (entry.title) { let coreTitleCleaned = cleanTextForComparison(entry.title, false); coreTitleCleaned = stripOrgPrefixes(coreTitleCleaned); if (gsCleanedForTitleMatch && coreTitleCleaned && coreTitleCleaned.length > 5) { if (gsCleanedForTitleMatch.includes(coreTitleCleaned)) { if (coreTitleCleaned.length > longestMatchLength) { longestMatchLength = coreTitleCleaned.length; bestSubstringMatchRank = VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A"; } } } } }
    if (bestSubstringMatchRank !== null) return bestSubstringMatchRank;
    let bestFuzzyScore = 0, bestFuzzyRank: string | null = null;
    for (const entry of coreData) { if (!entry.title) continue; let coreTitleCleanedForFuzzy = cleanTextForComparison(entry.title, false); coreTitleCleanedForFuzzy = stripOrgPrefixes(coreTitleCleanedForFuzzy); if (coreTitleCleanedForFuzzy.length < 6 || gsCleanedForTitleMatch.length < 6) continue; const score = jaroWinkler(gsCleanedForTitleMatch, coreTitleCleanedForFuzzy); if (score >= FUZZY_THRESHOLD && score > bestFuzzyScore) { bestFuzzyScore = score; bestFuzzyRank = VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A"; if (score === 1.0) break; } }
    if (bestFuzzyRank !== null) return bestFuzzyRank;
    return "N/A";
}

function extractPotentialAcronymsFromText(scholarVenueName: string): string[] {
    const acronyms: Set<string> = new Set(); const originalVenueName = scholarVenueName;
    const parentheticalMatches = originalVenueName.match(/\(([^)]+)\)/g);
    if (parentheticalMatches) { parentheticalMatches.forEach(match => { const contentInParen = match.slice(1, -1).trim(); const potentialAcronymsInParen = contentInParen.match(/([A-Z]{2,}[0-9']*\b|[A-Z]+[0-9]+[A-Z0-9]*\b|[A-Z][a-zA-Z0-9]{1,9}\b)/g); if (potentialAcronymsInParen) { potentialAcronymsInParen.forEach(pAcronym => { let cleanedParenAcronym = pAcronym.replace(/'\d{2,4}$/, '').replace(/'s$/, ''); if (cleanedParenAcronym.length >= 2 && cleanedParenAcronym.length <= 12 && !/^\d+$/.test(cleanedParenAcronym) && !IGNORE_KEYWORDS.includes(cleanedParenAcronym.toLowerCase()) && cleanedParenAcronym.toLowerCase() !== "was" && cleanedParenAcronym.toLowerCase() !== "formerly") { acronyms.add(cleanedParenAcronym.toLowerCase()); } }); } else { if (contentInParen.length >= 2 && contentInParen.length <= 12 && /^[A-Za-z0-9]+$/.test(contentInParen) && !contentInParen.includes(" ") && !contentInParen.includes("-") && !/^\d+$/.test(contentInParen) && !IGNORE_KEYWORDS.includes(contentInParen.toLowerCase()) && contentInParen.toLowerCase() !== "was" && contentInParen.toLowerCase() !== "formerly") { acronyms.add(contentInParen.toLowerCase()); } } }); }
    let textWithoutParens = originalVenueName.replace(/\s*\([^)]*\)\s*/g, ' ').trim(); textWithoutParens = textWithoutParens.replace(/\b(Proceedings\s+of\s+(the)?|Proc\.\s+of\s+(the)?|International\s+Conference\s+on|Intl\.\s+Conf\.\s+on|Conference\s+on|Symposium\s+on|Workshop\s+on|Journal\s+of)\b/gi, ' ').trim();
    const words = textWithoutParens.split(/[\s\-‑\/.,:;&]+/); const commonNonAcronymWords = new Set([...IGNORE_KEYWORDS, 'proc', 'data', 'services','models', 'security', 'time','proceedings', 'journal', 'conference', 'conf', 'symposium', 'symp', 'workshop', 'ws', 'international', 'intl', 'natl', 'national', 'annual', 'vol', 'volume', 'no', 'number', 'pp', 'page', 'pages', 'part', 'edition', 'of', 'the', 'on', 'in', 'and', 'for', 'to', 'at', 'st', 'nd', 'rd', 'th', 'springer', 'elsevier', 'wiley', 'press', 'extended', 'abstracts', 'poster', 'session', 'sessions', 'doctoral', 'companion', 'joint', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'advances', 'systems', 'networks', 'computing', 'applications', 'technology', 'technologies', 'research', 'science', 'sciences', 'engineering', 'management', 'information', 'communication', 'communications', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'letters', 'bulletin', 'archive', 'archives', 'series', 'chapter', 'section', 'tutorial', 'tutorials', 'report', 'technical', 'tech', ...(Array.from({length: 75}, (_, i) => (1970 + i).toString()))]);
    words.forEach(word => { const cleanWordOriginalCase = word.trim(); if (cleanWordOriginalCase.length >= 2 && cleanWordOriginalCase.length <= 12 && !/^\d+$/.test(cleanWordOriginalCase)) { if ((!commonNonAcronymWords.has(cleanWordOriginalCase.toLowerCase())) && ( /^[A-Z0-9]+$/.test(cleanWordOriginalCase) || /^[A-Z][a-z]+[A-Z]+[A-Za-z0-9]*$/.test(cleanWordOriginalCase))) { acronyms.add(cleanWordOriginalCase.toLowerCase()); } } });
    if (acronyms.size === 0 && originalVenueName.length >= 2 && originalVenueName.length <= 10 && !originalVenueName.includes(" ") && /^[A-Za-z0-9]+$/.test(originalVenueName) && !/^\d+$/.test(originalVenueName) && !commonNonAcronymWords.has(originalVenueName.toLowerCase())) { acronyms.add(originalVenueName.toLowerCase()); }
    return Array.from(acronyms);
}
// --- END: CORE Data, Venue Fetching, Cleaning, Matching ---


// --- START: UI Functions ---
function displayRankBadgeAfterTitle(rowElement: HTMLElement, rank: string) {
    const titleCell = rowElement.querySelector('td.gsc_a_t');
    if (titleCell) { const oldBadge = titleCell.querySelector('span.gsr-rank-badge-inline'); oldBadge?.remove(); }
    if (!VALID_RANKS.includes(rank)) return;
    const titleLinkElement = rowElement.querySelector('td.gsc_a_t a.gsc_a_at');
    if (!titleLinkElement) return;
    const badge = document.createElement('span'); badge.classList.add('gsr-rank-badge-inline'); badge.textContent = rank;
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
    disconnectPublicationTableObserver();
    activeCachedPublicationRanks = null;
    rankMapForObserver = null;
    document.getElementById(SUMMARY_PANEL_ID)?.remove(); document.getElementById(STATUS_ELEMENT_ID)?.remove();
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
    } else { const profileTableContainer = document.getElementById('gsc_a_c'); if (profileTableContainer) profileTableContainer.before(container); else document.body.prepend(container); }
    return container;
}

function updateStatusElement(statusContainer: HTMLElement, processed: number, total: number) {
    const progressBarInner = statusContainer.querySelector('.gsr-progress-bar-inner') as HTMLElement | null;
    const statusText = statusContainer.querySelector('.gsr-status-text') as HTMLElement | null;
    const percentage = total > 0 ? (processed / total) * 100 : 0;
    if (progressBarInner) progressBarInner.style.width = `${percentage}%`;
    if (statusText) statusText.textContent = `Processing ${processed} / ${total}...`;
}

function displaySummaryPanel(rankCounts: Record<string, number>, currentUserId: string | null, initialCachedPubRanks?: PublicationRankInfo[]) {
    document.getElementById(STATUS_ELEMENT_ID)?.remove();
    document.getElementById(SUMMARY_PANEL_ID)?.remove();
    disconnectPublicationTableObserver();

    const panel = document.createElement('div');
    panel.id = SUMMARY_PANEL_ID;
    panel.classList.add('gsc_rsb_s', 'gsc_prf_pnl');
    panel.style.padding = '10px'; panel.style.marginBottom = '15px';

    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex'; headerDiv.style.alignItems = 'center';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.fontSize = '14px'; headerDiv.style.fontWeight = 'bold'; headerDiv.style.color = '#777';
    headerDiv.style.marginBottom = '10px'; headerDiv.style.paddingBottom = '5px'; headerDiv.style.borderBottom = '1px solid #e0e0e0';

    const summaryTitle = document.createElement('span');
    summaryTitle.textContent = 'CORE Rank Summary';
    headerDiv.appendChild(summaryTitle);

    if (currentUserId) {
        const refreshButton = document.createElement('button');
        refreshButton.textContent = 'Refresh Ranks';
        refreshButton.style.marginLeft = 'auto'; refreshButton.style.padding = '2px 8px';
        refreshButton.style.fontSize = '0.7em'; refreshButton.style.fontWeight = '600';
        refreshButton.style.color = '#006400'; refreshButton.style.backgroundColor = '#90EE90';
        refreshButton.style.border = '1px solid #77dd77'; refreshButton.style.borderRadius = '10px';
        refreshButton.style.lineHeight = '1.4'; refreshButton.style.height = 'fit-content';
        refreshButton.style.display = 'inline-flex'; refreshButton.style.alignItems = 'center';
        refreshButton.style.cursor = 'pointer'; refreshButton.setAttribute('title', 'Recalculate CORE ranks');
        refreshButton.onmouseenter = () => { refreshButton.style.backgroundColor = '#7CFC00'; refreshButton.style.borderColor = '#006400'; };
        refreshButton.onmouseleave = () => { refreshButton.style.backgroundColor = '#90EE90'; refreshButton.style.borderColor = '#77dd77'; };
        refreshButton.onclick = async () => {
            if (isMainProcessing) return;
            disconnectPublicationTableObserver();
            activeCachedPublicationRanks = null;
            rankMapForObserver = null;
            await clearCachedData(currentUserId);
            main().catch(error => {
                 console.error("DEBUG: Error during refresh:", error);
                 const statusElem = createStatusElement("Error during refresh. Check console.");
                 if(statusElem.querySelector('.gsr-progress-bar-inner')) (statusElem.querySelector('.gsr-progress-bar-inner') as HTMLElement).style.backgroundColor = 'red';
            });
        };
        headerDiv.appendChild(refreshButton);
    }
    panel.appendChild(headerDiv);

    const list = document.createElement('ul');
    list.style.listStyle = 'none'; list.style.padding = '0'; list.style.margin = '8px 0 0 0';
    const ranksForChart = ["A*", "A", "B", "C"];
    let maxCountForScale = 10;
    ranksForChart.forEach(rank => { if ((rankCounts[rank] || 0) > maxCountForScale) maxCountForScale = rankCounts[rank] || 0; });
    if (maxCountForScale < 10) maxCountForScale = 10;
    else if (maxCountForScale > 10 && maxCountForScale < 15) maxCountForScale = Math.ceil(maxCountForScale / 5) * 5;
    const barChartColor = '#76C7C0'; const barHeight = '18px';
    for (const rank of ["A*", "A", "B", "C", "N/A"]) {
        const count = rankCounts[rank] || 0;
        const listItem = document.createElement('li');
        listItem.style.fontSize = '13px'; listItem.style.marginBottom = '6px';
        listItem.style.display = 'flex'; listItem.style.alignItems = 'center';
        const rankLabelSpan = document.createElement('span');
        rankLabelSpan.style.display = 'inline-block'; rankLabelSpan.style.fontWeight = 'bold';
        rankLabelSpan.style.marginRight = '8px'; rankLabelSpan.style.width = '35px';
        if (VALID_RANKS.includes(rank)) {
            rankLabelSpan.textContent = rank;
            rankLabelSpan.style.padding = '1px 4px'; rankLabelSpan.style.fontSize = '0.9em';
            rankLabelSpan.style.color = '#000000'; rankLabelSpan.style.border = '1px solid #ccc';
            rankLabelSpan.style.borderRadius = '3px'; rankLabelSpan.style.textAlign = 'center';
            switch (rank) {
                case "A*": rankLabelSpan.style.backgroundColor = '#FFD700'; rankLabelSpan.style.borderColor = '#B8860B'; break;
                case "A":  rankLabelSpan.style.backgroundColor = '#90EE90'; rankLabelSpan.style.borderColor = '#3CB371'; break;
                case "B":  rankLabelSpan.style.backgroundColor = '#ADFF2F'; rankLabelSpan.style.borderColor = '#7FFF00'; break;
                case "C":  rankLabelSpan.style.backgroundColor = '#FFA07A'; rankLabelSpan.style.borderColor = '#FA8072'; break;
            }
        } else { rankLabelSpan.textContent = `${rank}:`; rankLabelSpan.style.width = 'auto'; }
        listItem.appendChild(rankLabelSpan);
        if (VALID_RANKS.includes(rank)) {
            const barContainer = document.createElement('div');
            barContainer.style.flexGrow = '1'; barContainer.style.backgroundColor = '#f0f0f0';
            barContainer.style.height = barHeight; barContainer.style.borderRadius = '2px';
            barContainer.style.marginRight = '8px'; barContainer.style.position = 'relative';
            const barFill = document.createElement('div');
            const percentageWidth = maxCountForScale > 0 ? (count / maxCountForScale) * 100 : 0;
            barFill.style.width = `${Math.min(percentageWidth, 100)}%`;
            barFill.style.height = '100%'; barFill.style.backgroundColor = barChartColor;
            barFill.style.borderRadius = '2px'; barFill.style.transition = 'width 0.5s ease-out';
            barContainer.appendChild(barFill); listItem.appendChild(barContainer);
        }
        const countTextSpan = document.createElement('span');
        countTextSpan.textContent = `${count} paper${count === 1 ? '' : 's'}`;
        countTextSpan.style.minWidth = '55px'; countTextSpan.style.textAlign = 'right';
        listItem.appendChild(countTextSpan); list.appendChild(listItem);
    }
    panel.appendChild(list);

    const footerDiv = document.createElement('div');
    footerDiv.style.display = 'flex'; footerDiv.style.justifyContent = 'flex-end';
    footerDiv.style.alignItems = 'center'; footerDiv.style.marginTop = '10px';
    footerDiv.style.paddingTop = '5px'; footerDiv.style.borderTop = '1px solid #e0e0e0';
    const betaLabel = document.createElement('span'); betaLabel.textContent = 'BETA';
    betaLabel.style.padding = '1px 7px'; betaLabel.style.fontSize = '0.7em'; betaLabel.style.fontWeight = '600';
    betaLabel.style.color = '#fff'; betaLabel.style.backgroundColor = '#6c757d'; betaLabel.style.borderRadius = '10px';
    betaLabel.style.lineHeight = '1.4'; betaLabel.style.height = 'fit-content'; betaLabel.style.display = 'inline-flex';
    betaLabel.style.alignItems = 'center'; betaLabel.style.marginRight = '10px'; betaLabel.style.cursor = 'help';
    betaLabel.setAttribute('title', "Developed by Naveed Anwar Bhatti.\nIt is free and open source.\nIt uses historical CORE rankings (2014-2023) based on publication year.\nHelp us spot inconsistencies!\nFor any issues, please click on “Report Bug”.");
    footerDiv.appendChild(betaLabel);
    const reportBugLink = document.createElement('a'); reportBugLink.href = "https://forms.office.com/r/PbSzWaQmpJ";
    reportBugLink.target = "_blank"; reportBugLink.style.textDecoration = 'none'; reportBugLink.style.color = '#D32F2F';
    reportBugLink.style.fontSize = '0.8em'; reportBugLink.innerHTML = '🐞 Report Bug';
    reportBugLink.setAttribute('title', 'Report a bug or inconsistency (opens new tab)');
    footerDiv.appendChild(reportBugLink); panel.appendChild(footerDiv);

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
    } else { const profileTableContainer = document.getElementById('gsc_a_c'); if (profileTableContainer) profileTableContainer.before(panel); else document.body.prepend(panel); }

    if (initialCachedPubRanks && initialCachedPubRanks.length > 0) {
        activeCachedPublicationRanks = initialCachedPubRanks;
        rankMapForObserver = new Map<string, string>();
        activeCachedPublicationRanks.forEach(pubRank => {
            if (pubRank.titleText && pubRank.rank) {
                rankMapForObserver!.set(pubRank.titleText.trim().toLowerCase(), pubRank.rank);
            }
        });
        restoreVisibleInlineBadgesFromCache(activeCachedPublicationRanks);
        setupPublicationTableObserver();
    } else {
        activeCachedPublicationRanks = null;
        rankMapForObserver = null;
        disconnectPublicationTableObserver();
    }
}
// --- END: UI Functions ---

// --- START: MutationObserver Functions for Option A ---
function setupPublicationTableObserver() {
    disconnectPublicationTableObserver(); // Ensure no multiple observers

    const tableBody = document.querySelector('#gsc_a_b');
    // Ensure rankMapForObserver is also checked here before setting up
    if (!tableBody || !activeCachedPublicationRanks || !rankMapForObserver) {
        // console.log("DEBUG: setupPublicationTableObserver - No table body or no active cache/rankMap to observe for.");
        return;
    }

    // console.log("DEBUG: setupPublicationTableObserver - Setting up observer.");
    publicationTableObserver = new MutationObserver((mutationsList, obs) => {
        // CRITICAL CHECK: Ensure rankMapForObserver is still valid when the callback fires
        if (!activeCachedPublicationRanks || !rankMapForObserver) {
            // console.log("DEBUG: Observer callback fired but active cache/rankMap is null. Disconnecting.");
            obs.disconnect();
            publicationTableObserver = null; // Explicitly clear the observer instance
            return;
        }
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'TR' && (node as HTMLElement).classList.contains('gsc_a_tr')) {
                        const rowElement = node as HTMLElement;
                        const linkEl = rowElement.querySelector('td.gsc_a_t a.gsc_a_at');
                        if (linkEl instanceof HTMLAnchorElement && linkEl.textContent) {
                            const currentTitleText = linkEl.textContent.trim().toLowerCase();
                            // Now that we've checked rankMapForObserver above, this access is safer.
                            // TypeScript might still complain if it can't infer the check covers this specific line.
                            // We can use a non-null assertion if we're confident from the logic.
                            const cachedRank = rankMapForObserver!.get(currentTitleText); // Added '!'
                            if (cachedRank) {
                                // console.log(`DEBUG: Observer found rank "${cachedRank}" for new row: "${currentTitleText}"`);
                                displayRankBadgeAfterTitle(rowElement, cachedRank);
                            }
                        }
                    }
                });
            }
        }
    });
    publicationTableObserver.observe(tableBody, { childList: true, subtree: false });
}

function disconnectPublicationTableObserver() {
    if (publicationTableObserver) {
        publicationTableObserver.disconnect();
        publicationTableObserver = null;
    }
}
// --- END: MutationObserver Functions ---


// --- START: Helper Function to Restore Badges for Option A (for initially visible items) ---
function restoreVisibleInlineBadgesFromCache(
    cachedRanks: PublicationRankInfo[]
): void {
    const allVisibleRows = document.querySelectorAll('tr.gsc_a_tr');
    if (allVisibleRows.length === 0 || !cachedRanks || cachedRanks.length === 0) {
        return;
    }

    const currentRankMap = rankMapForObserver || new Map<string, string>();
    if (!rankMapForObserver && cachedRanks) {
        cachedRanks.forEach(pubRank => {
            if (pubRank.titleText && pubRank.rank) {
                currentRankMap.set(pubRank.titleText.trim().toLowerCase(), pubRank.rank);
            }
        });
    }

    let restoredCount = 0;
    allVisibleRows.forEach((row) => {
        const linkEl = row.querySelector('td.gsc_a_t a.gsc_a_at');
        if (linkEl instanceof HTMLAnchorElement && linkEl.textContent) {
            const currentTitleText = linkEl.textContent.trim().toLowerCase();
            const cachedRank = currentRankMap.get(currentTitleText);
            if (cachedRank) {
                displayRankBadgeAfterTitle(row as HTMLElement, cachedRank);
                restoredCount++;
            }
        }
    });
}
// --- END: Helper Function to Restore Badges ---


// --- START: Main Orchestration ---
async function main() {
  if (isMainProcessing) { return; }
  isMainProcessing = true;

  disconnectPublicationTableObserver();
  activeCachedPublicationRanks = null;
  rankMapForObserver = null;

  const statusElement = createStatusElement("Initializing Scholar Ranker...");
  const currentUserId = getScholarUserId();
  const determinedPublicationRanks: PublicationRankInfo[] = [];

  try {
    (statusElement.querySelector('.gsr-status-text') as HTMLElement).textContent = "Expanding publications list...";
    await expandAllPublications(statusElement);

    const publicationLinkElements: { url: string, rowElement: HTMLElement, titleText: string, yearFromProfile: number | null }[] = [];
    document.querySelectorAll('tr.gsc_a_tr').forEach(row => {
      const linkEl = row.querySelector('td.gsc_a_t a.gsc_a_at');
      const yearEl = row.querySelector('td.gsc_a_y span.gsc_a_h');
      let yearFromProfile: number | null = null;
      if (yearEl?.textContent && /^\d{4}$/.test(yearEl.textContent.trim())) { yearFromProfile = parseInt(yearEl.textContent.trim(), 10); }
      if (linkEl instanceof HTMLAnchorElement && linkEl.href && linkEl.textContent) {
        publicationLinkElements.push({
          url: linkEl.href, rowElement: row as HTMLElement,
          titleText: linkEl.textContent.trim().toLowerCase(),
          yearFromProfile: yearFromProfile
        });
      }
    });

    if (publicationLinkElements.length === 0) {
      (statusElement.querySelector('.gsr-status-text') as HTMLElement).textContent = "No publications found.";
      setTimeout(() => document.getElementById(STATUS_ELEMENT_ID)?.remove(), 3000);
      isMainProcessing = false; return;
    }
    updateStatusElement(statusElement, 0, publicationLinkElements.length);

    const rankCounts: Record<string, number> = { "A*": 0, "A": 0, "B": 0, "C": 0, "N/A": 0 };
    let processedCount = 0;
    const CONCURRENCY_LIMIT = 5;

    const processPublication = async (pubInfo: { url: string, rowElement: HTMLElement, titleText: string, yearFromProfile: number | null }): Promise<{ rank: string, rowElement: HTMLElement, titleText: string }> => {
      let currentRank = "N/A";
      try {
        for (const keyword of IGNORE_KEYWORDS) { if (pubInfo.titleText.includes(keyword)) return { rank: "N/A", rowElement: pubInfo.rowElement, titleText: pubInfo.titleText }; }
        const { venueName, publicationYear: yearFromDetail } = await fetchVenueAndYear(pubInfo.url);
        const effectiveYear = yearFromDetail !== null ? yearFromDetail : pubInfo.yearFromProfile;
        if (venueName?.trim()) {
          const lowerVenueName = venueName.toLowerCase(); let venueIgnored = false;
          for (const keyword of IGNORE_KEYWORDS) { if (lowerVenueName.includes(keyword)) { venueIgnored = true; break; } }
          if (!venueIgnored) {
            const coreDataFile = getCoreDataFileForYear(effectiveYear);
            const yearSpecificCoreData = await loadCoreDataForFile(coreDataFile);
            if (yearSpecificCoreData.length > 0) currentRank = findRankForVenue(venueName, yearSpecificCoreData);
          }
        }
      } catch (error) { console.warn(`Error processing ${pubInfo.url}:`, error); }
      return { rank: currentRank, rowElement: pubInfo.rowElement, titleText: pubInfo.titleText };
    };

    for (let i = 0; i < publicationLinkElements.length; i += CONCURRENCY_LIMIT) {
      const chunk = publicationLinkElements.slice(i, i + CONCURRENCY_LIMIT);
      const promises = chunk.map(pubInfo =>
        processPublication(pubInfo).then(result => {
          rankCounts[result.rank]++;
          displayRankBadgeAfterTitle(result.rowElement, result.rank);
          determinedPublicationRanks.push({ titleText: result.titleText, rank: result.rank });
          processedCount++;
          updateStatusElement(statusElement, processedCount, publicationLinkElements.length);
          return result;
        })
      );
      await Promise.all(promises);
    }

    if (currentUserId) {
        // For Option A, we are now saving detailed publication ranks.
        await saveCachedData(currentUserId, rankCounts, determinedPublicationRanks);
    }
    // Pass determinedPublicationRanks so observer can be set up based on fresh results.
    displaySummaryPanel(rankCounts, currentUserId, determinedPublicationRanks);
  } catch (error) {
      console.error("GSR: Uncaught error in main pipeline:", error);
      const statusElem = document.getElementById(STATUS_ELEMENT_ID) || createStatusElement("An error occurred.");
      const statusText = statusElem.querySelector('.gsr-status-text') as HTMLElement | null;
      if (statusText) statusText.textContent = "Error. Check console.";
      if(statusElem.querySelector('.gsr-progress-bar-inner')) (statusElem.querySelector('.gsr-progress-bar-inner') as HTMLElement).style.backgroundColor = 'red';
  } finally {
      isMainProcessing = false;
  }
}

async function initialLoad() {
    if (isMainProcessing) { return; }
    const userId = getScholarUserId();

    if (userId) {
        const cached = await loadCachedData(userId);
        if (cached && cached.publicationRanks) { // Ensure publicationRanks exists for Option A
            displaySummaryPanel(cached.rankCounts, userId, cached.publicationRanks);
            // displaySummaryPanel will call restoreVisibleInlineBadgesFromCache and setupPublicationTableObserver
            return;
        }
    }
    main().catch(error => {
        console.error("GSR: Error during initial full analysis in main():", error);
        const statusElem = document.getElementById(STATUS_ELEMENT_ID) || createStatusElement("A critical error occurred.");
        const statusText = statusElem.querySelector('.gsr-status-text') as HTMLElement | null;
        if (statusText) statusText.textContent = "Critical Error. Check console.";
        if(statusElem.querySelector('.gsr-progress-bar-inner')) (statusElem.querySelector('.gsr-progress-bar-inner') as HTMLElement).style.backgroundColor = 'red';
    });
}

if (document.getElementById('gsc_a_b') && window.location.pathname.includes("/citations")) {
    setTimeout(() => { initialLoad(); }, 500);
}
// --- END: Main Orchestration ---