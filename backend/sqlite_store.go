package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	_ "modernc.org/sqlite"
)

const sqliteSchemaVersion = 6

// openRuntimeStore opens the operational SQLite store. On the first start it
// migrates a non-empty legacy JSON snapshot without changing that source. A
// missing or empty source creates a fresh database.
func openRuntimeStore(sqlitePath, legacyJSONPath string) (*store, bool, error) {
	sqlitePath = filepath.Clean(sqlitePath)
	legacyJSONPath = filepath.Clean(legacyJSONPath)
	if sqlitePath == legacyJSONPath {
		return nil, false, errors.New("SQLite and legacy JSON paths must differ")
	}
	if info, err := os.Lstat(sqlitePath); err == nil {
		if !info.Mode().IsRegular() {
			return nil, false, errors.New("SQLite store path must be a regular file")
		}
		s, err := newSQLiteStore(sqlitePath)
		return s, false, err
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, false, fmt.Errorf("inspect SQLite store: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(sqlitePath), 0o755); err != nil {
		return nil, false, fmt.Errorf("create SQLite store directory: %w", err)
	}
	migrated := false
	if info, err := os.Stat(legacyJSONPath); err == nil && info.Size() > 0 {
		if !info.Mode().IsRegular() {
			return nil, false, errors.New("legacy JSON store path must be a regular file")
		}
		if err := migrateJSONToSQLite(legacyJSONPath, sqlitePath); err != nil {
			return nil, false, fmt.Errorf("migrate legacy JSON store: %w", err)
		}
		migrated = true
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, false, fmt.Errorf("inspect legacy JSON store: %w", err)
	} else if err := createEmptySQLiteDatabase(sqlitePath); err != nil {
		return nil, false, err
	}

	s, err := newSQLiteStore(sqlitePath)
	if err != nil {
		return nil, false, err
	}
	return s, migrated, nil
}

func createEmptySQLiteDatabase(path string) (err error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("exclusively create SQLite store: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("close new SQLite store: %w", err)
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.Remove(path)
			_ = os.Remove(path + "-journal")
		}
	}()
	db, err := openSQLiteDatabase(path, "rw")
	if err != nil {
		return err
	}
	defer func() {
		if db == nil {
			return
		}
		if closeErr := db.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	if err := configureSQLiteImport(db); err != nil {
		return err
	}
	empty := persistedStore{
		Version: persistedStoreVersion, Items: []Media{}, SyncJobs: []syncJob{}, Activities: []Activity{},
		NextID: 1, NextJobID: 1, NextActivityID: 1,
	}
	if err := writeSQLiteSnapshot(db, empty); err != nil {
		return err
	}
	if err := verifySQLiteIntegrity(db); err != nil {
		return err
	}
	if err := db.Close(); err != nil {
		return fmt.Errorf("close new SQLite store: %w", err)
	}
	db = nil
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("restrict SQLite store permissions: %w", err)
	}
	if err := syncFileParent(path); err != nil {
		return err
	}
	complete = true
	return nil
}

func newSQLiteStore(path string) (*store, error) {
	if err := migrateSQLiteSchema(path); err != nil {
		return nil, err
	}
	snapshot, err := loadSQLiteSnapshot(path)
	if err != nil {
		return nil, err
	}
	db, err := openSQLiteDatabase(path, "rw")
	if err != nil {
		return nil, err
	}
	if err := configureSQLiteRuntime(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("restrict SQLite store permissions: %w", err)
	}
	s := emptyStore(path)
	s.sqlite = true
	s.db = db
	s.loadSnapshot(snapshot)
	s.normalizeLoadedState()
	return s, nil
}

