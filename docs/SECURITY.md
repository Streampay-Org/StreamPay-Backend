# Security

## Reporting Vulnerabilities

If you discover a security vulnerability, please **do not** open a public
GitHub issue. Instead, email the maintainers directly so we can investigate
and ship a fix before the issue is widely known.

We aim to acknowledge new reports within two business days.

## Threat Model Summary

StreamPay Backend handles partner integrations and chain-indexer webhooks.
Key security controls include:

- **API key authentication** with SHA-256 hashes at rest and constant-time
  comparison (`crypto.timingSafeEqual`).
- **HMAC verification** of indexer webhook payloads against the raw request
  body, using `INDEXER_WEBHOOK_SECRET`.
- **Replay protection** via deduplication of `eventId` values in the
  ingestion service.
- **IP-based and API-key-based rate limiting** through `express-rate-limit`.
- **Strict CORS** allowlists in production (no wildcard).

## Dependency Hygiene

- Dependabot is configured to open weekly PRs for npm updates.
- Run `npm audit` periodically in addition to automated tooling.

## Secrets

- Never commit `.env` files or hard-code secrets.
- Use `.env.example` as the source of truth for required variables.
- Rotate `INDEXER_WEBHOOK_SECRET` and API keys whenever team membership
  changes.
