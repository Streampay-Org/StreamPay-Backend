# StreamPay Data Model

## Overview

This document describes the relational schema for payment streams in the StreamPay backend.

## Tables

### `streams`

The core table for managing payment streams aligned with the Soroban contract model.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Unique identifier for the stream |
| `payer` | `varchar(255)` | NOT NULL | Address of the entity sending funds |
| `recipient` | `varchar(255)` | NOT NULL | Address of the entity receiving funds |
| `status` | `stream_status` | NOT NULL, DEFAULT `'active'` | Current state of the stream |
| `rate_per_second` | `decimal(20,9)` | NOT NULL | Amount streamed per second (in stroops/smallest unit) |
| `start_time` | `timestamp` | NOT NULL | When the stream began or will begin |
| `end_time` | `timestamp` | NULLABLE | When the stream ends (NULL = indefinite) |
| `total_amount` | `decimal(20,9)` | NOT NULL | Total amount allocated for this stream |
| `last_settled_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Last time funds were settled |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Record creation timestamp |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Record last update timestamp |
| `chain_id` | `varchar(50)` | NOT NULL, DEFAULT `'stellar-testnet'` | Blockchain network identifier |
| `contract_address` | `varchar(255)` | NULLABLE | Associated Soroban contract address |
| `transaction_hash` | `varchar(66)` | NULLABLE | On-chain transaction hash |
| `metadata` | `text` | NULLABLE | Additional JSON metadata |

### Enum: `stream_status`

| Value | Description |
|-------|-------------|
| `active` | Stream is currently streaming funds |
| `paused` | Stream is temporarily stopped |
| `cancelled` | Stream was cancelled before completion |
| `completed` | Stream finished its full duration |

## Indexes

The following indexes are created for efficient querying:

| Index Name | Column(s) | Purpose |
|------------|-----------|---------|
| `streams_payer_idx` | `payer` | Filter streams by payer |
| `streams_recipient_idx` | `recipient` | Filter streams by recipient |
| `streams_status_idx` | `status` | Filter streams by status |
| `streams_chain_id_idx` | `chain_id` | Filter streams by blockchain network |
| `streams_created_at_idx` | `created_at` | Sort/filter by creation time |

## Invariants

1. **Active Stream Duration**: `end_time` can be NULL for indefinite streams
2. **Settlement Tracking**: `last_settled_at` is updated on each settlement event
3. **Balance Consistency**: `total_amount >= accrued_amount` at all times
4. **Status Transitions**:
   - `active` -> `paused` | `cancelled` | `completed`
   - `paused` -> `active` | `cancelled`
   - `cancelled` and `completed` are terminal states

## Migrations

Migrations are managed with Drizzle ORM and stored in `/drizzle`.

To run migrations:
```bash
npx drizzle-kit push
```

To generate a new migration after schema changes:
```bash
npx drizzle-kit generate
```

## Security Notes

- No plaintext secrets are stored in the database
- All addresses are validated before storage
- Transaction hashes enable on-chain verification
- HMAC signatures required for webhook ingestion

## Soft Delete

The `streams` table supports a soft-delete pattern via a nullable
`deleted_at` timestamp. Repository methods filter rows where
`deleted_at IS NULL` by default; pass `includeDeleted: true` for admin
inspection paths. Hard deletes are reserved for retention sweeps and are
not exposed via the HTTP API.

## Audit Log

Sensitive write operations (stream create, update, and admin actions) are
recorded by `AuditService` with:

- `actor`: identifier of the principal making the request
- `action`: discriminator for the operation
- `streamId`: target stream id when applicable
- `ipAddress`: normalized client IP (IPv4-mapped IPv6 prefix stripped)
- `metadata`: arbitrary JSON describing the change

Retention is governed by `AUDIT_LOG_RETENTION_DAYS` (default 365).
