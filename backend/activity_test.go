package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestActivityCRUDPersistenceAndNewestFirstAPI(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}

	create := httptest.NewRecorder()
	application.createMedia(create, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Cowboy Bebop", Type: "anime", Status: "planned", RepeatCount: intPointer(1),
	}))
	if create.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", create.Code, create.Body.String())
	}

	updateRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Cowboy Bebop", Type: "anime", Status: "in_progress", Progress: 3, Total: 26, Rating: 9, RepeatCount: intPointer(2),
	})
	updateRequest.SetPathValue("id", "1")
	update := httptest.NewRecorder()
	application.updateMedia(update, updateRequest)
	if update.Code != http.StatusOK {
		t.Fatalf("update = %d: %s", update.Code, update.Body.String())
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/media/1", nil)
	deleteRequest.SetPathValue("id", "1")
	deleted := httptest.NewRecorder()
	application.deleteMedia(deleted, deleteRequest)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete = %d: %s", deleted.Code, deleted.Body.String())
	}

	if len(store.activities) != 3 {
		t.Fatalf("activities = %+v, want 3", store.activities)
	}
	updated := store.activities[1]
	if updated.Action != "updated" || updated.Changes.FromStatus != "planned" || updated.Changes.ToStatus != "in_progress" ||
		updated.Changes.FromProgress == nil || *updated.Changes.FromProgress != 0 || updated.Changes.ToProgress == nil || *updated.Changes.ToProgress != 3 ||
		updated.Changes.FromRating == nil || *updated.Changes.FromRating != 0 || updated.Changes.ToRating == nil || *updated.Changes.ToRating != 9 ||
		updated.Changes.FromRepeatCount == nil || *updated.Changes.FromRepeatCount != 1 || updated.Changes.ToRepeatCount == nil || *updated.Changes.ToRepeatCount != 2 {
		t.Fatalf("unexpected structured update activity: %+v", updated)
	}

	response := httptest.NewRecorder()
	application.listActivity(response, httptest.NewRequest(http.MethodGet, "/api/activity?limit=2", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("list activity = %d: %s", response.Code, response.Body.String())
	}
	var activities []Activity
	if err := json.NewDecoder(response.Body).Decode(&activities); err != nil {
		t.Fatal(err)
	}
	if len(activities) != 2 || activities[0].Action != "deleted" || activities[1].Action != "updated" {
		t.Fatalf("activity API is not newest-first with limit: %+v", activities)
	}

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.activities) != 3 || reopened.nextActivityID != 4 {
		t.Fatalf("activity state did not survive restart: activities=%+v next=%d", reopened.activities, reopened.nextActivityID)
	}
}

func TestActivityBackwardCompatibilityAndRetention(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	legacy := []byte(`[{"id":7,"title":"Dune","type":"book","status":"planned","progress":0,"total":0,"rating":0,"notes":"","coverUrl":"","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]`)
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.activities) != 0 || store.nextActivityID != 1 {
		t.Fatalf("legacy state initialized unexpected activity state: activities=%+v next=%d", store.activities, store.nextActivityID)
	}

	versionedPath := filepath.Join(t.TempDir(), "media.json")
	if err := os.WriteFile(versionedPath, []byte(`{"version":1,"items":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	versioned, err := newStore(versionedPath)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	(&app{store: versioned}).listActivity(response, httptest.NewRequest(http.MethodGet, "/api/activity", nil))
	if response.Body.String() != "[]\n" {
		t.Fatalf("old versioned state activity response = %q, want an empty array", response.Body.String())
	}

	for index := 0; index < maxStoredActivities+1; index++ {
		store.appendActivityLocked(Activity{Title: "Dune", MediaType: "book", Action: "updated", OccurredAt: time.Now()})
	}
	if len(store.activities) != maxStoredActivities || store.activities[0].ID != 2 || store.nextActivityID != maxStoredActivities+2 {
		t.Fatalf("retention/counter mismatch: len=%d first=%d next=%d", len(store.activities), store.activities[0].ID, store.nextActivityID)
	}
}

func TestCreateRollsBackActivityWhenPersistenceFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	store := &store{path: path, items: []Media{}, syncJobs: []syncJob{}, activities: []Activity{}, nextID: 1, nextJobID: 1, nextActivityID: 1}
	application := &app{store: store}
	response := httptest.NewRecorder()
	application.createMedia(response, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Dune", Type: "book", Status: "planned",
	}))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("create = %d, want 500", response.Code)
	}
	if len(store.items) != 0 || len(store.activities) != 0 || store.nextID != 1 || store.nextActivityID != 1 {
		t.Fatalf("failed persistence left partial state: items=%+v activities=%+v nextID=%d nextActivityID=%d", store.items, store.activities, store.nextID, store.nextActivityID)
	}
}

func TestRepeatCountUpdateRollsBackWhenPersistenceFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	store := &store{
		path: path,
		items: []Media{{
			ID: 1, Title: "Dune", Type: "book", Status: "completed", RepeatCount: 1,
			CreatedAt: now, UpdatedAt: now,
		}},
		syncJobs: []syncJob{}, activities: []Activity{},
		nextID: 2, nextJobID: 1, nextActivityID: 1,
	}
	application := &app{store: store}
	request := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Dune", Type: "book", Status: "completed", RepeatCount: intPointer(2),
	})
	request.SetPathValue("id", "1")
	response := httptest.NewRecorder()
	application.updateMedia(response, request)

	if response.Code != http.StatusInternalServerError || store.items[0].RepeatCount != 1 ||
		len(store.activities) != 0 || store.nextActivityID != 1 {
		t.Fatalf("failed update left partial state: code=%d item=%+v activities=%+v next=%d", response.Code, store.items[0], store.activities, store.nextActivityID)
	}
}

func TestActivityLimitValidationAndCap(t *testing.T) {
	store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
	for index := 0; index < 120; index++ {
		store.appendActivityLocked(Activity{Title: "Item", MediaType: "anime", Action: "added"})
	}
	application := &app{store: store}

	invalid := httptest.NewRecorder()
	application.listActivity(invalid, httptest.NewRequest(http.MethodGet, "/api/activity?limit=zero", nil))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid limit = %d, want 400", invalid.Code)
	}

	capped := httptest.NewRecorder()
	application.listActivity(capped, httptest.NewRequest(http.MethodGet, "/api/activity?limit=999", nil))
	var activities []Activity
	if err := json.NewDecoder(capped.Body).Decode(&activities); err != nil {
		t.Fatal(err)
	}
	if len(activities) != 100 {
		t.Fatalf("capped activity count = %d, want 100", len(activities))
	}
}

func jsonRequest(method, path string, body any) *http.Request {
	data, _ := json.Marshal(body)
	return httptest.NewRequest(method, path, bytes.NewReader(data))
}
