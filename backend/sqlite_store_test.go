package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestRuntimeSQLiteStoreMigratesOnceAndPersistsNewWrites(t *testing.T) {
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "media.json")
	sqlitePath := filepath.Join(dir, "honne.db")
	legacyData := []byte(`{"version":6,"items":[{"id":7,"title":"Legacy","type":"book","status":"planned","progress":0,"total":0,"rating":0,"repeatCount":0,"playedOnPlatforms":[],"catalogPlatforms":[],"notes":"source stays frozen","coverUrl":"","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}],"nextId":8}`)
	if err := os.WriteFile(legacyPath, legacyData, 0o600); err != nil {
		t.Fatal(err)
	}

	store, migrated, err := openRuntimeStore(sqlitePath, legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if !migrated || !store.sqlite || len(store.items) != 1 || store.items[0].ID != 7 {
		t.Fatalf("legacy source was not activated in SQLite: migrated=%v store=%+v", migrated, store)
	}
	store.mu.Lock()
	store.items[0].Notes = "written only to SQLite"
	store.nextID = 12
	err = store.persistLocked()
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	unchanged, err := os.ReadFile(legacyPath)
	if err != nil || !bytes.Equal(unchanged, legacyData) {
		t.Fatal("runtime changed the legacy recovery source")
	}

	reopened, migratedAgain, err := openRuntimeStore(sqlitePath, legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if migratedAgain || reopened.items[0].Notes != "written only to SQLite" || reopened.nextID != 12 {
		t.Fatalf("runtime did not reopen the current SQLite state: migrated=%v store=%+v", migratedAgain, reopened)
	}
	backup, err := reopened.backupSnapshot()
	if err != nil || !bytes.Contains(backup, []byte("written only to SQLite")) {
		t.Fatalf("portable backup did not use current SQLite state: %s err=%v", backup, err)
	}
}

func TestRuntimeSQLiteCreateCommitsMediaActivityAndCountersTogether(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "honne.db")
	store, _, err := openRuntimeStore(path, filepath.Join(dir, "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}
	response := httptest.NewRecorder()
	application.createMedia(response, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Dune", Type: "book", Status: "planned", PlayedOnPlatforms: &[]string{},
	}))
	if response.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", response.Code, response.Body.String())
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := newSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if len(reopened.items) != 1 || reopened.items[0].Title != "Dune" || len(reopened.activities) != 1 ||
		reopened.activities[0].MediaID != reopened.items[0].ID || reopened.nextID != 2 || reopened.nextActivityID != 2 {
		t.Fatalf("related state did not commit together: %+v", reopened.snapshotLocked())
	}
}

func TestRuntimeSQLiteStoreCreatesFreshDatabaseAndCloses(t *testing.T) {
	dir := t.TempDir()
	store, migrated, err := openRuntimeStore(filepath.Join(dir, "honne.db"), filepath.Join(dir, "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	if migrated || !store.sqlite || len(store.items) != 0 || store.nextID != 1 {
		t.Fatalf("unexpected fresh runtime store: migrated=%v store=%+v", migrated, store)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	err = store.persistLocked()
	store.mu.Unlock()
	if !errors.Is(err, errStoreClosed) {
		t.Fatalf("persist after close = %v, want errStoreClosed", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("second close = %v", err)
	}
}

func TestRuntimeSQLiteWriteFailureRollsBackDomainMutation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "honne.db")
	store, _, err := openRuntimeStore(path, filepath.Join(dir, "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.db.Close(); err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}
	response := httptest.NewRecorder()
	application.createMedia(response, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Dune", Type: "book", Status: "planned",
	}))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("create = %d, want 500: %s", response.Code, response.Body.String())
	}
	if len(store.items) != 0 || len(store.activities) != 0 || len(store.syncJobs) != 0 ||
		store.nextID != 1 || store.nextJobID != 1 || store.nextActivityID != 1 {
		t.Fatalf("failed SQLite write left partial in-memory state: %+v", store.snapshotLocked())
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := newSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if len(reopened.items) != 0 || len(reopened.activities) != 0 || reopened.nextID != 1 {
		t.Fatalf("failed SQLite write changed durable state: %+v", reopened.snapshotLocked())
	}
}

func TestRuntimeSQLiteTransactionFailureLeavesDurableSnapshotUnchanged(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "honne.db")
	store, _, err := openRuntimeStore(path, filepath.Join(dir, "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	store.items = []Media{{ID: 1, Title: "Duplicate one"}, {ID: 1, Title: "Duplicate two"}}
	store.nextID = 2
	err = store.persistLocked()
	store.mu.Unlock()
	if err == nil {
		t.Fatal("invalid snapshot unexpectedly committed")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if len(reopened.items) != 0 || reopened.nextID != 1 {
		t.Fatalf("failed transaction changed durable state: %+v", reopened.snapshotLocked())
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
