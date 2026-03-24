# streampay-backend

**StreamPay** API backend — stream management, usage metering, and settlement services.

## Overview

Node.js + Express (TypeScript) service that will power the StreamPay API gateway: health checks, stream listing, and (later) metering and Stellar settlement integration.

## Prerequisites

- Node.js 18+
- npm (or yarn/pnpm)

## Setup for contributors

1. **Clone and enter the repo**
   ```bash
   git clone <repo-url>
   cd streampay-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Verify setup**
   ```bash
   npm run build
   npm test
   ```

4. **Run locally**
   ```bash
   npm run dev    # dev with hot reload
   # or
   npm run build && npm start
   ```

API will be at `http://localhost:3001` (or `PORT` env). Try `GET /health` and `GET /api/streams`.

## Indexer webhook ingestion

The backend now exposes `POST /webhooks/indexer` for trusted chain-indexer events such as `stream_created` and `settled`.

Set `INDEXER_WEBHOOK_SECRET` before running the service. The sender must compute an HMAC SHA-256 signature over the raw JSON request body and send it in the `x-indexer-signature` header using either the raw hex digest or the `sha256=<digest>` format.

Example payload:

```json
{
  "eventId": "evt_123",
  "eventType": "stream_created",
  "streamId": "stream_456",
  "occurredAt": "2026-03-23T10:00:00.000Z",
  "chainId": "stellar-testnet",
  "transactionHash": "abc123",
  "data": {
    "amount": "42"
  }
}
```

Security notes:

- Signature verification uses the raw request body and `crypto.timingSafeEqual`.
- Replay protection is enforced by deduplicating `eventId` values in the ingestion service.
- Duplicate deliveries are treated as safe no-ops and return `202 Accepted`.

## Prometheus Metrics

The backend exposes a standard Prometheus metrics endpoint at `GET /metrics`.

- **HTTP Metrics**: Tracks request duration, error rates, and throughput (labels: `method`, `route`, `status_code`).
- **Custom Metrics**: Includes `job_sync_lag_seconds` to track background processing delay.
- **Default Metrics**: Standard Node.js process and runtime metrics (GC, memory, CPU).

### Security

In `production` Environments, the `/metrics` endpoint is protected by a Bearer token.
- Set `PROMETHEUS_AUTH_TOKEN` in your environment.
- Clients must provide `Authorization: Bearer <token>`.
- In non-production environments, authentication is bypassed for easier debugging.

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `npm run build`| Compile TypeScript       |
| `npm start`    | Run production build     |
| `npm run dev`  | Run with ts-node-dev     |
| `npm test`     | Run Jest tests           |
| `npm run lint` | Run ESLint               |

## CI/CD

On every push/PR to `main`, GitHub Actions runs:

- Install: `npm ci`
- Build: `npm run build`
- Tests: `npm test`

Keep the default branch green before merging.

## Project structure

```
streampay-backend/
├── src/
│   ├── api/            # Versioned API routes
│   ├── db/             # Drizzle ORM schema and client
│   ├── metrics/        # Prometheus metrics logic and tests
│   ├── repositories/   # Data access layer
│   └── routes/         # Webhooks and other handlers
├── package.json
├── tsconfig.json
├── jest.config.js
├── .github/workflows/ci.yml
└── README.md
```

## License

MIT
