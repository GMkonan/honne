package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"reflect"
	"testing"
)

func seedTopNineLibrary(t *testing.T, a *app, count int) []int {
	t.Helper()
	snapshot := persistedStore{Version: persistedStoreVersion}
	ids := []int{}
	for id := 1; id <= count; id++ {
		snapshot.Items = append(snapshot.Items, Media{ID: id, Title: fmt.Sprintf("Anime %d", id), Type: "anime"})
		ids = append(ids, id)
	}
	data, _ := json.Marshal(snapshot)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", data, http.StatusOK)
	return ids
}

func putSelection(t *testing.T, a *app, path string, ids []int, status int) {
	t.Helper()
	data, _ := json.Marshal(favoritesInput{MediaIDs: ids})
	validationSQLiteRequest(t, a, http.MethodPut, path, "application/json", data, status)
}

func TestUnlimitedFavoritesAndIndependentTopNineSurviveRestartAndRestore(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	ids := seedTopNineLibrary(t, a, 100)
	putSelection(t, a, "/api/favorites", ids, http.StatusOK)
	if len(s.topNineMediaIDs) != 0 {
		t.Fatal("favoriting automatically selected top nine")
	}
	putSelection(t, a, "/api/top-nine", []int{9, 3, 1}, http.StatusOK)
	if !reflect.DeepEqual(s.favoriteMediaIDs, ids) {
		t.Fatal("3×3 selection reordered favorites")
	}
	backup := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !reflect.DeepEqual(reopened.favoriteMediaIDs, ids) || !reflect.DeepEqual(reopened.topNineMediaIDs, []int{9, 3, 1}) {
		t.Fatal("restart changed independent selections")
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
		t.Fatalf("backup restore lost selections: %v", err)
	}
}

func TestTopNineRejectsInvalidSelectionsAndBackupsAtomically(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	ids := seedTopNineLibrary(t, a, 12)
	putSelection(t, a, "/api/favorites", ids[:11], http.StatusOK)
	putSelection(t, a, "/api/top-nine", []int{2, 1}, http.StatusOK)
	before := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	for _, invalid := range [][]int{ids[:10], {1, 1}, {12}, {1000}, {-1}} {
		putSelection(t, a, "/api/top-nine", invalid, http.StatusUnprocessableEntity)
		var snapshot persistedStore
		if err := json.Unmarshal(before, &snapshot); err != nil {
			t.Fatal(err)
		}
		snapshot.TopNineMediaIDs = invalid
		data, _ := json.Marshal(snapshot)
		validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/preview", "application/json", data, http.StatusUnprocessableEntity)
		validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", data, http.StatusUnprocessableEntity)
	}
	for _, path := range []string{"/api/favorites", "/api/top-nine"} {
		for _, malformed := range []string{`{"mediaIds":[1],"unknown":true}`, `{"mediaIds":[1]} {}`, `{"mediaIds":["1"]}`} {
			validationSQLiteRequest(t, a, http.MethodPut, path, "application/json", []byte(malformed), http.StatusBadRequest)
		}
	}
	after := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	if !bytes.Equal(before, after) {
		t.Fatal("invalid requests changed durable state")
	}
}

func TestFavoriteRemovalAndMediaDeletionCleanTopNine(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	ids := seedTopNineLibrary(t, a, 12)
	putSelection(t, a, "/api/favorites", ids, http.StatusOK)
	putSelection(t, a, "/api/top-nine", []int{3, 1, 2}, http.StatusOK)
	putSelection(t, a, "/api/favorites", []int{2, 3}, http.StatusOK)
	if !reflect.DeepEqual(s.topNineMediaIDs, []int{3, 2}) {
		t.Fatal("favorite removal did not prune top nine while preserving its order")
	}
	validationSQLiteRequest(t, a, http.MethodDelete, "/api/media/3", "", nil, http.StatusNoContent)
	if !reflect.DeepEqual(s.topNineMediaIDs, []int{2}) || !reflect.DeepEqual(s.favoriteMediaIDs, []int{2}) {
		t.Fatal("media deletion did not clean both selections")
	}
	putSelection(t, a, "/api/top-nine", []int{}, http.StatusOK)
	backup := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", backup, http.StatusOK)
	if len(s.topNineMediaIDs) != 0 || len(s.favoriteMediaIDs) != 1 {
		t.Fatal("empty current top nine was repopulated from favorites")
	}
}

