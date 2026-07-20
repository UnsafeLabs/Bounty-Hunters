/**
 * Cross-platform terminal copy/paste keybindings (issue #824).
 */

export type PlatformKind = "mac" | "win" | "linux";

export function detectPlatform(navPlatform: string): PlatformKind {
  const p = navPlatform.toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "win";
  return "linux";
}

export interface KeyChord {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseEvent(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyChord {
  return {
    key: e.key,
    meta: Boolean(e.metaKey),
    ctrl: Boolean(e.ctrlKey),
    shift: Boolean(e.shiftKey),
    alt: Boolean(e.altKey),
  };
}

export function isCopyChord(chord: KeyChord, platform: PlatformKind): boolean {
  if (platform === "mac") {
    // Cmd+C when selection exists (caller gates)
    return chord.meta && !chord.alt && !chord.shift && chord.key.toLowerCase() === "c";
  }
  // Ctrl+Shift+C
  return chord.ctrl && chord.shift && !chord.alt && chord.key.toLowerCase() === "c";
}

export function isPasteChord(chord: KeyChord, platform: PlatformKind): boolean {
  if (platform === "mac") {
    return chord.meta && !chord.alt && !chord.shift && chord.key.toLowerCase() === "v";
  }
  return chord.ctrl && chord.shift && !chord.alt && chord.key.toLowerCase() === "v";
}

export function isSigintPassThrough(
  chord: KeyChord,
  platform: PlatformKind,
  hasSelection: boolean,
): boolean {
  // When no selection, Ctrl+C should reach terminal (SIGINT), not copy
  if (platform === "mac") return false; // Cmd+C never sigint
  return (
    chord.ctrl &&
    !chord.shift &&
    !chord.alt &&
    chord.key.toLowerCase() === "c" &&
    !hasSelection
  );
}

export function handleTerminalKey(input: {
  chord: KeyChord;
  platform: PlatformKind;
  hasSelection: boolean;
  selectionText: string;
}): { action: "copy" | "paste" | "passthrough" | "none"; toast?: string } {
  if (isCopyChord(input.chord, input.platform)) {
    if (!input.hasSelection) {
      // mac Cmd+C with no selection: nothing; win Ctrl+Shift+C no selection: nothing
      // win Ctrl+C without selection handled as passthrough separately
      return { action: "none" };
    }
    return { action: "copy", toast: "Copied to clipboard" };
  }
  if (isPasteChord(input.chord, input.platform)) {
    return { action: "paste" };
  }
  if (isSigintPassThrough(input.chord, input.platform, input.hasSelection)) {
    return { action: "passthrough" };
  }
  return { action: "none" };
}
