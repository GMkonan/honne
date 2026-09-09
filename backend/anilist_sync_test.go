package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalStatusMapping(t *testing.T) {
	cases := map[string]string{
		"planned": "PLANNING", "in_progress": "CURRENT", "completed": "COMPLETED",
		"paused": "PAUSED", "dropped": "DROPPED",
	}
	for local, remote := range cases {
		if got := mapLocalStatus(local); got != remote {
			t.Errorf("mapLocalStatus(%q) = %q, want %q", local, got, remote)
		}
	}
}

func TestLegacyStoreMigratesWithDurableCoalescedOutbox(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	legacy := []Media{{ID: 4, Title: "Cowboy Bebop", Type: "anime", Status: "planned", Provider: "anilist", ProviderID: "1"}}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	syncer, err := newAniListSync(testAniListConfig(path), store)
	if err != nil {
		t.Fatal(err)
	}

	store.mu.Lock()
	syncer.queueUpsertLocked(0)
	store.items[0].Progress = 2
	syncer.queueUpsertLocked(0)
	if len(store.syncJobs) != 1 || store.syncJobs[0].Generation != 2 {
		t.Fatalf("expected one coalesced job, got %+v", store.syncJobs)
	}
	if err := store.persistLocked(); err != nil {
		t.Fatal(err)
	}
	store.mu.Unlock()

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.items) != 1 || len(reopened.syncJobs) != 1 || reopened.nextID != 5 {
		t.Fatalf("migration did not survive restart: %+v", reopened)
	}
	persisted, _ := os.ReadFile(path)
	if !strings.Contains(string(persisted), `"version": 3`) {
		t.Fatalf("expected versioned store, got %s", persisted)
	}
}

func TestPendingDeletePreventsMediaIDReuseAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	store.nextID = 6
	store.syncJobs = []syncJob{{ID: 1, MediaID: 5, Operation: syncDelete, ProviderMediaID: 20}}
	store.nextJobID = 2
	store.mu.Lock()
	if err := store.persistLocked(); err != nil {
		t.Fatal(err)
	}
	store.mu.Unlock()

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.nextID != 6 {
		t.Fatalf("nextID = %d, want 6 so tombstone identity cannot be reused", reopened.nextID)
	}
}

func TestManualAniListTypeStaysLocalOnly(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	store.items = []Media{{ID: 1, Title: "Manual", Type: "anime", Status: "planned"}}
	syncer, _ := newAniListSync(testAniListConfig(store.path), store)
	store.mu.Lock()
	syncer.queueUpsertLocked(0)
	store.mu.Unlock()
	if store.items[0].SyncStatus != "local_only" || len(store.syncJobs) != 0 {
		t.Fatalf("unexpected manual item sync state: %+v", store.items[0])
	}
}

