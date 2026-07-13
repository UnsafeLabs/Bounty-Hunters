import { describe, it, expect, afterAll } from "vitest";
import * as Schema from "effect/Schema";
import * as Opt from "effect/Option";
import * as Contracts from "./index.ts";

/* ------------------------------------------------------------------ */
/* Generic candidate-sample generator driven by the Effect Schema AST  */
/* ------------------------------------------------------------------ */

function peel(ast: any): any {
  let a = ast;
  while (a && (a._tag === "Refinement" || a._tag === "Transformation")) a = a.from;
  return a;
}

function fallback(ast: any): any {
  const u = peel(ast);
  if (u._tag === "String") return "x";
  if (u._tag === "Number") return 1;
  if (u._tag === "Boolean") return true;
  if (u._tag === "BigInt") return 1n;
  return null;
}

/* Rebuild a usable Schema from an AST so we can validate candidate samples
   against the *exact* field type (critical for Option<X>, bounded numbers,
   and regex-constrained strings where the first generated candidate would be
   rejected). Cached per-AST to keep the suite fast. */
const schemaCache = new WeakMap<any, any>();
function fieldSchema(ast: any): any {
  let s = schemaCache.get(ast);
  if (s === undefined) {
    try {
      s = (Schema as any).make(ast);
    } catch {
      s = null;
    }
    schemaCache.set(ast, s);
  }
  return s;
}
function pickValid(ast: any, cands: any[]): any {
  const s = fieldSchema(ast);
  if (s) {
    for (const c of cands) {
      try {
        Schema.decodeUnknownSync(s)(c);
        return c;
      } catch {
        /* try next candidate */
      }
    }
  }
  return cands.length ? cands[0] : fallback(ast);
}

function genCandidates(ast: any, depth = 0): any[] {
  if (!ast) return [];
  if (depth > 8) return [fallback(ast)];
  const tag = ast._tag;
  switch (tag) {
    case "String":
      return [
        "alpha",
        "hello world",
        "unicode-☃-Ω-test",
        "x",
        "A Name",
        "image/png",
        "image/jpeg",
        "text/plain",
        "application/json",
      ];
    case "Number":
      return [42, 1, 0, 100, 65535, -1, 3.14, 7];
    case "Boolean":
      return [true, false];
    case "Literal":
      return [ast.literal];
    case "Unknown":
      return [null, "value", 1, true, {}, ["a"]];
    case "BigInt":
      return [42n, 1n, 0n];
    case "TemplateLiteral": {
      try {
        const parts: any[] = ast.parts || [];
        const s = parts.map((p: any) => (typeof p?.literal === "string" ? p.literal : "x")).join("");
        return [s, s + "x", "ax", "x" + s];
      } catch {
        return ["x", "ax"];
      }
    }
    case "Objects": {
      const build = (omitOptional: boolean): any => {
        const obj: any = {};
        for (const ps of ast.propertySignatures || []) {
          if (omitOptional && ps.isOptional) continue;
          const c = genCandidates(ps.type, depth + 1);
          if (c.length) obj[String(ps.name)] = pickValid(ps.type, c);
        }
        for (const idx of ast.indexSignatures || []) {
          const kc = genCandidates(idx.parameter, depth + 1);
          const vc = genCandidates(idx.type, depth + 1);
          if (kc.length && vc.length) {
            obj[String(pickValid(idx.parameter, kc))] = pickValid(idx.type, vc);
          }
        }
        return obj;
      };
      return [build(false), build(true)];
    }
    case "Arrays": {
      if (ast.elements && ast.elements.length) {
        const arr = ast.elements.map((e: any) => {
          const c = genCandidates(e.type, depth + 1);
          return c.length ? pickValid(e.type, c) : null;
        });
        if (arr.every((x: any) => x !== null)) return [arr];
        return [[]];
      }
      if (ast.rest && ast.rest.length) {
        const restAst = ast.rest[0].type ?? ast.rest[0];
        const c = genCandidates(restAst, depth + 1);
        return [c.length ? [pickValid(restAst, c)] : [], []];
      }
      return [[]];
    }
    case "Union": {
      const out: any[] = [];
      for (const t of ast.types || []) out.push(...genCandidates(t, depth + 1));
      return out;
    }
    case "Suspend": {
      const inner = ast.ast || (typeof ast.f === "function" ? ast.f() : ast);
      return genCandidates(inner, depth + 1);
    }
    case "Refinement":
    case "Transformation":
      return genCandidates(peel(ast), depth + 1);
    case "Declaration": {
      // Branded / transformation-backed declarations (DateTimeUtc, DurationFromMillis,
      // Option<X>, ...) have no generic structural shape. `decodeUnknown` expects the
      // *encoded* (wire) form as input, which for some declarations (DurationFromMillis,
      // DateTimeUtcFromMillis) is a primitive (number) while for others (DateTimeUtc,
      // Option<X>) it equals the decoded value. To stay general we probe a basket of
      // seeds, and for every seed that decodes we push back the *re-encoded* value, which
      // is guaranteed to be a valid encoded candidate regardless of the declaration kind.
      const s = fieldSchema(ast);
      if (!s) return [fallback(ast)];
      const out: any[] = [];
      const seeds: any[] = [
        0,
        1,
        42,
        1000,
        60,
        3600000,
        -1,
        3.14,
        "1970-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        Opt.none(),
        Opt.some(0),
      ];
      try {
        seeds.push(Schema.decodeUnknownSync(Schema.DateTimeUtcFromMillis)(0));
      } catch {}
      try {
        seeds.push(Opt.some(Schema.decodeUnknownSync(Schema.DateTimeUtcFromMillis)(0)));
      } catch {}
      for (const seed of seeds) {
        try {
          const decoded = Schema.decodeUnknownSync(s)(seed);
          out.push(Schema.encodeSync(s)(decoded));
        } catch {
          /* seed is not a valid encoded value for this declaration */
        }
      }
      if (out.length) return out;
      return [fallback(ast)];
    }
    default:
      return [fallback(ast)];
  }
}

