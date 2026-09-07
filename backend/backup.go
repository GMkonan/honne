package main

import (
	"fmt"
	"net/http"
	"strconv"
	"time"
)

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
