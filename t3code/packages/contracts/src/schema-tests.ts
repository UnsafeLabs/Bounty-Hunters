/**
 * Round-trip schema validation tests for contract types.
 * Tests encoding/decoding consistency for all schema types.
 */

import { Schema } from "@effect/schema";

interface TestCase {
  name: string;
  schema: Schema.Schema<any>;
  validInput: unknown;
  invalidInput?: unknown;
}

/**
 * Test that a value survives encode -> decode round-trip.
 */
export function testRoundTrip<T>(
  schema: Schema.Schema<T>,
  value: T,
  testName: string
): { pass: boolean; error?: string } {
  try {
    const encoded = Schema.encodeSync(schema)(value);
    const decoded = Schema.decodeSync(schema)(encoded);

    if (JSON.stringify(decoded) !== JSON.stringify(value)) {
      return {
        pass: false,
        error: `${testName}: Round-trip mismatch. Expected ${JSON.stringify(value)}, got ${JSON.stringify(decoded)}`,
      };
    }

    return { pass: true };
  } catch (error: any) {
    return {
      pass: false,
      error: `${testName}: ${error.message}`,
    };
  }
}

/**
 * Test that invalid input is properly rejected.
 */
export function testValidation<T>(
  schema: Schema.Schema<T>,
  invalidInput: unknown,
  testName: string
): { pass: boolean; error?: string } {
  try {
    Schema.decodeUnknownSync(schema)(invalidInput);
    return {
      pass: false,
      error: `${testName}: Should have rejected invalid input`,
    };
  } catch {
    return { pass: true };
  }
}

/**
 * Run all schema tests.
 */
export function runSchemaTests(testCases: TestCase[]): {
  passed: number;
  failed: number;
  results: Array<{ name: string; pass: boolean; error?: string }>;
} {
  const results: Array<{ name: string; pass: boolean; error?: string }> = [];

  for (const tc of testCases) {
    // Test round-trip
    const roundTrip = testRoundTrip(tc.schema, tc.validInput, tc.name);
    results.push({ name: `${tc.name} (round-trip)`, ...roundTrip });

    // Test invalid input rejection
    if (tc.invalidInput !== undefined) {
      const validation = testValidation(tc.schema, tc.invalidInput, tc.name);
      results.push({ name: `${tc.name} (validation)`, ...validation });
    }
  }

  return {
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
}
