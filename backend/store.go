package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

const persistedStoreVersion = 6

type persistedStore struct {
	Version        int        `json:"version"`
	Items          []Media    `json:"items"`
	SyncJobs       []syncJob  `json:"syncJobs,omitempty"`
	Activities     []Activity `json:"activities,omitempty"`
	NextID         int        `json:"nextId,omitempty"`
	NextJobID      int64      `json:"nextJobId,omitempty"`
	NextActivityID int64      `json:"nextActivityId,omitempty"`
}

type store struct {
	mu             sync.RWMutex
	path           string
	items          []Media
	syncJobs       []syncJob
	activities     []Activity
	nextID         int
	nextJobID      int64
	nextActivityID int64
}

func newStore(path string) (*store, error) {
	s := &store{path: path, items: []Media{}, syncJobs: []syncJob{}, activities: []Activity{}, nextID: 1, nextJobID: 1, nextActivityID: 1}
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
		s.items = persisted.Items
		s.syncJobs = persisted.SyncJobs
		if persisted.Activities != nil {
			s.activities = persisted.Activities
		}
		if persisted.NextID > s.nextID {
			s.nextID = persisted.NextID
		}
		if persisted.NextJobID > s.nextJobID {
			s.nextJobID = persisted.NextJobID
		}
		if persisted.NextActivityID > s.nextActivityID {
			s.nextActivityID = persisted.NextActivityID
		}
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
	}
	if overflow := len(s.activities) - maxStoredActivities; overflow > 0 {
		s.activities = slices.Delete(s.activities, 0, overflow)
	}
	return s, nil
}

func (s *store) marshalSnapshotLocked() ([]byte, error) {
	return json.MarshalIndent(persistedStore{
		Version: persistedStoreVersion, Items: s.items, SyncJobs: s.syncJobs, Activities: s.activities,
		NextID: s.nextID, NextJobID: s.nextJobID, NextActivityID: s.nextActivityID,
	}, "", "  ")
}

func (s *store) persistLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := s.marshalSnapshotLocked()
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
