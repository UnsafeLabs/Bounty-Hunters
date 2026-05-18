typescript
/* -------------------------------------------------------------------------- */
/*  Imports                                                                   */
/* -------------------------------------------------------------------------- */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import winston from 'winston'; // Ensure winston is installed (types included)
import {
  generateReviewComment,
  ReviewCommentParams,
  ReviewCommentResult,
  AGENT_NAME,
  ACCEPTANCE_CRITERIA,
  SYSTEM_PROMPT,
  AGENT_NAME_PATTERN,
  IMPROVEMENT_KEYWORDS,
  ENDING_CODE_BLOCK_PATTERN,
} from './review';

/* -------------------------------------------------------------------------- */
/*  Logger setup with mocking                                                 */
/* -------------------------------------------------------------------------- */

// Mock winston logger to prevent side effects and noise in test output.
jest.mock('winston', () => {
  const mockLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  return {
    createLogger: jest.fn(() => mockLogger),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      printf: jest.fn(),
      colorize: jest.fn(),
    },
    transports: {
      Console: jest.fn(),
      File: jest.fn(),
    },
  };
});

// Re-import the logger after it's been mocked.
import { logger } from './logger';

beforeEach(() => {
  // Clear all mock calls before each test for isolation.
  jest.clearAllMocks();
});

afterEach(() => {
  // Optional: additional cleanup if needed.
});

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

/** Minimum number of acceptance criteria required for a valid comment. */
const MIN_ACCEPTANCE_CRITERIA = 1;

/** Default error messages used across the module. */
const ERRORS = {
  INVALID_AGENT_NAME: 'agentName must be a non‑empty string',
  INVALID_CRITERIA: 'acceptanceCriteria must be a non‑empty array of non‑empty strings',
  GENERATION_FAILED: 'GenerateReviewComment threw an error',
} as const;

/* -------------------------------------------------------------------------- */
/*  Valid baseline parameters                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Baseline valid parameters used across multiple tests.
 * All values are derived from the imported constants to ensure consistency
 * and reduce maintenance overhead.
 */
const validParams: ReviewCommentParams = {
  agentName: AGENT_NAME,
  acceptanceCriteria: [...ACCEPTANCE_CRITERIA], // Shallow copy to avoid mutation
  outOfScopeFiles: [],
  hasLinkedIssue: true,
  systemPrompt: SYSTEM_PROMPT,
};

/* -------------------------------------------------------------------------- */
/*  Helper: generate a comment and catch errors                               */
/* -------------------------------------------------------------------------- */

/**
 * Safely generates a review comment, returning either the result or an error.
 * All inputs are validated before calling the core function to provide clear
 * error messages even when `generateReviewComment` might not perform its own
 * validation.
 *
 * @param params - The parameters to be passed to `generateReviewComment`.
 *                 Must conform to `ReviewCommentParams` interface.
 * @returns An object with either a `result` property (on success) or an `error`
 *          property (on failure). The result contains the generated comment
 *          and any additional metadata.
 *
 * @example
 * const outcome = safeGenerateComment(validParams);
 * if ('error' in outcome) {
 *   logger.error(outcome.error);
 * } else {
 *   logger.info(outcome.result.comment);
 * }
 *
 * @throws Never throws; errors are captured and returned.
 */
