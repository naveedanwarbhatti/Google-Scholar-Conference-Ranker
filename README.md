# Google Scholar Conference Ranker (CORE Edition)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Instantly see CORE conference rankings directly on Google Scholar profile pages! Essential for researchers in Computer Science, Electrical Engineering, and related fields.**

This Chrome extension enhances your Google Scholar experience by automatically fetching and displaying [CORE Conference Rankings](http://portal.core.edu.au/conf-ranks/) (currently using CORE 2023 data) for publications. It helps you quickly assess the prestige of conference venues without leaving the Scholar page.

![Screenshot of Extension in Action](ScreenShot.png)
*(Suggestion: Replace with your actual screenshot, like the one you provided, and place it in an `images` folder in your repo)*

## Why This Extension?

In fields like Computer Science (CS) and Electrical Engineering (EE), top-tier conferences are pivotal for disseminating cutting-edge research, often holding prestige comparable to or exceeding that of journals. However, unlike the readily available Impact Factor for journals, quickly discerning a conference's ranking can be challenging.

This extension solves this by:
*   Displaying a **summary panel** on Google Scholar profiles, showing the count of papers per CORE rank (A\*, A, B, C, N/A).
*   Tagging **individual publications** in the list with their respective CORE rank badge.
*   Helping you **save time** and **quickly evaluate** the quality of conference venues and research output.

## Key Features

*   **Automatic Ranking:** Fetches venue details and matches them against CORE 2023 data.
*   **Inline Rank Display:** Shows a colored rank badge (A\*, A, B, C) next to each ranked paper title.
*   **Profile Summary Panel:** Injects a summary block on the right sidebar of Google Scholar profiles, showing paper counts for each rank.
    *   Includes a "BETA" label with a helpful tooltip for users.
    *   Provides a "Report Bug" link for easy feedback.
*   **Keyword Exclusion:** Automatically assigns N/A to items identified as posters, demos, extended abstracts, etc., based on keywords in the paper title or venue name.
*   **Efficient Processing:** Uses concurrent fetching to retrieve venue details quickly, with a progress bar for user feedback.
*   **Wide Compatibility:** Designed to work on most international Google Scholar domains.

## Installation (Developer Mode for Chrome)

Since this extension is not yet on the Chrome Web Store (or if you're testing a development version), you can load it manually in Developer Mode:

1.  **Download or Clone:**
    *   **Option A (Download ZIP):** Go to the [GitHub repository page](https://github.com/your-username/your-repo-name) (replace with your actual repo URL). Click on the green "Code" button, then "Download ZIP". Extract the ZIP file to a folder on your computer.
    *   **Option B (Clone with Git):** If you have Git installed, clone the repository:
        ```bash
        git clone https://github.com/your-username/your-repo-name.git
        cd your-repo-name
        ```

2.  **Build the Content Script (if using TypeScript):**
    This extension uses TypeScript (`content.ts`). You need to compile it to JavaScript (`content.js`).
    *   Make sure you have Node.js and npm installed.
    *   Open a terminal in the extension's root directory (where `package.json` and `tsconfig.json` would be, if you have them).
    *   Install TypeScript if you haven't: `npm install -g typescript` (or `npm install typescript --save-dev` for a local project install).
    *   Compile the TypeScript file:
        ```bash
        npx tsc
        ```
        This will generate a `dist/content.js` file (or wherever your `tsconfig.json` specifies the output). Ensure your `manifest.json` points to this compiled JavaScript file (e.g., `"js": ["dist/content.js"]`).

3.  **Load the Extension in Chrome:**
    *   Open Google Chrome.
    *   Navigate to `chrome://extensions`.
    *   Enable **"Developer mode"** using the toggle switch in the top-right corner.
    *   Click the **"Load unpacked"** button that appears.
    *   Select the **root directory** of the extension (the folder where `manifest.json` is located, e.g., `scholar-ranker` if you extracted/cloned it there).

4.  **Verify:**
    *   The "Google Scholar Conference Ranker" should now appear in your list of extensions.
    *   Navigate to a Google Scholar profile page (e.g., `https://scholar.google.com/citations?user=...`). The extension should automatically run. You should see the progress bar, then the summary panel, and ranks next to papers.

## Usage

Once installed, simply navigate to any Google Scholar profile page that lists publications. The extension will:
1.  Show a "CORE Rank Processing" progress bar in the right sidebar.
2.  Fetch venue information for each publication.
3.  Match venues against the CORE 2023 dataset.
4.  Display a colored rank badge next to each recognized paper's title.
5.  Replace the progress bar with a "CORE Rank Summary" panel in the sidebar showing the distribution of ranks.

## Data Source

This extension currently uses the **CORE 2023 Conference Rankings**.

## Contributing & Bug Reports (BETA)

This extension is currently in BETA. Your feedback is invaluable!

*   **Report a Bug:** Please use the "Report Bug" link in the summary panel (links to: [https://forms.office.com/r/PbSzWaQmpJ](https://forms.office.com/r/PbSzWaQmpJ)) or open an issue on the [GitHub Issues page](https://github.com/your-username/your-repo-name/issues) (replace with your URL). When reporting, please include:
    *   The Google Scholar profile URL.
    *   The specific paper/venue that was mismatched or not detected.
    *   The expected rank/behavior.
    *   Any console errors if applicable.
*   **Feature Requests:** Feel free to open an issue for feature suggestions.
*   **Pull Requests:** Contributions are welcome! Please open an issue first to discuss significant changes.

## Future Ideas
*   Support for other ranking systems (e.g., Qualis, CCF).
*   User-configurable settings (e.g., preferred ranking system, option to hide N/A).
*   More advanced venue name disambiguation.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details (You'll need to create a LICENSE file with the MIT license text).
