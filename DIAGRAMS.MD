# Honne diagrams

This document describes the current runtime architecture and durable data model. It is intentionally implementation-oriented: when persistence or service boundaries change, update the diagrams in the same commit.

## Runtime architecture

```mermaid
flowchart LR
    Browser[React SPA\nfrontend container]
    API[Go API\nbackend container]
    Store[(honne.db\nembedded SQLite)]
    Legacy[media.json\nlegacy migration source]
    Auth[anilist-auth.json\nOAuth authorization]
    Providers[AniList · Kitsu · TMDB\nOpen Library · RAWG]

    Browser -->|same-origin /api| API
    API -->|single writer| Store
    Legacy -. first startup only .-> API
    API -->|optional metadata and sync| Providers
    API -->|separate secret state| Auth
```

The frontend never opens persistence or contacts authenticated providers directly. The Go backend owns validation, IDs, transactions, provider credentials, and the AniList outbox.

## SQLite model

```mermaid
erDiagram
    STORE_META {
        integer singleton PK
        integer json_version
        integer next_media_id
        integer next_job_id
        integer next_activity_id
    }

    MEDIA {
        integer id PK
        integer position UK
        text payload_json
    }

    SYNC_JOBS {
        integer id PK
        integer media_id
        integer position UK
        text payload_json
    }

    ACTIVITIES {
        integer id PK
        integer media_id
        integer position UK
        text payload_json
    }

    FAVORITES {
        integer media_id PK,FK
        integer position UK
    }

    LIBRARY_APPEARANCE {
        integer singleton PK
        text banner_content_type
        blob banner_data
        text avatar_content_type
        blob avatar_data
    }

    MEDIA ||--o| FAVORITES : "selected as"
    MEDIA ||--o{ SYNC_JOBS : "current item or tombstone reference"
    MEDIA ||--o{ ACTIVITIES : "current item or retained history reference"
```

### Table responsibilities

| Table | Responsibility |
| --- | --- |
| `store_meta` | JSON contract version and monotonic counters. The singleton row is replaced with every logical snapshot. |
| `media` | Ordered Library entries. `payload` preserves the complete validated media contract while the relational key keeps identity explicit. |
| `sync_jobs` | Durable AniList outbox, including jobs that may refer to a locally deleted item. |
| `activities` | Retained local history. Historical rows may refer to deleted media, so they intentionally have no cascading foreign key. |
| `favorites` | Manual order for at most nine existing Library entries. Position `0` is the first tile in the 3×3. |
| `library_appearance` | Singleton local customization. Stores an optional banner up to 8 MiB and profile picture up to 4 MiB as validated JPEG, PNG, WebP, or GIF data. |

`media`, `sync_jobs`, and `activities` keep validated JSON payloads in the first SQLite model. This preserves the established backup contract and avoids scattering provider-specific fields across many nullable columns before their query needs are proven.

## Atomic write boundary

```mermaid
sequenceDiagram
    participant UI as React UI
    participant API as Go handler
    participant Memory as Locked store
    participant DB as SQLite

    UI->>API: validated mutation
    API->>Memory: acquire lock + clone snapshot
    API->>Memory: apply media/activity/outbox/preferences change
    Memory->>DB: replace logical snapshot in one transaction
    alt commit succeeds
        DB-->>Memory: committed
        Memory-->>API: unlock
        API-->>UI: success
    else write or commit fails
        DB-->>Memory: error + rollback
        Memory->>Memory: restore cloned snapshot
        Memory-->>API: unlock
        API-->>UI: stable error
    end
```

A user-visible success is never returned before the SQLite commit. Library data, Activity, counters, favorites, appearance, and AniList jobs share the same transaction and rollback boundary.

## JSON migration and restore

```mermaid
flowchart TD
    Input[Legacy or backup JSON] --> Limit[Enforce 32 MiB limit]
    Limit --> Decode[Strict decode\nlegacy array or versions 1–8]
    Decode --> Validate[Validate IDs, references, counters,\nfavorites, banner, profile picture, and payloads]
    Validate --> Tx[Write new or replacement SQLite snapshot\nin one transaction]
    Tx --> Integrity[Integrity check and reopen]
    Integrity --> Ready[Use SQLite as operational source]

    Validate -. failure .-> Unchanged[Current data remains unchanged]
    Tx -. failure .-> Unchanged
```

Startup migration creates `honne.db` only when it does not exist and never changes `media.json`. Settings restore previews the same portable JSON format, requires explicit confirmation, waits for an in-flight AniList operation, and replaces the current snapshot transactionally. AniList OAuth authorization is deliberately excluded from portable backups.

## Backup projection

```mermaid
flowchart LR
    SQLite[(SQLite snapshot)] --> Export[Version 8 JSON]
    Export --> Media[Library]
    Export --> Activity[Activity]
    Export --> Outbox[AniList outbox]
    Export --> Counters[Monotonic counters]
    Export --> Favorites[Favorite order]
    Export --> Appearance[Custom banner and profile picture]
    Secret[OAuth token] -. excluded .-> Export
```
