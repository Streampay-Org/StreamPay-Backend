/**
 * Pagination helpers.
 *
 * These utilities normalize page/limit inputs and compute database offsets.
 * They intentionally avoid throwing so they can be used in hot paths; callers
 * that need strict validation should layer a schema parser on top.
 */

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "./constants";

export interface PaginationInput {
  page?: number | string | null;
  limit?: number | string | null;
}

export interface NormalizedPagination {
  page: number;
  limit: number;
  offset: number;
}

const toFiniteInt = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

/**
 * Normalize raw pagination input into safe, clamped values plus a computed
 * SQL-style `offset`.
 */
export const normalizePagination = (input: PaginationInput = {}): NormalizedPagination => {
  const page = Math.max(1, toFiniteInt(input.page, 1));
  const rawLimit = toFiniteInt(input.limit, DEFAULT_PAGE_SIZE);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};
