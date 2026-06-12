/**
 * Time-related helpers.
 *
 * These helpers operate on UTC and avoid any locale-specific behavior so
 * outputs are stable across environments (CI, local dev, production).
 */

/** Number of milliseconds in one second. */
export const ONE_SECOND_MS = 1_000;

/** Number of milliseconds in one minute. */
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;

/** Number of milliseconds in one hour. */
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

/** Number of milliseconds in one day. */
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Convert a `Date` to an ISO-8601 string in UTC.
 *
 * Wrapper around `Date.prototype.toISOString` for parity with our other
 * formatter helpers and easier mocking in tests.
 */
export const toIsoUtc = (date: Date): string => date.toISOString();

/**
 * Return the elapsed number of whole seconds between `from` and `to`.
 *
 * Always non-negative; if `to` is before `from`, returns 0.
 */
export const elapsedSeconds = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / ONE_SECOND_MS));
