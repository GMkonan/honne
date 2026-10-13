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
