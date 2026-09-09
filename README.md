# Honne

A self-hostable, local-first library for anime, series, movies, books, manga, and light novels. Track status, progress, ratings, and notes; optionally use metadata providers and synchronize AniList-linked titles back to AniList.

## Install a release

Docker Compose is the recommended deployment method. A release installation needs only Docker, `compose.yaml`, and `.env`; Git and the source code are not required.

```bash
mkdir -p ~/honne && cd ~/honne
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/compose.yaml
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/env.example
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/checksums.txt
sha256sum --check checksums.txt
mv env.example .env
chmod 600 .env
# Edit .env to personalize the profile and configure optional providers.
docker compose config --quiet
docker compose pull
docker compose up -d
```

Open `http://localhost:8080`. The collection, activity journal, and pending synchronization jobs are stored in the named `honne-data` Docker volume and survive container replacement.

Personalize the Library profile in `.env` with an optional name and avatar:

```dotenv
PROFILE_NAME=My Library
PROFILE_AVATAR_URL=https://images.example.com/avatar.png
```

The avatar must use an absolute HTTP or HTTPS URL without embedded credentials. Invalid profile values make the backend stop at startup with a configuration error.

Useful commands:

```bash
docker compose logs -f
docker compose pull && docker compose up -d
docker compose down                 # keeps data
docker compose down --volumes       # permanently deletes data
```

### Update or roll back

Download the current release Compose file, set both images to the desired immutable tag through `HONNE_VERSION` in `.env`, and recreate the services:

```bash
curl -fL https://github.com/GMkonan/honne/releases/latest/download/compose.yaml -o compose.yaml
# Edit HONNE_VERSION in .env, for example v0.2.0 or v0.1.0 for rollback.
docker compose pull
docker compose up -d
```

Back up before updating. Rolling back containers does not reverse a data migration; restore the matching pre-update backup when a release documents an incompatible persistence change.

### Backup and restore

Use **Settings → Download backup** for a safe JSON snapshot containing the collection, catalog metadata, activity journal, pending sync changes, and ID counters. The download intentionally excludes the AniList OAuth token; reconnect AniList after restoring it.

Restore a downloaded snapshot only into the same or a newer Honne version. Preserve the current private data directory first so the operation can be reversed:

```bash
docker compose stop backend
mkdir -p ./pre-restore-data
docker compose cp backend:/data/. ./pre-restore-data/
docker compose cp ./honne-backup-YYYYMMDDTHHMMSSZ.json backend:/data/media.json
docker compose run --rm --no-deps --user root --entrypoint sh backend \
  -c 'chown honne:honne /data/media.json && chmod 600 /data/media.json'
docker compose start backend
docker compose logs backend
```

On a fresh installation, reconnect the same AniList account after restoring. When restoring over an existing installation, its separate AniList authorization remains in `/data/anilist-auth.json`; pending jobs are account-bound and pause rather than run against a different account.

For an operational backup of the complete private data directory, including AniList authorization, stop the backend and copy `/data`. This backup contains a usable OAuth token and must be stored as a secret:

```bash
mkdir -p backup
docker compose stop backend
docker compose cp backend:/data/. ./backup/
docker compose start backend
```

Existing source-based installations may use a Compose-prefixed volume such as `lists_honne-data`. Never run the source and release backends against that volume at the same time: their in-process locks do not coordinate with each other. Migrate it explicitly:

```bash
# In the old source checkout: make a backup, then stop without deleting volumes.
docker compose down
# In the standalone release directory:
# set HONNE_DATA_VOLUME=lists_honne-data in .env
docker compose up -d
```

Confirm the old backend is stopped before starting the release installation. Alternatively, leave `HONNE_DATA_VOLUME=honne-data` and restore a downloaded backup into the new volume.

## Build from source

Developers can keep using the repository Compose file:

```bash
cp .env.example .env
# Edit .env if you want authentication or optional integrations.
docker compose up -d --build
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
- rewatch or reread count;
- notes;
- local deletion, when `ANILIST_DELETE_ON_LOCAL_DELETE=true`.

Changes are saved locally first. If AniList is unavailable, a durable job remains queued and is retried with backoff, including after a container restart. Repeated edits to one title are coalesced to the latest state. Jobs are bound to the AniList account that created them, so reconnecting another account cannot apply old work to it. The connection panel also offers an explicit destructive option to discard a stuck queue before disconnecting.

Manually entered anime, manga, and light novels have no AniList media ID and are marked **local only**. A future linking flow can associate them with a search result. Books, movies, and series are always local to Honne.

When an AniList account is connected, imports are restricted to that same account so another public profile cannot accidentally be synchronized into it.

## Other discovery providers

The add-title flow uses:

- AniList for anime, manga, and light novels, with Kitsu as an automatic public fallback;
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
- `GET /api/profile`: public Library profile name and avatar
- `GET /api/media`: list the collection
- `GET /api/activity`: list recent library activity (`?limit=30`, maximum 100)
- `GET /api/backup`: download a restorable JSON snapshot without AniList credentials
- `POST /api/media`: add media
- `PATCH /api/media/{id}`: update media
- `POST /api/media/{id}/refresh-metadata`: refresh provider metadata for a linked title
- `DELETE /api/media/{id}`: delete media
- `GET /api/discovery/search?type=anime&q=bebop&page=1`: search one metadata catalog
- `GET /api/discovery/global?q=bebop`: search all available metadata catalogs
- `GET /api/import/anilist?username=example`: preview a public AniList library
- `POST /api/import/anilist`: import selected types and statuses
- `GET /api/integrations/anilist`: connection and queue status
- `GET /api/integrations/anilist/connect`: begin OAuth
- `GET /api/integrations/anilist/callback`: OAuth callback
- `DELETE /api/integrations/anilist`: disconnect without changing AniList (`?discardPending=true` explicitly abandons queued work)
- `POST /api/integrations/anilist/retry`: retry queued jobs now

Existing legacy `media.json` array files are loaded automatically and migrated to the versioned format on the next write.