function safeGenerateComment(
  params: ReviewCommentParams,
): { result: ReviewCommentResult } | { error: Error } {
  // Input validation
  if (!params.agentName || typeof params.agentName !== 'string') {
    const err = new Error(ERRORS.INVALID_AGENT_NAME);
    logger.error('Validation error in safeGenerateComment', {
      reason: ERRORS.INVALID_AGENT_NAME,
      received: params.agentName,
    });
    return { error: err };
  }

  if (
    !Array.isArray(params.acceptanceCriteria) ||
    params.acceptanceCriteria.length < MIN_ACCEPTANCE_CRITERIA ||
    params.acceptanceCriteria.some((ac) => typeof ac !== 'string' || ac.trim().length === 0)
  ) {
    const err = new Error(ERRORS.INVALID_CRITERIA);
    logger.error('Validation error in safeGenerateComment', {
      reason: ERRORS.INVALID_CRITERIA,
      length: Array.isArray(params.acceptanceCriteria) ? params.acceptanceCriteria.length : undefined,
    });
    return { error: err };
  }

  try {
    const result: ReviewCommentResult = generateReviewComment(params);
    logger.info('Review comment generated successfully', {
      agentName: params.agentName,
      criteriaCount: params.acceptanceCriteria.length,
      outOfScopeFilesCount: params.outOfScopeFiles?.length ?? 0,
      hasLinkedIssue: params.hasLinkedIssue,
    });
    return { result };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(ERRORS.GENERATION_FAILED, {
      params: {
        agentName: params.agentName,
        criteriaCount: params.acceptanceCriteria.length,
      },
      errorMessage: error.message,
      stack: error.stack,
    });
    return { error };
  }
}

/* -------------------------------------------------------------------------- */
/*  Test Suite                                                                */
/* -------------------------------------------------------------------------- */

