/**
 * Small string helpers shared across the codebase.
 *
 * Kept dependency-free so they can be imported from hot paths and tests
 * without pulling in additional packages.
 */

/**
 * Truncate `input` to at most `maxLength` characters, appending an ellipsis
 * when truncation occurs. Returns the original string when it already fits.
 */
export const truncate = (input: string, maxLength: number): string => {
  if (maxLength <= 0) return "";
  if (input.length <= maxLength) return input;
  if (maxLength <= 1) return input.slice(0, maxLength);
  return `${input.slice(0, maxLength - 1)}…`;
};

/**
 * Return `true` when `input` is `null`, `undefined`, or contains only
 * whitespace characters.
 */
export const isBlank = (input: string | null | undefined): boolean =>
  input == null || input.trim().length === 0;

/**
 * Convert `input` from kebab-case or snake_case to camelCase.
 *
 * Useful when mapping between database column names and TypeScript fields.
 */
export const toCamelCase = (input: string): string =>
  input.replace(/[-_]+([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase());
