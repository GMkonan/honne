package main

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDownloadBackupProducesRestorableSnapshot(t *testing.T) {
	now := time.Date(2026, time.September, 6, 23, 0, 0, 0, time.UTC)
	s := &store{
		items: []Media{
			{
				ID: 7, Title: "Cowboy Bebop", Type: "anime", Status: "in_progress",
				Progress: 8, RepeatCount: 2, PlayedOnPlatforms: []string{}, Genres: []string{"Sci-Fi"}, AniListUserID: 42, AniListRepeatKnown: true, CreatedAt: now, UpdatedAt: now,
			},
			{
				ID: 8, Title: "Hades", Type: "game", Status: "in_progress",
				PlaytimeMinutes: 720, PlayedOnPlatforms: []string{"PC", "Steam Deck"}, CatalogPlatforms: []string{"PC", "PlayStation 5"}, Genres: []string{"Action"}, CreatedAt: now, UpdatedAt: now,
			},
		},
		syncJobs: []syncJob{{
			ID: 9, MediaID: 7, Operation: "upsert", ProviderMediaID: 1,
			AniListUserID: 42, Generation: 1, CreatedAt: now, UpdatedAt: now,
		}},
		activities: []Activity{{
			ID: 11, MediaID: 7, Title: "Cowboy Bebop", MediaType: "anime",
			Action: "updated", OccurredAt: now,
		}},
		favoriteMediaIDs: []int{8, 7},
		appearance: libraryAppearance{
			BannerContentType: "image/png",
			BannerData:        append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 24)...),
			AvatarContentType: "image/png",
			AvatarData:        append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 24)...),
		},
		nextID: 9, nextJobID: 10, nextActivityID: 12,
	}
	application := &app{store: s}
	response := httptest.NewRecorder()
	application.downloadBackup(response, httptest.NewRequest(http.MethodGet, "/api/backup", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/json; charset=utf-8" ||
		response.Header().Get("Cache-Control") != "no-store" ||
		response.Header().Get("X-Content-Type-Options") != "nosniff" ||
		response.Header().Get("X-Honne-Backup-Version") != "11" {
		t.Fatalf("unexpected backup headers: %v", response.Header())
	}
	if disposition := response.Header().Get("Content-Disposition"); !strings.HasPrefix(disposition, `attachment; filename="honne-backup-`) || !strings.HasSuffix(disposition, `.json"`) {
		t.Fatalf("unexpected content disposition %q", disposition)
	}
	if strings.Contains(response.Body.String(), "accessToken") {
		t.Fatal("backup unexpectedly contains AniList authorization")
	}

	path := filepath.Join(t.TempDir(), "media.json")
	if err := os.WriteFile(path, response.Body.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	restored, err := newStore(path)
	if err != nil {
		t.Fatalf("backup could not be restored: %v", err)
	}
	if len(restored.items) != 2 || restored.items[0].ID != 7 || restored.items[0].RepeatCount != 2 || restored.items[0].AniListUserID != 42 || !restored.items[0].AniListRepeatKnown || restored.items[0].Genres[0] != "Sci-Fi" ||
		restored.items[1].ID != 8 || restored.items[1].PlaytimeMinutes != 720 || strings.Join(restored.items[1].PlayedOnPlatforms, ",") != "PC,Steam Deck" || strings.Join(restored.items[1].CatalogPlatforms, ",") != "PC,PlayStation 5" || restored.items[1].Genres[0] != "Action" ||
		len(restored.syncJobs) != 1 || restored.syncJobs[0].ID != 9 ||
		len(restored.activities) != 1 || restored.activities[0].ID != 11 ||
		len(restored.favoriteMediaIDs) != 2 || restored.favoriteMediaIDs[0] != 8 || restored.favoriteMediaIDs[1] != 7 ||
		restored.appearance.BannerContentType != "image/png" || len(restored.appearance.BannerData) == 0 ||
		restored.appearance.AvatarContentType != "image/png" || len(restored.appearance.AvatarData) == 0 ||
		restored.nextID != 9 || restored.nextJobID != 10 || restored.nextActivityID != 12 {
		t.Fatalf("restored backup lost durable state: %+v", restored)
	}
}

func TestDownloadBackupDoesNotSendPartialSnapshotOnSerializationFailure(t *testing.T) {
	s := &store{items: []Media{{ID: 1, CommunityRating: math.NaN()}}}
	application := &app{store: s}
	response := httptest.NewRecorder()
	application.downloadBackup(response, httptest.NewRequest(http.MethodGet, "/api/backup", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Disposition") != "" {
		t.Fatal("failed backup was presented as a download")
	}
	var payload map[string]string
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload["error"] != "could not prepare backup" {
		t.Fatalf("unexpected error payload: %+v", payload)
	}
}

func TestPreviewAndRestoreBackupReplaceSQLiteSnapshot(t *testing.T) {
	directory := t.TempDir()
	databasePath := filepath.Join(directory, "honne.db")
	store, _, err := openRuntimeStore(databasePath, filepath.Join(directory, "missing.json"))
	if err != nil {
		t.Fatal(err)
	}

	store.mu.Lock()
	store.items = []Media{{ID: 1, Title: "Old title", Type: "movie", Status: "completed", PlayedOnPlatforms: []string{}, CatalogPlatforms: []string{}}}
	store.nextID = 2
	if err := store.persistLocked(); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()

	backup := `{
		"version": 6,
		"items": [{"id": 9, "title": "Restored title", "type": "anime", "status": "planned", "playedOnPlatforms": [], "catalogPlatforms": []}],
		"syncJobs": [],
		"activities": [{"id": 4, "mediaId": 9, "title": "Restored title", "mediaType": "anime", "action": "created", "occurredAt": "2026-09-06T23:00:00Z"}],
		"nextId": 10,
		"nextJobId": 1,
		"nextActivityId": 5
	}`
	application := &app{store: store}

	previewRequest := httptest.NewRequest(http.MethodPost, "/api/backup/preview", strings.NewReader(backup))
	previewRequest.Header.Set("Content-Type", "application/json")
	previewResponse := httptest.NewRecorder()
	application.previewBackupRestore(previewResponse, previewRequest)
	if previewResponse.Code != http.StatusOK || !strings.Contains(previewResponse.Body.String(), `"items":1`) || !strings.Contains(previewResponse.Body.String(), `"activities":1`) {
		t.Fatalf("unexpected preview response %d: %s", previewResponse.Code, previewResponse.Body.String())
	}

	restoreRequest := httptest.NewRequest(http.MethodPost, "/api/backup/restore", strings.NewReader(backup))
	restoreRequest.Header.Set("Content-Type", "application/json")
	restoreRequest.Header.Set(restoreConfirmationHeader, "replace")
	restoreResponse := httptest.NewRecorder()
	application.restoreBackup(restoreResponse, restoreRequest)
	if restoreResponse.Code != http.StatusOK {
		t.Fatalf("unexpected restore response %d: %s", restoreResponse.Code, restoreResponse.Body.String())
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := newSQLiteStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if len(reopened.items) != 1 || reopened.items[0].ID != 9 || reopened.items[0].Title != "Restored title" || len(reopened.activities) != 1 || reopened.nextID != 10 || reopened.nextActivityID != 5 {
		t.Fatalf("restored SQLite snapshot was not durable: %+v", reopened.snapshotLocked())
	}
}

func TestRestoreBackupRequiresConfirmationAndDisconnectedAniList(t *testing.T) {
	backup := `{"version":6,"items":[],"syncJobs":[],"activities":[],"nextId":1,"nextJobId":1,"nextActivityId":1}`
	store := emptyStore(filepath.Join(t.TempDir(), "media.json"))
	configured := config{AniListClientID: "client", AniListClientSecret: "secret", AniListRedirectURL: "http://localhost/callback"}
	application := &app{store: store, anilist: &aniListSync{cfg: configured, auth: &aniListAuth{AccessToken: "token", Username: "owner"}}}

	missingConfirmation := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/backup/restore", strings.NewReader(backup))
	request.Header.Set("Content-Type", "application/json")
	application.restoreBackup(missingConfirmation, request)
	if missingConfirmation.Code != http.StatusPreconditionRequired {
		t.Fatalf("expected confirmation requirement, got %d: %s", missingConfirmation.Code, missingConfirmation.Body.String())
	}

	connected := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/backup/restore", strings.NewReader(backup))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(restoreConfirmationHeader, "replace")
	application.restoreBackup(connected, request)
	if connected.Code != http.StatusConflict || !strings.Contains(connected.Body.String(), "disconnect AniList") {
		t.Fatalf("expected connected AniList conflict, got %d: %s", connected.Code, connected.Body.String())
	}
}

func TestRestoreBackupRejectsInvalidInputAndRollsBackPersistenceFailure(t *testing.T) {
	store := emptyStore(filepath.Join(t.TempDir(), "media.json"))
	store.items = []Media{{ID: 1, Title: "Keep me", Type: "book", Status: "planned", PlayedOnPlatforms: []string{}, CatalogPlatforms: []string{}}}
	store.nextID = 2
	application := &app{store: store}

	invalid := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/backup/preview", strings.NewReader(`{"version":99,"items":[]}`))
	request.Header.Set("Content-Type", "application/json")
	application.previewBackupRestore(invalid, request)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected invalid backup rejection, got %d: %s", invalid.Code, invalid.Body.String())
	}

	store.closed = true
	valid := `{"version":6,"items":[],"syncJobs":[],"activities":[],"nextId":1,"nextJobId":1,"nextActivityId":1}`
	failed := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/backup/restore", strings.NewReader(valid))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(restoreConfirmationHeader, "replace")
	application.restoreBackup(failed, request)
	if failed.Code != http.StatusInternalServerError || len(store.items) != 1 || store.items[0].Title != "Keep me" || store.nextID != 2 {
		t.Fatalf("failed restore did not roll memory back: code=%d store=%+v", failed.Code, store.snapshotLocked())
	}
}
