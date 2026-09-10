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
		response.Header().Get("X-Honne-Backup-Version") != "5" {
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
