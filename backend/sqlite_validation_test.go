package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func validationSQLiteStore(t *testing.T) *store {
	t.Helper()
	dir := t.TempDir()
	s, _, err := openRuntimeStore(filepath.Join(dir, "honne.db"), filepath.Join(dir, "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	return s
}

func validationSQLiteRequest(t *testing.T, a *app, method, path, contentType string, body []byte, want int) []byte {
	t.Helper()
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	r.Header.Set("Content-Type", contentType)
	if path == "/api/backup/restore" {
		r.Header.Set(restoreConfirmationHeader, "replace")
	}
	w := httptest.NewRecorder()
	applicationHandler(a, config{}).ServeHTTP(w, r)
	if w.Code != want {
		t.Fatalf("%s %s = %d, want %d: %s", method, path, w.Code, want, w.Body.String())
	}
	return w.Body.Bytes()
}

func TestSQLiteBackupRestoresCustomizationAndQueueAcrossRestart(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s, anilist: &aniListSync{store: s}}
	seed := []byte(`{"version":8,"items":[{"id":7,"title":"Synthetic book","type":"book","status":"planned"},{"id":8,"title":"Synthetic game","type":"game","status":"completed"}],"syncJobs":[{"id":12,"mediaId":91,"operation":"delete","aniListUserId":42,"generation":3}],"activities":[{"id":15,"mediaId":120,"title":"Deleted title"}],"nextId":121,"nextJobId":13,"nextActivityId":16}`)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", seed, http.StatusOK)
	before := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{1}, 32)...)
	validationSQLiteRequest(t, a, http.MethodPut, "/api/profile/banner", "image/png", png, http.StatusOK)
	validationSQLiteRequest(t, a, http.MethodPut, "/api/profile/avatar", "image/png", png, http.StatusOK)
	validationSQLiteRequest(t, a, http.MethodPut, "/api/favorites", "application/json", []byte(`{"mediaIds":[8,7]}`), http.StatusOK)
	after := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	if bytes.Equal(before, after) {
		t.Fatal("customization did not change the backup")
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
	if err != nil || !bytes.Equal(got, after) {
		t.Fatalf("restart changed the customized backup: %v", err)
	}

	for name, backup := range map[string][]byte{"before": before, "after": after} {
		t.Run(name, func(t *testing.T) {
			restored := validationSQLiteStore(t)
			application := &app{store: restored, anilist: &aniListSync{store: restored}}
			validationSQLiteRequest(t, application, http.MethodPost, "/api/backup/preview", "application/json", backup, http.StatusOK)
			validationSQLiteRequest(t, application, http.MethodPost, "/api/backup/restore", "application/json", backup, http.StatusOK)
			if err := restored.Close(); err != nil {
				t.Fatal(err)
			}
			verify, err := newSQLiteStore(restored.path)
			if err != nil {
				t.Fatal(err)
			}
			defer verify.Close()
			got, err := verify.backupSnapshot()
			if err != nil || !bytes.Equal(got, backup) {
				t.Fatalf("restored snapshot changed after restart: %v", err)
			}
		})
	}
}

func TestSQLiteLateWriteFailureRollsBackCompleteSnapshot(t *testing.T) {
	s := validationSQLiteStore(t)
	a := &app{store: s, anilist: &aniListSync{store: s}}
	seed := []byte(`{"version":8,"items":[{"id":7,"title":"Keep me","type":"book","status":"planned"}],"syncJobs":[{"id":12,"mediaId":91,"operation":"delete","aniListUserId":42,"generation":3}],"activities":[{"id":15,"mediaId":120,"title":"Deleted title"}],"favoriteMediaIds":[7],"nextId":121,"nextJobId":13,"nextActivityId":16}`)
	validationSQLiteRequest(t, a, http.MethodPost, "/api/backup/restore", "application/json", seed, http.StatusOK)
	before := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
	// Appearance is inserted last, after every other durable table was replaced.
	if _, err := s.db.Exec(`CREATE TRIGGER reject_appearance BEFORE INSERT ON library_appearance BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END`); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []struct{ method, path, contentType, body string }{
		{http.MethodPost, "/api/backup/restore", "application/json", `{"version":8,"items":[]}`},
		{http.MethodDelete, "/api/media/7", "", ""},
		{http.MethodPut, "/api/favorites", "application/json", `{"mediaIds":[]}`},
	} {
		validationSQLiteRequest(t, a, operation.method, operation.path, operation.contentType, []byte(operation.body), http.StatusInternalServerError)
		got := validationSQLiteRequest(t, a, http.MethodGet, "/api/backup", "", nil, http.StatusOK)
		if !bytes.Equal(got, before) {
			t.Fatalf("%s %s left partial in-memory state", operation.method, operation.path)
		}
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
	if err != nil || !bytes.Equal(got, before) {
		t.Fatalf("failed transactions changed the durable snapshot: %v", err)
	}
}

func TestSQLiteFailedSchemaUpgradeRollsBackDDLAndVersion(t *testing.T) {
	s := validationSQLiteStore(t)
	// Simulate a damaged v2 schema with a conflicting avatar column. Migration
	// must undo earlier DDL rather than leave renamed metadata or a newer version.
	if _, err := s.db.Exec("UPDATE store_meta SET json_version = 7; PRAGMA user_version = 2"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := migrateSQLiteSchema(s.path); err == nil {
		t.Fatal("conflicting schema unexpectedly upgraded")
	}
	db, err := openSQLiteDatabase(s.path, "ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version, jsonVersion, renamedTables int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT json_version FROM store_meta").Scan(&jsonVersion); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name = 'store_meta_v2'").Scan(&renamedTables); err != nil {
		t.Fatal(err)
	}
	if version != 2 || jsonVersion != 7 || renamedTables != 0 {
		t.Fatalf("failed migration left partial DDL: schema=%d JSON=%d renamed=%d", version, jsonVersion, renamedTables)
	}
	if err := verifySQLiteIntegrity(db); err != nil {
		t.Fatal(err)
	}
}

func TestSQLiteRuntimeMigratesEverySupportedJSONVersion(t *testing.T) {
	for version := 0; version <= persistedStoreVersion; version++ {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			dir := t.TempDir()
			source, destination := filepath.Join(dir, "media.json"), filepath.Join(dir, "honne.db")
			items := `[{"id":7,"title":"Preserved","type":"book","notes":"keep this"}]`
			data := []byte(items)
			if version > 0 {
				data = []byte(fmt.Sprintf(`{"version":%d,"items":%s}`, version, items))
			}
			if err := os.WriteFile(source, data, 0o600); err != nil {
				t.Fatal(err)
			}
			s, migrated, err := openRuntimeStore(destination, source)
			if err != nil {
				t.Fatal(err)
			}
			if !migrated {
				t.Fatal("source was not migrated")
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, migratedAgain, err := openRuntimeStore(destination, source)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if migratedAgain || len(reopened.items) != 1 || reopened.items[0].ID != 7 || reopened.items[0].Notes != "keep this" || reopened.nextID != 8 {
				t.Fatal("migration lost data or repeated on restart")
			}
			unchanged, err := os.ReadFile(source)
			if err != nil || !bytes.Equal(unchanged, data) {
				t.Fatal("migration changed its recovery source")
			}
		})
	}
}