func TestRepeatUpdateQueuesOnlyAfterAniListValueIsKnown(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	store.items = []Media{{
		ID: 1, Title: "Bebop", Type: "anime", Status: "completed", Progress: 26, Total: 26,
		Rating: 9, Notes: "Original", RepeatCount: 1, Provider: "anilist", ProviderID: "20", SyncStatus: "synced",
	}}
	store.nextID = 2
	syncer, err := newAniListSync(testAniListConfig(store.path), store)
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store, anilist: syncer}

	repeatOnly := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Bebop", Type: "anime", Status: "completed", Progress: 26, Total: 26,
		Rating: 9, Notes: "Original", RepeatCount: intPointer(2), Provider: "anilist", ProviderID: "20",
	})
	repeatOnly.SetPathValue("id", "1")
	repeatResponse := httptest.NewRecorder()
	application.updateMedia(repeatResponse, repeatOnly)
	if repeatResponse.Code != http.StatusOK || len(store.syncJobs) != 0 || store.items[0].SyncStatus != "synced" {
		t.Fatalf("local repeat update affected AniList sync: code=%d item=%+v jobs=%+v", repeatResponse.Code, store.items[0], store.syncJobs)
	}

	store.items[0].AniListUserID = 7
	store.items[0].AniListRepeatKnown = true
	knownRepeatUpdate := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Bebop", Type: "anime", Status: "completed", Progress: 26, Total: 26,
		Rating: 9, Notes: "Original", RepeatCount: intPointer(3), Provider: "anilist", ProviderID: "20",
	})
	knownRepeatUpdate.SetPathValue("id", "1")
	knownResponse := httptest.NewRecorder()
	application.updateMedia(knownResponse, knownRepeatUpdate)
	if knownResponse.Code != http.StatusOK || len(store.syncJobs) != 1 || store.syncJobs[0].AniListUserID != 7 {
		t.Fatalf("known repeat update did not queue for its AniList account: code=%d jobs=%+v", knownResponse.Code, store.syncJobs)
	}
	reopened, err := newStore(store.path)
	if err != nil || len(reopened.syncJobs) != 1 || reopened.syncJobs[0].AniListUserID != 7 || reopened.items[0].RepeatCount != 3 {
		t.Fatalf("repeat sync intent did not survive restart: store=%+v err=%v", reopened, err)
	}
}

func TestDeleteCancelsUpsertQueuedBeforeAnyAccountWasConnected(t *testing.T) {
	store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
	store.items = []Media{{ID: 1, Title: "Bebop", Type: "anime", Status: "planned", Provider: "anilist", ProviderID: "20"}}
	syncer, _ := newAniListSync(testAniListConfig(store.path), store)
	store.mu.Lock()
	syncer.queueUpsertLocked(0)
	item := store.items[0]
	syncer.queueDeleteLocked(item)
	store.mu.Unlock()
	if len(store.syncJobs) != 0 {
		t.Fatalf("pre-connection upsert should be cancelled, got %+v", store.syncJobs)
	}
}

func TestLocalOnlyDeleteDoesNotTouchConnectedAccount(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	item := Media{ID: 1, Title: "Public import", Type: "anime", Status: "planned", Provider: "anilist", ProviderID: "20", SyncStatus: "local_only"}
	syncer, _ := newAniListSync(testAniListConfig(store.path), store)
	store.mu.Lock()
	syncer.queueDeleteLocked(item)
	store.mu.Unlock()
	if len(store.syncJobs) != 0 {
		t.Fatalf("local-only deletion queued a remote operation: %+v", store.syncJobs)
	}
}

