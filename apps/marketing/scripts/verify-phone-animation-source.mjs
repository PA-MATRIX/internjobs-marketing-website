import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const appSource = readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const cssSource = readFileSync(path.join(root, "src", "styles.css"), "utf8");

const requiredAppMarkers = [
  "const MAX_VISIBLE_CHAT_MESSAGES = 5",
  "const windowStart = Math.max(0, visibleCount - MAX_VISIBLE_CHAT_MESSAGES)",
  "const visibleMessages = messages.slice(windowStart, visibleCount)",
];

const requiredCssMarkers = [
  ".iphone-screen {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  height:",
  "overflow: hidden;\n  border-radius: 2.35rem;",
  ".messages-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: hidden;",
  ".message-stack {\n  display: flex;\n  min-height: 0;\n  height: 100%;",
];

const missingAppMarkers = requiredAppMarkers.filter((marker) => !appSource.includes(marker));
const missingCssMarkers = requiredCssMarkers.filter((marker) => !cssSource.includes(marker));

if (missingAppMarkers.length || missingCssMarkers.length) {
  console.error("verify-phone-animation-source failed: hero phone animation guardrail was removed or changed.");
  for (const marker of missingAppMarkers) console.error(`missing App.tsx marker: ${marker}`);
  for (const marker of missingCssMarkers) console.error(`missing styles.css marker: ${marker}`);
  process.exit(1);
}

console.log("verify-phone-animation-source: hero phone animation guardrails verified");
