/**
 * Command palette enhancements with keyboard navigation and fuzzy search.
 */

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  action: () => void;
}

interface PaletteState {
  query: string;
  selectedIndex: number;
  filteredItems: CommandItem[];
  recentIds: string[];
}

export function useCommandPalette(commands: CommandItem[]) {
  const recentKey = "command-palette-recent";
  const maxRecent = 5;

  function getRecent(): string[] {
    try {
      return JSON.parse(localStorage.getItem(recentKey) || "[]");
    } catch {
      return [];
    }
  }

  function addRecent(id: string): void {
    const recent = getRecent().filter((r) => r !== id);
    recent.unshift(id);
    localStorage.setItem(recentKey, JSON.stringify(recent.slice(0, maxRecent)));
  }

  function fuzzyMatch(query: string, label: string): boolean {
    const q = query.toLowerCase();
    const l = label.toLowerCase();
    let qi = 0;
    for (let li = 0; li < l.length && qi < q.length; li++) {
      if (l[li] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function filterItems(query: string): CommandItem[] {
    if (!query) {
      const recent = getRecent();
      const recentItems = recent
        .map((id) => commands.find((c) => c.id === id))
        .filter(Boolean) as CommandItem[];
      const otherItems = commands.filter((c) => !recent.includes(c.id));
      return [...recentItems, ...otherItems];
    }

    return commands
      .filter((c) => fuzzyMatch(query, c.label))
      .sort((a, b) => {
        const aStart = a.label.toLowerCase().startsWith(query.toLowerCase()) ? -1 : 0;
        const bStart = b.label.toLowerCase().startsWith(query.toLowerCase()) ? -1 : 0;
        return aStart - bStart;
      });
  }

  return {
    filterItems,
    addRecent,
    getRecent,
    fuzzyMatch,
  };
}