func migrateSQLiteSchema(path string) error {
	db, err := openSQLiteDatabase(path, "rw")
	if err != nil {
		return err
	}
	defer db.Close()
	if err := configureSQLiteRuntime(db); err != nil {
		return err
	}
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read SQLite schema version: %w", err)
	}
	if version < 1 || version > sqliteSchemaVersion {
		return fmt.Errorf("unsupported SQLite schema version %d", version)
	}
	if version == 1 {
		if err := applySQLiteMigration(db, []string{
			"ALTER TABLE store_meta RENAME TO store_meta_v1",
			"CREATE TABLE store_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), json_version INTEGER NOT NULL CHECK (json_version BETWEEN 1 AND 7), next_media_id INTEGER NOT NULL CHECK (next_media_id > 0), next_job_id INTEGER NOT NULL CHECK (next_job_id > 0), next_activity_id INTEGER NOT NULL CHECK (next_activity_id > 0))",
			"INSERT INTO store_meta SELECT singleton, json_version, next_media_id, next_job_id, next_activity_id FROM store_meta_v1",
			"DROP TABLE store_meta_v1",
			"CREATE TABLE favorites (media_id INTEGER PRIMARY KEY CHECK (media_id > 0), position INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 0 AND 8), FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT)",
			"CREATE TABLE library_appearance (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), banner_content_type TEXT NOT NULL DEFAULT '' CHECK (banner_content_type IN ('', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')), banner_data BLOB NOT NULL DEFAULT X'' CHECK (length(banner_data) <= 8388608), CHECK ((banner_content_type = '') = (length(banner_data) = 0)))",
			"INSERT INTO library_appearance (singleton, banner_content_type, banner_data) VALUES (1, '', X'')",
			"PRAGMA user_version = 2",
		}); err != nil {
			return err
		}
		version = 2
	}
	if version == 2 {
		if err := applySQLiteMigration(db, []string{
			"ALTER TABLE store_meta RENAME TO store_meta_v2",
			"CREATE TABLE store_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), json_version INTEGER NOT NULL CHECK (json_version BETWEEN 1 AND 8), next_media_id INTEGER NOT NULL CHECK (next_media_id > 0), next_job_id INTEGER NOT NULL CHECK (next_job_id > 0), next_activity_id INTEGER NOT NULL CHECK (next_activity_id > 0))",
			"INSERT INTO store_meta SELECT singleton, json_version, next_media_id, next_job_id, next_activity_id FROM store_meta_v2",
			"DROP TABLE store_meta_v2",
			"ALTER TABLE library_appearance ADD COLUMN avatar_content_type TEXT NOT NULL DEFAULT '' CHECK (avatar_content_type IN ('', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'))",
			"ALTER TABLE library_appearance ADD COLUMN avatar_data BLOB NOT NULL DEFAULT X'' CHECK (length(avatar_data) <= 4194304)",
			"PRAGMA user_version = 3",
		}); err != nil {
			return err
		}
		version = 3
	}
	if version == 3 {
		if err := applySQLiteMigration(db, []string{
			"ALTER TABLE store_meta RENAME TO store_meta_v3",
			"CREATE TABLE store_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), json_version INTEGER NOT NULL CHECK (json_version BETWEEN 1 AND 9), next_media_id INTEGER NOT NULL CHECK (next_media_id > 0), next_job_id INTEGER NOT NULL CHECK (next_job_id > 0), next_activity_id INTEGER NOT NULL CHECK (next_activity_id > 0))",
			"INSERT INTO store_meta SELECT singleton, json_version, next_media_id, next_job_id, next_activity_id FROM store_meta_v3",
			"DROP TABLE store_meta_v3",
			"ALTER TABLE favorites RENAME TO favorites_v3",
			"CREATE TABLE favorites (media_id INTEGER PRIMARY KEY CHECK (media_id > 0), position INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 0 AND 62), FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT)",
			"INSERT INTO favorites SELECT media_id, position FROM favorites_v3",
			"DROP TABLE favorites_v3",
			"PRAGMA user_version = 4",
		}); err != nil {
			return err
		}
		version = 4
	}
	if version == 4 {
		if err := applySQLiteMigration(db, []string{
			"ALTER TABLE store_meta RENAME TO store_meta_v4",
			"CREATE TABLE store_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), json_version INTEGER NOT NULL CHECK (json_version BETWEEN 1 AND 10), next_media_id INTEGER NOT NULL CHECK (next_media_id > 0), next_job_id INTEGER NOT NULL CHECK (next_job_id > 0), next_activity_id INTEGER NOT NULL CHECK (next_activity_id > 0))",
			"INSERT INTO store_meta SELECT singleton, 10, next_media_id, next_job_id, next_activity_id FROM store_meta_v4",
			"DROP TABLE store_meta_v4",
			"ALTER TABLE favorites RENAME TO favorites_v4",
			"CREATE TABLE favorites (media_id INTEGER PRIMARY KEY CHECK (media_id > 0), position INTEGER NOT NULL UNIQUE CHECK (position >= 0), FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT)",
			"INSERT INTO favorites SELECT media_id, position FROM favorites_v4",
			"DROP TABLE favorites_v4",
			"CREATE TABLE top_nine (media_id INTEGER PRIMARY KEY CHECK (media_id > 0), position INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 0 AND 62), FOREIGN KEY (media_id) REFERENCES favorites(media_id) ON DELETE RESTRICT)",
			"INSERT INTO top_nine SELECT media_id, position FROM favorites",
			"PRAGMA user_version = 5",
		}); err != nil {
			return err
		}
		version = 5
	}
	if version == 5 {
		if err := applySQLiteMigration(db, []string{
			"ALTER TABLE store_meta RENAME TO store_meta_v5",
			"CREATE TABLE store_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), json_version INTEGER NOT NULL CHECK (json_version BETWEEN 1 AND 11), next_media_id INTEGER NOT NULL CHECK (next_media_id > 0), next_job_id INTEGER NOT NULL CHECK (next_job_id > 0), next_activity_id INTEGER NOT NULL CHECK (next_activity_id > 0))",
			"INSERT INTO store_meta SELECT singleton, 11, next_media_id, next_job_id, next_activity_id FROM store_meta_v5",
			"DROP TABLE store_meta_v5",
			"CREATE TABLE app_preferences (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), start_page TEXT NOT NULL DEFAULT 'overview' CHECK (start_page IN ('overview', 'library', 'monthly_log', 'activity')))",
			"INSERT INTO app_preferences (singleton) VALUES (1)",
			"PRAGMA user_version = 6",
		}); err != nil {
			return err
		}
	}
	if err := verifySQLiteIntegrity(db); err != nil {
		return err
	}
	return syncFileParent(path)
}

