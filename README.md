![Version 1.7](https://img.shields.io/badge/version-1.6.5-blue.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Google Scholar Venue Ranker



**Instantly see CORE conference rankings and SJR journal quartiles directly on Google Scholar profile pages—essential context for researchers in Computer Science, Electrical Engineering, and related fields.**

This Chrome extension enhances your Google Scholar experience by automatically fetching and displaying [CORE Conference Rankings](http://portal.core.edu.au/conf-ranks/) for conference publications alongside [SCImago Journal Rank (SJR)](https://www.scimagojr.com/) quartiles for journals. It helps you quickly assess the prestige of publication venues without leaving the Scholar page.

![Screenshot of Extension in Action](Images/Screenshot.png)

<p align="left">
  <a href="https://chromewebstore.google.com/detail/egohghgpljdhkmcmllhncfndmkeilpfb?utm_source=item-share-cb">
    <img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store">
  </a>
</p>



### Why?

Google Scholar is great at collecting publications but **terrible at showing the prestige of publication venues**—a crucial signal in CS and EE. This add‑on pulls the official **CORE 2023 (and historical)** conference lists and the **latest SJR journal quartiles**, surfacing each publication’s tier directly in the interface.

---

## Features

| Feature                   | Description |
| ------------------------- | ----------- |
| 🎯 **Historical Matching** | Selects the appropriate CORE ranking list (2023, 2021, 2020, 2018, 2017, 2014) based on the publication's year and applies multiple heuristics for matching. |
| 🏷 **Rank badges**        | Shows colour‑coded A\*, A, B, C badges inline next to each conference paper title to reflect its historical rank. |
| 📊 **Summary panel**      | Totals conference ranks (A\*, A, B, C, N/A) and SJR quartiles, aggregated across the processed publications. |
| 📚 **Journal insights**   | Adds SJR quartile badges (Q1–Q4) next to journal papers using the latest SCImago data set. |
| 🧹 **Name cleanup**       | Removes trailing titles like "PhD" or "Dr." before DBLP lookup for better matches. |


## Quick Install

1.  **Download or Clone:**
    *   **Option A (Download ZIP):** Download the latest [release](https://github.com/naveedanwarbhatti/Google-Scholar-Conference-Ranker/releases/download/v1.6.3/Google-Scholar-Conference-Ranker-v1.6.3.zip), or click on the green "Code" button, then "Download ZIP". Extract the ZIP file to a folder on your computer.
	
    *   **Option B (Clone with Git):** If you have Git installed, clone the repository:
        ```bash
        git clone https://github.com/naveedanwarbhatti/Google-Scholar-Conference-Ranker.git
        ```
        The `dist/content.js` file (the compiled JavaScript) is included in the repository.

2.  **Load the Extension in Chrome:**
    *   Open Google Chrome.
    *   Navigate to `chrome://extensions` (or by clicking Menu -> Extensions -> Manage Extensions).
    *   Enable **"Developer mode"** using the toggle switch, usually found in the top-right corner.
    *   Click the **"Load unpacked"** button that appears (usually on the top-left).
    *   Select the **root directory** of the extension (the folder where `manifest.json` is located, e.g., the `Google-Scholar-Conference-Ranker` folder you downloaded/cloned).

3.  **Verify:**
    *   The "Google Scholar Venue Ranker" should now appear in your list of extensions and be enabled.
    *   Navigate to a Google Scholar profile page (e.g., `https://scholar.google.com/citations?user=...`). The extension should automatically run. You should see the progress bar, then the summary panel, and ranks next to papers.




## Limitations & Troubleshooting

* **DBLP coverage** – Papers missing from DBLP are not counted in the summary.
* **Short papers** – Conference papers under six pages are excluded as short papers.
* **Name mismatches** – DBLP may list your papers under a different name, leading to profile mismatches.
* **Tips**
  * Verify your DBLP profile is correct and matches your Scholar name.
  * Report mismatches or missing venues using the "Report Bug" link.

## Data Source and Acknowledgements

This extension uses historical **CORE Conference Rankings** from the years **2023, 2021, 2020, 2018, 2017, and 2014**, courtesy of [**Australasian Computing Research and Education (CORE)**](https://www.linkedin.com/company/australasian-computing-research-and-education-core/), and combines them with the latest **SCImago Journal Rank (SJR)** data set from [scimagojr.com](https://www.scimagojr.com/). Please refer to the official [CORE portal](http://portal.core.edu.au/conf-ranks/) and [SCImago portal](https://www.scimagojr.com/journalrank.php) for the most authoritative data.

## Contributing & Bug Reports (BETA)

This extension is currently in BETA. Your feedback is invaluable!

*   **Report a Bug:** Please use the ["Report Bug"](https://forms.office.com/r/PbSzWaQmpJ) link in the summary panel or open an issue on the [GitHub Issues page](https://github.com/naveedanwarbhatti/Google-Scholar-Conference-Ranker//issues). When reporting, please include:
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

This project is licensed under the MIT License


⭐ **Like it?** Give the repo a star—helps other researchers discover the extension!
