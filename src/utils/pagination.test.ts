import { normalizePagination } from "./pagination";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants";

describe("normalizePagination", () => {
  it("falls back to defaults when given no input", () => {
    expect(normalizePagination()).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });

  it("coerces numeric strings", () => {
    expect(normalizePagination({ page: "3", limit: "10" })).toEqual({
      page: 3,
      limit: 10,
      offset: 20,
    });
  });

  it("clamps the page to a minimum of 1", () => {
    expect(normalizePagination({ page: -5 }).page).toBe(1);
    expect(normalizePagination({ page: 0 }).page).toBe(1);
  });

  it("clamps limit between 1 and MAX_PAGE_SIZE", () => {
    expect(normalizePagination({ limit: 0 }).limit).toBe(1);
    expect(normalizePagination({ limit: MAX_PAGE_SIZE + 50 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("ignores non-finite values", () => {
    expect(normalizePagination({ page: Number.NaN, limit: Number.POSITIVE_INFINITY })).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });

  it("ignores empty and non-numeric strings", () => {
    expect(normalizePagination({ page: "", limit: "abc" })).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });
});
