package main

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRefreshMediaMetadataUsesTitleFallbackAndPreservesPersonalData(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/anilist" {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path != "/api/edge/anime" {
			t.Fatalf("unexpected provider path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/vnd.api+json")
		_, _ = w.Write([]byte(`{"data":[{"id":"1","attributes":{"canonicalTitle":"Cowboy Bebop","titles":{"en":"Cowboy Bebop","ja_jp":"カウボーイビバップ"},"synopsis":"Space bounty hunters.","startDate":"1998-04-03","endDate":"1999-04-24","status":"finished","averageRating":"82.27","episodeCount":26,"episodeLength":25,"subtype":"TV","posterImage":{"large":"https://example.com/bebop.jpg"}},"relationships":{"genres":{"data":[{"id":"1"}]}}}],"included":[{"id":"1","type":"genres","attributes":{"name":"Sci-Fi"}}],"links":{}}`))
	}))
	defer provider.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	s, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	item := mediaFromInput(1, mediaInput{
		Title: "Cowboy Bebop", Type: "anime", Status: "in_progress", Progress: 8,
		Total: 30, Rating: 9, Notes: "personal note", Provider: "anilist", ProviderID: "5",
	}, now)
	s.items = append(s.items, item)
	s.nextID = 2
	s.mu.Lock()
	if err := s.persistLocked(); err != nil {
		s.mu.Unlock()
		t.Fatal(err)
	}
	s.mu.Unlock()

	discovery := testDiscoveryService(provider.URL + "/anilist")
	discovery.anilistBase = provider.URL + "/anilist"
	discovery.kitsuBase = provider.URL + "/api/edge"
	application := &app{store: s, discovery: discovery}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/media/1/refresh-metadata", nil)
	request.SetPathValue("id", "1")
	application.refreshMediaMetadata(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var updated Media
	if err := json.NewDecoder(response.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.Provider != "anilist" || updated.ProviderID != "5" || updated.ProviderURL != "" {
		t.Fatalf("fallback changed provider identity: %+v", updated)
	}
	if updated.Status != "in_progress" || updated.Progress != 8 || updated.Total != 30 || updated.Rating != 9 || updated.Notes != "personal note" {
		t.Fatalf("personal data changed during refresh: %+v", updated)
	}
	if !updated.UpdatedAt.Equal(now) {
		t.Fatalf("metadata refresh changed personal timestamp: %s", updated.UpdatedAt)
	}
	if updated.Format != "TV" || updated.ReleaseStatus != "finished" || updated.CatalogTotal != 26 || updated.DurationMinutes != 25 || updated.CommunityRating != 8.227 || len(updated.Genres) != 1 || updated.Genres[0] != "Sci-Fi" {
		t.Fatalf("expanded metadata was not refreshed: %+v", updated)
	}
	if updated.Description != "Space bounty hunters." || updated.CoverURL == "" || updated.OriginalTitle == "" || updated.ReleaseYear != 1998 {
		t.Fatalf("empty basic metadata was not enriched: %+v", updated)
	}

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.items) != 1 || reopened.items[0].CatalogTotal != 26 || reopened.items[0].Status != "in_progress" {
		t.Fatalf("refreshed metadata did not survive restart: %+v", reopened.items)
	}
}

func TestRefreshMediaMetadataRejectsMissingAndLocalOnlyMedia(t *testing.T) {
	s := &store{items: []Media{{ID: 1, Title: "Manual", Type: "book"}}}
	application := &app{store: s}

	for _, test := range []struct {
		id   string
		want int
	}{
		{id: "99", want: http.StatusNotFound},
		{id: "1", want: http.StatusUnprocessableEntity},
		{id: "bad", want: http.StatusBadRequest},
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/media/"+test.id+"/refresh-metadata", nil)
		request.SetPathValue("id", test.id)
		application.refreshMediaMetadata(response, request)
		if response.Code != test.want {
			t.Fatalf("id %s: expected %d, got %d: %s", test.id, test.want, response.Code, response.Body.String())
		}
	}
}

func TestRefreshMediaMetadataRejectsMissingMatch(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"numFound":1,"docs":[{"key":"/works/2","title":"Another Book"}]}`))
	}))
	defer provider.Close()

	s := &store{items: []Media{{ID: 1, Title: "Dune", Type: "book", Provider: "open_library", ProviderID: "1"}}}
	application := &app{store: s, discovery: testDiscoveryService(provider.URL)}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/media/1/refresh-metadata", nil)
	request.SetPathValue("id", "1")
	application.refreshMediaMetadata(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", response.Code, response.Body.String())
	}
}

func TestRefreshedMetadataFallbackRequiresMatchingKnownYear(t *testing.T) {
	item := Media{Title: "The Thing", Type: "movie", ReleaseYear: 1982, Provider: "tmdb", ProviderID: "original"}
	results := []discoveryResult{
		{Provider: "fallback", ProviderID: "2011", Title: "The Thing", Type: "movie", ReleaseYear: 2011},
		{Provider: "fallback", ProviderID: "1982", Title: "The Thing", Type: "movie", ReleaseYear: 1982},
	}

	matched, exact := refreshedMetadataMatch(item, results)
	if matched == nil || matched.ReleaseYear != 1982 || exact {
		t.Fatalf("expected the same-year title fallback, got %+v (exact=%t)", matched, exact)
	}
}

func TestApplyRefreshedMetadataDiscardsInvalidProviderFields(t *testing.T) {
	item := Media{Format: "TV", ReleaseStatus: "finished", StartDate: "1998", DurationMinutes: 25, CommunityRating: 8}
	applyRefreshedMetadata(&item, discoveryResult{
		Format: strings.Repeat("x", 51), ReleaseStatus: "unknown",
		StartDate: "not-a-date", EndDate: "1990-13", DurationMinutes: 10081,
		CommunityRating: math.NaN(),
	}, true)

	if item.Format != "TV" || item.ReleaseStatus != "finished" || item.StartDate != "1998" ||
		item.EndDate != "" || item.DurationMinutes != 25 || item.CommunityRating != 8 {
		t.Fatalf("invalid provider metadata replaced valid values: %+v", item)
	}
}

func TestRefreshMediaMetadataRejectsConcurrentIdentityChange(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"numFound":1,"docs":[{"key":"/works/1","title":"Dune","subject":["Science Fiction"]}]}`))
	}))
	defer provider.Close()

	s := &store{items: []Media{{ID: 1, Title: "Dune", Type: "book", Provider: "open_library", ProviderID: "1"}}}
	application := &app{store: s, discovery: testDiscoveryService(provider.URL)}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/media/1/refresh-metadata", nil)
	request.SetPathValue("id", "1")
	done := make(chan struct{})
	go func() {
		application.refreshMediaMetadata(response, request)
		close(done)
	}()

	<-started
	s.mu.Lock()
	s.items[0].Title = "Dune Messiah"
	s.mu.Unlock()
	close(release)
	<-done
	if response.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
	}
	if len(s.items[0].Genres) != 0 {
		t.Fatalf("stale metadata was applied after identity change: %+v", s.items[0])
	}
}
