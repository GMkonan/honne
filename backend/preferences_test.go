package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func preferenceRequest(t *testing.T, a *app, page string, status int) []byte {
	t.Helper()
	body, err := json.Marshal(appPreferences{StartPage: page})
	if err != nil {
		t.Fatal(err)
	}
	return validationSQLiteRequest(t, a, http.MethodPut, "/api/preferences", "application/json", body, status)
}

func TestPreferencesPersistAcrossClientsRestartAndBackupRestore(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	seed := []byte(`{"version":10,"items":[{"id":7,"title":"Preserved","type":"book","notes":"Keep notes"}],"favoriteMediaIds":[7],"topNineMediaIds":[7],"syncJobs":[{"id":12,"mediaId":91,"operation":"delete","aniListUserId":42,"generation":3}],"activities":[{"id":15,"mediaId":120,"title":"Deleted"}],"nextId":121,"nextJobId":13,"nextActivityId":16}`)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", seed, http.StatusOK)
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{1}, 32)...)
	validationSQLiteRequest(t, a, http.MethodPut, "/api/profile/banner", "image/png", png, http.StatusOK)
	validationSQLiteRequest(t, a, http.MethodPut, "/api/profile/avatar", "image/png", png, http.StatusOK)
	before := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	var original persistedStore
	if err := json.Unmarshal(before, &original); err != nil {
		t.Fatal(err)
	}
	if s.getPreferences() != defaultPreferences() {
		t.Fatal("existing installation did not default to Overview")
	}
	for _, page := range []string{"library", "monthly_log", "activity", "overview", "library"} {
		preferenceRequest(t, a, page, http.StatusOK)
		// Each request is independent: no cookie or browser storage supplies the choice.
		got := validationSQLiteRequest(t, a, http.MethodGet, "/api/preferences", "", nil, http.StatusOK)
		var preferences appPreferences
		if err := json.Unmarshal(got, &preferences); err != nil || preferences.StartPage != page {
			t.Fatalf("another client received %s, err=%v", got, err)
		}
	}
	backup := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	var after persistedStore
	if err := json.Unmarshal(backup, &after); err != nil {
		t.Fatal(err)
	}
	original.Preferences = &appPreferences{StartPage: "library"}
	if !reflect.DeepEqual(original, after) {
		t.Fatal("saving a preference changed unrelated collection state")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.getPreferences().StartPage != "library" {
		t.Fatal("start page did not survive restart")
	}
	restored := validationSQLiteStore(t)
	application := &app{store: restored}
	validationSQLiteRequest(t, application, http.MethodPost, "/api/backup/preview", "application/json", backup, http.StatusOK)
	validationSQLiteRequest(t, application, http.MethodPost, "/api/backup/restore", "application/json", backup, http.StatusOK)
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
		t.Fatalf("restored snapshot changed after restart: %v", err)
	}
	validationSQLiteRequest(t, &app{store: verified}, http.MethodPost, "/api/backup/restore", "application/json", seed, http.StatusOK)
	if verified.getPreferences() != defaultPreferences() {
		t.Fatal("restoring an older backup retained a newer preference")
	}
}

