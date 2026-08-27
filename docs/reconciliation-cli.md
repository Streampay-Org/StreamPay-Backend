# Safe reconciliation CLI

The reconciliation runner separates inspection from mutation. It is exposed as a service so the same rules can be used by a scheduled worker and by the reference file-backed CLI.

## Commands

```sh
npm run reconcile -- --dry-run --job nightly --input rows.json --checkpoint nightly.json
npm run reconcile -- --apply --confirm APPLY-RECONCILIATION --job nightly --input rows.json --checkpoint nightly.json
```

Dry-run is the default and never invokes the source write adapter. Apply mode requires both `--apply` and the exact confirmation phrase. The command does not infer consent from an environment variable or from a non-empty string.

## Input

The reference adapter accepts an array of records:

```json
[{ "id": "stream-42", "expectedAmount": "10.25", "actualAmount": "10.00" }]
```

Amounts are parsed as fixed-point nine-decimal integers. Floating-point addition and exponent notation are rejected, so a one-nanounit mismatch cannot disappear through rounding.

## Resume behavior

The checkpoint records the job id, source cursor, sorted processed ids, scanned count, mismatch count, and update time. It is atomically replaced through a temporary file and rename. A checkpoint is saved after each successful write and after every batch. If a process stops after a database write but before its checkpoint, the adapter must use the supplied `operationKey` as an idempotency key; this closes the unavoidable write/checkpoint crash window without duplicate corrections.

Rerunning the same job skips ids already recorded in the checkpoint. `--start-over` is explicit and intended for a new source snapshot or an operator-approved replay. Batches are bounded to 1–1000 rows, and `--max-batches` is available to embedding callers for controlled work windows.

## Failure and security rules

- Mismatch records are included in dry-run output for review.
- Writes are never performed during dry-run, including checkpointed corrections.
- Invalid amounts and malformed records fail before their write operation.
- A partial run reports `complete: false` and its next cursor.
- The production source adapter must authorize the worker and make `applyMismatch` idempotent.
- Checkpoint files can reveal operational data and must be protected with normal service permissions.
