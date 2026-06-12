/**
 * Shared constants used across the StreamPay backend.
 *
 * Keeping magic numbers in a central module makes them easier to discover,
 * tune, and document. Prefer importing from here over redefining literal
 * values inside individual modules.
 */

/** Default page size returned by list endpoints when the caller omits one. */
export const DEFAULT_PAGE_SIZE = 25;

/** Maximum allowed page size for paginated list endpoints. */
export const MAX_PAGE_SIZE = 100;

/** Minimum allowed page size (must be at least 1). */
export const MIN_PAGE_SIZE = 1;

/** Default HTTP timeout, in milliseconds, for outbound calls. */
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

/** Default retry attempts for transient failures in background jobs. */
export const DEFAULT_RETRY_ATTEMPTS = 3;

/** Default initial backoff (ms) between retry attempts. */
export const DEFAULT_RETRY_BACKOFF_MS = 250;

/** Maximum length, in characters, of a free-form description field. */
export const MAX_DESCRIPTION_LENGTH = 512;