describe('Review Comment Generation', () => {
  // ==========================================================================
  // 1. Prefix validation (agent name in brackets)
  // ==========================================================================
  it('should generate a comment that starts with the agent name in brackets', () => {
    const outcome = safeGenerateComment(validParams);
    if ('error' in outcome) {
      throw outcome.error;
    }
    expect(outcome.result.comment).toMatch(AGENT_NAME_PATTERN);
  });

  // ==========================================================================
  // 2. Actionable improvement suggestion
  // ==========================================================================
  it('should include an actionable improvement suggestion', () => {
    const outcome = safeGenerateComment(validParams);
    if ('error' in outcome) {
      throw outcome.error;
    }
    // Use a regex that checks for any of the improvement keywords (case‑insensitive)
    expect(outcome.result.comment).toMatch(IMPROVEMENT_KEYWORDS);
  });

  // ==========================================================================
  // 3. References linked acceptance criteria
  // ==========================================================================
  it('should reference the linked acceptance criteria', () => {
    const outcome = safeGenerateComment(validParams);
    if ('error' in outcome) {
      throw outcome.error;
    }
    for (const criterion of ACCEPTANCE_CRITERIA) {
      // Use toContain for exact matches; if paraphrasing is an expected feature,
      // consider using toMatch(new RegExp(escapeRegex(criterion), 'i')) instead.
      expect(outcome.result.comment).toContain(criterion);
    }
  });

  // ==========================================================================
  // 4. Ends with a code block containing the system prompt
  // ==========================================================================
  it('should end with a code block containing the system prompt', () => {
    const outcome = safeGenerateComment(validParams);
    if ('error' in outcome) {
      throw outcome.error;
    }
    const comment = outcome.result.comment;
    // The pattern ENDING_CODE_BLOCK_PATTERN should match the terminal code block.
    expect(comment).toMatch(ENDING_CODE_BLOCK_PATTERN);
  });

  // ==========================================================================
  // 5. Validation: invalid agent name
  // ==========================================================================
  it('should return an error for an invalid agent name', () => {
    const outcome = safeGenerateComment({
      ...validParams,
      agentName: '', // empty string
    });
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expect(outcome.error.message).toBe(ERRORS.INVALID_AGENT_NAME);
    }
  });

  // ==========================================================================
  // 6. Validation: empty acceptance criteria / invalid criteria
  // ==========================================================================
  it('should return an error for empty acceptance criteria', () => {
    const outcome = safeGenerateComment({
      ...validParams,
      acceptanceCriteria: [],
    });
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expect(outcome.error.message).toBe(ERRORS.INVALID_CRITERIA);
    }
  });

  it('should return an error for acceptance criteria containing empty strings', () => {
    const outcome = safeGenerateComment({
      ...validParams,
      acceptanceCriteria: ['valid', '', 'also valid'],
    });
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expect(outcome.error.message).toBe(ERRORS.INVALID_CRITERIA);
    }
  });

  // ==========================================================================
  // 7. Error path: when generateReviewComment throws an error
  // ==========================================================================
  it('should catch and return errors thrown by generateReviewComment', () => {
    // Arrange: mock the generateReviewComment to throw a specific error.
    const mockError = new Error('Simulated failure');
    jest.spyOn({ generateReviewComment }, 'generateReviewComment').mockImplementationOnce(() => {
      throw mockError;
    });

    const outcome = safeGenerateComment(validParams);
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expect(outcome.error).toBe(mockError);
    }

    jest.restoreAllMocks(); // Clean up the spy.
  });

  // ==========================================================================
  // 8. PR without linked issue: should request issue number
  // ==========================================================================
  it('should request a linked issue number when hasLinkedIssue is false', () => {
    const paramsWithoutIssue: ReviewCommentParams = {
      ...validParams,
      hasLinkedIssue: false,
    };
    const outcome = safeGenerateComment(paramsWithoutIssue);
    if ('error' in outcome) {
      throw outcome.error;
    }
    // The comment should contain a phrase requesting the issue number.
    const requestPattern = /(?:please\s+link|link\s+the\s+relevant\s+issue|issue\s+number)/i;
    expect(outcome.result.comment).toMatch(requestPattern);
  });

  // ==========================================================================
  // 9. PR modifying out-of-scope files: should flag them
  // ==========================================================================
  it('should flag out-of-scope files in the review comment', () => {
    const outOfScopeFiles = ['unrelated.config.ts', 'docs/old_guide.md'];
    const paramsWithOutOfScope: ReviewCommentParams = {
      ...validParams,
      outOfScopeFiles: [...outOfScopeFiles],
    };
    const outcome = safeGenerateComment(paramsWithOutOfScope);
    if ('error' in outcome) {
      throw outcome.error;
    }
    // The comment should mention all out-of-scope files.
    for (const file of outOfScopeFiles) {
      expect(outcome.result.comment).toContain(file);
    }
  });

  // ==========================================================================
  // 10. Edge cases: null / undefined parameters
  // ==========================================================================
  it('should handle null acceptanceCriteria gracefully', () => {
    const outcome = safeGenerateComment({
      ...validParams,
      acceptanceCriteria: null as unknown as string[],
    });
    expect('error' in outcome).toBe(true);
  });

  it('should handle undefined agentName gracefully', () => {
    const outcome = safeGenerateComment({
      ...validParams,
      agentName: undefined as unknown as string,
    });
    expect('error' in outcome).toBe(true);
  });

  // ==========================================================================
  // 11. Logger calls verification (avoiding noise, ensuring proper levels)
  // ==========================================================================
  it('should log an info message on successful generation', () => {
    safeGenerateComment(validParams);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'Review comment generated successfully',
      expect.objectContaining({
        agentName: AGENT_NAME,
        criteriaCount: ACCEPTANCE_CRITERIA.length,
      }),
    );
  });

  it('should log an error message on validation failure', () => {
    safeGenerateComment({ ...validParams, agentName: '' });
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Validation error in safeGenerateComment',
      expect.objectContaining({
        reason: ERRORS.INVALID_AGENT_NAME,
      }),
    );
  });

  it('should log an error message when generateReviewComment throws', () => {
    jest.spyOn({ generateReviewComment }, 'generateReviewComment').mockImplementationOnce(() => {
      throw new Error('Boom');
    });
    safeGenerateComment(validParams);
    expect(logger.error).toHaveBeenCalledWith(
      ERRORS.GENERATION_FAILED,
      expect.any(Object),
    );
    jest.restoreAllMocks();
  });
});