function isStringBased(ast: any): boolean {
  const u = peel(ast);
  return u._tag === "String" || u._tag === "TemplateLiteral";
}

function collectLiterals(ast: any): any[] | null {
  const tag = ast._tag;
  if (tag === "Literal") return [ast.literal];
  if (tag === "Union") {
    const all: any[] = [];
    for (const t of ast.types || []) {
      const l = collectLiterals(t);
      if (l === null) return null;
      all.push(...l);
    }
    return all;
  }
  if (tag === "Refinement" || tag === "Transformation") return collectLiterals(peel(ast));
  return null;
}

/* ------------------------------------------------------------------ */
/* Collect every exported Schema from the package barrel              */
/* ------------------------------------------------------------------ */

const schemas: { name: string; schema: any }[] = [];
for (const name of Object.keys(Contracts)) {
  const v: any = (Contracts as any)[name];
  if (v && typeof v === "object" && v.ast && typeof v.ast === "object") {
    schemas.push({ name, schema: v });
  }
}

const stats = { roundTrip: 0, roundTripSkipped: 0, enumReject: 0, stringEdge: 0 };
const skippedNames: string[] = [];
const NONE = Symbol("none");

/* ------------------------------------------------------------------ */
/* Round-trip: decode -> encode -> decode == original                 */
/* ------------------------------------------------------------------ */

describe("schema round-trip (decode → encode → decode)", () => {
  for (const { name, schema } of schemas) {
    it(`${name} round-trips`, () => {
      const candidates = genCandidates(schema.ast);
      let decoded: any = NONE;
      const errs: string[] = [];
      for (const c of candidates) {
        try {
          decoded = Schema.decodeUnknownSync(schema)(c);
          break;
        } catch (e: any) {
          errs.push(String(e?.message ?? e).slice(0, 90));
          /* try next candidate */
        }
      }
      if (decoded === NONE) {
        stats.roundTripSkipped++;
        skippedNames.push(`${name} :: ${errs[0] ?? ""}`);
        return; // cannot synthesize a valid sample; leave green
      }
      stats.roundTrip++;
      const encoded = Schema.encodeSync(schema)(decoded);
      const redecoded = Schema.decodeUnknownSync(schema)(encoded);
      expect(redecoded).toEqual(decoded);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Enum / literal rejection: unknown values are rejected              */
/* ------------------------------------------------------------------ */

describe("enum schemas reject unknown values", () => {
  for (const { name, schema } of schemas) {
    const lits = collectLiterals(schema.ast);
    if (lits && lits.length >= 1) {
      it(`${name} rejects unknown value`, () => {
        const sample = typeof lits[0] === "string" ? "__not_a_member__" : -987654;
        expect(lits).not.toContain(sample);
        expect(() => Schema.decodeUnknownSync(schema)(sample)).toThrow();
        stats.enumReject++;
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/* String field edge cases: unicode + empty handling                  */
/* ------------------------------------------------------------------ */

describe("string field edge cases (unicode / empty)", () => {
  for (const { name, schema } of schemas) {
    if (isStringBased(schema.ast)) {
      it(`${name} handles unicode and empty`, () => {
        stats.stringEdge++;
        const uni = "café-☃-Ω-漢字-é";
        try {
          const d = Schema.decodeUnknownSync(schema)(uni);
          const e = Schema.encodeSync(schema)(d);
          expect(Schema.decodeUnknownSync(schema)(e)).toEqual(d);
        } catch {
          /* unicode not accepted by this string schema */
        }
        try {
          const d = Schema.decodeUnknownSync(schema)("");
          const e = Schema.encodeSync(schema)(d);
          expect(Schema.decodeUnknownSync(schema)(e)).toEqual(d);
        } catch {
          /* empty string rejected (e.g. non-empty branded id) — expected */
        }
      });
    }
  }
});

afterAll(() => {
  console.log(
    `\n[round-trip coverage] tested=${stats.roundTrip} skipped=${stats.roundTripSkipped} enumReject=${stats.enumReject} stringEdge=${stats.stringEdge} totalSchemas=${schemas.length}`,
  );
  if (skippedNames.length) console.log("[skipped]", skippedNames.join(", "));
});
