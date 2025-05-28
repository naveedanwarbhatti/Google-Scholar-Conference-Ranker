"use strict";
// scholar-ranker/content.ts
const VALID_RANKS = ["A*", "A", "B", "C"]; // Added string[] type
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
const DBLP_CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for DBLP PID
console.log("Google Scholar Ranker: Content script loaded (vDBLP_Auto_Integration_Fix1).");
const coreDataCache = {};
let isMainProcessing = false;
let activeCachedPublicationRanks = null;
let publicationTableObserver = null;
let rankMapForObserver = null; // Maps URL to Rank
// --- START: DBLP Constants & Globals ---
const DBLP_API_AUTHOR_SEARCH_URL = "https://dblp.org/search/author/api";
const DBLP_API_PERSON_PUBS_URL_PREFIX = "https://dblp.org/pid/";
const DBLP_HEURISTIC_MIN_OVERLAP_COUNT = 2;
const DBLP_HEURISTIC_SCORE_THRESHOLD = 2.5;
let dblpPubsForCurrentUser = [];
let scholarUrlToDblpVenueMap = new Map();
let scholarUrlToDblpInfoMap = new Map();
// --- END: DBLP Constants & Globals ---
async function fetchDblpStreamMetadata(streamXmlUrl) {
    try {
        const response = await fetch(streamXmlUrl);
        if (!response.ok) {
            console.warn(`DBLP Stream: Fetching metadata failed for "${streamXmlUrl}": ${response.statusText} (Status: ${response.status})`);
            return null;
        }
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");
        const errorNode = xmlDoc.querySelector("parsererror");
        if (errorNode) {
            console.error("DBLP Stream: Error parsing XML for stream", streamXmlUrl, errorNode.textContent);
            return null;
        }
        const confElement = xmlDoc.querySelector("dblpstreams > conf");
        if (confElement) {
            const acronym = confElement.querySelector("acronym")?.textContent?.trim() || null;
            const title = confElement.querySelector("title")?.textContent?.trim() || null;
            return { acronym, title };
        }
        else {
            console.warn(`DBLP Stream: Could not find <conf> element in ${streamXmlUrl}`);
        }
    }
    catch (error) {
        console.error(`DBLP Stream: Error fetching or parsing stream metadata from ${streamXmlUrl}:`, error);
    }
    return null;
}
function getScholarUserId() {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user');
    return userId;
}
function normalizeUrlForCache(url) {
    try {
        // Ensure the URL is absolute before parsing.
        // window.location.href provides the base if the input 'url' might be relative.
        const urlObj = new URL(url, window.location.href);
        const essentialParams = new URLSearchParams();
        // Essential parameters for identifying a specific publication view
        if (urlObj.searchParams.has('user')) {
            essentialParams.set('user', urlObj.searchParams.get('user'));
        }
        if (urlObj.searchParams.has('citation_for_view')) {
            essentialParams.set('citation_for_view', urlObj.searchParams.get('citation_for_view'));
        }
        // 'view_op=view_citation' is consistently part of these links
        if (urlObj.searchParams.has('view_op') && urlObj.searchParams.get('view_op') === 'view_citation') {
            essentialParams.set('view_op', 'view_citation');
        }
        // We might also want to keep 'mauthors' if present, as it can be part of the core link
        // to a specific version of a citation when multiple authors share a profile.
        // However, for simplicity and based on provided examples, we'll omit it for now.
        // If issues arise with co-authored papers from combined profiles, this could be a param to add.
        // Sort params for extremely consistent keys.
        essentialParams.sort();
        let normalized = `${urlObj.origin}${urlObj.pathname}`;
        if (essentialParams.toString()) {
            normalized += `?${essentialParams.toString()}`;
        }
        return normalized;
    }
    catch (e) {
        console.warn("GSR: Could not normalize URL:", url, e);
        // Fallback: remove hash and trim (less robust but better than nothing)
        return url.split('#')[0].trim();
    }
}
function getCacheKey(userId) {
    return `${CACHE_PREFIX}${userId}`;
}
async function loadCachedData(userId) {
    const cacheKey = getCacheKey(userId);
    try {
        const result = await chrome.storage.local.get(cacheKey);
        if (chrome.runtime.lastError) {
            //console.error("DEBUG: loadCachedData - chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
        if (result && result[cacheKey]) {
            const data = result[cacheKey];
            const timeSinceCache = Date.now() - data.timestamp;
            if (timeSinceCache < CACHE_DURATION_MS) {
                if (Array.isArray(data.publicationRanks) && typeof data.rankCounts === 'object') {
                    return data;
                }
                else {
                    await chrome.storage.local.remove(cacheKey);
                }
            }
            else {
                await chrome.storage.local.remove(cacheKey);
            }
        }
    }
    catch (error) {
        //console.error("DEBUG: loadCachedData - Error:", error, "Key:", cacheKey);
    }
    return null;
}
async function saveCachedData(userId, rankCounts, publicationRanks, dblpAuthorPid) {
    const cacheKey = getCacheKey(userId);
    const dataToStore = {
        rankCounts,
        publicationRanks,
        timestamp: Date.now(),
        dblpAuthorPid: dblpAuthorPid || undefined,
        dblpMatchTimestamp: dblpAuthorPid ? Date.now() : undefined
    };
    try {
        await chrome.storage.local.set({ [cacheKey]: dataToStore });
        if (chrome.runtime.lastError) {
            //console.error("DEBUG: saveCachedData - chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
    }
    catch (error) {
        //console.error("DEBUG: saveCachedData - Error:", error, "Key:", cacheKey);
    }
}
async function clearCachedData(userId) {
    const cacheKey = getCacheKey(userId);
    try {
        await chrome.storage.local.remove(cacheKey);
        activeCachedPublicationRanks = null;
        rankMapForObserver = null;
        disconnectPublicationTableObserver();
        dblpPubsForCurrentUser = [];
        scholarUrlToDblpVenueMap.clear();
        if (chrome.runtime.lastError) {
            //console.error("DEBUG: clearCachedData - chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
    }
    catch (error) {
        //console.error("DEBUG: clearCachedData - Error:", error, "Key:", cacheKey);
    }
}
async function expandAllPublications(statusElement) {
    const showMoreButtonId = 'gsc_bpf_more';
    const publicationsTableBodySelector = '#gsc_a_b';
    let attempts = 0;
    const maxAttempts = 30;
    const statusTextElement = statusElement.querySelector('.gsr-status-text');
    while (attempts < maxAttempts) {
        const showMoreButton = document.getElementById(showMoreButtonId);
        if (!showMoreButton || showMoreButton.disabled) {
            if (statusTextElement && (statusTextElement.textContent || "").includes("Expanding")) {
                statusTextElement.textContent = "All publications loaded.";
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            break;
        }
        if (statusTextElement)
            statusTextElement.textContent = `Expanding publications... (click ${attempts + 1})`;
        const tableBody = document.querySelector(publicationsTableBodySelector);
        if (!tableBody) {
            if (statusTextElement)
                statusTextElement.textContent = "Error finding table.";
            break;
        }
        const contentLoadedPromise = new Promise((resolve) => {
            const observer = new MutationObserver((mutationsList, obs) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        const newRows = Array.from(mutation.addedNodes).filter(node => node.nodeName === 'TR' && node.classList.contains('gsc_a_tr'));
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
            setTimeout(() => { observer.disconnect(); resolve(); }, 5000); // Timeout for click
        });
        await contentLoadedPromise;
        await new Promise(resolve => setTimeout(resolve, 750 + Math.random() * 500));
        attempts++;
    }
    if (attempts >= maxAttempts) {
        console.warn("Google Scholar Ranker: Reached max attempts for 'Show more'.");
        if (statusTextElement)
            statusTextElement.textContent = "Max expansion attempts.";
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}
function getCoreDataFileForYear(pubYear) {
    if (pubYear === null) {
        return 'core/CORE_2023.json';
    } // Default for unknown
    if (pubYear >= 2023)
        return 'core/CORE_2023.json';
    if (pubYear >= 2021)
        return 'core/CORE_2021.json';
    if (pubYear >= 2020)
        return 'core/CORE_2020.json';
    if (pubYear >= 2018)
        return 'core/CORE_2018.json';
    if (pubYear >= 2017)
        return 'core/CORE_2017.json';
    if (pubYear <= 2016) {
        return 'core/CORE_2014.json';
    } // Or a specific older one if you have it
    return 'core/CORE_2023.json'; // Fallback
}
function generateAcronymFromTitle(title) {
    if (!title)
        return "";
    const words = title.split(/[\s\-‑\/.,:;&]+/);
    let acronym = "";
    for (const word of words) {
        if (word.length > 0 && word[0] === word[0].toUpperCase() && /^[A-Za-z]/.test(word[0])) {
            acronym += word[0];
        }
        if (acronym.length >= 8)
            break;
    }
    return acronym.toUpperCase();
}
async function loadCoreDataForFile(coreDataFile) {
    if (coreDataCache[coreDataFile]) {
        return coreDataCache[coreDataFile];
    }
    try {
        const url = chrome.runtime.getURL(coreDataFile);
        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`Failed to fetch ${coreDataFile}: ${response.statusText} (URL: ${url})`);
        const jsonData = await response.json();
        if (!Array.isArray(jsonData)) {
            console.error(`CORE data from ${coreDataFile} is not an array.`, jsonData);
            return [];
        }
        const parsedData = jsonData.map((rawEntry) => {
            const entry = { title: "", acronym: "", rank: "N/A" };
            let pTitleKey = "International Conference on Advanced Communications and Computation", pAcroKey = "INFOCOMP"; // Default keys that might vary
            if (coreDataFile.includes('2018') || coreDataFile.includes('2017') || coreDataFile.includes('2014')) {
                pTitleKey = "Information Retrieval Facility Conference";
                pAcroKey = "IRFC"; // Example adjustment
            }
            if (typeof rawEntry[pTitleKey] === 'string')
                entry.title = rawEntry[pTitleKey];
            else if (typeof rawEntry.title === 'string')
                entry.title = rawEntry.title;
            else if (typeof rawEntry.Title === 'string')
                entry.title = rawEntry.Title;
            if (typeof rawEntry[pAcroKey] === 'string')
                entry.acronym = rawEntry[pAcroKey];
            else if (typeof rawEntry.acronym === 'string')
                entry.acronym = rawEntry.acronym;
            else if (typeof rawEntry.Acronym === 'string')
                entry.acronym = rawEntry.Acronym;
            let fRank;
            if (typeof rawEntry.Unranked === 'string')
                fRank = rawEntry.Unranked; // For 2014
            else if (typeof rawEntry.rank === 'string')
                fRank = rawEntry.rank;
            else if (typeof rawEntry.CORE_Rating === 'string')
                fRank = rawEntry.CORE_Rating; // For 2017
            else if (typeof rawEntry.Rating === 'string')
                fRank = rawEntry.Rating; // For some 2018
            if (fRank) {
                const uRank = fRank.toUpperCase().trim();
                if (VALID_RANKS.includes(uRank))
                    entry.rank = uRank;
            }
            entry.title = String(entry.title || "").trim();
            entry.acronym = String(entry.acronym || "").trim();
            if (!entry.acronym && entry.title) {
                const genAcro = generateAcronymFromTitle(entry.title);
                if (genAcro.length >= 2)
                    entry.acronym = genAcro;
            }
            return (entry.title || entry.acronym) ? entry : null;
        }).filter(entry => entry !== null);
        coreDataCache[coreDataFile] = parsedData;
        return parsedData;
    }
    catch (error) {
        console.error(`Error loading/parsing CORE data from ${coreDataFile}:`, error);
        return [];
    }
}
async function fetchVenueAndYear(publicationUrl) {
    let venueName = null, publicationYear = null;
    try {
        const response = await fetch(publicationUrl);
        if (!response.ok) {
            return { venueName, publicationYear };
        }
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const targetLabels = ['journal', 'conference', 'proceedings', 'book title', 'series', 'source', 'publication', 'book'], yearLabel = 'publication date';
        let foundInOci = false;
        const sectionsOci = doc.querySelectorAll('#gsc_oci_table div.gs_scl');
        if (sectionsOci.length > 0) {
            for (const section of sectionsOci) {
                const fieldEl = section.querySelector('div.gsc_oci_field'), valueEl = section.querySelector('div.gsc_oci_value');
                if (fieldEl && valueEl) {
                    const label = fieldEl.textContent?.trim().toLowerCase() || '';
                    if (!venueName && targetLabels.includes(label)) {
                        venueName = valueEl.textContent?.trim() || null;
                        foundInOci = true;
                    }
                    if (!publicationYear && label === yearLabel) {
                        const yT = valueEl.textContent?.trim().split('/')[0];
                        if (yT && /^\d{4}$/.test(yT))
                            publicationYear = parseInt(yT, 10);
                        foundInOci = true;
                    }
                }
                if (venueName && publicationYear)
                    break;
            }
        }
        if (!venueName || !publicationYear || !foundInOci) {
            const rowsVcd = doc.querySelectorAll('#gsc_vcd_table tr');
            for (const row of rowsVcd) {
                const fieldEl = row.querySelector('td.gsc_vcd_field'), valueEl = row.querySelector('td.gsc_vcd_value');
                if (fieldEl && valueEl) {
                    const label = fieldEl.textContent?.trim().toLowerCase() || '';
                    if (!venueName && targetLabels.includes(label))
                        venueName = valueEl.textContent?.trim() || null;
                    if (!publicationYear && label === yearLabel) {
                        const yT = valueEl.textContent?.trim().split('/')[0];
                        if (yT && /^\d{4}$/.test(yT))
                            publicationYear = parseInt(yT, 10);
                    }
                }
                if (venueName && publicationYear)
                    break;
            }
        }
    }
    catch (error) {
        console.error(`Error fetching/parsing ${publicationUrl}:`, error);
    }
    return { venueName, publicationYear };
}
const COMMON_ABBREVIATIONS = { "int'l": "international", "intl": "international", "conf\\.": "conference", "conf": "conference", "proc\\.": "proceedings", "proc": "proceedings", "symp\\.": "symposium", "symp": "symposium", "j\\.": "journal", "jour": "journal", "trans\\.": "transactions", "trans": "transactions", "annu\\.": "annual", "comput\\.": "computing", "commun\\.": "communications", "syst\\.": "systems", "sci\\.": "science", "tech\\.": "technical", "technol": "technology", "engin\\.": "engineering", "res\\.": "research", "adv\\.": "advances", "appl\\.": "applications", "lectures notes": "lecture notes", "lect notes": "lecture notes", "lncs": "lecture notes in computer science", };
function cleanTextForComparison(text, isGoogleScholarVenue = false) {
    if (!text)
        return "";
    let cleanedText = text.toLowerCase();
    for (const [abbr, expansion] of Object.entries(COMMON_ABBREVIATIONS)) {
        const regex = new RegExp(`\\b${abbr.replace('.', '\\.')}\\b`, 'gi');
        cleanedText = cleanedText.replace(regex, expansion);
    }
    cleanedText = cleanedText.replace(/&/g, " and ");
    cleanedText = cleanedText.replace(/[\.,\/#!$%\^;\*:{}=\_`~?"“”()\[\]]/g, " ");
    cleanedText = cleanedText.replace(/\s-\s/g, " ");
    if (isGoogleScholarVenue) {
        cleanedText = cleanedText.replace(/^(\d{4}\s+|\d{1,2}(st|nd|rd|th)\s+)/, "");
        cleanedText = cleanedText.replace(/,\s*\d{4}$/, "");
        cleanedText = cleanedText.replace(/\(\d{4}\)$/, "");
    }
    cleanedText = cleanedText.replace(/\s+/g, ' ');
    return cleanedText.trim();
}
const FUZZY_THRESHOLD = 0.90;
function jaroWinkler(s1, s2) {
    if (!s1 || !s2)
        return 0;
    const m = (a, b) => {
        const bound = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
        const match = new Array(a.length).fill(false), bMatch = new Array(b.length).fill(false);
        let matches = 0;
        for (let i = 0; i < a.length; i++) {
            const lo = Math.max(0, i - bound), hi = Math.min(i + bound + 1, b.length);
            for (let j = lo; j < hi; j++)
                if (!bMatch[j] && a[i] === b[j]) {
                    match[i] = bMatch[j] = true;
                    matches++;
                    break;
                }
        }
        if (!matches)
            return { matches: 0, trans: 0 };
        let k = 0, trans = 0;
        for (let i = 0; i < a.length; i++)
            if (match[i]) {
                while (!bMatch[k])
                    k++;
                if (a[i] !== b[k])
                    trans++;
                k++;
            }
        return { matches, trans: trans / 2 };
    };
    const { matches, trans } = m(s1, s2);
    if (!matches)
        return 0;
    const j = (matches / s1.length + matches / s2.length + (matches - trans) / matches) / 3;
    const l = Math.min(4, [...s1].findIndex((c, i) => c !== s2[i] || i >= s2.length));
    return j + l * 0.1 * (1 - j);
}
const ORG_PREFIXES_TO_IGNORE = ["acm/ieee", "ieee/acm", "acm-ieee", "ieee-acm", "acm sigplan", "acm sigops", "acm sigbed", "acm sigcomm", "acm sigmod", "acm sigarch", "acm sigsac", "acm", "ieee", "ifip", "usenix", "eurographics", "springer", "elsevier", "wiley", "sigplan", "sigops", "sigbed", "sigcomm", "sigmod", "sigarch", "sigsac", "international", "national", "annual"];
function stripOrgPrefixes(text) {
    let currentText = text;
    let strippedSomething;
    do {
        strippedSomething = false;
        for (const prefix of ORG_PREFIXES_TO_IGNORE) {
            if (currentText.startsWith(prefix + " ") || currentText === prefix) {
                currentText = currentText.substring(prefix.length).trim();
                strippedSomething = true;
            }
        }
    } while (strippedSomething && currentText.length > 0);
    return currentText;
}
/**
 * Return the CORE rank for a venue.
 * – If the acronym is ambiguous we try to disambiguate with the stream’s full title.
 * – If that fails we now return "N/A" instead of picking the highest rank.
 */
function findRankForVenue(venueKey, coreData, fullVenueTitle = undefined) {
    if (!venueKey || !venueKey.trim())
        return "N/A";
    const keyLower = venueKey.toLowerCase().trim();
    /* ---------- 1. exact-acronym match ---------- */
    const acronymMatches = coreData.filter(e => e.acronym && e.acronym.toLowerCase() === keyLower);
    /* 1-a  single hit → done */
    if (acronymMatches.length === 1) {
        const rank = acronymMatches[0].rank;
        return VALID_RANKS.includes(rank) ? rank : "N/A";
    }
    /* 1-b  ambiguous acronym → log & try title disambiguation */
    if (acronymMatches.length > 1) {
        console.log(`[Rank] Acronym '${venueKey}' matched ${acronymMatches.length} CORE rows.`, acronymMatches.map(e => ({ title: e.title, rank: e.rank })));
        if (fullVenueTitle) {
            const cleanedFull = cleanTextForComparison(fullVenueTitle, false);
            let bestScore = 0;
            let bestEntry = null;
            for (const entry of acronymMatches) {
                if (!entry.title)
                    continue;
                const score = jaroWinkler(cleanedFull, cleanTextForComparison(entry.title, false));
                console.log(`  ↳ JW score vs "${entry.title}": ${score.toFixed(3)}`);
                if (score > bestScore) {
                    bestScore = score;
                    bestEntry = entry;
                }
                if (score === 1)
                    break; // perfect match
            }
            if (bestEntry &&
                bestScore >= 0.85 &&
                VALID_RANKS.includes(bestEntry.rank)) {
                console.log(`[Rank]   ► Disambiguated by title → "${bestEntry.title}" (${bestEntry.rank})`);
                return bestEntry.rank;
            }
            console.log(`[Rank]   ► Title disambiguation failed (best score ${bestScore.toFixed(3)}). Returning N/A.`);
        }
        else {
            console.log(`[Rank]   ► No fullVenueTitle provided – cannot disambiguate. Returning N/A.`);
        }
        return "N/A"; // ← new behaviour
    }
    /* ---------- 2. substring containment (unchanged) ---------- */
    const gsCleaned = cleanTextForComparison(keyLower, true);
    if (!gsCleaned)
        return "N/A";
    let bestSubRank = null;
    let longestLen = 0;
    for (const entry of coreData) {
        if (!entry.title)
            continue;
        let coreTitle = cleanTextForComparison(entry.title, false);
        coreTitle = stripOrgPrefixes(coreTitle);
        if (gsCleaned.includes(coreTitle) && coreTitle.length > longestLen) {
            longestLen = coreTitle.length;
            bestSubRank = VALID_RANKS.includes(entry.rank) ? entry.rank : null;
        }
    }
    if (bestSubRank)
        return bestSubRank;
    /* ---------- 3. fuzzy JW (unchanged) ---------- */
    let bestFuzzy = 0;
    let fuzzyRank = null;
    for (const entry of coreData) {
        if (!entry.title)
            continue;
        let coreTitle = cleanTextForComparison(entry.title, false);
        coreTitle = stripOrgPrefixes(coreTitle);
        if (coreTitle.length < 6 || gsCleaned.length < 6)
            continue;
        const score = jaroWinkler(gsCleaned, coreTitle);
        if (score >= FUZZY_THRESHOLD && score > bestFuzzy) {
            bestFuzzy = score;
            fuzzyRank = VALID_RANKS.includes(entry.rank) ? entry.rank : null;
            if (score === 1)
                break;
        }
    }
    return fuzzyRank ?? "N/A";
}
function extractPotentialAcronymsFromText(scholarVenueName) {
    const acronyms = new Set();
    const originalVenueName = scholarVenueName;
    const parentheticalMatches = originalVenueName.match(/\(([^)]+)\)/g);
    if (parentheticalMatches) {
        parentheticalMatches.forEach(match => {
            const contentInParen = match.slice(1, -1).trim();
            const partsInParen = contentInParen.split(/[,;]/).map(p => p.trim());
            for (const part of partsInParen) {
                const potentialAcronym = part.match(/^([A-Z][a-zA-Z0-9'’]*[a-zA-Z0-9]|[A-Z]{2,}[0-9'’]*)$/);
                if (potentialAcronym && potentialAcronym[0]) {
                    let extracted = potentialAcronym[0];
                    let cleanedParenAcronym = extracted.replace(/['’]\d{2,4}$/, '').replace(/['’]s$/, '');
                    if (cleanedParenAcronym.length >= 2 && cleanedParenAcronym.length <= 12 &&
                        !/^\d+$/.test(cleanedParenAcronym) &&
                        !IGNORE_KEYWORDS.includes(cleanedParenAcronym.toLowerCase()) &&
                        !["was", "formerly", "inc", "ltd", "vol", "no"].includes(cleanedParenAcronym.toLowerCase())) {
                        acronyms.add(cleanedParenAcronym.toLowerCase());
                    }
                }
                else {
                    const simplerPatterns = part.match(/([A-Z]{2,}[0-9']*\b|[A-Z]+[0-9]+[A-Z0-9]*\b)/g);
                    if (simplerPatterns) {
                        simplerPatterns.forEach(pAcronym => {
                            let cleanedParenAcronym = pAcronym.replace(/['’]\d{2,4}$/, '').replace(/['’]s$/, '');
                            if (cleanedParenAcronym.length >= 2 && cleanedParenAcronym.length <= 12 &&
                                !/^\d+$/.test(cleanedParenAcronym) &&
                                !IGNORE_KEYWORDS.includes(cleanedParenAcronym.toLowerCase()) &&
                                !["was", "formerly"].includes(cleanedParenAcronym.toLowerCase())) {
                                acronyms.add(cleanedParenAcronym.toLowerCase());
                            }
                        });
                    }
                }
            }
        });
    }
    let textWithoutParens = originalVenueName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    textWithoutParens = textWithoutParens.replace(/\b(Proceedings\s+of\s+(the)?|Proc\.\s+of\s+(the)?|International\s+Conference\s+on|Intl\.\s+Conf\.\s+on|Conference\s+on|Symposium\s+on|Workshop\s+on|Journal\s+of)\b/gi, ' ').trim();
    const words = textWithoutParens.split(/[\s\-‑\/.,:;&]+/);
    const commonNonAcronymWords = new Set([...IGNORE_KEYWORDS, 'proc', 'data', 'services', 'models', 'security', 'time', 'proceedings', 'journal', 'conference', 'conf', 'symposium', 'symp', 'workshop', 'ws', 'international', 'intl', 'natl', 'national', 'annual', 'vol', 'volume', 'no', 'number', 'pp', 'page', 'pages', 'part', 'edition', 'of', 'the', 'on', 'in', 'and', 'for', 'to', 'at', 'st', 'nd', 'rd', 'th', 'springer', 'elsevier', 'wiley', 'press', 'extended', 'abstracts', 'poster', 'session', 'sessions', 'doctoral', 'companion', 'joint', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'advances', 'systems', 'networks', 'computing', 'applications', 'technology', 'technologies', 'research', 'science', 'sciences', 'engineering', 'management', 'information', 'communication', 'communications', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'letters', 'bulletin', 'archive', 'archives', 'series', 'chapter', 'section', 'tutorial', 'tutorials', 'report', 'technical', 'tech', ...(Array.from({ length: 75 }, (_, i) => (1970 + i).toString()))]);
    words.forEach(word => {
        const cleanWordOriginalCase = word.trim();
        if (cleanWordOriginalCase.length >= 2 && cleanWordOriginalCase.length <= 12 && !/^\d+$/.test(cleanWordOriginalCase)) {
            if ((!commonNonAcronymWords.has(cleanWordOriginalCase.toLowerCase())) &&
                (/^[A-Z0-9]+$/.test(cleanWordOriginalCase) ||
                    /^[A-Z][a-z]+[A-Z]+[A-Za-z0-9]*$/.test(cleanWordOriginalCase) ||
                    /^[A-Z][A-Z0-9]+$/.test(cleanWordOriginalCase) && cleanWordOriginalCase.length <= 5)) {
                acronyms.add(cleanWordOriginalCase.toLowerCase());
            }
        }
    });
    if (acronyms.size === 0 &&
        originalVenueName.length >= 2 && originalVenueName.length <= 10 &&
        !originalVenueName.includes(" ") && /^[A-Za-z0-9]+$/.test(originalVenueName) &&
        !/^\d+$/.test(originalVenueName) &&
        !commonNonAcronymWords.has(originalVenueName.toLowerCase())) {
        acronyms.add(originalVenueName.toLowerCase());
    }
    return Array.from(acronyms);
}
function createRankBadgeElement(rank) {
    if (!VALID_RANKS.includes(rank) && rank !== "N/A")
        return null;
    const badge = document.createElement('span');
    badge.textContent = rank;
    badge.style.display = 'inline-block';
    badge.style.padding = '2px 6px';
    badge.style.marginLeft = '10px';
    badge.style.fontSize = '0.9em';
    badge.style.fontWeight = 'bold';
    badge.style.color = '#000000';
    badge.style.border = '1px solid #ccc';
    badge.style.borderRadius = '3px';
    badge.style.verticalAlign = 'middle';
    badge.style.minWidth = '30px';
    badge.style.textAlign = 'center';
    if (rank === "N/A") {
        badge.style.backgroundColor = '#f0f0f0';
        badge.style.borderColor = '#bdbdbd';
        badge.style.color = '#555';
    }
    else {
        switch (rank) {
            case "A*":
                badge.style.backgroundColor = '#FFD700';
                badge.style.borderColor = '#B8860B';
                break;
            case "A":
                badge.style.backgroundColor = '#90EE90';
                badge.style.borderColor = '#3CB371';
                break;
            case "B":
                badge.style.backgroundColor = '#ADFF2F';
                badge.style.borderColor = '#7FFF00';
                break;
            case "C":
                badge.style.backgroundColor = '#FFA07A';
                badge.style.borderColor = '#FA8072';
                break;
        }
    }
    return badge;
}
function displayRankBadgeAfterTitle(rowElement, rank) {
    const titleCell = rowElement.querySelector('td.gsc_a_t');
    if (titleCell) {
        const oldBadge = titleCell.querySelector('span.gsr-rank-badge-inline');
        oldBadge?.remove(); // Ensure any previous badge is cleared first
    }
    else {
        return; // No title cell found
    }
    // Original logic: if (!VALID_RANKS.includes(rank)) return;
    // We DO want to create N/A badges if rank is "N/A" via createRankBadgeElement
    // So, only return if createRankBadgeElement itself returns null (e.g. invalid rank string not in VALID_RANKS and not N/A)
    const titleLinkElement = rowElement.querySelector('td.gsc_a_t a.gsc_a_at');
    if (!titleLinkElement)
        return;
    const badge = createRankBadgeElement(rank); // This can return N/A badge or null
    if (badge) {
        badge.classList.add('gsr-rank-badge-inline');
        badge.style.marginLeft = '8px';
        titleLinkElement.insertAdjacentElement('afterend', badge);
    }
}
function createStatusElement(initialMessage = "Initializing...") {
    disconnectPublicationTableObserver();
    activeCachedPublicationRanks = null;
    rankMapForObserver = null;
    document.getElementById(SUMMARY_PANEL_ID)?.remove();
    document.getElementById(STATUS_ELEMENT_ID)?.remove();
    const container = document.createElement('div');
    container.id = STATUS_ELEMENT_ID;
    container.classList.add('gsc_rsb_s', 'gsc_prf_pnl');
    container.style.padding = '10px';
    container.style.marginBottom = '15px';
    const title = document.createElement('div');
    title.textContent = "CORE Rank Processing";
    title.style.fontSize = '14px';
    title.style.fontWeight = 'bold';
    title.style.color = '#777';
    title.style.marginBottom = '8px';
    container.appendChild(title);
    const progressBarOuter = document.createElement('div');
    progressBarOuter.style.width = '100%';
    progressBarOuter.style.backgroundColor = '#e0e0e0';
    progressBarOuter.style.borderRadius = '4px';
    progressBarOuter.style.height = '10px';
    progressBarOuter.style.overflow = 'hidden';
    container.appendChild(progressBarOuter);
    const progressBarInner = document.createElement('div');
    progressBarInner.classList.add('gsr-progress-bar-inner');
    progressBarInner.style.width = '0%';
    progressBarInner.style.height = '100%';
    progressBarInner.style.backgroundColor = '#76C7C0';
    progressBarInner.style.transition = 'width 0.2s ease-out';
    progressBarOuter.appendChild(progressBarInner);
    const statusText = document.createElement('div');
    statusText.classList.add('gsr-status-text');
    statusText.textContent = initialMessage;
    statusText.style.marginTop = '5px';
    statusText.style.fontSize = '12px';
    statusText.style.color = '#555';
    statusText.style.textAlign = 'center';
    container.appendChild(statusText);
    const gsBdy = document.getElementById('gs_bdy');
    if (!gsBdy) {
        document.body.prepend(container);
        return container;
    }
    const rightSidebarContainer = gsBdy.querySelector('div.gsc_rsb');
    if (rightSidebarContainer) {
        const citedByElement = rightSidebarContainer.querySelector('#gsc_rsb_cit');
        const publicAccessElement = rightSidebarContainer.querySelector('#gsc_rsb_mnd');
        const coauthorsElement = rightSidebarContainer.querySelector('#gsc_rsb_co');
        if (publicAccessElement)
            rightSidebarContainer.insertBefore(container, publicAccessElement);
        else if (coauthorsElement)
            rightSidebarContainer.insertBefore(container, coauthorsElement);
        else if (citedByElement?.nextSibling)
            rightSidebarContainer.insertBefore(container, citedByElement.nextSibling);
        else if (citedByElement)
            citedByElement.parentNode?.appendChild(container);
        else
            rightSidebarContainer.prepend(container);
    }
    else {
        const profileTableContainer = document.getElementById('gsc_a_c');
        if (profileTableContainer)
            profileTableContainer.before(container);
        else
            document.body.prepend(container);
    }
    return container;
}
function updateStatusElement(statusContainer, processed, total, messagePrefix) {
    const progressBarInner = statusContainer.querySelector('.gsr-progress-bar-inner');
    const statusText = statusContainer.querySelector('.gsr-status-text');
    const percentage = total > 0 ? (processed / total) * 100 : 0;
    if (progressBarInner)
        progressBarInner.style.width = `${percentage}%`;
    const prefix = messagePrefix ? messagePrefix + ": " : "";
    if (statusText)
        statusText.textContent = `${prefix}Processing ${processed} / ${total}...`;
}
function displaySummaryPanel(rankCounts, currentUserId, initialCachedPubRanks, cacheTimestamp, dblpAuthorPid // New parameter for DBLP PID
) {
    document.getElementById(STATUS_ELEMENT_ID)?.remove();
    document.getElementById(SUMMARY_PANEL_ID)?.remove();
    disconnectPublicationTableObserver();
    const panel = document.createElement('div');
    panel.id = SUMMARY_PANEL_ID;
    panel.classList.add('gsc_rsb_s', 'gsc_prf_pnl');
    panel.style.padding = '10px';
    panel.style.marginBottom = '15px';
    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.fontSize = '14px';
    headerDiv.style.fontWeight = 'bold';
    headerDiv.style.color = '#777';
    headerDiv.style.marginBottom = '10px';
    headerDiv.style.paddingBottom = '5px';
    headerDiv.style.borderBottom = '1px solid #e0e0e0';
    const summaryTitle = document.createElement('span');
    summaryTitle.textContent = 'CORE Rank Summary';
    headerDiv.appendChild(summaryTitle);
    if (currentUserId) {
        const refreshButton = document.createElement('button');
        refreshButton.textContent = 'Refresh Ranks';
        refreshButton.style.marginLeft = 'auto';
        refreshButton.style.padding = '2px 8px';
        refreshButton.style.fontSize = '0.7em';
        refreshButton.style.fontWeight = '600';
        refreshButton.style.color = '#006400';
        refreshButton.style.backgroundColor = '#90EE90';
        refreshButton.style.border = '1px solid #77dd77';
        refreshButton.style.borderRadius = '10px';
        refreshButton.style.lineHeight = '1.4';
        refreshButton.style.height = 'fit-content';
        refreshButton.style.display = 'inline-flex';
        refreshButton.style.alignItems = 'center';
        refreshButton.style.cursor = 'pointer';
        refreshButton.setAttribute('title', 'Recalculate CORE ranks');
        refreshButton.onmouseenter = () => { refreshButton.style.backgroundColor = '#7CFC00'; refreshButton.style.borderColor = '#006400'; };
        refreshButton.onmouseleave = () => { refreshButton.style.backgroundColor = '#90EE90'; refreshButton.style.borderColor = '#77dd77'; };
        refreshButton.onclick = async () => {
            if (isMainProcessing)
                return;
            // Clear existing UI elements or states immediately
            disconnectPublicationTableObserver();
            activeCachedPublicationRanks = null;
            rankMapForObserver = null;
            // Remove status/summary panels to prepare for fresh UI from main()
            document.getElementById(STATUS_ELEMENT_ID)?.remove();
            document.getElementById(SUMMARY_PANEL_ID)?.remove();
            console.log("GSR: Refresh Ranks clicked. Clearing cached data for user:", currentUserId);
            if (currentUserId) { // Ensure currentUserId is still valid before clearing
                await clearCachedData(currentUserId); // Clear Chrome storage for this user
                console.log("GSR: Cached data cleared for user:", currentUserId);
            }
            else {
                console.warn("GSR: currentUserId not available, cannot clear cached data specifically.");
            }
            console.log("GSR: Proceeding to run main() for fresh ranking.");
            main().catch(error => {
                console.error("DEBUG: Error during refresh after cache clear:", error);
                // createStatusElement will be called by main(), but if main itself fails early,
                // we might need a fallback or ensure createStatusElement is robust.
                // For now, main()'s error handling should create the error UI.
                // If main() fails very early (before it can create its own status element), this might be needed:
                const statusElemCheck = document.getElementById(STATUS_ELEMENT_ID);
                if (!statusElemCheck) {
                    const statusElem = createStatusElement("Error during refresh. Check console.");
                    if (statusElem.querySelector('.gsr-progress-bar-inner'))
                        statusElem.querySelector('.gsr-progress-bar-inner').style.backgroundColor = 'red';
                }
            });
        };
        // --- END OF MODIFIED onClick HANDLER ---
        headerDiv.appendChild(refreshButton);
    }
    panel.appendChild(headerDiv);
    const list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.padding = '0';
    list.style.margin = '8px 0 0 0';
    const ranksForChart = ["A*", "A", "B", "C"];
    let maxCountForScale = 10;
    ranksForChart.forEach(rank => { if ((rankCounts[rank] || 0) > maxCountForScale)
        maxCountForScale = rankCounts[rank] || 0; });
    if (maxCountForScale < 10)
        maxCountForScale = 10;
    else if (maxCountForScale > 10 && maxCountForScale < 15)
        maxCountForScale = Math.ceil(maxCountForScale / 5) * 5;
    const barChartColor = '#76C7C0';
    const barHeight = '18px';
    for (const rank of ["A*", "A", "B", "C", "N/A"]) {
        const count = rankCounts[rank] || 0;
        const listItem = document.createElement('li');
        listItem.style.fontSize = '13px';
        listItem.style.marginBottom = '6px';
        listItem.style.display = 'flex';
        listItem.style.alignItems = 'center';
        const rankLabelSpan = document.createElement('span');
        rankLabelSpan.style.display = 'inline-block';
        rankLabelSpan.style.fontWeight = 'bold';
        rankLabelSpan.style.marginRight = '8px';
        rankLabelSpan.style.width = '35px';
        if (VALID_RANKS.includes(rank)) {
            rankLabelSpan.textContent = rank;
            rankLabelSpan.style.padding = '1px 4px';
            rankLabelSpan.style.fontSize = '0.9em';
            rankLabelSpan.style.color = '#000000';
            rankLabelSpan.style.border = '1px solid #ccc';
            rankLabelSpan.style.borderRadius = '3px';
            rankLabelSpan.style.textAlign = 'center';
            switch (rank) {
                case "A*":
                    rankLabelSpan.style.backgroundColor = '#FFD700';
                    rankLabelSpan.style.borderColor = '#B8860B';
                    break;
                case "A":
                    rankLabelSpan.style.backgroundColor = '#90EE90';
                    rankLabelSpan.style.borderColor = '#3CB371';
                    break;
                case "B":
                    rankLabelSpan.style.backgroundColor = '#ADFF2F';
                    rankLabelSpan.style.borderColor = '#7FFF00';
                    break;
                case "C":
                    rankLabelSpan.style.backgroundColor = '#FFA07A';
                    rankLabelSpan.style.borderColor = '#FA8072';
                    break;
            }
        }
        else {
            rankLabelSpan.textContent = `${rank}:`;
            rankLabelSpan.style.width = 'auto';
        }
        listItem.appendChild(rankLabelSpan);
        if (VALID_RANKS.includes(rank)) {
            const barContainer = document.createElement('div');
            barContainer.style.flexGrow = '1';
            barContainer.style.backgroundColor = '#f0f0f0';
            barContainer.style.height = barHeight;
            barContainer.style.borderRadius = '2px';
            barContainer.style.marginRight = '8px';
            barContainer.style.position = 'relative';
            const barFill = document.createElement('div');
            const percentageWidth = maxCountForScale > 0 ? (count / maxCountForScale) * 100 : 0;
            barFill.style.width = `${Math.min(percentageWidth, 100)}%`;
            barFill.style.height = '100%';
            barFill.style.backgroundColor = barChartColor;
            barFill.style.borderRadius = '2px';
            barFill.style.transition = 'width 0.5s ease-out';
            barContainer.appendChild(barFill);
            listItem.appendChild(barContainer);
        }
        const countTextSpan = document.createElement('span');
        countTextSpan.textContent = `${count} paper${count === 1 ? '' : 's'}`;
        countTextSpan.style.minWidth = '55px';
        countTextSpan.style.textAlign = 'right';
        listItem.appendChild(countTextSpan);
        list.appendChild(listItem);
    }
    panel.appendChild(list);
    // --- START: DBLP Link and Timestamp section ---
    if (dblpAuthorPid || cacheTimestamp) {
        const middleBarContainer = document.createElement('div');
        const greyLineTop = document.createElement('div');
        greyLineTop.style.borderTop = '1px solid #e0e0e0';
        greyLineTop.style.marginTop = '12px'; // Space from list
        greyLineTop.style.marginBottom = '6px'; // Space before dblp/timestamp text
        middleBarContainer.appendChild(greyLineTop);
        const dblpTimestampTextRow = document.createElement('div');
        dblpTimestampTextRow.style.display = 'flex';
        dblpTimestampTextRow.style.justifyContent = 'space-between';
        dblpTimestampTextRow.style.alignItems = 'center';
        dblpTimestampTextRow.style.fontSize = '11px';
        dblpTimestampTextRow.style.color = '#6c757d';
        dblpTimestampTextRow.style.marginBottom = '10px'; // Space before checker section's border/padding
        if (dblpAuthorPid) {
            const dblpProfileLink = document.createElement('a');
            // Construct DBLP profile URL. Standard DBLP person pages are /pid/{pid}.html
            // or /pers/hd/{initial}/{full_pid_path} but /pid/ is more canonical for linking.
            dblpProfileLink.href = `https://dblp.org/pid/${dblpAuthorPid}.html`;
            dblpProfileLink.target = "_blank";
            dblpProfileLink.textContent = "DBLP Profile";
            dblpProfileLink.style.textDecoration = 'none';
            dblpProfileLink.style.color = '#007bff'; // Standard hyperlink blue
            dblpTimestampTextRow.appendChild(dblpProfileLink);
        }
        else {
            // Add an empty div on the left if no DBLP link, to keep timestamp on the right
            dblpTimestampTextRow.appendChild(document.createElement('div'));
        }
        if (cacheTimestamp) {
            const timestampTextElement = document.createElement('div');
            const lastRankingTime = new Date(cacheTimestamp);
            const formattedDate = lastRankingTime.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            const formattedTime = lastRankingTime.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            timestampTextElement.textContent = `Ranks last updated: ${formattedDate} ${formattedTime}`;
            dblpTimestampTextRow.appendChild(timestampTextElement);
        }
        else {
            // Add an empty div on the right if DBLP link exists but no timestamp, to balance flexbox
            if (dblpAuthorPid) {
                dblpTimestampTextRow.appendChild(document.createElement('div'));
            }
        }
        middleBarContainer.appendChild(dblpTimestampTextRow);
        panel.appendChild(middleBarContainer);
    }
    // --- END: DBLP Link and Timestamp section ---
    const checkerSection = document.createElement('div');
    // Adjust marginTop for checkerSection based on whether the DBLP/Timestamp section was added
    if (dblpAuthorPid || cacheTimestamp) {
        checkerSection.style.marginTop = '0px'; // The middleBarContainer provides spacing
    }
    else {
        checkerSection.style.marginTop = '15px'; // Original spacing from list
    }
    checkerSection.style.paddingTop = '10px'; // Keep padding for content separation
    checkerSection.style.borderTop = '1px solid #e0e0e0'; // Always have border before checker
    const checkerTitle = document.createElement('div');
    checkerTitle.textContent = 'Conference Rank Checker (CORE 2023)';
    checkerTitle.style.fontSize = '13px';
    checkerTitle.style.fontWeight = 'bold';
    checkerTitle.style.color = '#555';
    checkerTitle.style.marginBottom = '8px';
    checkerSection.appendChild(checkerTitle);
    const checkerInputContainer = document.createElement('div');
    checkerInputContainer.style.display = 'flex';
    checkerInputContainer.style.alignItems = 'center';
    const conferenceInput = document.createElement('input');
    conferenceInput.type = 'text';
    conferenceInput.placeholder = 'Enter conference name/acronym';
    conferenceInput.style.flexGrow = '1';
    conferenceInput.style.padding = '8px 15px';
    conferenceInput.style.fontSize = '13px';
    conferenceInput.style.border = '1px solid #d0d0d0';
    conferenceInput.style.borderRadius = '20px';
    conferenceInput.style.backgroundColor = '#f8f9fa';
    conferenceInput.style.outline = 'none';
    conferenceInput.onfocus = () => { conferenceInput.style.borderColor = '#76C7C0'; };
    conferenceInput.onblur = () => { conferenceInput.style.borderColor = '#d0d0d0'; };
    checkerInputContainer.appendChild(conferenceInput);
    const rankDisplaySpan = document.createElement('span');
    rankDisplaySpan.style.minWidth = '40px';
    rankDisplaySpan.style.textAlign = 'center';
    checkerInputContainer.appendChild(rankDisplaySpan);
    checkerSection.appendChild(checkerInputContainer);
    let debounceTimeout;
    const debounce = (func, delay) => {
        return (...args) => {
            clearTimeout(debounceTimeout);
            debounceTimeout = window.setTimeout(() => func.apply(null, args), delay);
        };
    };
    const performRankCheck = async () => {
        const venueName = conferenceInput.value.trim();
        rankDisplaySpan.innerHTML = '';
        if (!venueName)
            return;
        try {
            const coreDataForChecker = await loadCoreDataForFile(getCoreDataFileForYear(null));
            if (coreDataForChecker.length > 0) {
                const rank = findRankForVenue(venueName, coreDataForChecker);
                const badgeElement = createRankBadgeElement(rank);
                if (badgeElement) {
                    rankDisplaySpan.appendChild(badgeElement);
                }
                else {
                    rankDisplaySpan.textContent = '-';
                    rankDisplaySpan.style.color = '#999';
                }
            }
            else {
                rankDisplaySpan.textContent = 'Data N/A';
                rankDisplaySpan.style.color = '#cc0000';
            }
        }
        catch (error) {
            console.error("Error in conference rank checker:", error);
            rankDisplaySpan.textContent = 'Error';
            rankDisplaySpan.style.color = '#cc0000';
        }
    };
    conferenceInput.addEventListener('input', debounce(performRankCheck, 500));
    panel.appendChild(checkerSection);
    const finalFooterDiv = document.createElement('div');
    finalFooterDiv.style.display = 'flex';
    finalFooterDiv.style.justifyContent = 'flex-end';
    finalFooterDiv.style.alignItems = 'center';
    finalFooterDiv.style.marginTop = '15px';
    finalFooterDiv.style.paddingTop = '5px';
    finalFooterDiv.style.borderTop = '1px solid #e0e0e0';
    const betaLabel = document.createElement('span');
    betaLabel.textContent = 'BETA';
    betaLabel.style.padding = '1px 7px';
    betaLabel.style.fontSize = '0.7em';
    betaLabel.style.fontWeight = '600';
    betaLabel.style.color = '#fff';
    betaLabel.style.backgroundColor = '#6c757d';
    betaLabel.style.borderRadius = '10px';
    betaLabel.style.lineHeight = '1.4';
    betaLabel.style.height = 'fit-content';
    betaLabel.style.display = 'inline-flex';
    betaLabel.style.alignItems = 'center';
    betaLabel.style.marginRight = '10px';
    betaLabel.style.cursor = 'help';
    betaLabel.setAttribute('title', "Developed by Naveed Anwar Bhatti.\nIt is free and open source.\nIt uses historical CORE rankings (2014-2023) based on publication year.\nHelp us spot inconsistencies!\nFor any issues, please click on “Report Bug”.");
    finalFooterDiv.appendChild(betaLabel);
    const reportBugLink = document.createElement('a');
    reportBugLink.href = "https://forms.office.com/r/PbSzWaQmpJ";
    reportBugLink.target = "_blank";
    reportBugLink.style.textDecoration = 'none';
    reportBugLink.style.color = '#D32F2F';
    reportBugLink.style.fontSize = '0.8em';
    reportBugLink.innerHTML = '🐞 Report Bug';
    reportBugLink.setAttribute('title', 'Report a bug or inconsistency (opens new tab)');
    finalFooterDiv.appendChild(reportBugLink);
    panel.appendChild(finalFooterDiv);
    const gsBdy = document.getElementById('gs_bdy');
    const rightSidebarContainer = gsBdy?.querySelector('div.gsc_rsb');
    if (rightSidebarContainer) {
        const publicAccessElement = rightSidebarContainer.querySelector('#gsc_rsb_mnd');
        const coauthorsElement = rightSidebarContainer.querySelector('#gsc_rsb_co');
        const citedByElement = rightSidebarContainer.querySelector('#gsc_rsb_cit');
        if (publicAccessElement)
            rightSidebarContainer.insertBefore(panel, publicAccessElement);
        else if (coauthorsElement)
            rightSidebarContainer.insertBefore(panel, coauthorsElement);
        else if (citedByElement?.nextSibling)
            rightSidebarContainer.insertBefore(panel, citedByElement.nextSibling);
        else if (citedByElement)
            citedByElement.parentNode?.appendChild(panel);
        else
            rightSidebarContainer.prepend(panel);
    }
    else {
        const profileTableContainer = document.getElementById('gsc_a_c');
        if (profileTableContainer)
            profileTableContainer.before(panel);
        else
            document.body.prepend(panel);
    }
    if (initialCachedPubRanks && initialCachedPubRanks.length > 0) {
        activeCachedPublicationRanks = initialCachedPubRanks;
        rankMapForObserver = new Map();
        activeCachedPublicationRanks.forEach(pubRank => {
            if (pubRank.url && pubRank.rank) {
                rankMapForObserver.set(pubRank.url, pubRank.rank);
            }
        });
        restoreVisibleInlineBadgesFromCache(activeCachedPublicationRanks);
        setupPublicationTableObserver(); // Call the revised function directly
    }
    else {
        activeCachedPublicationRanks = null;
        rankMapForObserver = null;
        disconnectPublicationTableObserver();
    }
}
function setupPublicationTableObserver(retryCount = 0) {
    disconnectPublicationTableObserver(); // Ensure any old one is gone
    const MAX_RETRIES = 5; // Try up to 5 times
    const RETRY_DELAY = 250; // Wait 250ms between retries
    // console.log(`GSR OBSERVER: Attempting to setup observer (Attempt ${retryCount + 1}).`);
    const tableContainer = document.getElementById('gsc_a_b');
    if (!tableContainer) {
        // console.warn(`GSR OBSERVER: Publication table container #gsc_a_c not found (Attempt ${retryCount + 1}).`);
        if (retryCount < MAX_RETRIES) {
            // console.log(`GSR OBSERVER: Will retry in ${RETRY_DELAY}ms.`);
            setTimeout(() => setupPublicationTableObserver(retryCount + 1), RETRY_DELAY);
        }
        else {
            console.error("GSR OBSERVER: Max retries reached for finding #gsc_a_c. Observer not set up. 'Show more' may not work.");
        }
        return;
    }
    // console.log("GSR OBSERVER: #gsc_a_c found. Proceeding with observer setup.");
    // Ensure we have rank data to apply before setting up an observer
    if (!activeCachedPublicationRanks || !rankMapForObserver || rankMapForObserver.size === 0) {
        console.warn("GSR OBSERVER: Setup aborted (at data check step), missing cached rank data or rank map is empty.");
        return;
    }
    let reapplyDebounceTimeout = null;
    publicationTableObserver = new MutationObserver((mutationsList, observerInstance) => {
        // console.log("GSR OBSERVER: Mutation detected in table container.");
        if (!document.body.contains(tableContainer) || publicationTableObserver !== observerInstance) {
            console.warn("GSR OBSERVER: Target no longer in DOM or instance mismatch. Disconnecting this instance.");
            observerInstance.disconnect();
            if (publicationTableObserver === observerInstance) {
                publicationTableObserver = null;
            }
            return;
        }
        if (!activeCachedPublicationRanks || !rankMapForObserver || rankMapForObserver.size === 0) {
            console.warn("GSR OBSERVER: Observer callback aborted, cached rank data became unavailable or empty.");
            return;
        }
        // Check if actual publication rows were added
        let newPubRowsAdded = false;
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node.nodeName === 'TR' && node.classList.contains('gsc_a_tr')) {
                        newPubRowsAdded = true;
                        break;
                    }
                }
            }
            if (newPubRowsAdded)
                break;
        }
        if (!newPubRowsAdded) {
            // console.log("GSR OBSERVER: Mutation detected, but no new 'gsc_a_tr' rows added. Skipping badge restoration.");
            return; // No relevant rows added
        }
        // console.log("GSR OBSERVER: Relevant new publication rows were added to the DOM.");
        if (reapplyDebounceTimeout) {
            clearTimeout(reapplyDebounceTimeout);
        }
        reapplyDebounceTimeout = window.setTimeout(() => {
            // console.log("GSR OBSERVER: Debounced: Restoring badges for all visible rows after 'Show more' or sort.");
            if (activeCachedPublicationRanks && rankMapForObserver && rankMapForObserver.size > 0) {
                restoreVisibleInlineBadgesFromCache(activeCachedPublicationRanks);
            }
            else {
                console.warn("GSR OBSERVER: Debounced re-scan aborted at execution, cached rank data is unavailable or empty.");
            }
        }, 300); // 300ms delay
    });
    try {
        publicationTableObserver.observe(tableContainer, { childList: true, subtree: true });
        console.log("GSR OBSERVER: Publication table container observer successfully attached to #gsc_a_c.");
    }
    catch (e) {
        console.error("GSR ERROR: Failed to attach publication table container observer to #gsc_a_c:", e);
    }
}
function disconnectPublicationTableObserver() {
    if (publicationTableObserver) {
        publicationTableObserver.disconnect();
        publicationTableObserver = null;
    }
}
function restoreVisibleInlineBadgesFromCache(cachedRanks) {
    const allVisibleRows = document.querySelectorAll('tr.gsc_a_tr');
    const currentRankMap = rankMapForObserver;
    console.log(`GSR RESTORE: Attempting badge restoration. Visible rows: ${allVisibleRows.length}, Cached ranks: ${cachedRanks.length}, Map size: ${currentRankMap ? currentRankMap.size : 'N/A'}`);
    if (allVisibleRows.length === 0 || !cachedRanks || cachedRanks.length === 0 || !currentRankMap || currentRankMap.size === 0) {
        console.warn("GSR RESTORE: Conditions not met (no rows, no ranks, or map unavailable/empty). Skipping.");
        return;
    }
    let badgesAppliedCount = 0;
    allVisibleRows.forEach((row, index) => {
        const rowElement = row;
        const linkEl = rowElement.querySelector('td.gsc_a_t a.gsc_a_at');
        const existingBadge = rowElement.querySelector('span.gsr-rank-badge-inline');
        if (existingBadge) {
            // If it already has a badge from this script, we can potentially skip it,
            // or remove and re-add. Current logic removes and re-adds.
            // console.log(`GSR RESTORE: Row ${index} already has a badge. It will be replaced.`);
        }
        const titleCell = rowElement.querySelector('td.gsc_a_t');
        if (titleCell) {
            const oldBadge = titleCell.querySelector('span.gsr-rank-badge-inline');
            oldBadge?.remove();
        }
        if (linkEl instanceof HTMLAnchorElement && linkEl.href) {
            const currentDomUrl = linkEl.href;
            const normalizedCurrentUrl = normalizeUrlForCache(currentDomUrl);
            const pubTitleForLog = linkEl.textContent?.trim().substring(0, 30) + "...";
            if (index < 5 || index >= allVisibleRows.length - 5) { // Log first 5 and last 5 for brevity
                console.log(`GSR RESTORE (Row ${index}, Title: "${pubTitleForLog}"): DOM URL="${currentDomUrl}", Normalized URL="${normalizedCurrentUrl}"`);
            }
            const cachedRank = currentRankMap.get(normalizedCurrentUrl);
            if (cachedRank) {
                if (index < 5 || index >= allVisibleRows.length - 5) {
                    console.log(`GSR RESTORE (Row ${index}, Title: "${pubTitleForLog}"): Found rank "${cachedRank}" for normalized URL "${normalizedCurrentUrl}". Applying badge.`);
                }
                displayRankBadgeAfterTitle(rowElement, cachedRank);
                badgesAppliedCount++;
            }
            else {
                if (index < 5 || index >= allVisibleRows.length - 5) { // Log misses for first/last few
                    console.warn(`GSR RESTORE (Row ${index}, Title: "${pubTitleForLog}"): Rank NOT FOUND for normalized URL "${normalizedCurrentUrl}" (from DOM URL "${currentDomUrl}")`);
                    // One-time log of some keys from the map for comparison if it's the first few misses
                    // if (index < 5 && !currentRankMap.has(normalizedCurrentUrl)) {
                    //    console.log("GSR RESTORE: Sample keys from rankMap: ", Array.from(currentRankMap.keys()).slice(0, 5));
                    // }
                }
            }
        }
        else {
            if (index < 5 || index >= allVisibleRows.length - 5) {
                console.warn(`GSR RESTORE (Row ${index}): No link element found or href missing.`);
            }
        }
    });
    console.log(`GSR RESTORE: Finished. Applied ${badgesAppliedCount} badges to ${allVisibleRows.length} visible rows.`);
}
// --- START: DBLP Integration Functions ---
function getScholarAuthorName() {
    const nameElement = document.getElementById('gsc_prf_in');
    if (nameElement) {
        return nameElement.textContent?.trim() || null;
    }
    // Fallback for potentially different DOM structures if #gsc_prf_in isn't found
    const legacyNameElement = document.querySelector('#gsc_prf_in_name_value');
    if (legacyNameElement) {
        return legacyNameElement.textContent?.trim() || null;
    }
    // Try another common pattern if the profile header is simpler
    const h1NameElement = document.querySelector('#gs_hdr_name > a, #gs_hdr_name');
    if (h1NameElement) {
        return h1NameElement.textContent?.trim() || null;
    }
    return null;
}
function getScholarSamplePublications(count = 7) {
    const samples = [];
    const publicationRows = document.querySelectorAll('tr.gsc_a_tr');
    for (let i = 0; i < Math.min(publicationRows.length, count); i++) {
        const row = publicationRows[i];
        const linkEl = row.querySelector('td.gsc_a_t a.gsc_a_at');
        const yearEl = row.querySelector('td.gsc_a_y span.gsc_a_h');
        if (linkEl instanceof HTMLAnchorElement && linkEl.href && linkEl.textContent) {
            let year = null;
            if (yearEl?.textContent && /^\d{4}$/.test(yearEl.textContent.trim())) {
                year = parseInt(yearEl.textContent.trim(), 10);
            }
            samples.push({
                title: cleanTextForComparison(linkEl.textContent),
                year: year,
                scholarUrl: linkEl.href
            });
        }
    }
    return samples;
}
async function searchDblpForAuthor(authorName, statusElement) {
    const statusTextEl = statusElement?.querySelector('.gsr-status-text');
    if (statusTextEl)
        statusTextEl.textContent = `DBLP: Searching for "${authorName}"...`;
    const url = new URL(DBLP_API_AUTHOR_SEARCH_URL);
    url.searchParams.append('q', authorName);
    url.searchParams.append('format', 'json');
    url.searchParams.append('h', '10');
    url.searchParams.append('c', '3'); // Request some completions (publications)
    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            console.warn(`DBLP: Author search failed for "${authorName}": ${response.statusText}`);
            if (statusTextEl)
                statusTextEl.textContent = `DBLP: Search failed (${response.status}).`;
            return [];
        }
        const data = await response.json();
        if (data.result?.hits?.hit) {
            const hits = Array.isArray(data.result.hits.hit) ? data.result.hits.hit : [data.result.hits.hit];
            if (statusTextEl)
                statusTextEl.textContent = `DBLP: Found ${hits.length} potential author(s). Analyzing...`;
            return hits;
        }
    }
    catch (error) {
        console.error("DBLP: Error during author search:", error);
    }
    if (statusTextEl)
        statusTextEl.textContent = `DBLP: No results or error for "${authorName}".`;
    return [];
}
function extractPidFromDblpUrl(dblpAuthorUrl) {
    const matchPers = dblpAuthorUrl.match(/dblp\.org\/pers\/hd\/[a-z0-9]\/([^.]+)/i);
    if (matchPers && matchPers[1]) {
        return matchPers[1].replace(/=/g, '');
    }
    const matchPid = dblpAuthorUrl.match(/dblp\.org\/pid\/([^/]+\/[^.]+)/i);
    if (matchPid && matchPid[1]) {
        return matchPid[1];
    }
    // A simpler PID extraction, e.g. https://dblp.org/pid/01/1234.html -> 01/1234
    const simplePidMatch = dblpAuthorUrl.match(/dblp\.org\/pid\/([\w\/-]+)\.html/i);
    if (simplePidMatch && simplePidMatch[1]) {
        return simplePidMatch[1];
    }
    // For URLs like: https://dblp.org/pers/gnd/123456789
    const gndMatch = dblpAuthorUrl.match(/dblp\.org\/pers\/gnd\/(\w+)/i);
    if (gndMatch && gndMatch[1]) {
        return `gnd/${gndMatch[1]}`; // Prefix to indicate it's a GND PID if needed
    }
    console.warn("DBLP: Could not extract PID from URL:", dblpAuthorUrl);
    return null;
}
async function selectBestDblpCandidateHeuristically(scholarAuthorName, scholarSamplePubs, dblpCandidates, statusElement) {
    const statusTextEl = statusElement?.querySelector('.gsr-status-text');
    if (statusTextEl)
        statusTextEl.textContent = `DBLP: Analyzing ${dblpCandidates.length} potential DBLP candidates...`;
    console.log("--- DBLP Heuristic Matching Start ---");
    console.log("Scholar Author Name:", scholarAuthorName);
    console.log("Scholar Sample Pubs (titles only for brevity):", scholarSamplePubs.map(p => `${p.title.substring(0, 50)}... (${p.year})`));
    let bestCandidatePid = null;
    let highestScore = 0;
    for (const [index, candidateHit] of dblpCandidates.entries()) {
        console.log(`\nProcessing DBLP Candidate Hit #${index + 1} of ${dblpCandidates.length}:`);
        console.log("GSR DEBUG: Current candidateHit object being evaluated:", JSON.stringify(candidateHit, null, 2)); // Log the object
        // Check using .author and .url from candidateHit.info
        if (!candidateHit.info || typeof candidateHit.info.author !== 'string' || !candidateHit.info.url || typeof candidateHit.info.url !== 'string') {
            console.warn("DBLP: Candidate hit is malformed (missing info, info.author (string), or info.url (string)), skipping. Condition was true.");
            console.warn("GSR DEBUG: Values causing skip: candidateHit.info:", candidateHit.info, "typeof candidateHit.info.author:", typeof candidateHit.info?.author, "candidateHit.info.url:", candidateHit.info?.url, "typeof candidateHit.info.url:", typeof candidateHit.info?.url);
            continue;
        }
        const candidateDblpName = candidateHit.info.author.replace(/\s\d{4}$/, '').trim();
        const nameSimilarity = jaroWinkler(scholarAuthorName.toLowerCase(), candidateDblpName.toLowerCase());
        console.log(`  Candidate DBLP Author: "${candidateDblpName}", URL from info: ${candidateHit.info.url}`);
        console.log(`  Name Similarity (vs "${scholarAuthorName}"): ${nameSimilarity.toFixed(3)}`);
        const MIN_NAME_SIMILARITY_FOR_FULL_FETCH = 0.70;
        if (nameSimilarity < MIN_NAME_SIMILARITY_FOR_FULL_FETCH) {
            console.log(`  Name Similarity ${nameSimilarity.toFixed(3)} < ${MIN_NAME_SIMILARITY_FOR_FULL_FETCH}. Skipping full publication fetch for this candidate.`);
            continue;
        }
        let currentScore = nameSimilarity * 2.0;
        console.log(`  Initial score from name similarity: ${currentScore.toFixed(3)}`);
        const candidatePid = extractPidFromDblpUrl(candidateHit.info.url); // Use candidateHit.info.url
        if (!candidatePid) {
            console.log(`  Could not extract PID for DBLP candidate "${candidateDblpName}" from info.url: ${candidateHit.info.url}, skipping full publication fetch.`);
            continue;
        }
        console.log(`  Extracted PID: ${candidatePid}`);
        if (statusTextEl)
            statusTextEl.textContent = `DBLP: Verifying "${candidateDblpName}" (PID: ${candidatePid})... (${index + 1}/${dblpCandidates.length})`;
        console.log(`  Fetching full publications for DBLP PID: ${candidatePid} (Author: "${candidateDblpName}")`);
        const candidateFullDblpPubs = await fetchPublicationsFromDblp(candidatePid, undefined);
        console.log(`  Fetched ${candidateFullDblpPubs.length} DBLP publications for PID ${candidatePid}. First 3:`, candidateFullDblpPubs.slice(0, 3).map(p => ({ title: p.title.substring(0, 50) + "...", venue: p.venue, year: p.year })));
        let overlapCount = 0;
        let publicationMatchScoreContribution = 0;
        if (candidateFullDblpPubs.length > 0 && scholarSamplePubs.length > 0) {
            console.log(`  Comparing ${scholarSamplePubs.length} Scholar samples with ${candidateFullDblpPubs.length} full DBLP publications for "${candidateDblpName}"`);
            for (const scholarPub of scholarSamplePubs) {
                for (const dblpPub of candidateFullDblpPubs) {
                    const cleanDblpTitle = cleanTextForComparison(dblpPub.title.toLowerCase());
                    const titleScore = jaroWinkler(scholarPub.title, cleanDblpTitle);
                    const TITLE_MATCH_THRESHOLD = 0.85;
                    if (titleScore > TITLE_MATCH_THRESHOLD) {
                        console.log(`    MATCH! Scholar: "${scholarPub.title.substring(0, 50)}..." (Year: ${scholarPub.year}) <-> DBLP: "${dblpPub.title.substring(0, 50)}..." (Year: ${dblpPub.year}) [Title Similarity: ${titleScore.toFixed(3)}]`);
                        publicationMatchScoreContribution += 1.0;
                        overlapCount++;
                        if (scholarPub.year && dblpPub.year) {
                            const scholarYearNum = scholarPub.year;
                            const dblpYearNum = parseInt(dblpPub.year, 10);
                            if (!isNaN(dblpYearNum) && Math.abs(scholarYearNum - dblpYearNum) <= 1) {
                                publicationMatchScoreContribution += 0.5;
                                console.log("      Year match bonus (0.5) applied.");
                            }
                        }
                        break;
                    }
                }
            }
        }
        currentScore += publicationMatchScoreContribution;
        console.log(`  Overlap Count (full publication check): ${overlapCount}`);
        console.log(`  Publication Match Score Contribution: ${publicationMatchScoreContribution.toFixed(3)}`);
        console.log(`  Current Total Score for DBLP candidate "${candidateDblpName}": ${currentScore.toFixed(3)}`);
        if (currentScore > highestScore && overlapCount >= DBLP_HEURISTIC_MIN_OVERLAP_COUNT) {
            highestScore = currentScore;
            bestCandidatePid = candidatePid;
            console.log(`  *** NEW BEST CANDIDATE (full check): PID ${bestCandidatePid}, Author "${candidateDblpName}", Score ${highestScore.toFixed(3)} ***`);
        }
    }
    console.log("--- DBLP Heuristic Matching End ---");
    // ... (rest of the function for threshold check and returning PID)
    if (bestCandidatePid && highestScore >= DBLP_HEURISTIC_SCORE_THRESHOLD) {
        if (statusTextEl)
            statusTextEl.textContent = `DBLP: Confidently matched PID ${bestCandidatePid} (Score: ${highestScore.toFixed(2)}).`;
        console.log(`GSR: DBLP Heuristic Match SUCCESS for "${scholarAuthorName}" -> PID: ${bestCandidatePid}, Score: ${highestScore.toFixed(2)}`);
        return bestCandidatePid;
    }
    else {
        if (statusTextEl)
            statusTextEl.textContent = `DBLP: No confident DBLP match found (Best score: ${highestScore.toFixed(2)}).`;
        console.log(`GSR: DBLP heuristic matching failed for "${scholarAuthorName}". Best score ${highestScore.toFixed(2)}. Threshold: ${DBLP_HEURISTIC_SCORE_THRESHOLD}, Min Overlap Required: ${DBLP_HEURISTIC_MIN_OVERLAP_COUNT}`);
        return null;
    }
}
async function fetchPublicationsFromDblp(authorPidPath, statusElement) {
    const statusTextEl = statusElement?.querySelector(".gsr-status-text");
    if (statusTextEl) {
        statusTextEl.textContent = `DBLP: Fetching publications for PID ${authorPidPath}…`;
    }
    const xmlUrl = `${DBLP_API_PERSON_PUBS_URL_PREFIX}${authorPidPath}.xml`;
    const publications = [];
    try {
        const response = await fetch(xmlUrl);
        if (!response.ok) {
            console.warn(`DBLP: Fetching publications XML failed for PID "${authorPidPath}": ${response.statusText} (${response.status})`);
            if (statusTextEl)
                statusTextEl.textContent = "DBLP: XML fetch failed.";
            return [];
        }
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");
        if (xmlDoc.querySelector("parsererror")) {
            console.error("DBLP: XML parse error for PID", authorPidPath);
            if (statusTextEl)
                statusTextEl.textContent = "DBLP: XML parse error.";
            return [];
        }
        const items = Array.from(xmlDoc.querySelectorAll("dblpperson > r > *"));
        for (const item of items) {
            const dblpKey = item.getAttribute("key") || "";
            if (!dblpKey)
                continue; // safety
            const title = (item.querySelector("title")?.textContent || "")
                .replace(/\.$/, "");
            if (!title)
                continue;
            const year = item.querySelector("year")?.textContent || null;
            const pages = item.querySelector("pages")?.textContent || null;
            /* ---------- 1. raw venue (booktitle / journal / …) ---------- */
            const venueElements = ["booktitle", "journal", "series", "school"];
            let rawVenue = null;
            for (const tag of venueElements) {
                const txt = item.querySelector(tag)?.textContent?.trim();
                if (txt) {
                    rawVenue = txt;
                    break;
                }
            }
            /* ---------- 2. stream-derived metadata (optional) ---------- */
            let acronym = null;
            let venue_full = null;
            const pubUrl = item.querySelector("url")?.textContent?.trim();
            if (pubUrl) {
                const streamMatch = pubUrl.match(/^db\/conf\/[^/]+\/([a-zA-Z][\w-]*?)(\d{4}.*)?\.html/);
                if (streamMatch?.[1]) {
                    const streamId = streamMatch[1];
                    const streamXmlUrl = `https://dblp.org/streams/conf/${streamId}.xml`;
                    const streamMeta = await fetchDblpStreamMetadata(streamXmlUrl);
                    if (streamMeta) {
                        acronym = streamMeta.acronym ?? null; // may still be null
                        venue_full = streamMeta.title ?? null;
                    }
                }
            }
            /* ---------- 3. push entry ---------- */
            publications.push({
                dblpKey,
                title,
                venue: rawVenue, // ← always “raw” venue
                year,
                pages,
                venue_full, // ← null if no valid stream
                acronym // ← null if no valid stream
            });
        }
        if (statusTextEl) {
            statusTextEl.textContent =
                `DBLP: Fetched ${publications.length} publications.`;
        }
    }
    catch (err) {
        console.error("DBLP: Error fetching/parsing XML:", err);
        if (statusTextEl)
            statusTextEl.textContent = "DBLP: Error fetching pubs.";
    }
    return publications;
}
function getPageCountFromDblpString(pageStr) {
    if (!pageStr) {
        return null;
    }
    pageStr = pageStr.trim();
    // Handle article numbers like "Article 27", "23", "IV" - these are not page counts
    if (/^(article\s+\d+|\d+$|[ivxlcdm]+$)/i.test(pageStr) && !pageStr.includes('-') && !pageStr.includes(':')) {
        // If it's just a number, it could be a single page or start page.
        // For simplicity, if it's not a range, we can't be sure of the count.
        // Or, assume 1 page if it's just a number like "123". Let's be conservative.
        const singleNumMatch = pageStr.match(/^(\d+)$/);
        if (singleNumMatch) {
            // This is ambiguous. Could be page "123" (1 page) or start of many.
            // Let's return null to indicate uncertainty for single numbers unless it's very small.
            // if (parseInt(singleNumMatch[1],10) < 5) return 1; // Heuristic: small single number likely 1 page
            return null;
        }
        return null; // Cannot determine count from article numbers or single Roman numerals
    }
    // Handle ranges like "10-15" or "S10-S15"
    let match = pageStr.match(/^(?:[a-z\d]+:)?(\d+)\s*-\s*(?:[a-z\d]+:)?(\d+)$/i); // Supports "section:start-section:end" or just "start-end"
    if (match) {
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        if (!isNaN(start) && !isNaN(end) && end >= start) {
            return end - start + 1;
        }
    }
    // Handle electronic journal pages like "25:1-25:10" or "1-10" (within an article number context)
    // This pattern is similar to the one above but allows for the colon prefix on both sides.
    match = pageStr.match(/^(?:(\d+):)?(\d+)\s*-\s*(?:(\d+):)?(\d+)$/i);
    if (match) {
        const prefix1 = match[1]; // e.g. "25" in "25:1"
        const startPage = parseInt(match[2], 10);
        const prefix2 = match[3]; // e.g. "25" in "25:10"
        const endPage = parseInt(match[4], 10);
        if (!isNaN(startPage) && !isNaN(endPage) && endPage >= startPage) {
            // If prefixes exist and are different, it's complex (e.g., 25:8-26:2).
            // For simplicity, if prefixes are the same or only one side has a prefix,
            // or no prefixes, calculate simple page diff.
            if (prefix1 === undefined && prefix2 === undefined) { // e.g. "1-10"
                return endPage - startPage + 1;
            }
            if (prefix1 && prefix2 && prefix1 === prefix2) { // e.g. "25:1-25:10"
                return endPage - startPage + 1;
            }
            // More complex cases like "10:S1-10:S5" or cross-section ranges are harder to generalize
            // For now, if prefixes differ or are one-sided with a range, we might still get a valid count
            // if the simple start-end logic makes sense.
            // If only end has prefix, it's odd. If only start has prefix, it's also odd for standard ranges.
            // This simplified logic might misinterpret some complex cases, but covers common ones.
            return endPage - startPage + 1;
        }
    }
    // If no specific format matched, we can't determine a reliable count.
    return null;
}
async function buildDblpInfoMap(scholarPubLinkElements, dblpPublications, 
// MODIFIED: Update mapToFill's type signature to include venue_full and acronym
mapToFill, statusElement) {
    if (dblpPublications.length === 0)
        return;
    const statusTextEl = statusElement?.querySelector('.gsr-status-text');
    if (statusTextEl)
        statusTextEl.textContent = `DBLP: Mapping ${scholarPubLinkElements.length} Scholar to ${dblpPublications.length} DBLP entries...`;
    let mappedCount = 0;
    for (const scholarPub of scholarPubLinkElements) {
        const cleanScholarTitle = cleanTextForComparison(scholarPub.titleText);
        for (const dblpPub of dblpPublications) {
            const cleanDblpTitle = cleanTextForComparison(dblpPub.title.toLowerCase());
            const titleSimilarity = jaroWinkler(cleanScholarTitle, cleanDblpTitle);
            // inside buildDblpInfoMap(), just before the `if (titleSimilarity > 0.90)` line
            if (titleSimilarity > 0.90) { // Threshold for title match
                let yearMatch = false;
                if (scholarPub.yearFromProfile && dblpPub.year) {
                    if (Math.abs(scholarPub.yearFromProfile - parseInt(dblpPub.year, 10)) <= 1) {
                        yearMatch = true;
                    }
                }
                else {
                    yearMatch = true;
                }
                // dblpPub.venue might be null if no stream and no fallback booktitle/journal
                // but dblpKey should always exist for a valid DBLP entry.
                if (yearMatch && dblpPub.dblpKey) {
                    const pageCount = getPageCountFromDblpString(dblpPub.pages);
                    mapToFill.set(scholarPub.url, {
                        venue: dblpPub.venue,
                        pageCount: pageCount,
                        dblpKey: dblpPub.dblpKey,
                        venue_full: dblpPub.venue_full, // Store full venue title from stream
                        acronym: dblpPub.acronym // Store acronym from stream
                    });
                    mappedCount++;
                    break;
                }
            }
        }
    }
    console.log(`GSR: DBLP Info Mapping: Matched ${mappedCount} of ${scholarPubLinkElements.length} Scholar publications to DBLP entries.`);
    if (statusTextEl && mappedCount > 0)
        statusTextEl.textContent = `DBLP: Mapped ${mappedCount} publication details.`;
}
// --- END: DBLP Integration Functions ---
// --- START: Main Orchestration ---
async function main() {
    if (isMainProcessing) {
        return;
    }
    isMainProcessing = true;
    // Clear session-specific DBLP data
    disconnectPublicationTableObserver();
    activeCachedPublicationRanks = null;
    rankMapForObserver = null;
    dblpPubsForCurrentUser = [];
    scholarUrlToDblpInfoMap.clear(); // Ensure it's clear for this run
    const statusElement = createStatusElement("Initializing Scholar Ranker...");
    const statusTextElement = statusElement.querySelector('.gsr-status-text');
    const currentUserId = getScholarUserId();
    const determinedPublicationRanks = [];
    let cachedDblpPidForSave = null;
    // --- START: Sets for de-duplication ---
    const scholarTitlesAlreadyRanked = new Set(); // Stores exact Scholar titles that got A*/A/B/C
    const dblpKeysAlreadyUsedForRank = new Set(); // Stores DBLP keys that yielded an A*/A/B/C
    // --- END: Sets for de-duplication ---
    try {
        // --- DBLP Author Identification & Data Fetch ---
        if (currentUserId) {
            const scholarAuthorName = getScholarAuthorName();
            if (scholarAuthorName) {
                const cachedUserData = await loadCachedData(currentUserId);
                // Prefer fresh DBLP match if cache is old or PID is missing
                if (cachedUserData?.dblpAuthorPid && cachedUserData.dblpMatchTimestamp && (Date.now() - cachedUserData.dblpMatchTimestamp) < DBLP_CACHE_DURATION_MS) {
                    cachedDblpPidForSave = cachedUserData.dblpAuthorPid;
                    console.log("GSR INFO: Using valid cached DBLP PID:", cachedDblpPidForSave);
                }
                else {
                    if (cachedUserData?.dblpAuthorPid)
                        console.log("GSR INFO: Cached DBLP PID is stale or missing timestamp. Will attempt fresh DBLP author match.");
                    else
                        console.log("GSR INFO: No valid cached DBLP PID. Attempting fresh DBLP author match for:", scholarAuthorName);
                    if (statusTextElement)
                        statusTextElement.textContent = `DBLP: Searching for ${scholarAuthorName}...`;
                    const scholarSamplePubs = getScholarSamplePublications(7);
                    if (scholarSamplePubs.length >= DBLP_HEURISTIC_MIN_OVERLAP_COUNT) {
                        const dblpCandidates = await searchDblpForAuthor(scholarAuthorName, statusElement);
                        if (dblpCandidates.length > 0) {
                            cachedDblpPidForSave = await selectBestDblpCandidateHeuristically(scholarAuthorName, scholarSamplePubs, dblpCandidates, statusElement);
                        }
                        else {
                            if (statusTextElement)
                                statusTextElement.textContent = "DBLP: No candidates found for this author.";
                        }
                    }
                    else {
                        if (statusTextElement)
                            statusTextElement.textContent = "DBLP: Not enough unique Scholar publications for match attempt.";
                    }
                }
                if (cachedDblpPidForSave) {
                    if (statusTextElement && dblpPubsForCurrentUser.length === 0)
                        statusTextElement.textContent = `DBLP: Fetching publications for PID ${cachedDblpPidForSave}...`;
                    dblpPubsForCurrentUser = await fetchPublicationsFromDblp(cachedDblpPidForSave, statusElement);
                }
                else {
                    if (statusTextElement && scholarAuthorName)
                        statusTextElement.textContent = "DBLP: Could not match author. Ranking may be limited.";
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
            else {
                if (statusTextElement)
                    statusTextElement.textContent = "Could not determine Scholar author name from page.";
            }
        }
        // --- End DBLP ---
        if (statusTextElement)
            statusTextElement.textContent = "Expanding publications list...";
        await expandAllPublications(statusElement);
        const publicationLinkElements = [];
        document.querySelectorAll('tr.gsc_a_tr').forEach(row => {
            const linkEl = row.querySelector('td.gsc_a_t a.gsc_a_at');
            const yearEl = row.querySelector('td.gsc_a_y span.gsc_a_h');
            let yearFromProfile = null;
            if (yearEl?.textContent && /^\d{4}$/.test(yearEl.textContent.trim())) {
                yearFromProfile = parseInt(yearEl.textContent.trim(), 10);
            }
            if (linkEl instanceof HTMLAnchorElement && linkEl.href && linkEl.textContent) {
                publicationLinkElements.push({
                    url: normalizeUrlForCache(linkEl.href),
                    rowElement: row,
                    titleText: linkEl.textContent.trim().toLowerCase(), // Title is normalized here
                    yearFromProfile: yearFromProfile
                });
            }
        });
        if (publicationLinkElements.length === 0) {
            if (statusTextElement)
                statusTextElement.textContent = "No publications found on profile.";
            setTimeout(() => document.getElementById(STATUS_ELEMENT_ID)?.remove(), 3000);
            isMainProcessing = false;
            return;
        }
        if (dblpPubsForCurrentUser.length > 0) {
            // This will populate scholarUrlToDblpInfoMap with dblpKey
            await buildDblpInfoMap(publicationLinkElements, dblpPubsForCurrentUser, scholarUrlToDblpInfoMap, statusElement);
        }
        else {
            // ... (logging if DBLP match but no pubs, or no DBLP match) ...
        }
        updateStatusElement(statusElement, 0, publicationLinkElements.length, "Ranking");
        const rankCounts = { "A*": 0, "A": 0, "B": 0, "C": 0, "N/A": 0 };
        let processedCount = 0;
        const processPublication = async (pubInfo, 
        // Passed sets for de-duplication:
        titlesAlreadyProcessedSet, dblpKeysUsedSet) => {
            // Check 1: Exact Scholar title already processed and received a valid rank.
            if (titlesAlreadyProcessedSet.has(pubInfo.titleText)) {
                console.log(`GSR INFO: Scholar title (exact) "${pubInfo.titleText.substring(0, 50)}..." already ranked. Marking as N/A.`);
                return { rank: "N/A", rowElement: pubInfo.rowElement, titleText: pubInfo.titleText, url: pubInfo.url };
            }
            let currentRank = "N/A";
            let dblpKeyUsedForThisRanking = null;
            try {
                // Check 2: Keyword filter on the Scholar title itself.
                for (const keyword of IGNORE_KEYWORDS) {
                    if (pubInfo.titleText.includes(keyword)) { // pubInfo.titleText is already lowercase
                        return { rank: "N/A", rowElement: pubInfo.rowElement, titleText: pubInfo.titleText, url: pubInfo.url };
                    }
                }
                const dblpInfo = scholarUrlToDblpInfoMap.get(pubInfo.url); // pubInfo.url is normalized
                if (dblpInfo && dblpInfo.venue && dblpInfo.dblpKey) { // DBLP info is available
                    dblpKeyUsedForThisRanking = dblpInfo.dblpKey; // This DBLP entry is being considered
                    // Check 3: This DBLP entry (by its key) has already provided an A*/A/B/C rank.
                    if (dblpKeysUsedSet.has(dblpInfo.dblpKey)) {
                        console.log(`GSR INFO: DBLP key "${dblpInfo.dblpKey}" (for Scholar title "${pubInfo.titleText.substring(0, 50)}...") already used to assign a rank. Marking as N/A.`);
                        return { rank: "N/A", rowElement: pubInfo.rowElement, titleText: pubInfo.titleText, url: pubInfo.url };
                    }
                    // --- Proceed with DBLP-based ranking ---
                    let venueName = dblpInfo.venue;
                    let pageCount = dblpInfo.pageCount;
                    let publicationYear = pubInfo.yearFromProfile;
                    // Refine year using the DBLP entry's year if possible
                    const matchedDblpEntry = dblpPubsForCurrentUser.find(dp => dp.dblpKey === dblpInfo.dblpKey);
                    if (matchedDblpEntry && matchedDblpEntry.year) {
                        const dblpYearNum = parseInt(matchedDblpEntry.year, 10);
                        if (!isNaN(dblpYearNum)) {
                            publicationYear = dblpYearNum;
                        }
                    }
                    // Page count filter (from DBLP)
                    if (pageCount !== null && pageCount < 6) {
                        console.log(`GSR INFO: Excluding DBLP-identified paper "${pubInfo.titleText.substring(0, 50)}..." (DBLP Key: ${dblpInfo.dblpKey}) due to page count < 6 (Pages: ${pageCount}). Venue: ${venueName}`);
                        return { rank: "N/A", rowElement: pubInfo.rowElement, titleText: pubInfo.titleText, url: pubInfo.url };
                    }
                    const effectiveYear = publicationYear;
                    // venueName here is still dblpInfo.venue (which could be the stream acronym or the booktitle)
                    // This is used for the IGNORE_KEYWORDS check on the DBLP venue.
                    const lowerVenueName = venueName ? venueName.toLowerCase() : "";
                    let venueIgnoredByKeyword = false;
                    if (venueName) { // Only check if venueName is not null
                        for (const keyword of IGNORE_KEYWORDS) {
                            if (lowerVenueName.includes(keyword)) {
                                venueIgnoredByKeyword = true;
                                break;
                            }
                        }
                    }
                    else {
                        // If venueName itself is null (e.g. DBLP entry had no booktitle, journal, or stream acronym),
                        // it likely won't find a rank anyway, but we can consider it as not passing keyword checks
                        // or handle it as an inability to rank. For now, findRankForVenue will receive null.
                    }
                    if (!venueIgnoredByKeyword) {
                        const coreDataFile = getCoreDataFileForYear(effectiveYear);
                        const yearSpecificCoreData = await loadCoreDataForFile(coreDataFile);
                        if (yearSpecificCoreData.length > 0) {
                            // --- MODIFICATION STARTS HERE ---
                            let venueForRankingApi = null;
                            // dblpInfo.acronym comes from DblpPublicationEntry.acronym (the <acronym> tag from stream XML)
                            // venueName is dblpInfo.venue (which is DblpPublicationEntry.venue)
                            if (dblpInfo.acronym && dblpInfo.acronym.trim() !== "") { // Prioritize dblpInfo.acronym if it exists and is not empty
                                venueForRankingApi = dblpInfo.acronym;
                            }
                            else if (venueName && venueName.trim() !== "") { // Fallback to venueName (dblpInfo.venue) if acronym is not usable
                                venueForRankingApi = venueName;
                            }
                            // If both dblpInfo.acronym and venueName are null/empty, venueForRankingApi will be null.
                            // findRankForVenue should handle null input gracefully (it typically returns "N/A").
                            const fullVenueTitleForRanking = dblpInfo.venue_full ?? null;
                            currentRank = findRankForVenue(venueForRankingApi || "", yearSpecificCoreData, fullVenueTitleForRanking // <-- new tie-breaker input
                            );
                            // Use non-null assertion if findRankForVenue expects string, or adjust findRankForVenue
                            // Assuming findRankForVenue can handle null for its first param and returns "N/A"
                            // If findRankForVenue cannot handle null and expects a string, ensure venueForRankingApi is a string or ""
                            // currentRank = findRankForVenue(venueForRankingApi || "", yearSpecificCoreData); // Example: pass empty string if null
                            // --- MODIFICATION ENDS HERE ---
                        }
                    }
                    // --- End DBLP-based ranking logic ---
                }
                // If no dblpInfo (i.e., this Scholar URL did not map to any DBLP entry),
                // currentRank remains "N/A". 
            }
            catch (error) {
                console.warn(`GSR Error processing publication (URL: ${pubInfo.url}, Title: "${pubInfo.titleText.substring(0, 50)}..."):`, error);
            }
            // If a valid rank (A*, A, B, C) was determined:
            if (VALID_RANKS.includes(currentRank)) {
                titlesAlreadyProcessedSet.add(pubInfo.titleText); // Mark this exact Scholar title as having received a valid rank.
                if (dblpKeyUsedForThisRanking) { // If the rank came from a DBLP entry
                    dblpKeysUsedSet.add(dblpKeyUsedForThisRanking); // Mark this DBLP key as "used up" for ranking.
                }
            }
            return { rank: currentRank, rowElement: pubInfo.rowElement, titleText: pubInfo.titleText, url: pubInfo.url };
        };
        for (const pubInfo of publicationLinkElements) {
            // Pass the de-duplication sets to processPublication
            const result = await processPublication(pubInfo, scholarTitlesAlreadyRanked, dblpKeysAlreadyUsedForRank);
            rankCounts[result.rank]++;
            displayRankBadgeAfterTitle(result.rowElement, result.rank);
            determinedPublicationRanks.push({
                titleText: result.titleText, // This is the original, non-cleaned title for storage if needed elsewhere
                rank: result.rank,
                url: result.url // Normalized URL
            });
            processedCount++;
            updateStatusElement(statusElement, processedCount, publicationLinkElements.length, "Ranking");
        }
        if (currentUserId) {
            await saveCachedData(currentUserId, rankCounts, determinedPublicationRanks, cachedDblpPidForSave);
        }
        displaySummaryPanel(rankCounts, currentUserId, determinedPublicationRanks, Date.now(), cachedDblpPidForSave);
    }
    catch (error) {
        console.error("GSR: Uncaught error in main pipeline:", error);
        const statusElem = document.getElementById(STATUS_ELEMENT_ID) || createStatusElement("An error occurred in main pipeline.");
        const currentStatusText = statusElem.querySelector('.gsr-status-text');
        if (currentStatusText)
            currentStatusText.textContent = "Error in main. Check console.";
        const progressBar = statusElem.querySelector('.gsr-progress-bar-inner');
        if (progressBar)
            progressBar.style.backgroundColor = 'red';
    }
    finally {
        isMainProcessing = false;
    }
}
// --- END: Main Orchestration ---
async function initialLoad() {
    if (isMainProcessing) {
        return;
    }
    const userId = getScholarUserId();
    if (userId) {
        const cached = await loadCachedData(userId);
        if (cached && cached.publicationRanks) {
            // Pass cached.dblpAuthorPid to displaySummaryPanel
            displaySummaryPanel(cached.rankCounts, userId, cached.publicationRanks, cached.timestamp, cached.dblpAuthorPid);
            return;
        }
    }
    main().catch(error => {
        console.error("GSR: Error during initial full analysis in main():", error);
        const statusElem = document.getElementById(STATUS_ELEMENT_ID) || createStatusElement("A critical error occurred.");
        const statusText = statusElem.querySelector('.gsr-status-text');
        if (statusText)
            statusText.textContent = "Critical Error. Check console.";
        if (statusElem.querySelector('.gsr-progress-bar-inner'))
            statusElem.querySelector('.gsr-progress-bar-inner').style.backgroundColor = 'red';
    });
}
function executeInitialLoad() {
    // console.log("GSR: Conditions met, executing initialLoad.");
    initialLoad().catch(error => {
        console.error("GSR: Error during initialLoad triggered by executeInitialLoad:", error);
        // Attempt to display an error if UI elements aren't already present from a partial run
        if (!document.getElementById(STATUS_ELEMENT_ID) && !document.getElementById(SUMMARY_PANEL_ID)) {
            const statusElem = createStatusElement("A critical error occurred during initialization.");
            const statusText = statusElem.querySelector('.gsr-status-text');
            if (statusText)
                statusText.textContent = "Critical Error. Check console.";
            const progressBar = statusElem.querySelector('.gsr-progress-bar-inner');
            if (progressBar)
                progressBar.style.backgroundColor = 'red';
        }
    });
}
let pageInitializationObserver = null;
function attemptPageInitialization() {
    // Check if already processing or if UI is already fully initialized
    if (isMainProcessing && (document.getElementById(STATUS_ELEMENT_ID) || document.getElementById(SUMMARY_PANEL_ID))) {
        // console.log("GSR: Attempting initialization - Main processing already underway with UI. Aborting to prevent duplication.");
        return true; // Consider it "handled" as it's in progress or done
    }
    if (document.getElementById(SUMMARY_PANEL_ID)) {
        // console.log("GSR: Attempting initialization - Summary panel already exists. Assuming fully initialized. Aborting.");
        return true; // Consider it "handled" as it's already done
    }
    // Check if we are on the correct Google Scholar citations page
    if (window.location.pathname.includes("/citations")) {
        const tableBodyElement = document.getElementById('gsc_a_b');
        if (tableBodyElement) {
            // console.log("GSR: #gsc_a_b found.");
            // If we found the table body, and not already processed, we can proceed.
            // Disconnect the observer if it was active, as we've found our condition.
            if (pageInitializationObserver) {
                pageInitializationObserver.disconnect();
                pageInitializationObserver = null;
                // console.log("GSR: Page content observer disconnected.");
            }
            // Use a timeout before calling executeInitialLoad, similar to the original script's delay.
            // This gives a brief moment for Google Scholar to settle its DOM after #gsc_a_b appears.
            setTimeout(executeInitialLoad, 500);
            return true; // Initialization has been scheduled
        }
        else {
            // console.log("GSR: #gsc_a_b not yet found on /citations page.");
        }
    }
    else {
        // console.log("GSR: Not on a /citations page.");
        // If not on the citations page, disconnect observer if it's running
        if (pageInitializationObserver) {
            pageInitializationObserver.disconnect();
            pageInitializationObserver = null;
            // console.log("GSR: Not on citations page, observer disconnected.");
        }
    }
    return false; // Conditions to start initialization were not met
}
// Try to initialize immediately when the script loads.
// This handles cases where the page is already fully loaded.
if (!attemptPageInitialization()) {
    // console.log("GSR: Initial attemptPageInitialization failed. Setting up MutationObserver to wait for #gsc_a_b.");
    pageInitializationObserver = new MutationObserver((mutationsList, observer) => {
        // console.log("GSR: Page observer detected DOM mutation.");
        if (attemptPageInitialization()) {
            // If attemptPageInitialization returns true, it means it either scheduled the load
            // or determined it was already handled/processing. The observer can be stopped.
            // Disconnection is handled within attemptPageInitialization if #gsc_a_b is found.
        }
    });
    // Observe the document for changes, waiting for #gsc_a_b to appear.
    // Start observing once the DOM is minimally ready. For content scripts,
    // document.documentElement should be available at `document_idle`.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            if (document.documentElement && pageInitializationObserver) { // Check observer still exists
                pageInitializationObserver.observe(document.documentElement, { childList: true, subtree: true });
            }
        });
    }
    else {
        if (document.documentElement && pageInitializationObserver) { // Check observer still exists
            pageInitializationObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
    }
    // Safety timeout: if #gsc_a_b doesn't appear after a while, stop observing to prevent issues.
    setTimeout(() => {
        if (pageInitializationObserver) {
            pageInitializationObserver.disconnect();
            pageInitializationObserver = null;
            // console.log("GSR: Page observer timed out after 15 seconds.");
        }
    }, 15000); // 15 seconds
}
