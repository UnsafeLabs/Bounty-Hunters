import { marked } from 'marked';
import { logger } from './logger';

/**
 * Extracts acceptance criteria from a GitHub issue body parsed as markdown.
 * Looks for a heading containing "Acceptance Criteria" (case-insensitive)
 * and then collects the immediately following bullet points.
 *
 * @param issueBody - The raw markdown content of the issue body.
 * @returns An array of acceptance criteria strings. Returns empty array if none found.
 * @throws {Error} If the issueBody is not a string or is empty.
 */
export function extractAcceptanceCriteria(issueBody: string): string[] {
  if (typeof issueBody !== 'string' || issueBody.trim().length === 0) {
    logger.error('Invalid or empty issue body provided');
    throw new Error('issueBody must be a non-empty string');
  }

  try {
    const tokens = marked.lexer(issueBody);
    const criteria: string[] = [];
    let capturing = false;

    for (const token of tokens) {
      if (token.type === 'heading') {
        const headingText = (token as marked.Tokens.Heading).text;
        if (/acceptance\s*criteria/i.test(headingText)) {
          capturing = true;
          continue;
        }
        // Reset capturing when encountering another heading of same or higher level
        if (capturing) {
          capturing = false;
        }
      }

      if (capturing && token.type === 'list') {
        const listToken = token as marked.Tokens.List;
        for (const item of listToken.items) {
          const text = item.text.replace(/^- /, '').trim();
          if (text.length > 0) {
            criteria.push(text);
          }
        }
        // After processing the list, stop capturing until next heading
        capturing = false;
      }
    }

    logger.info(`Extracted ${criteria.length} acceptance criteria`);
    return criteria;
  } catch (error) {
    logger.error('Failed to parse issue body', error);
    throw new Error('Failed to extract acceptance criteria from issue body');
  }
}