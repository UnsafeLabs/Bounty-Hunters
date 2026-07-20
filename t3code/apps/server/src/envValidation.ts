/**
 * Startup environment variable validation (issue 853).
 */

export type EnvType = "string" | "number" | "boolean" | "url";

export interface EnvSpec {
  name: string;
  required: boolean;
  type: EnvType;
  description: string;
  defaultValue?: string;
}

export interface EnvIssue {
  name: string;
  problem: string;
  expected: string;
  received: string;
  description: string;
}

export function parseBoolean(raw: string): boolean | null {
  const v = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

export function validateEnvValue(spec: EnvSpec, raw: string | undefined): EnvIssue | null {
  if (raw === undefined || raw === "") {
    if (spec.required && spec.defaultValue === undefined) {
      return {
        name: spec.name,
        problem: "missing",
        expected: spec.type,
        received: "<undefined>",
        description: spec.description,
      };
    }
    return null;
  }
  if (spec.type === "number" && !Number.isFinite(Number(raw))) {
    return {
      name: spec.name,
      problem: "invalid type",
      expected: "number",
      received: raw,
      description: spec.description,
    };
  }
  if (spec.type === "boolean" && parseBoolean(raw) === null) {
    return {
      name: spec.name,
      problem: "invalid type",
      expected: "boolean",
      received: raw,
      description: spec.description,
    };
  }
  if (spec.type === "url") {
    try {
      // eslint-disable-next-line no-new
      new URL(raw);
    } catch {
      return {
        name: spec.name,
        problem: "invalid type",
        expected: "url",
        received: raw,
        description: spec.description,
      };
    }
  }
  return null;
}

export function validateEnv(
  specs: EnvSpec[],
  env: Record<string, string | undefined>,
): { ok: boolean; issues: EnvIssue[] } {
  const issues: EnvIssue[] = [];
  for (const spec of specs) {
    const issue = validateEnvValue(spec, env[spec.name]);
    if (issue) issues.push(issue);
  }
  return { ok: issues.length === 0, issues };
}

export function formatIssuesTable(issues: EnvIssue[]): string {
  if (issues.length === 0) return "All environment variables valid.";
  const header = "| name | problem | expected | received | description |";
  const sep = "|---|---|---|---|---|";
  const rows = issues.map(
    (i) =>
      `| ${i.name} | ${i.problem} | ${i.expected} | ${i.received} | ${i.description} |`,
  );
  return [header, sep, ...rows].join("\n");
}

export function runValidateConfig(
  specs: EnvSpec[],
  env: Record<string, string | undefined>,
): { exitCode: number; output: string } {
  const { ok, issues } = validateEnv(specs, env);
  return { exitCode: ok ? 0 : 1, output: formatIssuesTable(issues) };
}