func applySQLiteMigration(db *sql.DB, statements []string) error {
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("begin SQLite schema migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("migrate SQLite schema: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit SQLite schema migration: %w", err)
	}
	return nil
}

// migrateJSONToSQLite imports a validated JSON snapshot into a newly created
// SQLite database. It never changes the source and removes an incomplete
// destination on every failure.
func migrateJSONToSQLite(source, destination string) (err error) {
	plan, err := prepareSQLiteImport(source, destination)
	if err != nil {
		return err
	}
	source, err = filepath.Abs(source)
	if err != nil {
		return err
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return err
	}

	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("exclusively create migration destination: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(destination)
		return fmt.Errorf("close migration destination: %w", err)
	}
	complete := false
	defer func() {
		if complete {
			return
		}
		_ = os.Remove(destination)
		_ = os.Remove(destination + "-journal")
		_ = os.Remove(destination + "-shm")
		_ = os.Remove(destination + "-wal")
	}()

	digest, err := migrationSourceDigest(source)
	if err != nil {
		return err
	}
	if digest != plan.SourceSHA256 {
		return errors.New("migration source changed after preflight")
	}

	db, err := openSQLiteDatabase(destination, "rwc")
	if err != nil {
		return err
	}
	defer func() {
		if db == nil {
			return
		}
		if closeErr := db.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	if err := configureSQLiteImport(db); err != nil {
		return err
	}
	if err := writeSQLiteSnapshot(db, plan.Snapshot); err != nil {
		return err
	}
	if err := verifySQLiteIntegrity(db); err != nil {
		return err
	}
	if err := db.Close(); err != nil {
		return fmt.Errorf("close imported SQLite database: %w", err)
	}
	db = nil

	reopened, err := loadSQLiteSnapshot(destination)
	if err != nil {
		return fmt.Errorf("reopen imported SQLite database: %w", err)
	}
	if !reflect.DeepEqual(reopened, plan.Snapshot) {
		return errors.New("reopened SQLite snapshot differs from migration source")
	}
	if err := os.Chmod(destination, 0o600); err != nil {
		return fmt.Errorf("restrict SQLite destination permissions: %w", err)
	}
	if err := syncFileParent(destination); err != nil {
		return err
	}
	complete = true
	return nil
}

func migrationSourceDigest(path string) ([32]byte, error) {
	var digest [32]byte
	file, err := os.Open(path)
	if err != nil {
		return digest, fmt.Errorf("reopen migration source: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return digest, err
	}
	if !info.Mode().IsRegular() {
		return digest, errors.New("migration source must remain a regular file")
	}
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(file, maxSQLiteImportBytes+1))
	if err != nil {
		return digest, err
	}
	if written > maxSQLiteImportBytes {
		return digest, errors.New("migration source exceeds 32 MiB")
	}
	copy(digest[:], hash.Sum(nil))
	return digest, nil
}

func openSQLiteDatabase(path, mode string) (*sql.DB, error) {
	uri := &url.URL{Scheme: "file", Path: path}
	query := uri.Query()
	query.Set("mode", mode)
	uri.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, fmt.Errorf("open SQLite database: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect to SQLite database: %w", err)
	}
	return db, nil
}

