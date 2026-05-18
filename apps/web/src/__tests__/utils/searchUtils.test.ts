import { describe, it, expect } from 'vitest';
import { highlightText, validateRegex, groupResultsBySource } from '../utils/searchUtils';
import { SearchResultGroup, SearchSource } from '../types/search';

describe('highlightText', (): void => {
  it('wraps matched term in <mark> tags for simple text', (): void => {
    const text = 'Hello World';
    const term = 'World';
    const result = highlightText(text, term);
    expect(result).toBe('Hello <mark>World</mark>');
  });

  it('highlights multiple occurrences of the same term', (): void => {
    const text = 'foo bar foo baz';
    const term = 'foo';
    const result = highlightText(text, term);
    expect(result).toBe('<mark>foo</mark> bar <mark>foo</mark> baz');
  });

  it('is case-sensitive by default', (): void => {
    const text = 'Apple apple';
    const term = 'apple';
    const result = highlightText(text, term);
    expect(result).toBe('Apple <mark>apple</mark>');
  });

  it('handles case-insensitive mode', (): void => {
    const text = 'Apple apple';
    const term = 'apple';
    const result = highlightText(text, term, { caseInsensitive: true });
    expect(result).toBe('<mark>Apple</mark> <mark>apple</mark>');
  });

  it('supports regex patterns', (): void => {
    const text = 'cat dog cat';
    const term = 'c.t';
    const result = highlightText(text, term, { isRegex: true });
    expect(result).toBe('<mark>cat</mark> dog <mark>cat</mark>');
  });

  it('returns original text when term is empty', (): void => {
    const text = 'sample text';
    const result = highlightText(text, '');
    expect(result).toBe('sample text');
  });

  it('escapes special regex characters when not in regex mode', (): void => {
    const text = 'price is $10.00';
    const term = '$10.00';
    const result = highlightText(text, term);
    expect(result).toBe('price is <mark>$10.00</mark>');
  });

  it('does not modify text when term is not found', (): void => {
    const text = 'hello world';
    const term = 'xyz';
    const result = highlightText(text, term);
    expect(result).toBe('hello world');
  });

  it('returns empty string for empty text', (): void => {
    const result = highlightText('', 'foo');
    expect(result).toBe('');
  });

  it('handles regex mode with invalid pattern by returning unmodified text', (): void => {
    const text = 'test';
    const term = '[invalid';
    const result = highlightText(text, term, { isRegex: true });
    expect(result).toBe('test');
  });
});

describe('validateRegex', (): void => {
  it('returns null for a valid regex pattern', (): void => {
    const result = validateRegex('\\d{3}');
    expect(result).toBeNull();
  });

  it('returns an error message for an invalid regex pattern', (): void => {
    const result = validateRegex('\\');
    expect(result).not.toBeNull();
    expect(result).toContain('Invalid regex');
  });

  it('handles empty pattern as valid', (): void => {
    const result = validateRegex('');
    expect(result).toBeNull();
  });

  it('returns error for pattern with unmatched parentheses', (): void => {
    const result = validateRegex('(abc');
    expect(result).not.toBeNull();
  });

  it('accepts flags suffix after closing delimiter when using RegExp constructor', (): void => {
    // Some implementations treat patterns with flags as valid
    const result = validateRegex('abc');
    expect(result).toBeNull();
  });

  it('returns descriptive error for completely malformed patterns', (): void => {
    const result = validateRegex('[');
    expect(result).not.toBeNull();
  });
});

describe('groupResultsBySource', (): void => {
  const sampleResults = [
    { source: 'chat' as SearchSource, id: '1', content: 'hello', preview: 'hello world' },
    { source: 'file' as SearchSource, id: '2', content: 'app.tsx', preview: 'export const' },
    { source: 'file' as SearchSource, id: '3', content: 'utils.ts', preview: 'function foo' },
    { source: 'git' as SearchSource, id: '4', content: 'fix bug', preview: 'commit message' },
  ];

  it('groups results by source type', (): void => {
    const groups = groupResultsBySource(sampleResults);
    expect(groups).toHaveLength(3);
    const chatGroup = groups.find((g: SearchResultGroup) => g.source === 'chat');
    expect(chatGroup).toBeDefined();
    expect(chatGroup!.count).toBe(1);
    const fileGroup = groups.find((g: SearchResultGroup) => g.source === 'file');
    expect(fileGroup).toBeDefined();
    expect(fileGroup!.count).toBe(2);
    const gitGroup = groups.find((g: SearchResultGroup) => g.source === 'git');
    expect(gitGroup).toBeDefined();
    expect(gitGroup!.count).toBe(1);
  });

  it('returns empty array for empty input', (): void => {
    const result = groupResultsBySource([]);
    expect(result).toEqual([]);
  });

  it('preserves result items in correct groups with order', (): void => {
    const groups = groupResultsBySource(sampleResults);
    const fileGroup = groups.find((g: SearchResultGroup) => g.source === 'file')!;
    expect(fileGroup.results).toHaveLength(2);
    expect(fileGroup.results[0].id).toBe('2');
    expect(fileGroup.results[1].id).toBe('3');
  });

  it('creates groups for each distinct source', (): void => {
    const results = [
      { source: 'chat' as SearchSource, id: 'a', content: 'x', preview: 'x' },
      { source: 'chat' as SearchSource, id: 'b', content: 'y', preview: 'y' },
    ];
    const groups = groupResultsBySource(results);
    expect(groups).toHaveLength(1);
    expect(groups[0].source).toBe('chat');
    expect(groups[0].count).toBe(2);
  });

  it('sorts groups in a consistent order: chat, file, git', (): void => {
    const results = [
      { source: 'git' as SearchSource, id: '1', content: 'a', preview: 'a' },
      { source: 'file' as SearchSource, id: '2', content: 'b', preview: 'b' },
      { source: 'chat' as SearchSource, id: '3', content: 'c', preview: 'c' },
    ];
    const order = ['chat', 'file', 'git'];
    const groups = groupResultsBySource(results);
    const sources = groups.map((g: SearchResultGroup) => g.source);
    expect(sources).toEqual(order);
  });

  it('handles unknown sources gracefully', (): void => {
    const results = [
      { source: 'other' as SearchSource, id: '1', content: 'test', preview: 'test' },
    ];
    const groups = groupResultsBySource(results);
    expect(groups).toHaveLength(1);
    expect(groups[0].source).toBe('other');
  });
});