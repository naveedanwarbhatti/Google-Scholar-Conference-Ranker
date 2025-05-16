"use strict";
// scholar-ranker/content.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Define the ranks we care about for counting and display
const VALID_RANKS = ["A*", "A", "B", "C"];
const IGNORE_KEYWORDS = ["workshop", "transactions", "poster", "demo", "abstract", "extended abstract", "doctoral consortium", "doctoral symposium", "computer communication review"];
const STATUS_ELEMENT_ID = 'scholar-ranker-status-progress';
const SUMMARY_PANEL_ID = 'scholar-ranker-summary';
console.log("Google Scholar Ranker: Content script loaded.");
function expandAllPublications(statusElement) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Google Scholar Ranker: Attempting to expand all publications...");
        const showMoreButtonId = 'gsc_bpf_more';
        const publicationsTableBodySelector = '#gsc_a_b';
        let attempts = 0;
        const maxAttempts = 30;
        const statusTextElement = statusElement.querySelector('.gsr-status-text');
        while (attempts < maxAttempts) {
            const showMoreButton = document.getElementById(showMoreButtonId);
            if (!showMoreButton || showMoreButton.disabled) {
                console.log("Google Scholar Ranker: 'Show more' button not found or disabled.");
                if (statusTextElement)
                    statusTextElement.textContent = "All publications loaded.";
                yield new Promise(resolve => setTimeout(resolve, 500));
                break;
            }
            if (statusTextElement)
                statusTextElement.textContent = `Expanding publications... (click ${attempts + 1})`;
            const tableBody = document.querySelector(publicationsTableBodySelector);
            if (!tableBody) {
                console.error("Google Scholar Ranker: Publications table body not found.");
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
                setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, 5000);
            });
            yield contentLoadedPromise;
            yield new Promise(resolve => setTimeout(resolve, 750 + Math.random() * 500));
            attempts++;
        }
        if (attempts >= maxAttempts) {
            console.warn("Google Scholar Ranker: Reached max attempts for 'Show more'.");
            if (statusTextElement)
                statusTextElement.textContent = "Max expansion attempts.";
            yield new Promise(resolve => setTimeout(resolve, 1000));
        }
    });
}
function loadCoreData() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const url = chrome.runtime.getURL('core_data.json');
            const response = yield fetch(url);
            if (!response.ok)
                throw new Error(`Failed to fetch core_data.json: ${response.statusText} (URL: ${url})`);
            const jsonData = yield response.json();
            if (!Array.isArray(jsonData)) {
                console.error("CORE data is not an array. Data received:", jsonData);
                return [];
            }
            return jsonData.map((rawEntry) => {
                const entry = { title: "", acronym: "", rank: "N/A" };
                if (typeof rawEntry["International Conference on Advanced Communications and Computation"] === 'string')
                    entry.title = rawEntry["International Conference on Advanced Communications and Computation"];
                else if (typeof rawEntry.title === 'string')
                    entry.title = rawEntry.title;
                else if (typeof rawEntry.Title === 'string')
                    entry.title = rawEntry.Title;
                else if (typeof rawEntry.JournalTitle === 'string')
                    entry.title = rawEntry.JournalTitle;
                else if (typeof rawEntry["Full Journal Title"] === 'string')
                    entry.title = rawEntry["Full Journal Title"];
                else if (typeof rawEntry["Full Name"] === 'string')
                    entry.title = rawEntry["Full Name"];
                else if (typeof rawEntry.source === 'string')
                    entry.title = rawEntry.source;
                if (typeof rawEntry.INFOCOMP === 'string')
                    entry.acronym = rawEntry.INFOCOMP;
                else if (typeof rawEntry.acronym === 'string')
                    entry.acronym = rawEntry.acronym;
                else if (typeof rawEntry.Acronym === 'string')
                    entry.acronym = rawEntry.Acronym;
                else if (typeof rawEntry.ConferenceAcro === 'string')
                    entry.acronym = rawEntry.ConferenceAcro;
                else if (typeof rawEntry.Abbreviation === 'string')
                    entry.acronym = rawEntry.Abbreviation;
                let foundRank = undefined;
                if (typeof rawEntry.Unranked === 'string')
                    foundRank = rawEntry.Unranked;
                else if (typeof rawEntry.rank === 'string')
                    foundRank = rawEntry.rank;
                else if (typeof rawEntry.Rank === 'string')
                    foundRank = rawEntry.Rank;
                else if (typeof rawEntry.CORE_Rating === 'string')
                    foundRank = rawEntry.CORE_Rating;
                else if (typeof rawEntry["CORE Rank"] === 'string')
                    foundRank = rawEntry["CORE Rank"];
                else if (typeof rawEntry.Rating === 'string')
                    foundRank = rawEntry.Rating;
                if (foundRank) {
                    const upperRank = foundRank.toUpperCase().trim();
                    if (VALID_RANKS.includes(upperRank))
                        entry.rank = upperRank;
                }
                entry.title = String(entry.title || "").trim();
                entry.acronym = String(entry.acronym || "").trim();
                return (entry.title || entry.acronym) ? entry : null;
            }).filter(entry => entry !== null);
        }
        catch (error) {
            console.error("Error loading or parsing CORE data:", error);
            return [];
        }
    });
}
function fetchAndExtractVenueName(publicationUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            const response = yield fetch(publicationUrl);
            if (!response.ok) {
                console.warn(`Failed to fetch ${publicationUrl}: ${response.statusText} (${response.status})`);
                return null;
            }
            const htmlText = yield response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            let venueNameFromDetail = '';
            const targetLabels = ['conference', 'proceedings', 'book title', 'series', 'source', 'publication', 'book', 'journal'];
            const sectionsOci = doc.querySelectorAll('#gsc_oci_table div.gs_scl');
            if (sectionsOci.length > 0) {
                for (const section of sectionsOci) {
                    const fieldEl = section.querySelector('div.gsc_oci_field');
                    const valueEl = section.querySelector('div.gsc_oci_value');
                    if (fieldEl && valueEl && targetLabels.includes(((_a = fieldEl.textContent) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase()) || '')) {
                        venueNameFromDetail = ((_b = valueEl.textContent) === null || _b === void 0 ? void 0 : _b.trim()) || '';
                        if (venueNameFromDetail)
                            break;
                    }
                }
            }
            if (!venueNameFromDetail) {
                const rowsVcd = doc.querySelectorAll('#gsc_vcd_table tr');
                for (const row of rowsVcd) {
                    const fieldEl = row.querySelector('td.gsc_vcd_field');
                    const valueEl = row.querySelector('td.gsc_vcd_value');
                    if (fieldEl && valueEl && targetLabels.includes(((_c = fieldEl.textContent) === null || _c === void 0 ? void 0 : _c.trim().toLowerCase()) || '')) {
                        venueNameFromDetail = ((_d = valueEl.textContent) === null || _d === void 0 ? void 0 : _d.trim()) || '';
                        if (venueNameFromDetail)
                            break;
                    }
                }
            }
            return venueNameFromDetail || null;
        }
        catch (error) {
            console.error(`Error fetching or parsing ${publicationUrl}:`, error);
            return null;
        }
    });
}
function cleanTextForComparison(text) {
    if (!text)
        return "";
    let cleanedText = text.toLowerCase();
    // Normalize "&" to "and"
    // Use regex with word boundaries (\b) if you only want to replace standalone '&'
    // For simplicity here, a global replace works well for venue names.
    cleanedText = cleanedText.replace(/ & /g, " and "); // Replace " & " with " and "
    cleanedText = cleanedText.replace(/&/g, " and "); // Replace standalone & if not surrounded by spaces, ensure spaces are added
    // Basic punctuation that might differ but try to keep structure for substring
    cleanedText = cleanedText.replace(/[.,\/#!$%\^;\*:{}<>=\-_`~?"“()]/g, " "); // Added parentheses to the removal list here for general cleaning
    cleanedText = cleanedText.replace(/\s+/g, ' '); // Normalize multiple spaces to a single space
    return cleanedText.trim();
}
function findRankForVenue(venueName, coreData) {
    const normalizedScholarVenueName = venueName.toLowerCase().trim();
    // --- Initial Log for the venue being processed ---
    console.log(`--- Evaluating GS Venue: "${venueName}" (Normalized: "${normalizedScholarVenueName}") ---`);
    if (!normalizedScholarVenueName)
        return "N/A";
    // --- START: Specific non-conference exclusion ---
    const specificExclusions = [
        "sigcomm computer communication review",
    ];
    for (const exclusion of specificExclusions) {
        if (normalizedScholarVenueName.includes(exclusion)) {
            console.log(`SPECIFIC EXCLUSION: GS Venue "${venueName}" contains "${exclusion}". Assigning N/A.`);
            return "N/A";
        }
    }
    // --- END: Specific non-conference exclusion ---
    // --- 1. Acronym-based match ---
    const extractedScholarAcronyms = extractPotentialAcronymsFromText(venueName);
    if (extractedScholarAcronyms.length > 0) {
        // Log extracted acronyms from GS venue
        console.log(`ACRONYM_MATCH_ATTEMPT: Extracted GS Acronyms: [${extractedScholarAcronyms.join(', ')}] for GS Venue: "${venueName}"`);
        for (const scholarAcro of extractedScholarAcronyms) {
            for (const entry of coreData) {
                if (entry.acronym) {
                    const coreAcro = entry.acronym.toLowerCase().trim();
                    if (coreAcro && coreAcro === scholarAcro) {
                        console.log(`!!! ACRONYM MATCH FOUND !!!`);
                        console.log(`  GS Acro: "${scholarAcro}" (from GS Venue: "${venueName}")`);
                        console.log(`  Matched CORE Acro: "${coreAcro}" (from CORE Title: "${entry.title}")`);
                        console.log(`  Assigned Rank: ${entry.rank}`);
                        return VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A";
                    }
                }
            }
        }
    }
    else {
        console.log(`ACRONYM_MATCH_ATTEMPT: No acronyms extracted for GS Venue: "${venueName}"`);
    }
    // --- 2. Full name substring match ---
    console.log(`FULL_NAME_MATCH_ATTEMPT: Starting for GS Venue: "${venueName}"`);
    const gsCleanedForSubstring = cleanTextForComparison(normalizedScholarVenueName);
    console.log(`  GS Venue Cleaned for Substring Match: "${gsCleanedForSubstring}"`);
    let bestMatchRank = null;
    let longestMatchLength = 0;
    let bestMatchingCoreTitleOriginal = ""; // To store the original CORE title of the best match
    let bestMatchingCoreTitleProcessed = ""; // To store the processed CORE title of the best match
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
            // Debugging for the LCTES case, and can be adapted for others
            if (entry.acronym === "LCTES" || entry.title.toLowerCase().includes("data centric engineering")) { // Broaden debug for DCE
                console.log(`  DEBUG_CORE_ENTRY: Acronym: "${entry.acronym}", Title: "${entry.title}"`);
                console.log(`    CDT_orig_cleaned: "${originalCoreTitleCleaned}"`);
                console.log(`    CDT_org_stripped (coreTitleForMatch): "${coreTitleForMatch}"`);
            }
            if (gsCleanedForSubstring && coreTitleForMatch && coreTitleForMatch.length > 5) {
                if (gsCleanedForSubstring.includes(coreTitleForMatch)) {
                    // console.log(`    POTENTIAL Full name substring match: CORE (org-stripped) "${coreTitleForMatch}" in GS "${gsCleanedForSubstring}" (Rank: ${entry.rank})`);
                    if (coreTitleForMatch.length > longestMatchLength) {
                        longestMatchLength = coreTitleForMatch.length;
                        bestMatchRank = VALID_RANKS.includes(entry.rank) ? entry.rank : "N/A";
                        bestMatchingCoreTitleOriginal = entry.title;
                        bestMatchingCoreTitleProcessed = coreTitleForMatch;
                        // console.log(`      NEW BEST Substring Match: Length ${longestMatchLength}, Rank ${bestMatchRank}, CORE Title: "${entry.title}"`);
                    }
                }
            }
        }
    }
    if (bestMatchRank !== null) {
        console.log(`!!! BEST FULL NAME SUBSTRING MATCH CHOSEN for GS Venue: "${venueName}" !!!`);
        console.log(`  Matched with CORE Title: "${bestMatchingCoreTitleOriginal}"`);
        console.log(`  (Processed CORE Title for match: "${bestMatchingCoreTitleProcessed}")`);
        console.log(`  (GS Venue processed for match: "${gsCleanedForSubstring}")`);
        console.log(`  Longest matched part length: ${longestMatchLength}, Assigned Rank: ${bestMatchRank}`);
        return bestMatchRank;
    }
    console.log(`--- NO MATCH FOUND for GS Venue: "${venueName}" (GS Cleaned: "${gsCleanedForSubstring}", GS Acronyms: [${extractedScholarAcronyms.join(', ')}]) ---`);
    return "N/A";
}
function extractPotentialAcronymsFromText(scholarVenueName) {
    const acronyms = new Set();
    const originalVenueName = scholarVenueName; // Keep original for case-sensitive extraction logic
    // --- Heuristic 1: Content within Parentheses ---
    const parentheticalMatches = originalVenueName.match(/\(([^)]+)\)/g);
    if (parentheticalMatches) {
        parentheticalMatches.forEach(match => {
            const contentInParen = match.slice(1, -1).trim();
            const potentialAcronymsInParen = contentInParen.match(/([A-Z]{2,}[0-9']*\b|[A-Z]+[0-9]+[A-Z0-9]*\b|[A-Z][A-Z0-9]{1,9}\b)/g);
            if (potentialAcronymsInParen) {
                potentialAcronymsInParen.forEach(pAcronym => {
                    let cleanedParenAcronym = pAcronym.replace(/'\d{2,4}$/, '').replace(/'s$/, '');
                    if (cleanedParenAcronym.length >= 2 && cleanedParenAcronym.length <= 12 && !/^\d+$/.test(cleanedParenAcronym)) {
                        acronyms.add(cleanedParenAcronym.toLowerCase());
                    }
                });
            }
            else {
                if (contentInParen.length >= 2 && contentInParen.length <= 12 &&
                    /^[A-Za-z0-9]+$/.test(contentInParen) &&
                    !contentInParen.includes(" ") && !contentInParen.includes("-") &&
                    !/^\d+$/.test(contentInParen) &&
                    contentInParen.toLowerCase() !== "was" && contentInParen.toLowerCase() !== "formerly") {
                    acronyms.add(contentInParen.toLowerCase());
                }
            }
        });
    }
    // --- Heuristic 2: Standalone Acronym-Like Words (Revised) ---
    let textWithoutParens = originalVenueName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    // Further clean common prefixes that are not acronyms themselves
    textWithoutParens = textWithoutParens.replace(/\b(Proceedings\s+of\s+the|Proc\.\s+of\s+the|International\s+Conference\s+on|Intl\.\s+Conf\.\s+on|Conference\s+on|Symposium\s+on|Workshop\s+on|Journal\s+of)\b/gi, ' ').trim();
    const words = textWithoutParens.split(/[\s\-‑\/.,:;&]+/);
    const commonNonAcronyms = new Set([
        'proc', 'data', 'services', 'models', 'security', 'time', 'proceedings', 'journal', 'conference', 'conf', 'symposium', 'symp', 'workshop', 'ws', 'international', 'intl', 'natl', 'national', 'annual', 'acm', 'ieee', 'usenix', 'sig', 'vol', 'volume', 'no', 'number', 'pp', 'page', 'pages', 'part', 'edition', 'of', 'the', 'on', 'in', 'and', 'for', 'to', 'at', 'st', 'nd', 'rd', 'th', 'springer', 'elsevier', 'wiley', 'press', 'extended', 'abstract', 'abstracts', 'poster', 'session', 'sessions', 'doctoral', 'companion', 'joint', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'advances', 'systems', 'networks', 'computing', 'applications', 'technology', 'technologies', 'research', 'science', 'sciences', 'engineering', 'management', 'information', 'communication', 'communications', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'transactions', 'letters', 'advances', 'bulletin', 'archive', 'archives', 'series', 'chapter', 'section', 'tutorial', 'tutorials', 'report', 'technical', 'tech', ...(Array.from({ length: 75 }, (_, i) => (1970 + i).toString())) // Extended year range
    ]);
    words.forEach(word => {
        const cleanWordOriginalCase = word.trim();
        if (cleanWordOriginalCase.length >= 2 && cleanWordOriginalCase.length <= 12 && !/^\d+$/.test(cleanWordOriginalCase)) {
            // Regex for typical acronym patterns:
            // 1. All caps: FOO, BAR1
            // 2. Mixed case with internal caps: SenSys, AsiaCCS, HotNets
            // 3. Caps-Numbers-Caps: W3C (already covered by all caps with numbers)
            // Does not match simple capitalized words like "Conference" or "Object".
            if ((!commonNonAcronyms.has(cleanWordOriginalCase.toLowerCase())) &&
                (/^[A-Z0-9]+$/.test(cleanWordOriginalCase) || // ALL CAPS (and numbers)
                    /^[A-Z][a-z]+[A-Z]+[A-Za-z0-9]*$/.test(cleanWordOriginalCase) // Cap->lowers->Caps->(optional more) e.g. SenSys, AsiaCCS
                )) {
                acronyms.add(cleanWordOriginalCase.toLowerCase());
            }
        }
    });
    // Fallback for when the entire venueName is the acronym (and wasn't caught above)
    if (acronyms.size === 0 &&
        originalVenueName.length >= 2 && originalVenueName.length <= 10 &&
        !originalVenueName.includes(" ") && // Typically single word if it's the whole name and an acronym
        /^[A-Za-z0-9]+$/.test(originalVenueName) && // Alphanumeric
        !/^\d+$/.test(originalVenueName) &&
        !commonNonAcronyms.has(originalVenueName.toLowerCase())) {
        acronyms.add(originalVenueName.toLowerCase());
    }
    const resultAcronyms = Array.from(acronyms);
    // if (resultAcronyms.length > 0) {
    //    console.log(`EXTRACTED ACRONYMS for "${scholarVenueName}": [${resultAcronyms.join(', ')}]`);
    // } else {
    //    console.log(`NO ACRONYMS extracted for "${scholarVenueName}"`);
    // }
    return resultAcronyms;
}
function displayRankBadgeAfterTitle(rowElement, rank) {
    const titleCell = rowElement.querySelector('td.gsc_a_t');
    if (titleCell) {
        const oldBadge = titleCell.querySelector('span.gsr-rank-badge-inline');
        oldBadge === null || oldBadge === void 0 ? void 0 : oldBadge.remove();
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
    titleLinkElement.insertAdjacentElement('afterend', badge);
}
function createStatusElement(initialMessage = "Initializing...") {
    var _a, _b;
    (_a = document.getElementById(STATUS_ELEMENT_ID)) === null || _a === void 0 ? void 0 : _a.remove();
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
        else if (citedByElement === null || citedByElement === void 0 ? void 0 : citedByElement.nextSibling)
            rightSidebarContainer.insertBefore(container, citedByElement.nextSibling);
        else if (citedByElement)
            (_b = citedByElement.parentNode) === null || _b === void 0 ? void 0 : _b.appendChild(container);
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
function updateStatusElement(statusContainer, processed, total) {
    const progressBarInner = statusContainer.querySelector('.gsr-progress-bar-inner');
    const statusText = statusContainer.querySelector('.gsr-status-text');
    const percentage = total > 0 ? (processed / total) * 100 : 0;
    if (progressBarInner)
        progressBarInner.style.width = `${percentage}%`;
    if (statusText)
        statusText.textContent = `Processing ${processed} / ${total}...`;
}
// --- MODIFIED displaySummaryPanel ---
function displaySummaryPanel(rankCounts) {
    var _a, _b;
    const existingStatusElement = document.getElementById(STATUS_ELEMENT_ID);
    const parentOfStatus = existingStatusElement === null || existingStatusElement === void 0 ? void 0 : existingStatusElement.parentNode;
    (_a = document.getElementById(SUMMARY_PANEL_ID)) === null || _a === void 0 ? void 0 : _a.remove(); // Remove old summary if any
    const panel = document.createElement('div');
    panel.id = SUMMARY_PANEL_ID;
    panel.classList.add('gsc_rsb_s', 'gsc_prf_pnl');
    panel.style.padding = '10px';
    panel.style.marginBottom = '15px';
    // --- Header with Beta Label (with tooltip) and Report Bug Link ---
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
    // Beta Label with Tooltip
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
    betaLabel.style.cursor = 'help'; // Add help cursor to indicate tooltip
    betaLabel.setAttribute('title', // Moved tooltip here
    "Developed by Naveed Anwar Bhatti.\n" +
        "It is free and open source.\n" +
        "We are currently using CORE2023 rankings only.\n" +
        "Help us spot inconsistencies!\n" +
        "For any issues, please click on “Report Bug”.");
    headerDiv.appendChild(betaLabel);
    // --- Question Mark Icon REMOVED ---
    // Report Bug Link (Text Only, smaller, red)
    const reportBugLink = document.createElement('a');
    reportBugLink.href = "https://forms.office.com/r/PbSzWaQmpJ";
    reportBugLink.target = "_blank";
    reportBugLink.style.marginLeft = '10px'; // Increased margin a bit as question mark is gone
    reportBugLink.style.textDecoration = 'none';
    reportBugLink.style.color = '#D32F2F'; // Red color for the link
    reportBugLink.style.fontSize = '0.75em'; // Reduced font size
    reportBugLink.style.fontWeight = 'normal'; // Normal weight, or '500' for slightly bolder
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
            badgeSpan.style.display = 'inline-block';
            badgeSpan.style.padding = '0px 4px';
            badgeSpan.style.marginRight = '8px';
            badgeSpan.style.fontSize = '0.9em';
            badgeSpan.style.fontWeight = 'bold';
            badgeSpan.style.color = '#000000';
            badgeSpan.style.border = '1px solid #ccc';
            badgeSpan.style.borderRadius = '3px';
            badgeSpan.style.minWidth = '25px';
            badgeSpan.style.textAlign = 'center';
            switch (rank) {
                case "A*":
                    badgeSpan.style.backgroundColor = '#FFD700';
                    badgeSpan.style.borderColor = '#B8860B';
                    break;
                case "A":
                    badgeSpan.style.backgroundColor = '#90EE90';
                    badgeSpan.style.borderColor = '#3CB371';
                    break;
                case "B":
                    badgeSpan.style.backgroundColor = '#ADFF2F';
                    badgeSpan.style.borderColor = '#7FFF00';
                    break;
                case "C":
                    badgeSpan.style.backgroundColor = '#FFA07A';
                    badgeSpan.style.borderColor = '#FA8072';
                    break;
            }
            rankDisplay = badgeSpan.outerHTML;
        }
        else {
            rankDisplay = `<span style="display:inline-block; width: 30px; font-weight:bold; margin-right: 8px;">${rank}:</span>`;
        }
        content += `<li style="font-size:13px; margin-bottom: 5px; display: flex; align-items: center;">
                      ${rankDisplay}
                      <span style="margin-left: ${VALID_RANKS.includes(rank) ? '0' : '5px'};">${count} papers</span></li>`;
    }
    panel.innerHTML = content + '</ul>';
    if (parentOfStatus && existingStatusElement) {
        parentOfStatus.replaceChild(panel, existingStatusElement);
    }
    else {
        const gsBdy = document.getElementById('gs_bdy');
        const rightSidebarContainer = gsBdy === null || gsBdy === void 0 ? void 0 : gsBdy.querySelector('div.gsc_rsb');
        if (rightSidebarContainer) {
            const publicAccessElement = rightSidebarContainer.querySelector('#gsc_rsb_mnd');
            const coauthorsElement = rightSidebarContainer.querySelector('#gsc_rsb_co');
            const citedByElement = rightSidebarContainer.querySelector('#gsc_rsb_cit');
            if (publicAccessElement)
                rightSidebarContainer.insertBefore(panel, publicAccessElement);
            else if (coauthorsElement)
                rightSidebarContainer.insertBefore(panel, coauthorsElement);
            else if (citedByElement === null || citedByElement === void 0 ? void 0 : citedByElement.nextSibling)
                rightSidebarContainer.insertBefore(panel, citedByElement.nextSibling);
            else if (citedByElement)
                (_b = citedByElement.parentNode) === null || _b === void 0 ? void 0 : _b.appendChild(panel);
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
    }
}
// --- END MODIFIED displaySummaryPanel ---
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Google Scholar Ranker: main() started.");
        const statusElement = createStatusElement("Initializing Scholar Ranker...");
        const coreData = yield loadCoreData();
        if (!coreData || coreData.length === 0) {
            const statusText = statusElement.querySelector('.gsr-status-text');
            if (statusText)
                statusText.textContent = "Error loading CORE data. Check console.";
            const progressBarInner = statusElement.querySelector('.gsr-progress-bar-inner');
            if (progressBarInner)
                progressBarInner.style.backgroundColor = 'red';
            return;
        }
        console.log(`Loaded ${coreData.length} CORE entries.`);
        statusElement.querySelector('.gsr-status-text').textContent = "Expanding publications...";
        yield expandAllPublications(statusElement);
        const publicationLinkElements = [];
        document.querySelectorAll('tr.gsc_a_tr').forEach(row => {
            var _a;
            const linkEl = row.querySelector('td.gsc_a_t a.gsc_a_at');
            if (linkEl instanceof HTMLAnchorElement && linkEl.href) {
                publicationLinkElements.push({
                    url: linkEl.href,
                    rowElement: row,
                    titleText: ((_a = linkEl.textContent) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || ""
                });
            }
        });
        if (publicationLinkElements.length === 0) {
            statusElement.querySelector('.gsr-status-text').textContent = "No publications found.";
            return;
        }
        console.log(`Found ${publicationLinkElements.length} total publication links.`);
        updateStatusElement(statusElement, 0, publicationLinkElements.length);
        const rankCounts = { "A*": 0, "A": 0, "B": 0, "C": 0, "N/A": 0 };
        let processedCount = 0;
        const CONCURRENCY_LIMIT = 6;
        const processPublication = (pubInfo) => __awaiter(this, void 0, void 0, function* () {
            try {
                const venueName = yield fetchAndExtractVenueName(pubInfo.url);
                let currentRank = "N/A";
                let ignoreFound = false;
                for (const keyword of IGNORE_KEYWORDS) {
                    if (pubInfo.titleText.includes(keyword)) {
                        currentRank = "N/A";
                        ignoreFound = true;
                        break;
                    }
                }
                if (!ignoreFound && (venueName === null || venueName === void 0 ? void 0 : venueName.trim())) {
                    const lowerVenueName = venueName.toLowerCase();
                    for (const keyword of IGNORE_KEYWORDS) {
                        if (lowerVenueName.includes(keyword)) {
                            currentRank = "N/A";
                            ignoreFound = true;
                            break;
                        }
                    }
                    if (!ignoreFound) {
                        currentRank = findRankForVenue(venueName, coreData);
                    }
                }
                else if (!(venueName === null || venueName === void 0 ? void 0 : venueName.trim()) && !ignoreFound) {
                    currentRank = "N/A";
                }
                return { rank: currentRank, rowElement: pubInfo.rowElement };
            }
            catch (error) {
                console.warn(`Error processing publication ${pubInfo.url}:`, error);
                return { rank: "N/A", rowElement: pubInfo.rowElement, error: error };
            }
        });
        for (let i = 0; i < publicationLinkElements.length; i += CONCURRENCY_LIMIT) {
            const chunk = publicationLinkElements.slice(i, i + CONCURRENCY_LIMIT);
            const promises = chunk.map(pubInfo => processPublication(pubInfo).then(result => {
                rankCounts[result.rank]++;
                displayRankBadgeAfterTitle(result.rowElement, result.rank);
                processedCount++;
                updateStatusElement(statusElement, processedCount, publicationLinkElements.length);
                return result;
            }));
            yield Promise.all(promises);
        }
        console.log("Final Rank Counts:", rankCounts);
        displaySummaryPanel(rankCounts);
    });
}
if (document.getElementById('gsc_a_b') && window.location.pathname.includes("/citations")) {
    setTimeout(() => {
        main().catch(error => {
            console.error("Google Scholar Ranker: Uncaught error in main():", error);
            const statusElem = document.getElementById(STATUS_ELEMENT_ID);
            if (statusElem) {
                const statusText = statusElem.querySelector('.gsr-status-text');
                if (statusText)
                    statusText.textContent = "An error occurred. Check console.";
                const progressBarInner = statusElem.querySelector('.gsr-progress-bar-inner');
                if (progressBarInner)
                    progressBarInner.style.backgroundColor = 'red';
            }
        });
    }, 500);
}
