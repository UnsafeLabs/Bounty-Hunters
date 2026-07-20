/**
 * Inline commenting on diff lines (issue #846).
 */

export interface DiffComment {
  id: string;
  filePath: string;
  line: number;
  body: string;
  createdAt: number;
  collapsed: boolean;
}

export type CommentKey = string; // `${filePath}:${line}`

export function commentKey(filePath: string, line: number): CommentKey {
  return `${filePath}:${line}`;
}

export class DiffCommentStore {
  private byKey = new Map<CommentKey, DiffComment[]>();
  private now: () => number;
  private idSeq = 0;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  add(filePath: string, line: number, body: string): DiffComment {
    const c: DiffComment = {
      id: `c${++this.idSeq}`,
      filePath,
      line,
      body,
      createdAt: this.now(),
      collapsed: false,
    };
    const k = commentKey(filePath, line);
    const list = this.byKey.get(k) ?? [];
    list.push(c);
    this.byKey.set(k, list);
    return { ...c };
  }

  listForLine(filePath: string, line: number): DiffComment[] {
    return (this.byKey.get(commentKey(filePath, line)) ?? []).map((c) => ({ ...c }));
  }

  totalCount(): number {
    let n = 0;
    for (const list of this.byKey.values()) n += list.length;
    return n;
  }

  setCollapsed(id: string, collapsed: boolean): void {
    for (const list of this.byKey.values()) {
      const c = list.find((x) => x.id === id);
      if (c) c.collapsed = collapsed;
    }
  }

  /** Clear all when diff changes (new commit). */
  clearAll(): void {
    this.byKey.clear();
  }

  /** Session persistence snapshot. */
  toJSON(): DiffComment[] {
    const all: DiffComment[] = [];
    for (const list of this.byKey.values()) all.push(...list.map((c) => ({ ...c })));
    return all;
  }

  fromJSON(comments: DiffComment[]): void {
    this.byKey.clear();
    for (const c of comments) {
      const k = commentKey(c.filePath, c.line);
      const list = this.byKey.get(k) ?? [];
      list.push({ ...c });
      this.byKey.set(k, list);
    }
  }
}

export function shouldCloseOnEscape(activeInputOpen: boolean): boolean {
  return activeInputOpen;
}
