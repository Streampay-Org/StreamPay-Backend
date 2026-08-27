# Redis outage and job-lease policy

StreamPay uses Redis for optional cache state and, when enabled, as the
coordination point for protected mutations and outbound webhook workers. Redis
is not the source of truth for streams or deliveries; PostgreSQL remains the
durable store. This document defines the behavior when Redis is unavailable,
reconnecting, or recovering.

## Operating modes

The `REDIS_REQUIRED_FOR_MUTATIONS` environment variable controls whether
protected write requests fail closed:

| Value | Mutation behavior | Read behavior | Use case |
|---|---|---|---|
| unset, `false`, `0`, `no`, `off` | Continue without the optional Redis dependency | Continue | Local development or cache-only deployments. |
| `true`, `1`, `yes`, `on` | Return `503 redis_unavailable` before the handler mutates state | Continue | Production deployments where Redis-backed protection is mandatory. |

The switch is deliberately explicit. A deployment should not accidentally
turn a missing Redis URL into a security bypass, and a local development
environment should not need a Redis process merely to run read-only tests.

The guard applies to `POST`, `PUT`, `PATCH`, and `DELETE` requests mounted under
`/api/v1`, and to the signed indexer webhook. It runs after API-key
authentication for versioned routes, so an unauthenticated caller still gets
the normal `401` response. It runs before JSON parsing and business handlers,
which prevents a protected mutation from partially executing during an outage.

The degraded response is:

```json
{
  "error": "redis_unavailable",
  "message": "This protected mutation is temporarily unavailable while Redis is recovering.",
  "retryable": true
}
```

Clients should retry with bounded exponential backoff and their normal
idempotency or optimistic-lock token. The backend does not fabricate a success
response or write a local fallback queue for a mutation that was rejected.

## Redis client state

`src/cache/redis.ts` owns the singleton Redis connection. The client records
availability transitions rather than treating every command error as a
permanent outage:

- No `REDIS_URL` means Redis is disabled, not an unexpected outage.
- Connection and command errors set the shared availability gauge to `0`.
- The first failure in a continuous outage increments the failure counter;
  repeated errors do not create an unbounded stream of transition events.
- A later `ready` event or successful connection sets the gauge to `1` and
  records one recovery transition.
- `closeRedisClient()` resets the state for deterministic process teardown and
  test isolation.

The cache helpers may return `null` or no-op when Redis is optional. They never
make PostgreSQL state disappear. The protected mutation guard uses the same
connection helper but changes the result to an explicit 503 when the required
mode is enabled.

## Rate limiting and protection

The existing in-process rate limiter continues to enforce request ceilings and
does not silently disable itself because Redis is down. Deployments that need
Redis-backed shared rate-limit state must enable the mutation guard and deploy
the shared Redis dependency as part of the protected request path. This
separates two concerns:

1. Rate-limit configuration controls request volume.
2. Redis-required mode controls whether a protected mutation may proceed when
   the shared coordination dependency is unavailable.

This is safer than treating a Redis exception as an empty rate-limit store.
An empty store would grant a fresh budget to every request during an outage.

## Job lease protocol

Outbound webhook deliveries are durable rows in `webhook_deliveries`. A worker
polls due rows, but polling is not claiming. Before calling a subscriber, it
must acquire a Redis lease:

```text
key   = streampay:job-lease:<delivery-id>
value = <worker-owner>:<random-nonce>
SET key value NX PX 30000
```

`NX` permits one worker to acquire a delivery at a time. `PX` gives the lease a
finite lifetime if a process crashes. The owner value is not exposed to the
subscriber and is used for owner-checked release:

```text
if GET key == owner:
    DEL key
```

The release script cannot delete another worker's renewed lease. If release
fails, the worker logs the failure and does not immediately attempt the row a
second time. The lease will expire, and the durable pending row remains
available for a later poll.

### Worker rules

- A due row without a valid lease is skipped, never sent.
- Redis unavailable, a failed `SET`, and a busy `SET NX` are all non-claims.
- Only the worker holding the lease calls `attempt`.
- The lease is released in a `finally` block after success, permanent failure,
  or retry scheduling.
