# agent.md
Google-Scholar Conference Ranker – build, zip, and end-to-end test
=================================================================

This manifest tells the OpenAI Codex “Fix-Build-Run” harness exactly how to
prepare the environment and which command to execute.  
Add it to the project root; no other manifest is required.

---

## 🛠️ Setup

```bash
# 1 · Essential OS packages
apt-get update -y
apt-get install -y curl git zip

# 2 · Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3 · Project dependencies (package-lock guarantees deterministic install)
npm ci

# 4 · Playwright browsers + system libraries (Chromium, Firefox, WebKit)
npx playwright install --with-deps

# Compile TypeScript → ./build
npm run build

# Run the Playwright test-suite in CI mode
PWTEST_MODE=ci npm run e2e

# Remove the compiled build directory
npm run clean
