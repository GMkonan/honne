# Validation contract

Run validation from the repository root. The production-line budget excludes tests, fixtures, generated files, and lockfiles.

```yaml
format: test -z "$(gofmt -l backend/*.go)" && (cd frontend && deno fmt --check src/ vite.config.ts)
lint: (cd backend && go vet ./...) && (cd frontend && deno task lint)
typecheck: cd frontend && deno task typecheck
test: cd backend && go test -race ./...
build: cd frontend && deno task build
compose: docker compose config --quiet
pr_size_budget: 500
guidelines:
  - AGENTS.md
  - GUIDELINES.md
  - backend/GUIDELINES.md
  - frontend/GUIDELINES.md
```
