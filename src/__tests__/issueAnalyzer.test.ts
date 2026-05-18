import { extractCriteria } from '../issueAnalyzer';

describe('issueAnalyzer - extractCriteria', () => {
  /**
   * Tests extraction of acceptance criteria from a properly formatted issue body.
   */
  it('should extract criteria from markdown issue body with dashed list', () => {
    const body = `
## Acceptance Criteria
- The system returns a 200 status code.
- Error messages are displayed in red.
- All fields are validated before submission.
`;
    const result = extractCriteria(body);
    expect(result).toEqual([
      'The system returns a 200 status code.',
      'Error messages are displayed in red.',
      'All fields are validated before submission.',
    ]);
  });

  /**
   * Tests extraction when criteria are listed with asterisks.
   */
  it('should extract criteria from asterisk bullet list', () => {
    const body = `
**Acceptance Criteria**
* User can log in with valid credentials.
* Invalid login shows an error message.
`;
    const result = extractCriteria(body);
    expect(result).toEqual([
      'User can log in with valid credentials.',
      'Invalid login shows an error message.',
    ]);
  });

  /**
   * Tests that empty issue body returns an empty array.
   */
  it('should return empty array for empty issue body', () => {
    const result = extractCriteria('');
    expect(result).toEqual([]);
  });

  /**
   * Tests that body without acceptance criteria returns empty array.
   */
  it('should return empty array when no acceptance criteria section exists', () => {
    const body = 'This issue describes a bug. No criteria section.';
    const result = extractCriteria(body);
    expect(result).toEqual([]);
  });

  /**
   * Tests extraction of numbered criteria.
   */
  it('should extract numbered list as criteria', () => {
    const body = `
### Acceptance Criteria
1. Create a new endpoint /api/v1/users.
2. Include pagination support.
3. Return 401 for unauthenticated requests.
`;
    const result = extractCriteria(body);
    expect(result).toEqual([
      'Create a new endpoint /api/v1/users.',
      'Include pagination support.',
      'Return 401 for unauthenticated requests.',
    ]);
  });

  /**
   * Tests that criteria following "Criteria:" on the same line are captured.
   */
  it('should extract inline criteria after heading', () => {
    const body = `**Acceptance Criteria:** Ensure latency is below 200ms.`;
    const result = extractCriteria(body);
    expect(result).toEqual(['Ensure latency is below 200ms.']);
  });

  /**
   * Tests that blank lines between criteria are ignored.
   */
  it('should ignore blank lines between criteria items', () => {
    const body = `
## Acceptance Criteria
- Login works.

- Logout works.
`;
    const result = extractCriteria(body);
    expect(result).toEqual(['Login works.', 'Logout works.']);
  });

  /**
   * Tests that the function throws an error when given a non-string input.
   */
  it('should throw TypeError when body is not a string', () => {
    expect(() => extractCriteria(null as unknown as string)).toThrow(TypeError);
    expect(() => extractCriteria(undefined as unknown as string)).toThrow(TypeError);
    expect(() => extractCriteria(123 as unknown as string)).toThrow(TypeError);
  });

  /**
   * Tests extraction from a complex markdown body with multiple sections.
   */
  it('should extract criteria from a full issue body ignoring other sections', () => {
    const body = `
# Bug Report

## Description
Something is broken.

## Acceptance Criteria
- The fix must not break existing tests.
- The error is logged with stack trace.
- Response time stays under 1 second.

## Additional Context
...
`;
    const result = extractCriteria(body);
    expect(result).toEqual([
      'The fix must not break existing tests.',
      'The error is logged with stack trace.',
      'Response time stays under 1 second.',
    ]);
  });

  /**
   * Tests that only the first occurrence of acceptance criteria section is used.
   */
  it('should use the first acceptance criteria section when multiple exist', () => {
    const body = `
## Acceptance Criteria
- First criteria list.

## Acceptance Criteria
- Second criteria list.
`;
    const result = extractCriteria(body);
    expect(result).toEqual(['First criteria list.']);
  });
});