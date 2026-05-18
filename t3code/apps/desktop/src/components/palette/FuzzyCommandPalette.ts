import { Effect, Ref } from "effect";

/**
 * Fix: Add fuzzy search with match highlighting to CommandPalette (#830)
 */

export interface CommandItem {
  id: string;
  label: string;
  category: string;
  keywords: string[];
  shortcut?: string;
}

export interface MatchResult {
  item: CommandItem;
  score: number;
  highlights: number[];  // indices of matched characters
}

const fuzzyMatch = (query: string, text: string): { score: number; indices: number[] } | null => {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  const indices: number[] = [];

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      // Bonus for consecutive matches
      score += (indices.length > 1 && indices[indices.length - 2] === ti - 1) ? 10 : 1;
      // Bonus for match at word boundary
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "_") score += 5;
      qi++;
    }
  }

  return qi === q.length ? { score, indices } : null;
};

export const FuzzyCommandPalette = Effect.gen(function* (_) {
  const commandsRef = yield* _(Ref.make<CommandItem[]>([]));

  const search = (query: string, limit: number = 20) =>
    Effect.gen(function* (_) {
      const commands = yield* _(Ref.get(commandsRef));
      
      if (!query) return commands.slice(0, limit).map((item) => ({ item, score: 0, highlights: [] }));

      const results: MatchResult[] = [];
      
      for (const cmd of commands) {
        // Search in label
        const labelMatch = fuzzyMatch(query, cmd.label);
        // Search in keywords
        const keywordMatches = cmd.keywords
          .map((kw) => fuzzyMatch(query, kw))
          .filter(Boolean);

        const bestMatch = [labelMatch, ...keywordMatches].filter(Boolean).sort((a, b) => b.score - a.score)[0];

        if (bestMatch) {
          results.push({
            item: cmd,
            score: bestMatch.score,
            highlights: bestMatch.indices,
          });
        }
      }

      return results.sort((a, b) => b.score - a.score).slice(0, limit);
    });

  const register = (commands: CommandItem[]) =>
    Ref.update(commandsRef, (existing) => [...existing, ...commands]);

  return { search, register };
});
