package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func favoriteTestSnapshot() persistedStore {
	snapshot := persistedStore{Version: persistedStoreVersion}
	for _, mediaType := range []string{"anime", "series", "movie", "book", "manga", "light_novel", "game"} {
		for range 9 {
			id := len(snapshot.Items) + 1
			snapshot.Items = append(snapshot.Items, Media{ID: id, Title: mediaType, Type: mediaType})
			snapshot.FavoriteMediaIDs = append(snapshot.FavoriteMediaIDs, id)
		}
	}
	return snapshot
}

func TestFavoritesNinePerTypeSurviveRestartAndBackupRestore(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	snapshot := favoriteTestSnapshot()
	snapshot.FavoriteMediaIDs = nil
	seed, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", seed, http.StatusOK)
	ids := favoriteTestSnapshot().FavoriteMediaIDs
	// Interleave categories to verify that grouping does not rewrite saved order.
	ids[1], ids[10] = ids[10], ids[1]
	input, _ := json.Marshal(favoritesInput{MediaIDs: ids})
	validationSQLiteRequest(t, a, http.MethodPut, "/api/favorites", "application/json", input, http.StatusOK)
	backup := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !reflect.DeepEqual(reopened.favoriteMediaIDs, ids) {
		t.Fatalf("restart changed favorite order: %v", reopened.favoriteMediaIDs)
	}
	restored := validationSQLiteStore(t)
	validationSQLiteRequest(t, &app{store: restored}, http.MethodPost, "/api/backup/restore", "application/json", backup, http.StatusOK)
	if err := restored.Close(); err != nil {
		t.Fatal(err)
	}
	verified, err := newSQLiteStore(restored.path)
	if err != nil {
		t.Fatal(err)
	}
	defer verified.Close()
	got, err := verified.backupSnapshot()
	if err != nil || !bytes.Equal(got, backup) {
		t.Fatalf("restored favorites changed: %v", err)
	}
}

func TestFavoritesRejectTenthOfOneTypeWithoutChangingSnapshot(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	snapshot := favoriteTestSnapshot()
	snapshot.Items = append(snapshot.Items, Media{ID: 64, Title: "Tenth anime", Type: "anime"})
	seed, _ := json.Marshal(snapshot)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", seed, http.StatusOK)
	before := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	ids := append(append([]int{}, snapshot.FavoriteMediaIDs[:9]...), 64)
	input, _ := json.Marshal(favoritesInput{MediaIDs: ids})
	response := validationSQLiteRequest(t, a, http.MethodPut, "/api/favorites", "application/json", input, http.StatusUnprocessableEntity)
	if !strings.Contains(string(response), "9 titles per media type") {
		t.Fatalf("missing actionable limit: %s", response)
	}
	snapshot.FavoriteMediaIDs = ids
	invalidBackup, _ := json.Marshal(snapshot)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/preview", "application/json", invalidBackup, http.StatusUnprocessableEntity)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", invalidBackup, http.StatusUnprocessableEntity)
	after := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	if !bytes.Equal(before, after) {
		t.Fatal("invalid selection changed persisted favorites")
	}
}

func createSchemaThreeFavorites(t *testing.T, conflict bool) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "schema-three.db")
	db, err := openSQLiteDatabase(path, "rwc")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	oldSchema := strings.NewReplacer("BETWEEN 1 AND 9", "BETWEEN 1 AND 8", "BETWEEN 0 AND 62", "BETWEEN 0 AND 8", "user_version = 4", "user_version = 3").Replace(sqliteSchema)
	if _, err := db.Exec(oldSchema); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(Media{ID: 7, Title: "Preserved", Type: "book", PlayedOnPlatforms: []string{}, CatalogPlatforms: []string{}})
	if _, err := db.Exec("INSERT INTO store_meta VALUES (1, 8, 8, 1, 1); INSERT INTO media VALUES (7, 0, ?); INSERT INTO favorites VALUES (7, 0); INSERT INTO library_appearance (singleton) VALUES (1)", string(payload)); err != nil {
		t.Fatal(err)
	}
	if conflict {
		if _, err := db.Exec("CREATE TABLE favorites_v3 (preserved TEXT)"); err != nil {
			t.Fatal(err)
		}
	}
	return path
}

func TestFavoritesSchemaThreeMigrationPreservesSelection(t *testing.T) {
	path := createSchemaThreeFavorites(t, false)
	s, err := newSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if !reflect.DeepEqual(s.favoriteMediaIDs, []int{7}) || s.items[0].Title != "Preserved" || s.nextID != 8 {
		t.Fatal("schema migration changed Library data")
	}
	if err := s.replaceFavorites([]int{7}); err != nil {
		t.Fatal(err)
	}
	var schema, version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow("SELECT json_version FROM store_meta").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if schema != 4 || version != 9 {
		t.Fatalf("versions = schema %d, JSON %d", schema, version)
	}
}

func TestFavoritesSchemaMigrationFailureKeepsVersionAndOriginalTables(t *testing.T) {
	path := createSchemaThreeFavorites(t, true)
	if err := migrateSQLiteSchema(path); err == nil {
		t.Fatal("conflicting table unexpectedly migrated")
	}
	db, err := openSQLiteDatabase(path, "ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var schema, version, mediaID, temporary int
	if err := db.QueryRow("PRAGMA user_version").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT json_version FROM store_meta").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT media_id FROM favorites WHERE position = 0").Scan(&mediaID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name = 'store_meta_v3'").Scan(&temporary); err != nil {
		t.Fatal(err)
	}
	if schema != 3 || version != 8 || mediaID != 7 || temporary != 0 {
		t.Fatal("failed migration left partial changes")
	}
	if err := verifySQLiteIntegrity(db); err != nil {
		t.Fatal(err)
	}
}
