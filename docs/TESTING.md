# Testing Guide

This guide describes how StreamPay Backend tests are organized and how to run
them locally.

## Layout

Tests live next to the code they cover, using the `*.test.ts` suffix. For
example, `src/services/accrualService.ts` is exercised by
`src/services/accrualService.test.ts`.

This colocation keeps the import graph small and makes it obvious when a
production module has gone untested.

## Running

```bash
# Run the whole suite
npm test

# Run a single file
npx jest src/services/accrualService.test.ts

# Watch mode
npx jest --watch

# Coverage report (writes to ./coverage)
npx jest --coverage
```

## Writing Tests

- Prefer pure functions; tests for them require no setup.
- For services that depend on repositories, inject a fake via the constructor
  rather than mocking the module.
- Use `it.each` for table-driven cases.
- Assert on specific values, not just truthiness, when validating outputs.

## CI

GitHub Actions runs `npm ci`, `npm run build`, and `npm test` on every push
and pull request to `main`. Keep the suite green before merging.
