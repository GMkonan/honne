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

const sqliteSchemaVersion = 1

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
	if err := syncParentDirectory(destination); err != nil {
		return err
	}
	complete = true
	return nil
}

func syncParentDirectory(path string) error {
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return fmt.Errorf("open SQLite destination directory: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync SQLite destination directory: %w", err)
	}
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
	for _, statement := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = DELETE",
		"PRAGMA synchronous = FULL",
		"PRAGMA busy_timeout = 5000",
	} {
		if _, err := db.Exec(statement); err != nil {
			return fmt.Errorf("configure SQLite import: %w", err)
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
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit SQLite import: %w", err)
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
	canonical, err := json.Marshal(snapshot)
	if err != nil {
		return snapshot, err
	}
	normalized, err := decodeSQLiteImport(canonical)
	if err != nil {
		return snapshot, fmt.Errorf("validate SQLite snapshot: %w", err)
	}
	if !reflect.DeepEqual(normalized, snapshot) {
		return snapshot, errors.New("SQLite snapshot contains inconsistent counters or defaults")
	}
	return snapshot, nil
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
