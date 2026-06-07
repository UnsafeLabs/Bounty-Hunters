import { readFileSync } from "node:fs";

const component = readFileSync(
  "apps/web/src/components/ThreadTerminalDrawer.tsx",
  "utf8",
);
const test = readFileSync(
  "apps/web/src/components/ThreadTerminalDrawer.test.ts",
  "utf8",
);
const metadata = readFileSync(
  "apps/web/src/components/_generation.json",
  "utf8",
);

const checks = [
  [
    "exports mac platform helper",
    /export function isMacTerminalClipboardPlatform/.test(component),
  ],
  ["exports copy shortcut helper", /export function isTerminalCopyShortcut/.test(component)],
  ["exports paste shortcut helper", /export function isTerminalPasteShortcut/.test(component)],
  [
    "exports selection-gated copy helper",
    /export function shouldHandleTerminalCopyShortcut/.test(component),
  ],
  ["uses terminal selection guard", /terminal\.hasSelection\(\)/.test(component)],
  ["copies current xterm selection", /terminal\.getSelection\(\)/.test(component)],
  ["writes clipboard text", /navigator\.clipboard\?\.writeText/.test(component)],
  ["reads clipboard text", /navigator\.clipboard\?\.readText/.test(component)],
  ["pastes through existing terminal RPC", /api\.terminal\.write/.test(component)],
  ["shows copied toast", /Terminal selection copied/.test(component)],
  [
    "passes through copy shortcut with no selection",
    /if \(!terminal\.hasSelection\(\)\) \{\s*return true;\s*\}/s.test(component),
  ],
  [
    "tests Windows/Linux clipboard shortcuts",
    /Ctrl\+Shift\+C and Ctrl\+Shift\+V/.test(test),
  ],
  ["tests macOS clipboard shortcuts", /Cmd\+C and Cmd\+V/.test(test)],
  ["tests selection gating", /only when the terminal has selected text/.test(test)],
  ["metadata is public-safe", /Public metadata only/.test(metadata)],
  ["metadata redacts private context", /redacted/i.test(metadata)],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [name] of failed) {
    console.error(`FAIL: ${name}`);
  }
  process.exit(1);
}

console.log(`PASS: ${checks.length} terminal clipboard checks passed`);
