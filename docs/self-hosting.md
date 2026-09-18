# Self-hosting Honne

Honne is distributed as versioned backend and frontend container images. A release installation needs only Docker Compose and the release configuration files.

## Install a release

```bash
mkdir -p ~/honne && cd ~/honne
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/compose.yaml
curl -fLO https://github.com/GMkonan/honne/releases/latest/download/env.example
```

Preserve an existing `.env`; `cp -n` creates it only on the first installation:

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
PROFILE_CAT_ENABLED=false
```

The avatar must be an absolute HTTP or HTTPS URL without embedded credentials. Set `PROFILE_CAT_ENABLED=true` to place the decorative Honne cat above the profile image. Invalid profile values stop the backend during startup.

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
- TMDB for movies and series;
- RAWG for games.

TMDB discovery requires an API Read Access Token. RAWG game discovery requires a personal API key from [RAWG API Docs](https://rawg.io/apidocs). Open Library recommends identifying requests with a contact email:

```dotenv
TMDB_API_TOKEN=your-api-read-access-token
RAWG_API_KEY=your-rawg-api-key
APP_CONTACT_EMAIL=you@example.com
```

The RAWG free plan requires attribution and active RAWG links wherever its data or images appear; Honne renders that attribution automatically. Provider secrets remain in the backend and are never sent to frontend code. See [AniList synchronization](anilist-sync.md) to configure authenticated list updates.

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

Back up before every important update. Release Compose files from v0.2.0 onward contain the matching immutable backend and frontend image tags, so updating to the latest release does not require discovering or editing a version:

```bash
cd ~/honne
curl -fL \
  https://github.com/GMkonan/honne/releases/latest/download/compose.yaml \
  -o compose.yaml.next
docker compose -f compose.yaml.next config --quiet
mv compose.yaml.next compose.yaml
docker compose pull
docker compose up -d
```

The temporary file keeps the current Compose file intact if the download or validation fails. The existing `.env`, provider credentials, and `honne-data` volume are not replaced. Explicit host-port and `APP_ORIGIN` values are also preserved, so a v0.1.0 installation remains on port 8080 unless both are intentionally changed. New optional settings use Compose defaults; release notes will call out any future setting that requires manual action.

After the containers are healthy, reload every open Honne tab so it uses the frontend contract shipped with the new backend.

For a rollback to v0.2.0 or newer, download the Compose asset from the exact previous tag:

```bash
ROLLBACK_VERSION=v0.2.0
curl -fL \
  "https://github.com/GMkonan/honne/releases/download/${ROLLBACK_VERSION}/compose.yaml" \
  -o compose.yaml.next
docker compose -f compose.yaml.next config --quiet
mv compose.yaml.next compose.yaml
docker compose pull
docker compose up -d
```

Do not use that sequence for v0.1.0. Its Compose asset predates embedded image tags, and its backend cannot read the persistence-v5 snapshot written by v0.2.0. Before validating or starting v0.1.0:

1. locate the matching pre-v0.2.0 JSON backup;
2. set `HONNE_VERSION=v0.1.0` in `.env`;
3. download and validate the v0.1.0 Compose asset;
4. pull the v0.1.0 images without starting them;
5. stop the current backend and preserve its data directory;
6. restore the matching backup while the backend remains stopped;
7. replace the Compose file and start v0.1.0.

```bash
ROLLBACK_VERSION=v0.1.0
BACKUP=./honne-backup-before-v0.2.0.json
# Set HONNE_VERSION=v0.1.0 in .env before continuing.
test -f "$BACKUP"
curl -fL \
  "https://github.com/GMkonan/honne/releases/download/${ROLLBACK_VERSION}/compose.yaml" \
  -o compose.yaml.next
docker compose -f compose.yaml.next config --quiet
docker compose -f compose.yaml.next pull
docker compose stop backend
mkdir -p ./pre-rollback-data
docker compose cp backend:/data/. ./pre-rollback-data/
docker compose cp "$BACKUP" backend:/data/media.json
docker compose run --rm --no-deps --user root --entrypoint sh backend \
  -c 'chown honne:honne /data/media.json && chmod 600 /data/media.json'
mv compose.yaml.next compose.yaml
docker compose up -d
```

Do not combine an older image with a newer Compose file or start v0.1.0 before restoring compatible data.

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

## Install on a phone

When Honne is reached through a stable HTTPS address, it can be installed as a standalone app without publishing the private instance to the internet. Open that address on the phone, then:

- on Android, use the browser's **Install app** action;
- on iPhone or iPad, use Safari's **Share → Add to Home Screen** action.

Install from the address that will remain available, including any nonstandard port. An installation through Tailscale remains private to the tailnet, but the phone must be connected to Tailscale and the Honne host and containers must be running.

The installed app is currently network-dependent. It does not cache the Library for offline access and does not queue offline changes.
