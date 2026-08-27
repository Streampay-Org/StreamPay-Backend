# Settlement transactional outbox

Settlement state and its external side effects have different failure modes. A database commit can succeed while a payout, notification, or webhook process is unavailable. The `settlement_outbox` table is the durable boundary between those operations.

## Write path

The settlement transaction must update its aggregate and insert an outbox row using the same database transaction. The `event_key` is a stable idempotency key such as `settlement:<stream-id>:<ledger>`; a unique index makes a client retry safe. The payload is immutable event data, not a query that may produce a different result later.

The outbox row is committed before a worker attempts delivery. A process crash after commit and before delivery therefore leaves a `pending` row for the next worker. A process crash during delivery leaves a lease that can expire and be reclaimed.

## Worker path

Workers claim due rows with `FOR UPDATE SKIP LOCKED`. Claiming changes the row to `processing`, records a lease token and deadline, and increments the attempt count. A successful handler clears the lease and marks the row `succeeded`. A failure schedules exponential backoff (5 seconds to 15 minutes) and stores a bounded error message. Once `max_attempts` is reached, the row becomes `dead` and does not prevent unrelated settlements from progressing.

Handlers must be idempotent. The outbox prevents duplicate logical rows, while the handler's provider request should use `eventKey` as its own idempotency key where supported. Operators can inspect `dead` rows, correct the underlying issue, and replay them through an explicit administrative workflow rather than silently retrying forever.

## Operational guarantees

- One committed settlement event key produces one outbox row.
- A worker never acknowledges a row with an expired or replaced lease.
- Batch size and lease duration are bounded by the service constants.
- Poison messages are visible in `dead` state with their last error.
- Delivery is at-least-once; exactly-once external effects require downstream idempotency.
