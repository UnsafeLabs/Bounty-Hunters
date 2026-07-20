/**
 * File tree drag-and-drop move logic (issue #857).
 */

export interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface MovePlan {
  sources: string[];
  targetDir: string;
  operations: Array<{ from: string; to: string; useGitMv: boolean }>;
  noop: boolean;
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

export function join(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir.replace(/\/$/, "")}/${name}`;
}

export function isValidDropTarget(
  sourcePaths: string[],
  target: FileNode,
): boolean {
  if (!target.isDirectory) return false;
  for (const src of sourcePaths) {
    if (src === target.path) return false;
    if (target.path === dirname(src)) return false; // same parent
    if (target.path.startsWith(src + "/")) return false; // into self
  }
  return true;
}

export function planMove(
  sources: string[],
  targetDir: string,
  tracked: Set<string>,
): MovePlan {
  const ops: MovePlan["operations"] = [];
  let noop = true;
  for (const from of sources) {
    const name = from.split("/").pop()!;
    const to = join(targetDir, name);
    if (to === from) continue;
    noop = false;
    ops.push({ from, to, useGitMv: tracked.has(from) });
  }
  return { sources, targetDir, operations: ops, noop };
}

export function invertMove(plan: MovePlan): MovePlan {
  return {
    sources: plan.operations.map((o) => o.to),
    targetDir: plan.operations[0] ? dirname(plan.operations[0].from) : "",
    operations: plan.operations.map((o) => ({
      from: o.to,
      to: o.from,
      useGitMv: o.useGitMv,
    })),
    noop: plan.noop,
  };
}

export function dropIndicator(
  valid: boolean,
): "valid" | "invalid" | "none" {
  return valid ? "valid" : "invalid";
}
