# Configuration Reference

This document lists the environment variables that StreamPay Backend reads at
startup. Defaults shown are applied when the variable is unset.

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | TCP port the HTTP server listens on. |
| `NODE_ENV` | `development` | Affects logging verbosity and CORS strictness. |

## CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ALLOWED_ORIGINS` | unset | Comma-separated allowlist. Required in production. Wildcard `*` is rejected in production. |

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | unset | Postgres connection string. |
| `DB_POOL_MAX` | `10` (dev) / `20` (prod) | Maximum pool size. |
| `DB_POOL_IDLE_TIMEOUT` | `30000` / `60000` | Idle connection timeout in ms. |
| `DB_CONNECTION_TIMEOUT` | `5000` / `10000` | Connection acquisition timeout in ms. |
| `DB_STATEMENT_TIMEOUT` | `30000` / `60000` | Per-statement timeout in ms. |

## Health checks

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_CHECK_TIMEOUT_MS` | `5000` | Timeout for deep health probes. |
| `RPC_PROBE_ENABLED` | `false` | When true, deep health checks also probe the configured RPC endpoint. Accepts `true`/`false`, `1`/`0`, `yes`/`no`, or `on`/`off`. |

## Rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Global window in ms. |
| `RATE_LIMIT_MAX` | `100` | Global max requests per window. |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `900000` | Auth window in ms. |
| `RATE_LIMIT_AUTH_MAX` | `20` | Auth max requests per window. |

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEYS` | unset | Comma-separated plaintext keys (development/test only). |
| `API_KEY_HASHES` | unset | Comma-separated SHA-256 hashes (production). |
| `INDEXER_WEBHOOK_SECRET` | unset | HMAC secret for verifying indexer webhooks. |
