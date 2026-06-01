/**
 * Global search across chat messages, files, and git history.
 */

interface SearchResult {
  type: "message" | "file" | "git";
  title: string;
  snippet: string;
  path?: string;
  score: number;
  timestamp?: number;
}

export class GlobalSearch {
  private indexes: Map<string, SearchIndex> = new Map();

  registerIndex(name: string, index: SearchIndex): void {
    this.indexes.set(name, index);
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const [, index] of this.indexes) {
      const found = await index.search(query, limit);
      results.push(...found);
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

interface SearchIndex {
  search(query: string, limit: number): Promise<SearchResult[]>;
}

export class FileSearchIndex implements SearchIndex {
  private files: Map<string, string> = new Map();

  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const q = query.toLowerCase();
    const results: SearchResult[] = [];
    for (const [path, content] of this.files) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          results.push({
            type: "file",
            title: path,
            snippet: lines.slice(Math.max(0, i - 1), i + 2).join("\n"),
            path,
            score: lines[i].toLowerCase().indexOf(q) === 0 ? 1 : 0.5,
          });
          if (results.length >= limit) return results;
          break;
        }
      }
    }
    return results;
  }
}