func configureSQLiteImport(db *sql.DB) error {
	return configureSQLite(db, "import")
}

func configureSQLiteRuntime(db *sql.DB) error {
	return configureSQLite(db, "runtime")
}

func configureSQLite(db *sql.DB, operation string) error {
	// DELETE journal mode avoids live sidecar files and keeps stopped-volume
	// backups straightforward for this single-instance, in-memory runtime.
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = DELETE",
		"PRAGMA synchronous = FULL",
		"PRAGMA busy_timeout = 5000",
	} {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("configure SQLite %s: %w", operation, err)
		}
	}
	return nil
}

func writeSQLiteSnapshot(db *sql.DB, snapshot persistedStore) error {
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("begin SQLite import: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(sqliteSchema); err != nil {
		return fmt.Errorf("create SQLite schema: %w", err)
	}
	if err := insertSQLiteSnapshot(tx, snapshot); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit SQLite import: %w", err)
	}
	return nil
}

func replaceSQLiteSnapshot(db *sql.DB, snapshot persistedStore) error {
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("begin SQLite snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, statement := range []string{
		"DELETE FROM top_nine",
		"DELETE FROM favorites",
		"DELETE FROM library_appearance",
		"DELETE FROM app_preferences",
		"DELETE FROM activities",
		"DELETE FROM sync_jobs",
		"DELETE FROM media",
		"DELETE FROM store_meta",
	} {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("replace SQLite snapshot: %w", err)
		}
	}
	if err := insertSQLiteSnapshot(tx, snapshot); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit SQLite snapshot: %w", err)
	}
	return nil
}

func insertSQLiteSnapshot(tx *sql.Tx, snapshot persistedStore) error {
	if _, err := tx.Exec(
		"INSERT INTO store_meta (singleton, json_version, next_media_id, next_job_id, next_activity_id) VALUES (1, ?, ?, ?, ?)",
		snapshot.Version, snapshot.NextID, snapshot.NextJobID, snapshot.NextActivityID,
	); err != nil {
		return fmt.Errorf("write SQLite store metadata: %w", err)
	}
	for position, item := range snapshot.Items {
		payload, err := json.Marshal(item)
		if err != nil {
			return fmt.Errorf("encode SQLite media payload: %w", err)
		}
		if _, err := tx.Exec("INSERT INTO media (id, position, payload) VALUES (?, ?, ?)", item.ID, position, string(payload)); err != nil {
			return fmt.Errorf("write SQLite media payload: %w", err)
		}
	}
	for position, job := range snapshot.SyncJobs {
		payload, err := json.Marshal(job)
		if err != nil {
			return fmt.Errorf("encode SQLite sync job payload: %w", err)
		}
		if _, err := tx.Exec("INSERT INTO sync_jobs (id, media_id, position, payload) VALUES (?, ?, ?, ?)", job.ID, job.MediaID, position, string(payload)); err != nil {
			return fmt.Errorf("write SQLite sync job payload: %w", err)
		}
	}
	for position, activity := range snapshot.Activities {
		payload, err := json.Marshal(activity)
		if err != nil {
			return fmt.Errorf("encode SQLite activity payload: %w", err)
		}
		if _, err := tx.Exec("INSERT INTO activities (id, media_id, position, payload) VALUES (?, ?, ?, ?)", activity.ID, activity.MediaID, position, string(payload)); err != nil {
			return fmt.Errorf("write SQLite activity payload: %w", err)
		}
	}
	for position, mediaID := range snapshot.FavoriteMediaIDs {
		if _, err := tx.Exec("INSERT INTO favorites (media_id, position) VALUES (?, ?)", mediaID, position); err != nil {
			return fmt.Errorf("write SQLite favorite: %w", err)
		}
	}
	for position, mediaID := range snapshot.TopNineMediaIDs {
		if _, err := tx.Exec("INSERT INTO top_nine (media_id, position) VALUES (?, ?)", mediaID, position); err != nil {
			return fmt.Errorf("write SQLite 3×3 selection: %w", err)
		}
	}
	preferences := preferencesFromSnapshot(snapshot)
	if _, err := tx.Exec("INSERT INTO app_preferences (singleton, start_page) VALUES (1, ?)", preferences.StartPage); err != nil {
		return fmt.Errorf("write SQLite application preferences: %w", err)
	}
	bannerData := snapshot.Appearance.BannerData
	if bannerData == nil {
		bannerData = []byte{}
	}
	avatarData := snapshot.Appearance.AvatarData
	if avatarData == nil {
		avatarData = []byte{}
	}
	if _, err := tx.Exec(
		"INSERT INTO library_appearance (singleton, banner_content_type, banner_data, avatar_content_type, avatar_data) VALUES (1, ?, ?, ?, ?)",
		snapshot.Appearance.BannerContentType, bannerData, snapshot.Appearance.AvatarContentType, avatarData,
	); err != nil {
		return fmt.Errorf("write SQLite Library appearance: %w", err)
	}
	return nil
}

