import {
  detectPlatform,
  handleTerminalKey,
  isCopyChord,
  isPasteChord,
  parseEvent,
} from "./TerminalClipboard.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(detectPlatform("MacIntel") === "mac", "mac");
assert(detectPlatform("Win32") === "win", "win");

const macCopy = parseEvent({ key: "c", metaKey: true });
assert(isCopyChord(macCopy, "mac") === true, "mac copy");
const winCopy = parseEvent({ key: "C", ctrlKey: true, shiftKey: true });
assert(isCopyChord(winCopy, "win") === true, "win copy");
assert(isPasteChord(parseEvent({ key: "v", metaKey: true }), "mac") === true, "mac paste");

const r1 = handleTerminalKey({
  chord: macCopy,
  platform: "mac",
  hasSelection: true,
  selectionText: "hi",
});
assert(r1.action === "copy" && r1.toast, "copy toast");

const r2 = handleTerminalKey({
  chord: parseEvent({ key: "c", ctrlKey: true }),
  platform: "linux",
  hasSelection: false,
  selectionText: "",
});
assert(r2.action === "passthrough", "sigint");

const r3 = handleTerminalKey({
  chord: winCopy,
  platform: "win",
  hasSelection: false,
  selectionText: "",
});
assert(r3.action === "none", "no selection no copy");

console.log("TerminalClipboard tests: all passed");
