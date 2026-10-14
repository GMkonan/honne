package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

const persistedStoreVersion = 7

type libraryAppearance struct {
	BannerContentType string `json:"bannerContentType,omitempty"`
	BannerData        []byte `json:"bannerData,omitempty"`
}

var errStoreClosed = errors.New("store is closed")

type persistedStore struct {
	Version          int               `json:"version"`
	Items            []Media           `json:"items"`
	SyncJobs         []syncJob         `json:"syncJobs,omitempty"`
	Activities       []Activity        `json:"activities,omitempty"`
	FavoriteMediaIDs []int             `json:"favoriteMediaIds,omitempty"`
	Appearance       libraryAppearance `json:"appearance,omitempty"`
	NextID           int               `json:"nextId,omitempty"`
	NextJobID        int64             `json:"nextJobId,omitempty"`
	NextActivityID   int64             `json:"nextActivityId,omitempty"`
}

type store struct {
	mu               sync.RWMutex
	path             string
	db               *sql.DB
	sqlite           bool
	closed           bool
	items            []Media
	syncJobs         []syncJob
	activities       []Activity
	favoriteMediaIDs []int
	appearance       libraryAppearance
	nextID           int
	nextJobID        int64
	nextActivityID   int64
}

func newStore(path string) (*store, error) {
	s := emptyStore(path)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return s, nil
	}
	if trimmed[0] == '[' {
		if err := json.Unmarshal(trimmed, &s.items); err != nil {
			return nil, fmt.Errorf("decode legacy data file: %w", err)
		}
	} else {
		var persisted persistedStore
		if err := json.Unmarshal(trimmed, &persisted); err != nil {
			return nil, fmt.Errorf("decode data file: %w", err)
		}
		if persisted.Version < 1 || persisted.Version > persistedStoreVersion {
			return nil, fmt.Errorf("unsupported data file version %d", persisted.Version)
		}
		s.loadSnapshot(persisted)
	}
	s.normalizeLoadedState()
	return s, nil
}

func emptyStore(path string) *store {
	return &store{
		path: path, items: []Media{}, syncJobs: []syncJob{}, activities: []Activity{}, favoriteMediaIDs: []int{},
		nextID: 1, nextJobID: 1, nextActivityID: 1,
	}
}

func (s *store) loadSnapshot(snapshot persistedStore) {
	s.items = snapshot.Items
	s.syncJobs = snapshot.SyncJobs
	if snapshot.Activities != nil {
		s.activities = snapshot.Activities
	}
	if snapshot.FavoriteMediaIDs != nil {
		s.favoriteMediaIDs = snapshot.FavoriteMediaIDs
	}
	s.appearance = snapshot.Appearance
	if snapshot.NextID > s.nextID {
		s.nextID = snapshot.NextID
	}
	if snapshot.NextJobID > s.nextJobID {
		s.nextJobID = snapshot.NextJobID
	}
	if snapshot.NextActivityID > s.nextActivityID {
		s.nextActivityID = snapshot.NextActivityID
	}
}

func (s *store) normalizeLoadedState() {
	if s.items == nil {
		s.items = []Media{}
	}
	if s.syncJobs == nil {
		s.syncJobs = []syncJob{}
	}
	if s.activities == nil {
		s.activities = []Activity{}
	}
	if s.favoriteMediaIDs == nil {
		s.favoriteMediaIDs = []int{}
	}
	for index := range s.items {
		if s.items[index].PlayedOnPlatforms == nil {
			s.items[index].PlayedOnPlatforms = []string{}
		}
		if s.items[index].CatalogPlatforms == nil {
			s.items[index].CatalogPlatforms = []string{}
		}
		item := s.items[index]
		if item.ID >= s.nextID {
			s.nextID = item.ID + 1
		}
	}
	for _, job := range s.syncJobs {
		if job.ID >= s.nextJobID {
			s.nextJobID = job.ID + 1
		}
		if job.MediaID >= s.nextID {
			s.nextID = job.MediaID + 1
		}
	}
	for _, activity := range s.activities {
		if activity.ID >= s.nextActivityID {
			s.nextActivityID = activity.ID + 1
		}
		if activity.MediaID >= s.nextID {
			s.nextID = activity.MediaID + 1
		}
	}
	if overflow := len(s.activities) - maxStoredActivities; overflow > 0 {
		s.activities = slices.Delete(s.activities, 0, overflow)
	}
}

func (s *store) snapshotLocked() persistedStore {
	return persistedStore{
		Version: persistedStoreVersion, Items: s.items, SyncJobs: s.syncJobs, Activities: s.activities,
		FavoriteMediaIDs: s.favoriteMediaIDs, Appearance: s.appearance,
		NextID: s.nextID, NextJobID: s.nextJobID, NextActivityID: s.nextActivityID,
	}
}

func (s *store) cloneSnapshotLocked() persistedStore {
	snapshot := s.snapshotLocked()
	snapshot.Items = slices.Clone(snapshot.Items)
	snapshot.SyncJobs = slices.Clone(snapshot.SyncJobs)
	snapshot.Activities = slices.Clone(snapshot.Activities)
	snapshot.FavoriteMediaIDs = slices.Clone(snapshot.FavoriteMediaIDs)
	snapshot.Appearance.BannerData = slices.Clone(snapshot.Appearance.BannerData)
	return snapshot
}

func (s *store) restoreSnapshotLocked(snapshot persistedStore) {
	s.items = snapshot.Items
	s.syncJobs = snapshot.SyncJobs
	s.activities = snapshot.Activities
	s.favoriteMediaIDs = snapshot.FavoriteMediaIDs
	s.appearance = snapshot.Appearance
	s.nextID = snapshot.NextID
	s.nextJobID = snapshot.NextJobID
	s.nextActivityID = snapshot.NextActivityID
}

func (s *store) marshalSnapshotLocked() ([]byte, error) {
	return json.MarshalIndent(s.snapshotLocked(), "", "  ")
}

func (s *store) persistLocked() error {
	if s.closed {
		return errStoreClosed
	}
	if s.sqlite {
		if s.db == nil {
			return errStoreClosed
		}
		return replaceSQLiteSnapshot(s.db, s.snapshotLocked())
	}
	return s.persistJSONLocked()
}

func (s *store) persistJSONLocked() (err error) {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := s.marshalSnapshotLocked()
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if file != nil {
			_ = file.Close()
		}
		if err != nil {
			_ = os.Remove(tmp)
		}
	}()
	if err = file.Chmod(0o600); err != nil {
		return err
	}
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		file = nil
		return err
	}
	file = nil
	if err = os.Rename(tmp, s.path); err != nil {
		return err
	}
	if err = syncFileParent(s.path); err != nil {
		return err
	}
	return nil
}

func syncFileParent(path string) error {
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return fmt.Errorf("open parent directory: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync parent directory: %w", err)
	}
	return nil
}

func (s *store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

func writeAndSyncFile(path string, data []byte, mode os.FileMode) (err error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer func() {
		if file != nil {
			_ = file.Close()
		}
	}()
	if err = file.Chmod(mode); err != nil {
		return err
	}
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		file = nil
		return err
	}
	file = nil
	return nil
}