func TestSelectionWriteFailuresRollBackBothMemoryAndSQLite(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	ids := seedTopNineLibrary(t, a, 3)
	putSelection(t, a, "/api/favorites", ids, http.StatusOK)
	putSelection(t, a, "/api/top-nine", []int{3, 1}, http.StatusOK)
	before := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	if _, err := s.db.Exec(`CREATE TRIGGER reject_selection_write BEFORE INSERT ON library_appearance BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`); err != nil {
		t.Fatal(err)
	}
	putSelection(t, a, "/api/favorites", []int{2}, http.StatusInternalServerError)
	putSelection(t, a, "/api/top-nine", []int{2}, http.StatusInternalServerError)
	validationSQLiteRequest(t, a, http.MethodDelete, "/api/media/3", "", nil, http.StatusInternalServerError)
	after := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	if !bytes.Equal(before, after) {
		t.Fatal("failed writes changed in-memory state")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	got, err := reopened.backupSnapshot()
	if err != nil || !bytes.Equal(before, got) {
		t.Fatalf("failed writes changed durable state: %v", err)
	}
}

func TestSchemaFourSeparatesExistingFavoritesAndRollsBackFailedDDL(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		t.Run(fmt.Sprint(conflict), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "honne.db")
			db, err := openSQLiteDatabase(path, "rwc")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(legacyFavoritesSchema(4)); err != nil {
				t.Fatal(err)
			}
			payload, _ := json.Marshal(Media{ID: 7, Title: "Preserved", Type: "book", PlayedOnPlatforms: []string{}, CatalogPlatforms: []string{}})
			if _, err := db.Exec("INSERT INTO store_meta VALUES (1, 9, 8, 1, 1); INSERT INTO media VALUES (7, 0, ?); INSERT INTO favorites VALUES (7, 0); INSERT INTO library_appearance (singleton) VALUES (1)", string(payload)); err != nil {
				t.Fatal(err)
			}
			if conflict {
				if _, err := db.Exec("CREATE TABLE top_nine (preserved TEXT)"); err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			s, err := newSQLiteStore(path)
			if !conflict {
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				if !reflect.DeepEqual(s.favoriteMediaIDs, []int{7}) || !reflect.DeepEqual(s.topNineMediaIDs, []int{7}) || s.nextID != 8 {
					t.Fatal("upgrade changed existing selection or counters")
				}
				return
			}
			if err == nil {
				s.Close()
				t.Fatal("conflicting table unexpectedly migrated")
			}
			db, err = openSQLiteDatabase(path, "ro")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			var schema, version, id, renamed int
			if err := db.QueryRow("PRAGMA user_version").Scan(&schema); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT json_version FROM store_meta").Scan(&version); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT media_id FROM favorites WHERE position = 0").Scan(&id); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name IN ('favorites_v4', 'store_meta_v4')").Scan(&renamed); err != nil {
				t.Fatal(err)
			}
			if schema != 4 || version != 9 || id != 7 || renamed != 0 {
				t.Fatal("failed schema-4 upgrade left partial changes")
			}
		})
	}
}

func TestLegacyJSONInitializesTopNineWithoutChangingFavorites(t *testing.T) {
	for version := 7; version <= 10; version++ {
		data := []byte(fmt.Sprintf(`{"version":%d,"items":[{"id":7,"title":"Preserved","type":"book"}],"favoriteMediaIds":[7]}`, version))
		snapshot, err := decodeSQLiteImport(data)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(snapshot.FavoriteMediaIDs, []int{7}) || (version < 10 && !reflect.DeepEqual(snapshot.TopNineMediaIDs, []int{7})) || (version == 10 && len(snapshot.TopNineMediaIDs) != 0) {
			t.Fatalf("legacy initialization lost state for version %d", version)
		}
	}
}
