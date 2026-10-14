package main

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"slices"
)

const maxSQLiteImportBytes = 32 << 20

//go:embed sqlite_schema.sql
var sqliteSchema string

// An import plan never opens a database or changes the legacy source. Activation
// must revalidate the source digest and exclusively create the destination.
type sqliteImportPlan struct {
	Snapshot     persistedStore
	SourceSHA256 [32]byte
}

func prepareSQLiteImport(source, destination string) (sqliteImportPlan, error) {
	var plan sqliteImportPlan
	src, err := filepath.Abs(source)
	if err != nil {
		return plan, err
	}
	dst, err := filepath.Abs(destination)
	if err != nil {
		return plan, err
	}
	if src == dst {
		return plan, errors.New("migration source and destination must differ")
	}
	if _, err := os.Lstat(dst); err == nil {
		return plan, errors.New("migration destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return plan, err
	}
	file, err := os.Open(src)
	if err != nil {
		return plan, fmt.Errorf("open migration source: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return plan, err
	}
	if !info.Mode().IsRegular() {
		return plan, errors.New("migration source must be a regular file")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxSQLiteImportBytes+1))
	if err != nil {
		return plan, err
	}
	if len(data) > maxSQLiteImportBytes {
		return plan, errors.New("migration source exceeds 32 MiB")
	}
	plan.Snapshot, err = decodeSQLiteImport(data)
	if err != nil {
		return plan, err
	}
	plan.SourceSHA256 = sha256.Sum256(data)
	return plan, nil
}

func decodeSQLiteImport(data []byte) (persistedStore, error) {
	var snapshot persistedStore
	if len(data) > maxSQLiteImportBytes {
		return snapshot, errors.New("migration source exceeds 32 MiB")
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return snapshot, errors.New("migration source is empty")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if data[0] == '[' {
		snapshot.Version = persistedStoreVersion
		if err := decoder.Decode(&snapshot.Items); err != nil {
			return snapshot, fmt.Errorf("decode legacy migration source: %w", err)
		}
	} else {
		if err := decoder.Decode(&snapshot); err != nil {
			return snapshot, fmt.Errorf("decode migration source: %w", err)
		}
		if snapshot.Version < 1 || snapshot.Version > persistedStoreVersion {
			return snapshot, fmt.Errorf("unsupported migration version %d", snapshot.Version)
		}
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return snapshot, errors.New("migration source contains trailing JSON")
	}
	if snapshot.Items == nil {
		snapshot.Items = []Media{}
	}
	if snapshot.SyncJobs == nil {
		snapshot.SyncJobs = []syncJob{}
	}
	if snapshot.Activities == nil {
		snapshot.Activities = []Activity{}
	}
	if snapshot.FavoriteMediaIDs == nil {
		snapshot.FavoriteMediaIDs = []int{}
	}
	if snapshot.NextID < 0 || snapshot.NextJobID < 0 || snapshot.NextActivityID < 0 {
		return snapshot, errors.New("migration counters must be nonnegative")
	}
	snapshot.NextID = max(1, snapshot.NextID)
	snapshot.NextJobID = max(int64(1), snapshot.NextJobID)
	snapshot.NextActivityID = max(int64(1), snapshot.NextActivityID)
	seenMedia := map[int]bool{}
	for index := range snapshot.Items {
		item := &snapshot.Items[index]
		if item.ID <= 0 || item.ID == math.MaxInt || seenMedia[item.ID] {
			return snapshot, errors.New("invalid or duplicate migration media ID")
		}
		seenMedia[item.ID] = true
		snapshot.NextID = max(snapshot.NextID, item.ID+1)
		if item.PlayedOnPlatforms == nil {
			item.PlayedOnPlatforms = []string{}
		}
		if item.CatalogPlatforms == nil {
			item.CatalogPlatforms = []string{}
		}
	}
	if len(snapshot.FavoriteMediaIDs) > maxFavorites {
		return snapshot, errors.New("migration favorites cannot contain more than 9 titles")
	}
	seenFavorites := map[int]bool{}
	for _, mediaID := range snapshot.FavoriteMediaIDs {
		if !seenMedia[mediaID] || seenFavorites[mediaID] {
			return snapshot, errors.New("migration favorites contain an invalid or duplicate media reference")
		}
		seenFavorites[mediaID] = true
	}
	if len(snapshot.Appearance.BannerData) > maxBannerBytes {
		return snapshot, errors.New("migration banner exceeds 8 MiB")
	}
	if (snapshot.Appearance.BannerContentType == "") != (len(snapshot.Appearance.BannerData) == 0) {
		return snapshot, errors.New("migration banner content type and data must be provided together")
	}
	if len(snapshot.Appearance.BannerData) > 0 {
		if !slices.Contains(allowedImageTypes, snapshot.Appearance.BannerContentType) || http.DetectContentType(snapshot.Appearance.BannerData) != snapshot.Appearance.BannerContentType {
			return snapshot, errors.New("migration banner has an invalid image type")
		}
	}
	if len(snapshot.Appearance.AvatarData) > maxAvatarBytes {
		return snapshot, errors.New("migration profile picture exceeds 4 MiB")
	}
	if (snapshot.Appearance.AvatarContentType == "") != (len(snapshot.Appearance.AvatarData) == 0) {
		return snapshot, errors.New("migration profile picture content type and data must be provided together")
	}
	if len(snapshot.Appearance.AvatarData) > 0 {
		if !slices.Contains(allowedImageTypes, snapshot.Appearance.AvatarContentType) || http.DetectContentType(snapshot.Appearance.AvatarData) != snapshot.Appearance.AvatarContentType {
			return snapshot, errors.New("migration profile picture has an invalid image type")
		}
	}
	seenJobs := map[int64]bool{}
	for _, job := range snapshot.SyncJobs {
		if job.ID <= 0 || job.ID == math.MaxInt64 || seenJobs[job.ID] || job.MediaID <= 0 || job.MediaID == math.MaxInt {
			return snapshot, errors.New("invalid or duplicate migration job ID/reference")
		}
		seenJobs[job.ID] = true
		snapshot.NextJobID = max(snapshot.NextJobID, job.ID+1)
		snapshot.NextID = max(snapshot.NextID, job.MediaID+1)
	}
	seenActivities := map[int64]bool{}
	for _, activity := range snapshot.Activities {
		if activity.ID <= 0 || activity.ID == math.MaxInt64 || seenActivities[activity.ID] || activity.MediaID < 0 || activity.MediaID == math.MaxInt {
			return snapshot, errors.New("invalid or duplicate migration activity ID/reference")
		}
		seenActivities[activity.ID] = true
		snapshot.NextActivityID = max(snapshot.NextActivityID, activity.ID+1)
		snapshot.NextID = max(snapshot.NextID, activity.MediaID+1)
	}
	if snapshot.NextID == math.MaxInt || snapshot.NextJobID == math.MaxInt64 || snapshot.NextActivityID == math.MaxInt64 {
		return snapshot, errors.New("migration counter exhausted")
	}
	snapshot.Version = persistedStoreVersion
	return snapshot, nil
}
