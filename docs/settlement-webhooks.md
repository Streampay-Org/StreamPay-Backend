# Accrual, Webhook, and Settlement Lifecycle

This document connects the implemented StreamPay backend services so integrators
can understand how accrual previews, webhook delivery, and transaction
submission fit together.

## Accrual semantics

`src/services/accrualService.ts` calculates an estimated amount accrued since
the stream's `lastSettledAt` timestamp.

```text
accrued = ratePerSecond * max(0, min(now, endTime) - lastSettledAt)
```

Implementation details:

- Only streams with `status === "active"` accrue. Paused, cancelled, and
  completed streams return `0.000000000`.
- `endTime`, when present, caps the accrual window. A preview after `endTime`
  accrues only up to the end timestamp.
- Negative elapsed time is clamped to zero so clock skew does not create a
  negative preview.
- Amounts are returned with 9 decimal places to match the stream schema's
  `rate_per_second` precision.
- Accrual previews are estimates. Settlement still needs chain submission and
  reconciliation before a stream can be treated as paid.

Primary tests:

- `src/services/accrualService.test.ts`
- `src/api/v1/streams.accrual.test.ts`

## Stream state used by settlement

The `streams` table in `src/db/schema.ts` stores the fields that settlement and
reconciliation depend on.

| Column | Use |
| --- | --- |
| `status` | Controls whether accrual previews are active. |
| `rate_per_second` | Decimal rate used for accrual previews. |
| `start_time` / `end_time` | Defines the intended stream window. |
| `last_settled_at` | Start of the next accrual preview window. |
| `chain_id` | Identifies the Stellar network or test environment. |
| `contract_address` | Target contract for on-chain settlement. |
| `transaction_hash` | Last known chain transaction reference. |
| `metadata` | Extra integration context for operators and clients. |

Soft-deleted streams remain hidden from normal queries unless
`includeDeleted=true` is supplied.

## Inbound indexer webhook lifecycle

`POST /webhooks/indexer` accepts trusted chain-indexer events such as
`stream_created` and `settled`.

Security and idempotency rules:

- The route requires API key authentication before parsing the raw body.
- `INDEXER_WEBHOOK_SECRET` signs the raw JSON body with HMAC SHA-256.
- The sender may provide either a raw hex digest or `sha256=<digest>` in
  `x-indexer-signature`.
- `eventId` deduplication makes duplicate deliveries safe no-ops.
- Valid duplicate events return `202 Accepted` instead of mutating state twice.

Operational checklist:

- Rotate `INDEXER_WEBHOOK_SECRET` through the same deployment channel as API keys.
- Alert on repeated signature failures; they can indicate a stale secret,
  malformed proxy body handling, or an unauthorized sender.
- Store indexer transaction hashes and ledger references so settlement can be
  reconciled against chain state.

## Outbound webhook delivery lifecycle

`src/services/webhookDeliveryService.ts` sends StreamPay events to subscriber URLs.

Delivery behavior:

- `enqueue(event)` creates one pending delivery per enabled subscription that
  matches `event.eventType`.
- Payloads are signed with `X-StreamPay-Signature: sha256=<hmac>`.
- The event name is also sent as `X-StreamPay-Event`.
- Each HTTP POST has a 10 second timeout.
- Failed deliveries retry with exponential backoff:
  5s, 10s, 20s, 40s, 80s, capped at 5 minutes.
- Deliveries permanently fail after 5 attempts.
- `startWorker()` processes due deliveries on a polling loop.

Subscriber verification example:

```text
expected = hmac_sha256(raw_request_body, subscription_secret)
compare expected with X-StreamPay-Signature
```

## Transaction submission modes

`src/services/transactionService.ts` supports two settlement submission modes.

| Mode | Behavior | When to use |
| --- | --- | --- |
| `external_signer` | Returns `awaiting_external_signature` with the unsigned XDR and optional signer URL. | Production flows where signing stays outside the backend. |
| `backend_sign` | Uses a configured signer, then posts the signed XDR to Horizon's `/transactions` endpoint. | Development or controlled internal environments only. |

Environment-driven config is built from:

- `RPC_URL`
- `NODE_ENV`
- `TX_SIGNER_MODE`
- `TX_SIGNING_SEED`
- `TX_SIGNING_KMS_KEY_ID`
- `TX_EXTERNAL_SIGNER_URL`

The service redacts the configured signing seed from thrown errors. Do not log
raw seeds, signed XDRs from production users, or partner webhook secrets.

## End-to-end settlement flow

1. API or indexer creates/updates a stream record.
2. Client requests an accrual preview for the active stream.
3. Settlement code prepares an unsigned XDR for the accrued amount.
4. `TransactionService` either returns the unsigned XDR for an external signer
   or signs and submits it in controlled backend-sign mode.
5. Horizon returns a transaction hash and optional ledger.
6. Indexer webhook later confirms the chain event with an idempotent `eventId`.
7. Stream state and `lastSettledAt` are advanced by the reconciliation path.
8. Outbound webhooks notify subscribers that the stream was settled.

## Failure handling

| Failure | Expected handling |
| --- | --- |
| Accrual preview for non-active stream | Return zero, do not submit settlement. |
| Missing or invalid API key | Reject before validation, repository calls, or HMAC verification. |
| Invalid indexer signature | Reject the inbound webhook and preserve the raw body only for verification. |
| Duplicate `eventId` | Return accepted/no-op; do not replay settlement state changes. |
| Subscriber webhook timeout | Record attempt, schedule retry, and keep the delivery visible. |
| Horizon transaction rejection | Return a redacted error; reconcile against chain state before retrying. |

## Validation commands

```bash
npm test -- src/services/accrualService.test.ts src/services/webhookDeliveryService.test.ts src/services/transactionService.test.ts
npm test -- src/indexerWebhook.test.ts src/api/v1/streams.accrual.test.ts
```
