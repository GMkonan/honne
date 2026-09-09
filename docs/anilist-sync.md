# Connect Honne to AniList

Honne uses AniList's Authorization Code flow. The client secret and access token stay in the backend and are never exposed to frontend code.

Synchronization is primarily one-way: changes made in Honne are queued and sent to AniList. Import remains the explicit way to bring current AniList list data into Honne.

## 1. Back up the Library

Before enabling synchronization for an existing collection, open **Settings** and select **Download backup**.

## 2. Create an AniList API client

1. Sign in to AniList.
2. Open [AniList Developer Settings](https://anilist.co/settings/developer).
3. Select **Create New Client**.
4. Use `Honne` as the client name.
5. Register the redirect URL that matches the installation exactly.

Common redirect URLs:

| Installation | Redirect URL |
| --- | --- |
| Release default | `http://localhost:8080/api/integrations/anilist/callback` |
| Source Compose default | `http://localhost:7417/api/integrations/anilist/callback` |
| Public domain | `https://lists.example.com/api/integrations/anilist/callback` |

The scheme, host, port, and path must match exactly. Copy the generated **Client ID** and **Client Secret**.

## 3. Configure `.env`

Add the credentials and the same redirect URL to the installation's `.env` file:

```dotenv
ANILIST_CLIENT_ID=1234
ANILIST_CLIENT_SECRET=replace-with-the-client-secret
ANILIST_REDIRECT_URL=http://localhost:8080/api/integrations/anilist/callback

# Keep false initially so local deletion cannot remove the AniList entry.
ANILIST_DELETE_ON_LOCAL_DELETE=false
```

Never commit or share the client secret. For a source Compose installation on port `7417`, replace the redirect URL accordingly. Honne's environment templates default `ANILIST_DELETE_ON_LOCAL_DELETE` to `true`; change it explicitly to `false` before connecting if local deletion must remain local-only.

Recreate the backend so it receives the new environment:

```bash
docker compose up -d --force-recreate backend
docker compose ps
```

## 4. Authorize the account

1. Open Honne.
2. Go to **Settings**.
3. In the **AniList** card, select **Manage connection**.
4. Select **Connect AniList**.
5. Approve access on AniList.

AniList redirects to Honne, where the card should show **Connected** and the authenticated username.

## 5. Import or link titles

Select **Import AniList library**, load the preview, choose the media types and statuses, and confirm. Selection is performed by group, not title by title: every entry matching the chosen types and statuses is included. Start with a small filter and review both Honne and AniList before reconciling more entries.

- New matching titles are imported into Honne.
- Matching titles marked as already present are linked to the authenticated account.
- Existing rewatch or reread counts are read before Honne sends later changes.
- Local status, progress, rating, and notes remain authoritative; every difference is queued and may update the corresponding AniList entry.

A public import performed without an authenticated connection does not authorize or write to that profile. Imported entries begin as `local_only`; future synchronization requires a separately connected OAuth account.

## What synchronizes

For AniList-linked anime, manga, and light novels, Honne sends:

- list status;
- episode or chapter progress;
- personal rating;
- rewatch or reread count;
- notes;
- deletion, only when `ANILIST_DELETE_ON_LOCAL_DELETE=true`.

Changes are saved locally before the external request. If AniList is unavailable, a durable job stays queued and retries with backoff, including after a container restart. Repeated edits to one title are coalesced to the latest state.

Jobs and remote list-entry IDs are bound to the AniList account that owns them. Work pauses instead of running when a different account is connected.

## Disconnect safely

Open **Settings → AniList → Manage connection**. Normal disconnection is blocked while changes are pending. The dialog offers an explicit destructive option to discard the queue when those changes should never be sent.

Disconnecting does not remove entries from AniList. The access token is stored separately at `/data/anilist-auth.json` with mode `0600`; downloaded JSON backups intentionally exclude it. AniList does not provide refresh tokens, so reconnect when authorization expires.

## Troubleshooting

### AniList rejects the callback

The redirect URL registered in AniList Developer Settings must exactly equal `ANILIST_REDIRECT_URL`, including `/api/integrations/anilist/callback`. Separately, `APP_ORIGIN` must equal the origin used to open Honne, such as `http://localhost:8080`, without the callback path.

Update all three settings together when changing Honne's scheme, host, or port.

### The connection card says OAuth is not configured

Ensure all three variables are non-empty and recreate the backend:

```bash
docker compose up -d --force-recreate backend
docker compose logs backend
```

### Changes remain pending

Check the connection state and backend logs. Honne retries temporary failures automatically. After correcting the connection, use **Retry now** in the AniList connection dialog.

For protocol details, see the official [AniList authentication documentation](https://docs.anilist.co/guide/auth/authorization-code).