func TestPreferencesRejectInvalidRequestsAndBackupsWithoutMutation(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	preferenceRequest(t, a, "library", http.StatusOK)
	before, err := s.backupSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	for _, page := range []string{"", "settings", "favorites", "search", "detail", "#library/list", "https://example.com", "Library"} {
		preferenceRequest(t, a, page, http.StatusUnprocessableEntity)
		if err := s.replacePreferences(appPreferences{StartPage: page}); !errors.Is(err, errInvalidStartPage) {
			t.Fatalf("store accepted invalid preference %q: %v", page, err)
		}
	}
	for _, body := range []string{`{`, `{"startPage":1}`, `{"startPage":"library","unknown":true}`, `{"startPage":"library"} {}`, strings.Repeat(" ", 1024) + `{}`} {
		validationSQLiteRequest(t, a, http.MethodPut, "/api/preferences", "application/json", []byte(body), http.StatusBadRequest)
	}
	for _, body := range []string{`{}`, `null`} {
		validationSQLiteRequest(t, a, http.MethodPut, "/api/preferences", "application/json", []byte(body), http.StatusUnprocessableEntity)
	}
	for _, backup := range []string{
		`{"version":11,"preferences":{"startPage":"settings"}}`,
		`{"version":11,"preferences":{}}`,
		`{"version":11,"preferences":{"startPage":"library","unknown":true}}`,
		`{"version":10,"preferences":{"startPage":"library"}}`,
	} {
		for _, path := range []string{"/api/backup/preview", "/api/backup/restore"} {
			validationSQLiteRequest(t, a, http.MethodPost, path, "application/json", []byte(backup), http.StatusUnprocessableEntity)
		}
	}
	after, err := s.backupSnapshot()
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("invalid input changed state: %v", err)
	}
}

func TestPreferencesFailedWriteAndRestoreRollBackMemoryAndSQLite(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s}
	preferenceRequest(t, a, "activity", http.StatusOK)
	before, err := s.backupSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_preferences_write BEFORE INSERT ON library_appearance BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`); err != nil {
		t.Fatal(err)
	}
	preferenceRequest(t, a, "library", http.StatusInternalServerError)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", []byte(`{"version":11,"preferences":{"startPage":"monthly_log"}}`), http.StatusInternalServerError)
	after, err := s.backupSnapshot()
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("failed write changed in-memory state: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	after, err = reopened.backupSnapshot()
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("failed write changed durable state: %v", err)
	}
}

func schemaFivePreferencesFixture(t *testing.T, conflict bool) (string, []byte) {
	t.Helper()
	s := validationSQLiteStore(t)
	a := &app{store: s}
	seedTopNineLibrary(t, a, 3)
	putSelection(t, a, "/api/favorites", []int{3, 1, 2}, http.StatusOK)
	putSelection(t, a, "/api/top-nine", []int{2, 3}, http.StatusOK)
	before, err := s.backupSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := openSQLiteDatabase(s.path, "rw")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
		DROP TABLE app_preferences;
		ALTER TABLE store_meta RENAME TO current_meta;
		CREATE TABLE store_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), json_version INTEGER NOT NULL CHECK (json_version BETWEEN 1 AND 10), next_media_id INTEGER NOT NULL CHECK (next_media_id > 0), next_job_id INTEGER NOT NULL CHECK (next_job_id > 0), next_activity_id INTEGER NOT NULL CHECK (next_activity_id > 0));
		INSERT INTO store_meta SELECT singleton, 10, next_media_id, next_job_id, next_activity_id FROM current_meta;
		DROP TABLE current_meta;
		PRAGMA user_version = 5;
	`); err != nil {
		t.Fatal(err)
	}
	if conflict {
		if _, err := db.Exec("CREATE TABLE app_preferences (preserved TEXT); INSERT INTO app_preferences VALUES ('keep')"); err != nil {
			t.Fatal(err)
		}
	}
	return s.path, before
}

func TestPreferencesSchemaFiveUpgradePreservesSnapshot(t *testing.T) {
	path, before := schemaFivePreferencesFixture(t, false)
	s, err := newSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	after, err := s.backupSnapshot()
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("upgrade changed previous data or default: %v", err)
	}
	preferenceRequest(t, &app{store: s}, "library", http.StatusOK)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.getPreferences().StartPage != "library" {
		t.Fatal("new preference did not survive upgraded database restart")
	}
}