func TestSyncWorkerSafelyHydratesThenSendsAniListRepeat(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token" {
			t.Fatalf("missing bearer token")
		}
		var request struct {
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		received = request.Variables
		remoteRepeat := 4
		if repeat, ok := received["repeat"].(float64); ok {
			remoteRepeat = int(repeat)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"data":{"SaveMediaListEntry":{"id":99,"repeat":%d}}}`, remoteRepeat)
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	store.items = []Media{{ID: 1, Title: "Bebop", Type: "anime", Status: "in_progress", Progress: 7, Rating: 8, Notes: "good", Provider: "anilist", ProviderID: "1"}}
	cfg := testAniListConfig(path)
	cfg.AniListAPIURL = server.URL
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "owner", ExpiresAt: time.Now().Add(time.Hour)}
	store.mu.Lock()
	syncer.queueUpsertLocked(0)
	_ = store.persistLocked()
	store.mu.Unlock()

	if !syncer.processNext(context.Background()) {
		t.Fatal("expected worker to process a job")
	}
	if received["status"] != "CURRENT" || received["scoreRaw"] != float64(80) || received["progress"] != float64(7) {
		t.Fatalf("unexpected AniList variables: %+v", received)
	}
	if _, sentUnknownRepeat := received["repeat"]; sentUnknownRepeat {
		t.Fatalf("unknown local repeat count was sent to AniList: %+v", received)
	}
	if len(store.syncJobs) != 0 || store.items[0].SyncStatus != "synced" || store.items[0].ProviderListEntryID != 99 ||
		store.items[0].RepeatCount != 4 || !store.items[0].AniListRepeatKnown || store.items[0].AniListUserID != 7 {
		t.Fatalf("remote repeat was not safely hydrated: items=%+v jobs=%+v", store.items, store.syncJobs)
	}

	store.mu.Lock()
	store.items[0].RepeatCount = 5
	syncer.queueUpsertLocked(0)
	store.mu.Unlock()
	if !syncer.processNext(context.Background()) {
		t.Fatal("expected worker to sync a known repeat count")
	}
	if received["repeat"] != float64(5) || store.items[0].RepeatCount != 5 || len(store.syncJobs) != 0 {
		t.Fatalf("known repeat did not synchronize: variables=%+v item=%+v jobs=%+v", received, store.items[0], store.syncJobs)
	}
}

func TestKnownAniListRepeatRequiresRemoteConfirmation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SaveMediaListEntry":{"id":99}}}`))
	}))
	defer server.Close()

	store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
	cfg := testAniListConfig(store.path)
	cfg.AniListAPIURL = server.URL
	syncer, _ := newAniListSync(cfg, store)
	_, err := syncer.upsertRemote(context.Background(), aniListAuth{AccessToken: "token", UserID: 7}, Media{
		Provider: "anilist", ProviderID: "20", Type: "anime", Status: "completed",
		RepeatCount: 2, AniListUserID: 7, AniListRepeatKnown: true,
	})
	if err == nil || !strings.Contains(err.Error(), "confirm the repeat count") {
		t.Fatalf("known repeat was accepted without confirmation: %v", err)
	}
}

func TestPositiveLocalRepeatIsPreservedDuringInitialHydration(t *testing.T) {
	store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
	sentItem := Media{ID: 1, Title: "Bebop", Type: "anime", Status: "completed", RepeatCount: 2, Provider: "anilist", ProviderID: "20"}
	store.items = []Media{sentItem}
	store.syncJobs = []syncJob{{
		ID: 1, MediaID: 1, Operation: syncUpsert, ProviderMediaID: 20, AniListUserID: 7,
		Generation: 1, NextAttemptAt: time.Now(),
	}}
	store.nextJobID = 2
	syncer, _ := newAniListSync(testAniListConfig(store.path), store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "owner", ExpiresAt: time.Now().Add(time.Hour)}
	remoteRepeat := 0

	syncer.recordSuccess(
		store.syncJobs[0],
		aniListUpsertResult{ListEntryID: 99, Repeat: &remoteRepeat},
		sentItem,
		7,
	)

	item := store.items[0]
	if item.RepeatCount != 2 || !item.AniListRepeatKnown || item.AniListUserID != 7 || len(store.syncJobs) != 1 || store.syncJobs[0].AniListUserID != 7 {
		t.Fatalf("positive local repeat was not preserved and queued: item=%+v jobs=%+v", item, store.syncJobs)
	}
}

