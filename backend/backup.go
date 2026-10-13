package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const restoreConfirmationHeader = "X-Honne-Restore-Confirmation"

type backupPreview struct {
	Version               int `json:"version"`
	Items                 int `json:"items"`
	Activities            int `json:"activities"`
	PendingAniListChanges int `json:"pendingAniListChanges"`
}

func previewForSnapshot(snapshot persistedStore) backupPreview {
	return backupPreview{
		Version:               snapshot.Version,
		Items:                 len(snapshot.Items),
		Activities:            len(snapshot.Activities),
		PendingAniListChanges: len(snapshot.SyncJobs),
	}
}

func (s *store) backupSnapshot() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.marshalSnapshotLocked()
}

func (a *app) downloadBackup(w http.ResponseWriter, _ *http.Request) {
	data, err := a.store.backupSnapshot()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not prepare backup")
		return
	}

	filename := "honne-backup-" + time.Now().UTC().Format("20060102T150405Z") + ".json"
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Honne-Backup-Version", strconv.Itoa(persistedStoreVersion))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func decodeBackupRequest(w http.ResponseWriter, r *http.Request) (persistedStore, bool) {
	var snapshot persistedStore
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if contentType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "backup must be uploaded as application/json")
		return snapshot, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSQLiteImportBytes+1)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "backup exceeds 32 MiB")
		} else {
			writeError(w, http.StatusBadRequest, "could not read backup")
		}
		return snapshot, false
	}
	snapshot, err = decodeSQLiteImport(data)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid backup: "+err.Error())
		return persistedStore{}, false
	}
	return snapshot, true
}

func (a *app) previewBackupRestore(w http.ResponseWriter, r *http.Request) {
	snapshot, ok := decodeBackupRequest(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, previewForSnapshot(snapshot))
}

func (a *app) restoreBackup(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get(restoreConfirmationHeader) != "replace" {
		writeError(w, http.StatusPreconditionRequired, "backup restore confirmation is required")
		return
	}
	snapshot, ok := decodeBackupRequest(w, r)
	if !ok {
		return
	}
	if a.anilist != nil {
		a.anilist.operationMu.Lock()
		defer a.anilist.operationMu.Unlock()
		if _, connected := a.anilist.authSnapshot(); connected {
			writeError(w, http.StatusConflict, "disconnect AniList before restoring a backup")
			return
		}
	}

	a.store.mu.Lock()
	original := a.store.cloneSnapshotLocked()
	a.store.restoreSnapshotLocked(snapshot)
	if err := a.store.persistLocked(); err != nil {
		a.store.restoreSnapshotLocked(original)
		a.store.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not restore backup")
		return
	}
	a.store.mu.Unlock()

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, previewForSnapshot(snapshot))
}
