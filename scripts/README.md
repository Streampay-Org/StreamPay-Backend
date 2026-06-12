# Scripts

Helper scripts for local development and CI.

## `smoke.sh`

End-to-end smoke test that hits a running StreamPay backend over HTTP and
verifies the critical paths still respond as expected.

### Usage

```bash
./scripts/smoke.sh [base-url]
```

`base-url` defaults to `http://localhost:3000`. Examples:

```bash
# Against a locally running container stack
docker-compose up -d
./scripts/smoke.sh http://localhost:3000

# Against a staging deployment
./scripts/smoke.sh https://staging.api.streampay.example
```

### Behavior

1. Polls `GET /health` until it returns `ok` (up to 30 attempts, 2 s apart).
2. Calls `GET /api/v1/streams` and asserts an HTTP 200 response.
3. Exits non-zero on any failure so CI surfaces the problem.

### Requirements

- `bash`
- `curl` on the `$PATH`