func TestAniListSuccessRollsBackWhenPersistenceFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	now := time.Now().UTC()
	sentItem := Media{
		ID: 1, Title: "Bebop", Type: "anime", Status: "completed", Provider: "anilist", ProviderID: "20",
		SyncStatus: "pending", CreatedAt: now, UpdatedAt: now,
	}
	job := syncJob{
		ID: 1, MediaID: 1, Operation: syncUpsert, ProviderMediaID: 20, AniListUserID: 7,
		Generation: 1, NextAttemptAt: now, CreatedAt: now, UpdatedAt: now,
	}
	store.items = []Media{sentItem}
	store.syncJobs = []syncJob{job}
	store.nextID = 2
	store.nextJobID = 2
	store.mu.Lock()
	if err := store.persistLocked(); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()

	store.path = t.TempDir()
	syncer, _ := newAniListSync(testAniListConfig(store.path), store)
	remoteRepeat := 4
	err := syncer.recordSuccess(job, aniListUpsertResult{ListEntryID: 99, Repeat: &remoteRepeat}, sentItem, 7)
	if err == nil || store.items[0].ProviderListEntryID != 0 || store.items[0].RepeatCount != 0 ||
		store.items[0].AniListRepeatKnown || len(store.syncJobs) != 1 || store.syncJobs[0].Attempts != 1 ||
		store.items[0].SyncStatus != "error" {
		t.Fatalf("failed success persistence did not roll back safely: err=%v item=%+v jobs=%+v", err, store.items[0], store.syncJobs)
	}
	reopened, err := newStore(path)
	if err != nil || len(reopened.syncJobs) != 1 || reopened.items[0].SyncStatus != "pending" {
		t.Fatalf("durable job was not recoverable after restart: store=%+v err=%v", reopened, err)
	}
}

func TestDeleteLooksUpListEntryWhenMissing(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		queries = append(queries, request.Query)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(request.Query, "MediaList(mediaId") {
			_, _ = w.Write([]byte(`{"data":{"MediaList":{"id":321}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":{"DeleteMediaListEntry":{"deleted":true}}}`))
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	cfg := testAniListConfig(path)
	cfg.AniListAPIURL = server.URL
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "owner", ExpiresAt: time.Now().Add(time.Hour)}
	store.syncJobs = []syncJob{{ID: 1, MediaID: 10, Operation: syncDelete, ProviderMediaID: 20, Generation: 1, NextAttemptAt: time.Now().Add(-time.Second)}}

	if !syncer.processNext(context.Background()) || len(queries) != 2 || len(store.syncJobs) != 0 {
		t.Fatalf("delete was not resolved and completed: queries=%d jobs=%+v", len(queries), store.syncJobs)
	}
}

func TestDeleteSkipsLegacyAniListEntryWithUnknownOwner(t *testing.T) {
	store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
	item := Media{
		ID: 1, Title: "Legacy", Type: "anime", Status: "completed", Provider: "anilist", ProviderID: "20",
		ProviderListEntryID: 99, SyncStatus: "synced",
	}
	syncer, _ := newAniListSync(testAniListConfig(store.path), store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 8, Username: "other", ExpiresAt: time.Now().Add(time.Hour)}
	store.mu.Lock()
	syncer.queueDeleteLocked(item)
	store.mu.Unlock()
	if len(store.syncJobs) != 0 {
		t.Fatalf("legacy unowned list-entry ID was queued for deletion: %+v", store.syncJobs)
	}
}

func TestDeleteKeepsRestoredAniListOwnerInsteadOfCurrentAccount(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"DeleteMediaListEntry":{"deleted":true}}}`))
	}))
	defer server.Close()

	store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
	item := Media{
		ID: 1, Title: "Bebop", Type: "anime", Status: "completed", Provider: "anilist", ProviderID: "20",
		ProviderListEntryID: 99, AniListUserID: 7, AniListRepeatKnown: true, SyncStatus: "synced",
	}
	cfg := testAniListConfig(store.path)
	cfg.AniListAPIURL = server.URL
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 8, Username: "other", ExpiresAt: time.Now().Add(time.Hour)}
	store.mu.Lock()
	syncer.queueDeleteLocked(item)
	store.mu.Unlock()

	if len(store.syncJobs) != 1 || store.syncJobs[0].AniListUserID != 7 {
		t.Fatalf("delete was assigned to the wrong AniList owner: %+v", store.syncJobs)
	}
	if syncer.processNext(context.Background()) || calls != 0 || store.syncJobs[0].LastError == "" {
		t.Fatalf("cross-account delete was not safely paused: calls=%d jobs=%+v", calls, store.syncJobs)
	}
}

func TestDeleteTreatsAlreadyAbsentEntryAsSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errors":[{"message":"Media list entry not found"}]}`))
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	store.syncJobs = []syncJob{{ID: 1, MediaID: 10, Operation: syncDelete, ProviderMediaID: 20, ProviderListEntryID: 321, Generation: 1, NextAttemptAt: time.Now().Add(-time.Second)}}
	cfg := testAniListConfig(path)
	cfg.AniListAPIURL = server.URL
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "owner", ExpiresAt: time.Now().Add(time.Hour)}

	if !syncer.processNext(context.Background()) || len(store.syncJobs) != 0 {
		t.Fatalf("already-absent remote entry should complete deletion: %+v", store.syncJobs)
	}
}