func verifySQLiteIntegrity(db *sql.DB) error {
	var result string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&result); err != nil {
		return fmt.Errorf("check SQLite integrity: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("SQLite integrity check failed: %s", result)
	}
	return nil
}

func loadSQLiteSnapshot(path string) (persistedStore, error) {
	var snapshot persistedStore
	db, err := openSQLiteDatabase(path, "ro")
	if err != nil {
		return snapshot, err
	}
	defer db.Close()
	var schemaVersion int
	if err := db.QueryRow("PRAGMA user_version").Scan(&schemaVersion); err != nil {
		return snapshot, fmt.Errorf("read SQLite schema version: %w", err)
	}
	if schemaVersion != sqliteSchemaVersion {
		return snapshot, fmt.Errorf("unsupported SQLite schema version %d", schemaVersion)
	}
	if err := verifySQLiteIntegrity(db); err != nil {
		return snapshot, err
	}
	if err := db.QueryRow(
		"SELECT json_version, next_media_id, next_job_id, next_activity_id FROM store_meta WHERE singleton = 1",
	).Scan(&snapshot.Version, &snapshot.NextID, &snapshot.NextJobID, &snapshot.NextActivityID); err != nil {
		return snapshot, fmt.Errorf("read SQLite store metadata: %w", err)
	}
	if snapshot.Items, err = readSQLiteMedia(db); err != nil {
		return snapshot, err
	}
	if snapshot.SyncJobs, err = readSQLiteSyncJobs(db); err != nil {
		return snapshot, err
	}
	if snapshot.Activities, err = readSQLiteActivities(db); err != nil {
		return snapshot, err
	}
	if snapshot.FavoriteMediaIDs, err = readSQLiteSelection(db, "favorites"); err != nil {
		return snapshot, err
	}
	if snapshot.TopNineMediaIDs, err = readSQLiteSelection(db, "top_nine"); err != nil {
		return snapshot, err
	}
	if snapshot.Appearance, err = readSQLiteAppearance(db); err != nil {
		return snapshot, err
	}
	var preferences appPreferences
	if err := db.QueryRow("SELECT start_page FROM app_preferences WHERE singleton = 1").Scan(&preferences.StartPage); err != nil {
		return snapshot, fmt.Errorf("read SQLite application preferences: %w", err)
	}
	snapshot.Preferences = &preferences
	canonical, err := json.Marshal(snapshot)
	if err != nil {
		return snapshot, err
	}
	normalized, err := decodeSQLiteImport(canonical)
	if err != nil {
		return snapshot, fmt.Errorf("validate SQLite snapshot: %w", err)
	}
	snapshot.Version = persistedStoreVersion
	if snapshot.FavoriteMediaIDs == nil {
		snapshot.FavoriteMediaIDs = []int{}
	}
	if snapshot.TopNineMediaIDs == nil {
		snapshot.TopNineMediaIDs = []int{}
	}
	if !reflect.DeepEqual(normalized, snapshot) {
		return snapshot, errors.New("SQLite snapshot contains inconsistent counters or defaults")
	}
	return normalized, nil
}

