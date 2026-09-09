# Develop Honne

Honne consists of a Go backend and a React frontend built with Deno and Vite.

## Source Compose

```bash
cp -n .env.example .env
# Edit .env for optional authentication and provider integrations.
docker compose up -d --build
```

Open `http://localhost:7417`. The source-development default is bound to `127.0.0.1` and intentionally differs from the `8080` default used by published release assets.

## Run the processes directly

Use two terminals:

```bash
cd backend
cp -n .env.example .env
# Leave all three AniList OAuth values empty until configuring OAuth.
go run .
```

```bash
cd frontend
cp -n .env.example .env
deno install
deno task dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:7417` by default.

To use another backend development port, update both files:

```dotenv
# backend/.env
PORT=8091

# frontend/.env
VITE_API_PROXY_URL=http://localhost:8091
```

If the source Compose host port changes, update `HONNE_PORT`, `APP_ORIGIN`, and any configured AniList redirect URL together.

## Validation

Run from the repository root:

```bash
test -z "$(gofmt -l backend/*.go)"
(cd frontend && deno fmt --check src/ vite.config.ts vitest.config.ts)
(cd backend && go vet ./...)
(cd frontend && deno task lint)
(cd frontend && deno task typecheck)
(cd backend && go test -race ./...)
(cd frontend && deno task test)
(cd frontend && deno task build)
docker compose config --quiet
git diff --check
```

## API

All application responses disable caching. When Basic Auth is configured, every route except health checks is protected.

- `GET /api/health`: health check
- `GET /api/auth/check`: reverse-proxy authentication check
- `GET /api/profile`: public Library profile
- `GET /api/media`: list the collection
- `POST /api/media`: add media
- `PATCH /api/media/{id}`: update media
- `DELETE /api/media/{id}`: delete media
- `POST /api/media/{id}/refresh-metadata`: refresh linked catalog metadata
- `GET /api/activity`: list recent activity (`?limit=30`, maximum 100)
- `GET /api/backup`: download a restorable snapshot without AniList credentials
- `GET /api/discovery/search?type=anime&q=bebop&page=1`: search one catalog
- `GET /api/discovery/global?q=bebop`: search all available catalogs
- `GET /api/import/anilist?username=example`: preview a public AniList library
- `POST /api/import/anilist`: import or reconcile selected entries
- `GET /api/integrations/anilist`: connection and queue status
- `GET /api/integrations/anilist/connect`: begin OAuth
- `GET /api/integrations/anilist/callback`: OAuth callback
- `DELETE /api/integrations/anilist`: disconnect (`?discardPending=true` abandons queued work)
- `POST /api/integrations/anilist/retry`: retry queued jobs now

Legacy unversioned `media.json` arrays and supported older snapshots are migrated to the current persistence format on the next successful write.
