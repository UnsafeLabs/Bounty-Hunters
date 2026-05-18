import { Config, loadConfig } from './config';
import { ReviewOrchestrator } from './orchestrator';
import { createLogger, LogLevel } from './logger';

/**
 * Main entry point for the PR review bot.
 * Loads configuration, initializes the orchestrator, and runs the full review process.
 * Logs results and exits with appropriate exit codes.
 */
async function main(): Promise<void> {
  const logger = createLogger(LogLevel.INFO);

  try {
    logger.info('Starting PR review process');
    const config: Config = await loadConfig();
    logger.info('Configuration loaded successfully');

    const orchestrator = new ReviewOrchestrator(config);
    logger.info('ReviewOrchestrator initialized');

    const results = await orchestrator.run();
    logger.info('Review process completed', {
      totalPRsReviewed: results.totalPRs,
      commentsPosted: results.commentsPosted,
      errors: results.errors.length,
    });

    if (results.errors.length > 0) {
      logger.warn('Some PR reviews had errors', { errors: results.errors });
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error('Fatal error during PR review process', { error });
    process.exit(1);
  }
}

main();