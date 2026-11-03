package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSQLiteImportPreflightPreservesSourceAndDurableState(t *testing.T) {
	input := persistedStore{Version: 6, Items: []Media{{ID: 7, Title: "Example", Type: "game", PlannedRepeat: true, Notes: "keep me", PlayedOnPlatforms: []string{"PC", "Steam Deck"}, CatalogPlatforms: []string{"PS4"}}}, SyncJobs: []syncJob{{ID: 10, MediaID: 100}}, Activities: []Activity{{ID: 20, MediaID: 140, Title: "Deleted item"}}, NextID: 2, NextJobID: 3, NextActivityID: 4}
	data, err := json.MarshalIndent(input, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "media.json")
	destination := filepath.Join(dir, "media.db")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := prepareSQLiteImport(source, destination)
	if err != nil {
		t.Fatal(err)
	}
	if plan.SourceSHA256 != sha256.Sum256(data) {
		t.Fatal("source digest changed")
	}
	got, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatal("source was changed")
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("preflight created a database")
	}
	if plan.Snapshot.NextID != 141 || plan.Snapshot.NextJobID != 11 || plan.Snapshot.NextActivityID != 21 {
		t.Fatalf("counters ignored retained references: %+v", plan.Snapshot)
	}
	if !reflect.DeepEqual(plan.Snapshot.Items, input.Items) || !reflect.DeepEqual(plan.Snapshot.Activities, input.Activities) || !reflect.DeepEqual(plan.Snapshot.SyncJobs, input.SyncJobs) {
		t.Fatal("payloads were lost")
	}
	canonical, _ := json.Marshal(plan.Snapshot)
	roundtrip, err := decodeSQLiteImport(canonical)
	if err != nil || !reflect.DeepEqual(roundtrip, plan.Snapshot) {
		t.Fatalf("canonical round trip failed: %v", err)
	}
	if err := os.WriteFile(destination, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareSQLiteImport(source, destination); err == nil {
		t.Fatal("existing destination was accepted")
	}
	existing, _ := os.ReadFile(destination)
	if string(existing) != "existing" {
		t.Fatal("destination was modified")
	}
	if _, err := prepareSQLiteImport(source, source); err == nil {
		t.Fatal("same path was accepted")
	}
}

func TestSQLiteImportSupportedLegacyVersions(t *testing.T) {
	for _, source := range []string{`[]`, `[{"id":1,"title":"Legacy","type":"anime"}]`, `{"version":1,"items":[]}`, `{"version":2,"items":[]}`, `{"version":3,"items":[]}`, `{"version":4,"items":[]}`, `{"version":5,"items":[]}`, `{"version":6,"items":[]}`, `{"version":7,"items":[]}`, `{"version":8,"items":[]}`, `{"version":9,"items":[]}`, `{"version":10,"items":[]}`, `{"version":11,"items":[]}`} {
		t.Run(source, func(t *testing.T) {
			snapshot, err := decodeSQLiteImport([]byte(source))
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Version != persistedStoreVersion || snapshot.Items == nil || snapshot.SyncJobs == nil || snapshot.Activities == nil {
				t.Fatal("defaults not normalized")
			}
			if len(snapshot.Items) > 0 && (snapshot.Items[0].PlayedOnPlatforms == nil || snapshot.Items[0].CatalogPlatforms == nil) {
				t.Fatal("platform arrays became null")
			}
		})
	}
}

func TestSQLiteImportRejectsUnsafeSources(t *testing.T) {
	for _, source := range []string{"", " ", "{", "null", `{"version":12}`, `{"version":0}`, `[] []`, `{"version":6,"unknown":"do not silently discard"}`, `[{"id":0}]`, `[{"id":1},{"id":1}]`, `{"version":6,"nextId":-1}`, `{"version":6,"nextJobId":9223372036854775807}`, `{"version":6,"syncJobs":[{"id":1,"mediaId":0}]}`, `{"version":6,"syncJobs":[{"id":1,"mediaId":2},{"id":1,"mediaId":3}]}`, `{"version":6,"activities":[{"id":1,"mediaId":-2}]}`, `{"version":6,"activities":[{"id":1},{"id":1}]}`} {
		t.Run(source, func(t *testing.T) {
			if _, err := decodeSQLiteImport([]byte(source)); err == nil {
				t.Fatal("unsafe source accepted")
			}
		})
	}
	if _, err := decodeSQLiteImport(bytes.Repeat([]byte(" "), maxSQLiteImportBytes+1)); err == nil {
		t.Fatal("unbounded input accepted")
	}
}

func TestSQLiteImportDoesNotDropHistoricalActivities(t *testing.T) {
	snapshot := persistedStore{Version: 6, Items: []Media{}}
	for id := 1; id <= maxStoredActivities+1; id++ {
		snapshot.Activities = append(snapshot.Activities, Activity{ID: int64(id), MediaID: id})
	}
	data, _ := json.Marshal(snapshot)
	got, err := decodeSQLiteImport(data)
	if err != nil || len(got.Activities) != maxStoredActivities+1 {
		t.Fatalf("history was dropped: %v", err)
	}
	if got.NextID != maxStoredActivities+2 {
		t.Fatal("deleted historical IDs can be reused")
	}
	for _, table := range []string{"media", "sync_jobs", "activities", "favorites", "library_appearance", "store_meta"} {
		if !strings.Contains(sqliteSchema, "CREATE TABLE "+table) {
			t.Fatalf("schema missing %s", table)
		}
	}
}