func TestPreferencesFailedSchemaUpgradePreservesOldSchema(t *testing.T) {
	path, _ := schemaFivePreferencesFixture(t, true)
	if err := migrateSQLiteSchema(path); err == nil {
		t.Fatal("conflicting preferences table unexpectedly migrated")
	}
	db, err := openSQLiteDatabase(path, "ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var schema, version, counter, temporary, favorite, topNine int
	for query, target := range map[string]*int{
		"PRAGMA user_version":                                             &schema,
		"SELECT json_version FROM store_meta":                             &version,
		"SELECT next_media_id FROM store_meta":                            &counter,
		"SELECT count(*) FROM sqlite_master WHERE name = 'store_meta_v5'": &temporary,
		"SELECT media_id FROM favorites WHERE position = 0":               &favorite,
		"SELECT media_id FROM top_nine WHERE position = 0":                &topNine,
	} {
		if err := db.QueryRow(query).Scan(target); err != nil {
			t.Fatal(err)
		}
	}
	var preserved string
	if err := db.QueryRow("SELECT preserved FROM app_preferences").Scan(&preserved); err != nil {
		t.Fatal(err)
	}
	if schema != 5 || version != 10 || counter != 4 || temporary != 0 || favorite != 3 || topNine != 2 || preserved != "keep" {
		t.Fatal("failed migration left partial DDL, metadata, or selection changes")
	}
	if err := verifySQLiteIntegrity(db); err != nil {
		t.Fatal(err)
	}
}

func TestPreferencesConcurrentReadsAndWritesRemainDurable(t *testing.T) {
	s := validationSQLiteStore(t)
	handler := applicationHandler(&app{store: s}, config{})
	var workers sync.WaitGroup
	failures := make(chan error, 12)
	for _, page := range []string{"overview", "library", "monthly_log", "activity"} {
		workers.Go(func() {
			for range 3 {
				w := httptest.NewRecorder()
				r := httptest.NewRequest(http.MethodPut, "/api/preferences", strings.NewReader(fmt.Sprintf(`{"startPage":%q}`, page)))
				handler.ServeHTTP(w, r)
				if w.Code != http.StatusOK || !validStartPage(s.getPreferences().StartPage) {
					failures <- fmt.Errorf("concurrent %s write failed: %d", page, w.Code)
				}
			}
		})
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	before, err := s.backupSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newSQLiteStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	after, err := reopened.backupSnapshot()
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("concurrent writes did not survive restart: %v", err)
	}
}

func TestPreferencesUseExistingAuthenticationAndDisableCaching(t *testing.T) {
	s := validationSQLiteStore(t)
	handler := applicationHandler(&app{store: s}, config{AppUsername: "owner", AppPassword: "test-password"})
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		for _, authenticated := range []bool{false, true} {
			r := httptest.NewRequest(method, "/api/preferences", strings.NewReader(`{"startPage":"library"}`))
			want := http.StatusUnauthorized
			if authenticated {
				r.SetBasicAuth("owner", "test-password")
				want = http.StatusOK
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != want || authenticated && w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%s authenticated=%v: status=%d cache=%s", method, authenticated, w.Code, w.Header().Get("Cache-Control"))
			}
		}
	}
}

func TestPreferencesJSONCompatibilityAndValidation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	if err := os.WriteFile(path, []byte(`{"version":10,"items":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := newStore(path)
	if err != nil || s.getPreferences() != defaultPreferences() {
		t.Fatalf("legacy JSON did not default to Overview: %v", err)
	}
	if err := s.replacePreferences(appPreferences{StartPage: "library"}); err != nil {
		t.Fatal(err)
	}
	reopened, err := newStore(path)
	if err != nil || reopened.getPreferences().StartPage != "library" {
		t.Fatalf("JSON preference did not survive restart: %v", err)
	}
	for _, data := range []string{
		`{"version":11,"preferences":{"startPage":"settings"}}`,
		`{"version":10,"preferences":{"startPage":"library"}}`,
	} {
		if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := newStore(path); err == nil {
			t.Fatalf("invalid JSON preference accepted: %s", data)
		}
	}
}