- The database row is updated by the existing delivery state machine; Redis
  does not become a second source of truth.
- A worker crash may cause a later retry after the TTL, but cannot cause two
  workers to send concurrently while one valid lease is held.

The 30-second lease is longer than the normal outbound timeout and short
enough to recover from a crashed worker. If subscriber calls or platform load
require a different value, change the class constant and review the timeout
relationship together.

## Recovery and duplicate safety

Recovery does not replay an in-memory list. The worker re-reads durable rows on
the next poll. A row already being processed remains protected by its lease;
rows that were never leased stay pending. This avoids the classic recovery
sequence in which a reconnecting worker re-enqueues every item it saw before
the outage.

The database state machine remains authoritative:

| State | Lease available? | Action |
|---|---|---|
| pending and due | yes | Send once, then mark success or schedule retry. |
| pending and due | no | Skip; leave row unchanged. |
| pending but not due | not polled | Leave row unchanged. |
| success | no poll | Never re-enqueue. |
| failed permanently | no poll | Never re-enqueue. |

If a process loses its lease after the subscriber has accepted a request but
before the database update, the delivery may be retried after lease expiry.
Subscribers must therefore treat `delivery.id` or the event id as an
idempotency key. This is the normal at-least-once delivery contract; the lease
prevents concurrent duplicate work but cannot provide distributed exactly-once
HTTP semantics.

## Metrics and alerts

The Prometheus registry exposes:

| Metric | Labels | Meaning |
|---|---|---|
| `redis_availability` | `component` | `1` when the latest connection state is healthy, `0` otherwise. |
| `redis_state_changes_total` | `component`, `state` | Transition count for `failure` and `recovery`. |
| `job_lease_decisions_total` | `result` | `acquired`, `busy`, `redis_unavailable`, command errors, and release outcomes. |

Recommended alerts are based on duration and recovery, not a single transient
error:

- alert when `redis_availability{component="shared"} == 0` for the mutation
  outage budget;
- alert when `rate(job_lease_decisions_total{result="redis_unavailable"}[5m])`
  is non-zero for a worker outage budget;
- alert when lease `busy` decisions rise unexpectedly, which can indicate a
  stuck or slow worker;
- graph failure-to-recovery transitions beside 503 mutation responses.

Metrics contain no API keys, lease owners, subscriber secrets, or payload data.

## Failure-injection validation

`src/__tests__/redisOutage.test.ts` covers:

- disabled mode passing requests through;
- configured mutation mode returning 503 when Redis is missing;
- read-only requests remaining available during an outage;
- unavailable leases never creating ownership;
- concurrent in-memory lease acquisition allowing one owner only;
- Redis `SET NX PX` `OK` and busy outcomes;
- Redis command errors becoming safe skips;
- owner-checked Lua release behavior;
- availability, failure, recovery, and lease decision metrics.

`src/services/webhookDeliveryService.test.ts` additionally proves that an
unavailable lease does not call the subscriber, two workers do not process the
same due row concurrently, and a released lease permits a later poll to make
the next valid attempt.

These tests use an injected lease implementation and fake Redis clients. No
test requires a live Redis server, and no test weakens the production default
lease behavior.

## Deployment checklist

Before enabling fail-closed mode:

1. Set `REDIS_URL` to the intended isolated Redis deployment.
2. Confirm the `/metrics` endpoint reports `redis_availability{component="shared"} 1`.
3. Set `REDIS_REQUIRED_FOR_MUTATIONS=true` in the protected API deployment.
4. Confirm a controlled Redis outage returns 503 for a mutation and keeps GET
   requests available.
5. Confirm worker lease acquisition and release counters move during a normal
   delivery.
6. Confirm a two-worker canary shows one `acquired` decision and one `busy`
   decision for the same delivery id.
7. Confirm clients retry rejected mutations with their idempotency safeguards.

Do not use `REDIS_REQUIRED_FOR_MUTATIONS` as a substitute for database
availability checks. The database remains the durable source of truth and has
its own connection, migration, and health-check policy.
