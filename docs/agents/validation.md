# Validation contract

Run validation from the repository root.

```yaml
format: test -z "$(gofmt -l backend/*.go)" && (cd frontend && deno fmt --check src/ vite.config.ts vitest.config.ts)
lint: (cd backend && go vet ./...) && (cd frontend && deno task lint)
typecheck: cd frontend && deno task typecheck
test: (cd backend && go test -race ./...) && (cd frontend && deno task test)
build: cd frontend && deno task build
compose: docker compose config --quiet
guidelines:
  - AGENTS.md
  - GUIDELINES.md
  - backend/GUIDELINES.md
  - frontend/GUIDELINES.md
```

## Execution notes

Run full workspace and staged-snapshot frontend suites sequentially, not at the
same time. Each suite already uses parallel workers; concurrent suites can exhaust
host resources and cause existing 5-second tests to time out. When that happens,
rerun without a competing suite before diagnosing an application regression.
Do not raise timeouts or weaken assertions to conceal resource contention.

Do not use `set -e` as the only failure propagation inside a validation group that
is itself followed by `||`: Bash can ignore errexit throughout that group. Run
the group as an unconditionally executed command under `set -e`, or connect every
required check with `&&`. Confirm individual test/build outcomes before claiming
that validation passed.
