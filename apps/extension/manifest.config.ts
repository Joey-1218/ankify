import { defineManifest } from "@crxjs/vite-plugin";
import { extensionApiOrigin } from "./extension-env";

// Public key only: it fixes the unpacked/development extension ID at
// dboijhnmohmpceamddfchbjicdgcgnlg. ankileet's own key, not Ankify's, so the
// two never share an ID. Store builds omit it and get the store's ID.
const DEVELOPMENT_EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQuBtg/mUri1KaZefm7sYRG9uUOc21gsGmBXL0Ev6vFdkF+1go7tDgoTUZluyLf2JCsk60jhOW4zHSYYFzyt6eP76mTGYdtgyMtsabKl/6c4VMA1nV36Gh7UjJlniXWUVIWWwhUzHI1nnM0i9snOFjEZ0qbdYZpoZR4IFoq9cLDJFJ/Hf42DdBoH82yLQceKb/8ZbUWTNp4q13fgI5IqanIZf6CVbaX9aLvmtweL/elaN4WeE/coxmoIxXmDFFiYXj4etFfZ03WL/6jrBofXDg4t+3XGv3Z1pE+mdNdgbCIjGaXUs7YKjamW1X1fpJObUKqskSJ1Kfm2Ztd2grSCRQIDAQAB";

export default defineManifest(({ mode }) => {
  const apiOrigin = extensionApiOrigin(mode);
  const includeDevelopmentKey =
    mode === "development" ||
    process.env.ANKILEET_EXTENSION_BUILD_TARGET === "unpacked";

  return {
    manifest_version: 3,
    minimum_chrome_version: "116",
    name: "ankileet",
    description:
      "Practice LeetCode problems with spaced repetition: track each attempt on the problem page and review when it's due.",
    version: "0.3.0",
    ...(includeDevelopmentKey ? { key: DEVELOPMENT_EXTENSION_KEY } : {}),
    action: {
      default_title: "ankileet",
      default_popup: "src/popup/index.html",
      default_icon: {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png",
      },
    },
    icons: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
    // alarms: wake the worker to retry durable sync after an outage and to
    // refresh the due-count badge.
    permissions: ["storage", "tabs", "alarms"],
    host_permissions: ["https://leetcode.com/*", `${apiOrigin}/*`],
    homepage_url: apiOrigin,
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none';",
    },
    content_scripts: [
      {
        matches: ["https://leetcode.com/problems/*"],
        js: ["src/content/index.ts"],
        run_at: "document_idle",
      },
    ],
    background: {
      service_worker: "src/background/index.ts",
      type: "module",
    },
  };
});
