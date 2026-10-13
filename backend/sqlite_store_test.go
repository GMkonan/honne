package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSQLiteMigrationRoundTripPreservesSnapshotAndJSONSource(t *testing.T) {
	input := persistedStore{
		Version: 6,
		Items: []Media{{
			ID:                  7,
			Title:               "Shadow of the Colossus",
			Type:                "game",
			Status:              "completed",
			PlannedRepeat:       true,
			Notes:               "Preserve this note",
			PlayedOnPlatforms:   []string{"PS4"},
			CatalogPlatforms:    []string{"PlayStation 4"},
			Provider:            "rawg",
			ProviderID:          "432",
			CommunityRating:     9.1,
			ProviderListEntryID: 0,
		}},
		SyncJobs:       []syncJob{{ID: 12, MediaID: 91, Operation: syncDelete}},
		Activities:     []Activity{{ID: 15, MediaID: 120, Title: "Deleted title"}},
		NextID:         2,
		NextJobID:      3,
		NextActivityID: 4,
	}
	data, err := json.MarshalIndent(input, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "media.json")
	destination := filepath.Join(dir, "media.db")
	if err := os.WriteFile(source, data, 0o600); err != nil {
		t.Fatal(err)
	}

	plan, err := prepareSQLiteImport(source, destination)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrateJSONToSQLite(source, destination); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(after, data) {
		t.Fatal("migration changed its JSON source")
	}
	info, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("database permissions = %o, want 600", info.Mode().Perm())
	}

	reopened, err := loadSQLiteSnapshot(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(reopened, plan.Snapshot) {
		t.Fatalf("SQLite round trip changed snapshot:\n got: %+v\nwant: %+v", reopened, plan.Snapshot)
	}

	exported, err := exportSQLiteSnapshot(destination)
	if err != nil {
		t.Fatal(err)
	}
	rollbackPath := filepath.Join(dir, "rollback.json")
	if err := os.WriteFile(rollbackPath, exported, 0o600); err != nil {
		t.Fatal(err)
	}
	legacy, err := newStore(rollbackPath)
	if err != nil {
		t.Fatalf("current JSON store could not open rollback export: %v", err)
	}
	legacySnapshot := persistedStore{
		Version: persistedStoreVersion, Items: legacy.items, SyncJobs: legacy.syncJobs,
		Activities: legacy.activities, NextID: legacy.nextID, NextJobID: legacy.nextJobID,
		NextActivityID: legacy.nextActivityID,
	}
	if !reflect.DeepEqual(legacySnapshot, plan.Snapshot) {
		t.Fatal("rollback JSON export is not logically identical")
	}
}

func TestSQLiteMigrationRejectsUnsafeDestinationsAndCleansFailures(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "media.json")
	destination := filepath.Join(dir, "media.db")
	if err := os.WriteFile(source, []byte(`{"version":6,"items":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("owner data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateJSONToSQLite(source, destination); err == nil {
		t.Fatal("existing destination was accepted")
	}
	got, err := os.ReadFile(destination)
	if err != nil || string(got) != "owner data" {
		t.Fatal("existing destination was changed")
	}

	invalidDestination := filepath.Join(dir, "invalid.db")
	if err := os.WriteFile(source, []byte(`{"version":7}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateJSONToSQLite(source, invalidDestination); err == nil {
		t.Fatal("unsupported source was accepted")
	}
	if _, err := os.Stat(invalidDestination); !os.IsNotExist(err) {
		t.Fatal("failed migration left a destination")
	}
}

func TestSQLiteSnapshotRejectsInconsistentCountersAndCorruption(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "media.json")
	destination := filepath.Join(dir, "media.db")
	if err := os.WriteFile(source, []byte(`{"version":6,"items":[{"id":7,"title":"Example","type":"book"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateJSONToSQLite(source, destination); err != nil {
		t.Fatal(err)
	}
	db, err := openSQLiteDatabase(destination, "rw")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE store_meta SET next_media_id = 1"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := loadSQLiteSnapshot(destination); err == nil {
		t.Fatal("inconsistent SQLite counters were accepted")
	}

	corrupt := filepath.Join(dir, "corrupt.db")
	if err := os.WriteFile(corrupt, []byte("not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadSQLiteSnapshot(corrupt); err == nil {
		t.Fatal("corrupt SQLite database was accepted")
	}
}
