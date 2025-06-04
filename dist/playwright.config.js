"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url"); // ← NEW  (ESM shim)
/* ---------------------------------------------------------------
   In ESM we re-create the CommonJS globals this way
---------------------------------------------------------------- */
const __filename = (0, node_url_1.fileURLToPath)(import.meta.url);
const __dirname = node_path_1.default.dirname(__filename);
/* --------------------------------------------------------------- */
exports.default = (0, test_1.defineConfig)({
    timeout: 60_000,
    retries: 0,
    use: {
        headless: false,
        viewport: { width: 1280, height: 800 },
        launchOptions: {
            args: [
                // point Chrome at the built extension folder
                `--disable-extensions-except=${node_path_1.default.join(__dirname, "build")}`,
                `--load-extension=${node_path_1.default.join(__dirname, "build")}`
            ]
        }
    },
    projects: [
        { name: "chromium-with-extension", use: { browserName: "chromium" } }
    ]
});
