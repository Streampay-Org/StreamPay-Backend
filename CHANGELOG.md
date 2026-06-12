# Changelog

All notable changes to the StreamPay Backend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Shared pagination and retry constants under `src/utils/`.
- `normalizePagination` helper for list endpoints.
- Expanded `.gitignore` to cover editor and cache artifacts.
- Package metadata: `keywords`, `license`, `repository`, `bugs`, `homepage`.

## [0.1.0]

### Added
- Initial Express + TypeScript scaffolding.
- Drizzle ORM schema and migrations.
- API key authentication and indexer webhook ingestion.
- Prometheus metrics and rate limiting.