func TestWorkerDoesNotRunAnotherAccountsJob(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"SaveMediaListEntry":{"id":99}}}`))
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	store.items = []Media{{ID: 1, Title: "Bebop", Type: "anime", Status: "planned", Provider: "anilist", ProviderID: "1"}}
	store.syncJobs = []syncJob{{ID: 1, MediaID: 1, Operation: syncUpsert, ProviderMediaID: 1, AniListUserID: 8, Generation: 1, NextAttemptAt: time.Now().Add(-time.Second)}}
	cfg := testAniListConfig(path)
	cfg.AniListAPIURL = server.URL
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "owner", ExpiresAt: time.Now().Add(time.Hour)}

	if syncer.processNext(context.Background()) {
		t.Fatal("worker should pause a job owned by another account")
	}
	if calls != 0 || store.syncJobs[0].LastError == "" || store.items[0].SyncStatus != "waiting_auth" {
		t.Fatalf("cross-account job was not safely paused: calls=%d job=%+v item=%+v", calls, store.syncJobs[0], store.items[0])
	}
}

func TestForbiddenAniListResponsePausesForReconnect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	store.items = []Media{{ID: 1, Title: "Bebop", Type: "anime", Status: "planned", Provider: "anilist", ProviderID: "1"}}
	cfg := testAniListConfig(path)
	cfg.AniListAPIURL = server.URL
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "revoked", UserID: 7, Username: "owner", ExpiresAt: time.Now().Add(time.Hour)}
	store.mu.Lock()
	syncer.queueUpsertLocked(0)
	store.mu.Unlock()

	if syncer.processNext(context.Background()) {
		t.Fatal("worker should stop when authorization needs reconnection")
	}
	if _, connected := syncer.authSnapshot(); connected || store.items[0].SyncStatus != "waiting_auth" {
		t.Fatalf("authorization was not paused: auth=%+v item=%+v", syncer.auth, store.items[0])
	}
}

func TestDisconnectDetachesSyncedItemsAndRejectsPendingJobs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	store.items = []Media{{ID: 1, Title: "Bebop", Type: "anime", Status: "planned", RepeatCount: 2, Provider: "anilist", ProviderID: "20", ProviderListEntryID: 99, AniListUserID: 7, AniListRepeatKnown: true, SyncStatus: "synced"}}
	cfg := testAniListConfig(path)
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "owner", ExpiresAt: time.Now().Add(time.Hour)}
	if err := syncer.persistAuth(*syncer.auth); err != nil {
		t.Fatal(err)
	}

	store.syncJobs = []syncJob{{ID: 1, MediaID: 1, Operation: syncUpsert}}
	blocked := httptest.NewRecorder()
	syncer.disconnectHandler(blocked, httptest.NewRequest(http.MethodDelete, "/api/integrations/anilist", nil))
	if blocked.Code != http.StatusConflict {
		t.Fatalf("disconnect with pending jobs = %d, want 409", blocked.Code)
	}

	disconnected := httptest.NewRecorder()
	syncer.disconnectHandler(disconnected, httptest.NewRequest(http.MethodDelete, "/api/integrations/anilist?discardPending=true", nil))
	if disconnected.Code != http.StatusNoContent || len(store.syncJobs) != 0 || store.items[0].SyncStatus != "local_only" || store.items[0].ProviderListEntryID != 0 || store.items[0].AniListUserID != 0 || store.items[0].AniListRepeatKnown {
		t.Fatalf("forced disconnect did not discard jobs and detach items: code=%d jobs=%+v item=%+v", disconnected.Code, store.syncJobs, store.items[0])
	}
}

func TestOAuthCallbackPersistsPrivateTokenAndViewer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":
			_, _ = w.Write([]byte(`{"access_token":"secret-token","token_type":"Bearer","expires_in":3600}`))
		case "/graphql":
			_, _ = w.Write([]byte(`{"data":{"Viewer":{"id":7,"name":"Owner","avatar":{"large":"avatar"}}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	store, _ := newStore(path)
	cfg := testAniListConfig(path)
	cfg.AniListAuthorizeURL = server.URL + "/authorize"
	cfg.AniListTokenURL = server.URL + "/token"
	cfg.AniListAPIURL = server.URL + "/graphql"
	cfg.AllowedOrigin = "http://honne.test"
	syncer, err := newAniListSync(cfg, store)
	if err != nil {
		t.Fatal(err)
	}

	connectResponse := httptest.NewRecorder()
	syncer.connectHandler(connectResponse, httptest.NewRequest(http.MethodGet, "/api/integrations/anilist/connect", nil))
	location, err := url.Parse(connectResponse.Header().Get("Location"))
	if err != nil || location.Query().Get("state") == "" {
		t.Fatalf("missing OAuth state in %q", connectResponse.Header().Get("Location"))
	}
	callback := "/api/integrations/anilist/callback?code=ok&state=" + url.QueryEscape(location.Query().Get("state"))
	callbackRequest := httptest.NewRequest(http.MethodGet, callback, nil)
	for _, cookie := range connectResponse.Result().Cookies() {
		callbackRequest.AddCookie(cookie)
	}
	callbackResponse := httptest.NewRecorder()
	syncer.callbackHandler(callbackResponse, callbackRequest)
	if callbackResponse.Code != http.StatusFound || callbackResponse.Header().Get("Location") != "http://honne.test/?anilist=connected#settings" {
		t.Fatalf("unexpected callback response: %d %q", callbackResponse.Code, callbackResponse.Header().Get("Location"))
	}
	username, connected := syncer.connectedUsername()
	if !connected || username != "Owner" {
		t.Fatalf("unexpected connected user: %q %v", username, connected)
	}
	info, err := os.Stat(cfg.AniListAuthPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("auth file mode = %o, want 600", info.Mode().Perm())
	}
}

func TestConnectedImportRejectsAnotherUsername(t *testing.T) {
	store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
	cfg := testAniListConfig(store.path)
	syncer, _ := newAniListSync(cfg, store)
	syncer.auth = &aniListAuth{AccessToken: "token", Username: "Owner", ExpiresAt: time.Now().Add(time.Hour)}
	application := &app{store: store, anilist: syncer}
	request := httptest.NewRequest(http.MethodGet, "/api/import/anilist?username=someone-else", nil)
	response := httptest.NewRecorder()
	application.previewAniListImport(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", response.Code, response.Body.String())
	}
}

func testAniListConfig(dataPath string) config {
	return config{
		DataPath:             dataPath,
		AllowedOrigin:        "http://localhost:5173",
		AniListAPIURL:        "http://example.invalid/graphql",
		AniListClientID:      "client",
		AniListClientSecret:  "secret",
		AniListRedirectURL:   "http://localhost:8080/api/integrations/anilist/callback",
		AniListAuthPath:      filepath.Join(filepath.Dir(dataPath), "anilist-auth.json"),
		AniListAuthorizeURL:  "http://example.invalid/authorize",
		AniListTokenURL:      "http://example.invalid/token",
		AniListDeleteEnabled: true,
	}
}
