# Self-hosting Honne

Honne is distributed as versioned backend and frontend container images. A release installation needs only Docker Compose and the release configuration files.

## Install a release

```bash
mkdir -p ~/honne && cd ~/honne
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/compose.yaml
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/env.example
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/checksums.txt
if command -v sha256sum >/dev/null; then sha256sum --check checksums.txt; else shasum -a 256 -c checksums.txt; fi
```

Continue only when both assets report `OK`. Preserve an existing `.env`; `cp -n` creates it only on the first installation:

```bash
cp -n env.example .env
chmod 600 .env
```

Review `.env`, then start Honne:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
```

Open `http://localhost:7417`. Collection data, activities, pending synchronization jobs, and ID counters are stored in the named `honne-data` volume.

Useful commands:

```bash
docker compose ps
docker compose logs -f
docker compose pull && docker compose up -d
docker compose down                 # keeps data
docker compose down --volumes       # permanently deletes data
```

Never use `docker compose down --volumes` unless deleting the collection is intentional.

## Configuration

### Profile

```dotenv
PROFILE_NAME=My Library
PROFILE_AVATAR_URL=https://images.example.com/avatar.png
```

The avatar must be an absolute HTTP or HTTPS URL without embedded credentials. Invalid profile values stop the backend during startup.

### Optional login

Set both values to enable HTTP Basic authentication:

```dotenv
APP_USERNAME=owner
APP_PASSWORD=use-a-long-random-password
```

Leaving both empty disables authentication. Supplying only one makes the backend refuse to start. If a password contains `$`, quote it in the Compose `.env` file, for example `APP_PASSWORD='pa$word'`.

The browser may cache Basic Auth credentials until it is closed. Always use HTTPS when exposing a password outside a trusted private network.

### Discovery providers

Manual tracking does not require provider credentials. Public discovery uses:

- AniList for anime, manga, and light novels, with Kitsu as an automatic fallback;
- Open Library for books;
- TMDB for movies and series.

TMDB discovery requires an API Read Access Token. Open Library recommends identifying requests with a contact email:

```dotenv
TMDB_API_TOKEN=your-api-read-access-token
APP_CONTACT_EMAIL=you@example.com
```

Provider secrets remain in the backend and are never sent to frontend code. See [AniList synchronization](anilist-sync.md) to configure authenticated list updates.

## Download a backup

Use **Settings → Download backup** for a coherent JSON snapshot containing:

- the collection and catalog metadata;
- activity history;
- pending AniList synchronization jobs;
- persisted ID counters.

The download intentionally excludes the AniList OAuth token. Reconnect AniList after restoring into a fresh installation.

For a complete operational backup, including AniList authorization, stop the backend and copy its private data directory. This copy contains a usable OAuth token and must be stored as a secret:

```bash
mkdir -p backup
docker compose stop backend
docker compose cp backend:/data/. ./backup/
docker compose start backend
```

## Restore a downloaded backup

Restore only into the same or a newer Honne version. Preserve the existing private data directory first:

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

When restoring over an existing installation, the separate authorization file at `/data/anilist-auth.json` remains in place. Pending jobs are account-bound and pause instead of running against a different AniList account.

## Update and roll back

Back up before every important update. Download the Compose file from the same immutable tag as the images, update `HONNE_VERSION`, and recreate the services:

```bash
TARGET_VERSION=v0.2.0
curl -fL "https://github.com/GMkonan/honne/releases/download/${TARGET_VERSION}/compose.yaml" -o compose.yaml
curl -fL "https://github.com/GMkonan/honne/releases/download/${TARGET_VERSION}/env.example" -o env.example
curl -fL "https://github.com/GMkonan/honne/releases/download/${TARGET_VERSION}/checksums.txt" -o checksums.txt
if command -v sha256sum >/dev/null; then sha256sum --check checksums.txt; else shasum -a 256 -c checksums.txt; fi
```

Continue only after both assets report `OK`. Review the new settings and set `HONNE_VERSION` in `.env` to the same value as `TARGET_VERSION`, then run:

```bash
docker compose pull
docker compose up -d
```

Use the same process with the previous tag for a rollback; do not combine an older image with a newer Compose file. Rolling back containers does not reverse a persistence migration. If the newer release changed the persistence version, restore the matching pre-update backup before starting the older containers.

## Migrate a source installation

A source checkout may use a Compose-prefixed volume such as `lists_honne-data`. Stop the old backend before mounting that volume in a standalone release; process-local locks do not protect against two backend containers writing concurrently.

```bash
# Run in the source checkout after downloading a backup.
docker compose down

# Run in the standalone release directory after setting this in .env:
# HONNE_DATA_VOLUME=lists_honne-data
docker compose up -d
```

Alternatively, keep `HONNE_DATA_VOLUME=honne-data` and restore a downloaded JSON backup into the new volume.

## Private-network and public access

The release binds to localhost by default. For a different local port, update both values:

```dotenv
HONNE_PORT=127.0.0.1:8123
APP_ORIGIN=http://localhost:8123
```

When AniList OAuth is enabled, its registered redirect URL and `ANILIST_REDIRECT_URL` must use the same host and port.

For remote access, prefer a private network such as Tailscale. A public deployment must use authentication and HTTPS. Put Honne behind a reverse proxy and configure its external origin:

```dotenv
HONNE_PORT=127.0.0.1:7417
APP_ORIGIN=https://lists.example.com
```

Proxy `https://lists.example.com` to `http://127.0.0.1:7417`. `APP_ORIGIN` is also the destination after the AniList OAuth callback.
