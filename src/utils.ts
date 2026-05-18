*/
export function sleep(ms: number): Promise<void> {
  // Input validation
  if (typeof ms !== 'number' || isNaN(ms) || ms === Infinity || ms === -Infinity) {
    const errorMsg = `Invalid sleep duration: "${ms}". Must be a finite number.`;
    logger.error(errorMsg);
    throw new InvalidArgumentError(errorMsg, 'ms');
  }
  if (ms < 0) {
    const errorMsg = `Invalid sleep duration: "${ms}". Must be non-negative.`;
    logger.error(errorMsg);
    throw new InvalidArgumentError(errorMsg, 'ms');
  }
  // Optimization: if ms is exactly 0 or negative (already validated), use queueMicrotask
  if (ms === 0) {
    return new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  logger.debug(`Sleeping for ${ms}ms`);
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.debug(`Sleep of ${ms}ms completed`);
      resolve();
    }, ms);
    // Allow timer to be cleaned up if the promise is never awaited (unlikely but good practice)
    if (timer.unref) {
      timer.unref();
    }
  });
}

/**
 * Validates and normalizes a URL to ensure it is an HTTP or HTTPS URL.
 *
 * @param url - The URL string to validate.
 * @returns The valid URL object.
 * @throws {InvalidUrlError} If the URL is missing, malformed, or not HTTP/HTTPS.
 */
export function validateHttpUrl(url: string): URL {
  if (typeof url !== 'string' || url.trim().length === 0) {
    const errorMsg = 'URL must be a non-empty string.';
    logger.error(errorMsg);
    throw new InvalidUrlError(url || '');
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new InvalidUrlError(url);
    }
    return parsedUrl;
  } catch (err) {
    if (err instanceof InvalidUrlError) {
      throw err;
    }
    logger.error(`Failed to parse URL: "${url}"`, { error: (err as Error).message });
    throw new InvalidUrlError(url);
  }
}

/**
 * Retries an asynchronous function with exponential backoff and jitter.
 *
 * @param fn - The async function to retry.
 * @param options - Retry configuration.
 * @param options.maxRetries - Maximum number of retries (default: 3).
 * @param options.baseDelay - Base delay in ms (default: 1000).
 * @param options.maxDelay - Maximum delay in ms (default: 30000).
 * @param options.retryableErrors - Optional array of error classes that should be retried.
 * @returns The result of the function.
 * @throws The last error encountered if all retries fail.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    retryableErrors?: Array<new (...args: any[]) => Error>;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    retryableErrors,
  } = options;

  // Input validation
  if (maxRetries < 0 || !Number.isInteger(maxRetries)) {
    throw new InvalidArgumentError(`maxRetries must be a non-negative integer, got ${maxRetries}`, 'maxRetries');
  }
  if (baseDelay <= 0 || isNaN(baseDelay) || baseDelay === Infinity) {
    throw new InvalidArgumentError(`baseDelay must be a positive finite number, got ${baseDelay}`, 'baseDelay');
  }
  if (maxDelay <= 0 || isNaN(maxDelay) || maxDelay === Infinity) {
    throw new InvalidArgumentError(`maxDelay must be a positive finite number, got ${maxDelay}`, 'maxDelay');
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) {
        logger.info(`Retry succeeded on attempt ${attempt + 1}/${maxRetries + 1}`);
      }
      return result;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(`Attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`);

      // Check if the error is retryable
      if (retryableErrors && retryableErrors.length > 0) {
        const isRetryable = retryableErrors.some((ErrorClass) => lastError instanceof ErrorClass);
        if (!isRetryable) {
          logger.error(`Non-retryable error encountered, aborting retries.`);
          throw lastError;
        }
      }

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        const jitter = exponentialDelay * (0.5 + Math.random() * 0.5); // ±50% jitter
        const delay = Math.min(jitter, maxDelay);
        logger.debug(`Waiting ${Math.round(delay)}ms before next retry`);
        await sleep(delay);
      }
    }
  }

  // If we exhausted retries, throw the last error
  const finalError = lastError || new Error('Retry failed without producing an error');
  logger.error(`All ${maxRetries + 1} attempts failed.`);
  throw finalError;
}

// ──────────────────────────────────────────────
// Read environment variable with fallback and validation
// ──────────────────────────────────────────────

/**
 * Safely retrieves an environment variable and validates it.
 *
 * @param key - The environment variable name.
 * @param defaultValue - Optional default value if the variable is not set.
 * @param validator - Optional validation function that returns true if value is valid.
 * @returns The value of the environment variable or default.
 * @throws {InvalidArgumentError} If the variable is not set and no default is provided, or if validation fails.
 */
export function getEnvVariable(
  key: string,
  defaultValue?: string,
  validator?: (value: string) => boolean
): string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new InvalidArgumentError('Environment variable key must be a non-empty string.', 'key');
  }

  const value = process.env[key] || defaultValue;

  if (value === undefined) {
    const errorMsg = `Environment variable "${key}" is not defined and no default value provided.`;
    logger.error(errorMsg);
    throw new InvalidArgumentError(errorMsg, key);
  }

  if (validator && !validator(value)) {
    const errorMsg = `Environment variable "${key}" with value "${value}" failed validation.`;
    logger.error(errorMsg);
    throw new InvalidArgumentError(errorMsg, key);
  }

  logger.debug(`Environment variable "${key}" resolved to "${value}"`);
  return value;
}

// ──────────────────────────────────────────────
// Utility to safely parse JSON with error handling
// ──────────────────────────────────────────────

/**
 * Safely parses a JSON string, logging errors instead of throwing.
 *
 * @param text - The JSON string to parse.
 * @returns The parsed object, or null if parsing fails.
 */
export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to parse JSON: ${error}. Input (first 200 chars): ${text.substring(0, 200)}`);
    return null;
  }
}

// ──────────────────────────────────────────────
// Graceful shutdown handler
// ──────────────────────────────────────────────

/**
 * Registers a graceful shutdown handler for the application.
 * @param cleanup - Async function to perform cleanup (e.g., close DB connections).
 * @param signal - The signal to listen for (default: 'SIGTERM').
 */
export function onShutdown(cleanup: () => Promise<void>, signal: NodeJS.Signals = 'SIGTERM'): void {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    try {
      await cleanup();
      logger.info('Cleanup completed, exiting.');
      process.exit(0);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`Cleanup failed: ${error}`);
      process.exit(1);
    }
  });
}

// ──────────────────────────────────────────────
// Export logger for external use
// ──────────────────────────────────────────────

export { logger };