# Develop Honne

Honne consists of a Go backend and a React frontend built with Deno and Vite.

## Source Compose

```bash
cp -n .env.example .env
# Edit .env for optional authentication and provider integrations.
docker compose up -d --build
```

Open `http://localhost:7417`. Both source development and published release assets use this localhost-only host port by default.

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
- `GET /api/profile`: public Library profile and current custom image URLs
- `GET /api/profile/banner`: read the local custom banner
- `PUT /api/profile/banner`: store a validated local image (JPEG, PNG, WebP, or GIF; maximum 8 MiB)
- `DELETE /api/profile/banner`: restore the bundled default banner
- `GET /api/profile/avatar`: read the local custom profile picture
- `PUT /api/profile/avatar`: store a validated local image (JPEG, PNG, WebP, or GIF; maximum 4 MiB)
- `DELETE /api/profile/avatar`: restore the configured or built-in profile picture
- `GET /api/favorites`: read the ordered favorite media IDs
- `PUT /api/favorites`: replace the ordered selection with up to nine Library IDs per media type (63 total)
- `GET /api/media`: list the collection
- `POST /api/media`: add media
- `PATCH /api/media/{id}`: update media
- `DELETE /api/media/{id}`: delete media
- `POST /api/media/{id}/refresh-metadata`: refresh linked catalog metadata
- `GET /api/activity`: list recent activity (`?limit=30`, maximum 100)
- `GET /api/backup`: download a restorable snapshot without AniList credentials
- `POST /api/backup/preview`: validate and summarize a portable backup
- `POST /api/backup/restore`: explicitly replace the current snapshot after preview
- `GET /api/discovery/search?type=anime&q=bebop&page=1`: search one catalog
- `GET /api/discovery/global?q=bebop`: search all available catalogs
- `GET /api/discovery/detail?provider=rawg&type=game&id=3498`: load one game's full catalog metadata
- `GET /api/discovery/detail?provider=anilist&type=anime&id=21366`: load exact AniList metadata, alternative titles, and related media
- `GET /api/import/anilist?username=example`: preview a public AniList library
- `POST /api/import/anilist`: import or reconcile selected entries
- `GET /api/integrations/anilist`: connection and queue status
- `GET /api/integrations/anilist/connect`: begin OAuth
- `GET /api/integrations/anilist/callback`: OAuth callback
- `DELETE /api/integrations/anilist`: disconnect (`?discardPending=true` abandons queued work)
- `POST /api/integrations/anilist/retry`: retry queued jobs now

SQLite is the operational store at `SQLITE_PATH` (`data/honne.db` by default). When the database is absent, a non-empty legacy `DATA_PATH` (`data/media.json`) using an unversioned array or supported versioned snapshot is validated and imported transactionally at startup. The JSON source remains unchanged.
