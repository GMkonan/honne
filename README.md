# Honne

A self-hostable, local-first library for anime, series, movies, books, manga, and light novels. Track status, progress, ratings, and notes; optionally use metadata providers and synchronize AniList-linked titles back to AniList.

## Run with Docker Compose

Docker Compose is the recommended deployment method. Only Docker is required.

```bash
cp .env.example .env
# Edit .env if you want authentication or optional integrations.
docker compose up -d --build
```

Open `http://localhost:8080`. The collection and pending synchronization jobs are stored in the `honne-data` Docker volume and survive container replacement.

Useful commands:

```bash
docker compose logs -f
docker compose up -d --build
docker compose down                 # keeps data
docker compose down --volumes       # permanently deletes data
```

Back up the persistent directory, including the AniList authorization. The backup contains a usable OAuth token, so store it as a secret:

```bash
mkdir -p backup
docker compose cp backend:/data/. ./backup/
```

### Public deployment

Put Honne behind an HTTPS reverse proxy such as Caddy, Traefik, or nginx. Set these values in `.env`:

```dotenv
HONNE_PORT=127.0.0.1:8080
APP_ORIGIN=https://lists.example.com
```

Proxy `https://lists.example.com` to `http://127.0.0.1:8080`. `APP_ORIGIN` is also used after the AniList OAuth callback, so it must be the exact external base URL.

## Optional login

Set both values to enable HTTP Basic authentication for the API:

```dotenv
APP_USERNAME=owner
APP_PASSWORD=use-a-long-random-password
```

Leaving both empty disables authentication. Supplying only one makes the backend refuse to start. The health endpoint remains public for container monitoring.

The reverse proxy protects the complete web interface and API with the browser's native login challenge. The health endpoints remain public for container monitoring. Basic authentication has no application-level logout; browsers may cache credentials until they are closed. Always use HTTPS when exposing a password outside your own machine.

If a password contains `$`, wrap the value in single quotes in the Compose `.env` file (for example, `APP_PASSWORD='pa$word'`), or use a long alphanumeric password.

## AniList synchronization

Honne supports one-way synchronization: **changes made in Honne are sent to AniList**. It does not continuously overwrite Honne with changes made directly on AniList; the existing import flow remains available for bringing a list in.

### Configure OAuth

1. Create an API client in the AniList developer settings.
2. Register this exact redirect URL:

   ```text
   https://lists.example.com/api/integrations/anilist/callback
   ```

   For the default local installation, use `http://localhost:8080/api/integrations/anilist/callback`.
3. Add the credentials and the same redirect URL to `.env`:

   ```dotenv
   ANILIST_CLIENT_ID=1234
   ANILIST_CLIENT_SECRET=...
   ANILIST_REDIRECT_URL=https://lists.example.com/api/integrations/anilist/callback
   ANILIST_DELETE_ON_LOCAL_DELETE=true
   ```
4. Restart with `docker compose up -d`.
5. Open **AniList** in the navigation and choose **Connect AniList**.

The access token is stored at `/data/anilist-auth.json` inside the private backend volume with mode `0600`. AniList tokens do not have refresh tokens; reconnect when authorization expires.

### What synchronizes

For anime, manga, and light novels selected through AniList discovery, Honne synchronizes:

- list status;
- episode/chapter progress;
- personal rating;
- notes;
- local deletion, when `ANILIST_DELETE_ON_LOCAL_DELETE=true`.

Changes are saved locally first. If AniList is unavailable, a durable job remains queued and is retried with backoff, including after a container restart. Repeated edits to one title are coalesced to the latest state. Jobs are bound to the AniList account that created them, so reconnecting another account cannot apply old work to it. The connection panel also offers an explicit destructive option to discard a stuck queue before disconnecting.

Manually entered anime, manga, and light novels have no AniList media ID and are marked **local only**. A future linking flow can associate them with a search result. Books, movies, and series are always local to Honne.

When an AniList account is connected, imports are restricted to that same account so another public profile cannot accidentally be synchronized into it.

## Other discovery providers

The add-title flow uses:

- AniList for anime, manga, and light novels;
- Open Library for books;
- TMDB for movies and series.

Movie and series discovery requires a TMDB API Read Access Token:

```dotenv
TMDB_API_TOKEN=your-token
APP_CONTACT_EMAIL=you@example.com
```

Provider credentials remain in the backend and are never sent to the frontend.

## Run for development

Use two terminals:

```bash
cd backend
cp .env.example .env # optional
# If OAuth is not being configured yet, leave all three ANILIST_* OAuth values empty.
go run .
```

```bash
cd frontend
deno install
deno task dev
```

Open `http://localhost:5173`. The frontend proxies `/api` to `http://localhost:8080`. To change the API development port, set matching values in `backend/.env` and `frontend/.env`:

```dotenv
# backend/.env
PORT=8091

# frontend/.env
VITE_API_PROXY_URL=http://localhost:8091
```

Checks:

```bash
(cd backend && go test -race ./... && go vet ./...)
(cd frontend && deno task check)
docker compose config --quiet
docker compose build
```

## API

- `GET /api/health`: health check
- `GET /api/auth/check`: reverse-proxy authentication check
- `GET /api/media`: list the collection
- `POST /api/media`: add media
- `PATCH /api/media/{id}`: update media
- `DELETE /api/media/{id}`: delete media
- `GET /api/discovery/search?type=anime&q=bebop&page=1`: search metadata
- `GET /api/import/anilist?username=example`: preview a public AniList library
- `POST /api/import/anilist`: import selected types and statuses
- `GET /api/integrations/anilist`: connection and queue status
- `GET /api/integrations/anilist/connect`: begin OAuth
- `GET /api/integrations/anilist/callback`: OAuth callback
- `DELETE /api/integrations/anilist`: disconnect without changing AniList (`?discardPending=true` explicitly abandons queued work)
- `POST /api/integrations/anilist/retry`: retry queued jobs now

Existing legacy `media.json` array files are loaded automatically and migrated to the versioned format on the next write.