func readSQLiteMedia(db *sql.DB) ([]Media, error) {
	rows, err := db.Query("SELECT id, position, payload FROM media ORDER BY position")
	if err != nil {
		return nil, fmt.Errorf("read SQLite media: %w", err)
	}
	defer rows.Close()
	items := []Media{}
	for rows.Next() {
		var id, position int
		var payload string
		if err := rows.Scan(&id, &position, &payload); err != nil {
			return nil, err
		}
		var item Media
		if position != len(items) || decodeStrictSQLitePayload(payload, &item) != nil || item.ID != id {
			return nil, errors.New("invalid SQLite media payload or position")
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func readSQLiteSyncJobs(db *sql.DB) ([]syncJob, error) {
	rows, err := db.Query("SELECT id, media_id, position, payload FROM sync_jobs ORDER BY position")
	if err != nil {
		return nil, fmt.Errorf("read SQLite sync jobs: %w", err)
	}
	defer rows.Close()
	jobs := []syncJob{}
	for rows.Next() {
		var id, mediaID int64
		var position int
		var payload string
		if err := rows.Scan(&id, &mediaID, &position, &payload); err != nil {
			return nil, err
		}
		var job syncJob
		if position != len(jobs) || decodeStrictSQLitePayload(payload, &job) != nil || job.ID != id || int64(job.MediaID) != mediaID {
			return nil, errors.New("invalid SQLite sync job payload or position")
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func readSQLiteActivities(db *sql.DB) ([]Activity, error) {
	rows, err := db.Query("SELECT id, media_id, position, payload FROM activities ORDER BY position")
	if err != nil {
		return nil, fmt.Errorf("read SQLite activities: %w", err)
	}
	defer rows.Close()
	activities := []Activity{}
	for rows.Next() {
		var id, mediaID int64
		var position int
		var payload string
		if err := rows.Scan(&id, &mediaID, &position, &payload); err != nil {
			return nil, err
		}
		var activity Activity
		if position != len(activities) || decodeStrictSQLitePayload(payload, &activity) != nil || activity.ID != id || int64(activity.MediaID) != mediaID {
			return nil, errors.New("invalid SQLite activity payload or position")
		}
		activities = append(activities, activity)
	}
	return activities, rows.Err()
}

func readSQLiteSelection(db *sql.DB, table string) ([]int, error) {
	// Table names are internal constants, never request input.
	if table != "favorites" && table != "top_nine" {
		return nil, errors.New("unknown SQLite selection")
	}
	rows, err := db.Query("SELECT media_id, position FROM " + table + " ORDER BY position")
	if err != nil {
		return nil, fmt.Errorf("read SQLite %s: %w", table, err)
	}
	defer rows.Close()
	favorites := []int{}
	for rows.Next() {
		var mediaID, position int
		if err := rows.Scan(&mediaID, &position); err != nil {
			return nil, err
		}
		if position != len(favorites) {
			return nil, fmt.Errorf("invalid SQLite %s position", table)
		}
		favorites = append(favorites, mediaID)
	}
	return favorites, rows.Err()
}

func readSQLiteAppearance(db *sql.DB) (libraryAppearance, error) {
	var appearance libraryAppearance
	if err := db.QueryRow(
		"SELECT banner_content_type, banner_data, avatar_content_type, avatar_data FROM library_appearance WHERE singleton = 1",
	).Scan(&appearance.BannerContentType, &appearance.BannerData, &appearance.AvatarContentType, &appearance.AvatarData); err != nil {
		return appearance, fmt.Errorf("read SQLite Library appearance: %w", err)
	}
	return appearance, nil
}

func decodeStrictSQLitePayload(payload string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("SQLite payload contains trailing JSON")
	}
	return nil
}

func exportSQLiteSnapshot(path string) ([]byte, error) {
	snapshot, err := loadSQLiteSnapshot(path)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(snapshot, "", "  ")
}
