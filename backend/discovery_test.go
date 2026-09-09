package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSearchAniListNormalizesAndCaches(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		var requestBody struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(requestBody.Query, "format:") {
			t.Fatalf("anime search must not send a format filter: %s", requestBody.Query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"Page":{"pageInfo":{"hasNextPage":false},"media":[{"id":1,"siteUrl":"https://anilist.co/anime/1","format":"TV","status":"FINISHED","description":"Space bounty hunters.<br>In space.","episodes":26,"duration":24,"genres":["Action","Sci-Fi"],"averageScore":88,"title":{"romaji":"Cowboy Bebop","english":"Cowboy Bebop","native":"カウボーイビバップ"},"coverImage":{"extraLarge":"https://example.com/cover.jpg"},"startDate":{"year":1998,"month":4,"day":3},"endDate":{"year":1999,"month":4,"day":24},"studios":{"nodes":[{"name":"Sunrise"}]},"staff":{"edges":[{"role":"Director","node":{"name":{"full":"Shinichiro Watanabe"}}}]}}]}}}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	for range 2 {
		response, err := service.search(context.Background(), "anime", "bebop", 1)
		if err != nil {
			t.Fatal(err)
		}
		if len(response.Results) != 1 || response.Results[0].Format != "TV" || response.Results[0].Total != 26 || response.Results[0].CatalogTotal != 26 || response.Results[0].Subtitle != "Sunrise" || strings.Contains(response.Results[0].Description, "<br>") {
			t.Fatalf("unexpected normalized response: %+v", response)
		}
		result := response.Results[0]
		if strings.Join(result.Genres, ",") != "Action,Sci-Fi" || result.ReleaseStatus != "finished" || result.StartDate != "1998-04-03" || result.EndDate != "1999-04-24" || result.DurationMinutes != 24 || len(result.Credits) != 2 || result.Credits[0] != (mediaCredit{Name: "Sunrise", Role: "Studio"}) || result.Credits[1] != (mediaCredit{Name: "Shinichiro Watanabe", Role: "Director"}) {
			t.Fatalf("expanded AniList metadata was not normalized: %+v", result)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("expected cached second request, got %d provider calls", calls.Load())
	}
}

func TestSearchFallsBackToKitsuWhenAniListIsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/anilist" {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path != "/api/edge/anime" || r.Header.Get("Accept") != "application/vnd.api+json" || r.URL.Query().Get("filter[text]") != "frieren" || r.URL.Query().Get("include") != "genres" {
			t.Fatalf("unexpected Kitsu request: %s", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/vnd.api+json")
		_, _ = w.Write([]byte(`{"data":[{"id":"46474","attributes":{"canonicalTitle":"Sousou no Frieren","titles":{"en":"Frieren: Beyond Journey's End","ja_jp":"葬送のフリーレン"},"synopsis":"An elven mage.","startDate":"2023-09-29","endDate":"2024-03-22","status":"finished","averageRating":"88.81","episodeCount":28,"episodeLength":24,"subtype":"TV","posterImage":{"large":"https://example.com/frieren.jpg"}},"relationships":{"genres":{"data":[{"id":"8"},{"id":"14"}]}}}],"included":[{"id":"8","type":"genres","attributes":{"name":"Fantasy"}},{"id":"14","type":"genres","attributes":{"name":"Adventure"}}],"links":{"next":"https://example.com/next"}}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.anilistBase = server.URL + "/anilist"
	service.kitsuBase = server.URL + "/api/edge"
	response, err := service.search(context.Background(), "anime", "frieren", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 1 || response.Results[0].Provider != "kitsu" || response.Results[0].Format != "TV" || response.Results[0].Total != 28 || response.Results[0].CatalogTotal != 28 || response.Results[0].ReleaseYear != 2023 || response.Results[0].CommunityRating != 8.881 || !response.HasMore {
		t.Fatalf("unexpected Kitsu fallback response: %+v", response)
	}
	result := response.Results[0]
	if strings.Join(result.Genres, ",") != "Fantasy,Adventure" || result.ReleaseStatus != "finished" || result.StartDate != "2023-09-29" || result.EndDate != "2024-03-22" || result.DurationMinutes != 24 {
		t.Fatalf("expanded Kitsu metadata was not normalized: %+v", result)
	}
}

func TestSearchKitsuRejectsNonFiniteRating(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.api+json")
		_, _ = w.Write([]byte(`{"data":[{"id":"1","attributes":{"canonicalTitle":"Invalid rating","averageRating":"NaN","subtype":"TV"}}],"links":{}}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.kitsuBase = server.URL
	response, err := service.searchKitsu(context.Background(), "anime", "invalid", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 1 || response.Results[0].CommunityRating != 0 {
		t.Fatalf("non-finite Kitsu rating was not normalized: %+v", response.Results)
	}
}

func TestSearchBooksNormalizesCover(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"numFound":1,"docs":[{"key":"/works/OL123W","title":"Dune","author_name":["Frank Herbert"],"first_publish_year":1965,"cover_i":42,"number_of_pages_median":412,"subject":["Science Fiction","nyt:mass-market-monthly=2021-11-07","Politics","award:nebula_award=novel","New York Times reviewed"]}]}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	response, err := service.searchBooks(context.Background(), "Dune", 1)
	if err != nil {
		t.Fatal(err)
	}
	result := response.Results[0]
	if result.ProviderID != "OL123W" || result.Total != 412 || result.CatalogTotal != 412 || !strings.Contains(result.CoverURL, "/42-L.jpg") {
		t.Fatalf("unexpected normalized result: %+v", result)
	}
	if strings.Join(result.Genres, ",") != "Science Fiction,Politics" || result.StartDate != "1965" || len(result.Credits) != 1 || result.Credits[0] != (mediaCredit{Name: "Frank Herbert", Role: "Author"}) {
		t.Fatalf("expanded Open Library metadata was not normalized: %+v", result)
	}
}

func TestSearchAniListFiltersLightNovels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var requestBody struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(requestBody.Query, "format: NOVEL") {
			t.Fatalf("light novel search must require NOVEL format")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"Page":{"pageInfo":{"hasNextPage":false},"media":[{"id":123,"siteUrl":"https://anilist.co/manga/123","format":"NOVEL","chapters":10,"title":{"romaji":"Novel","english":"A Novel","native":"小説"},"coverImage":{"extraLarge":"https://example.com/novel.jpg"},"startDate":{"year":2020},"studios":{"nodes":[]}}]}}}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	response, err := service.searchAniList(context.Background(), "light_novel", "novel", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 1 || response.Results[0].Type != "light_novel" {
		t.Fatalf("unexpected light novel results: %+v", response.Results)
	}
}

func TestSearchTMDBUsesBearerToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" || r.URL.Path != "/search/movie" {
			t.Fatalf("unexpected TMDB request")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"total_pages":1,"results":[{"id":550,"title":"Fight Club","original_title":"Fight Club","overview":"An insomniac.","poster_path":"/poster.jpg","release_date":"1999-10-15","vote_average":8.4,"genre_ids":[18,53]}]}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"
	response, err := service.searchTMDB(context.Background(), "movie", "Fight Club", 1)
	if err != nil {
		t.Fatal(err)
	}
	result := response.Results[0]
	if result.ReleaseYear != 1999 || result.StartDate != "1999-10-15" || result.ProviderID != "550" || result.Type != "movie" || strings.Join(result.Genres, ",") != "Drama,Thriller" {
		t.Fatalf("unexpected normalized result: %+v", result)
	}
}

func TestDiscoveryValidation(t *testing.T) {
	application := &app{discovery: testDiscoveryService("http://example.invalid")}
	request := httptest.NewRequest(http.MethodGet, "/api/discovery/search?type=game&q=x", nil)
	recorder := httptest.NewRecorder()
	application.searchDiscovery(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestAniListImportMapsAndPersistsEntries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var requestBody struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(requestBody.Query, "progress repeat notes") {
			t.Fatalf("AniList import query does not request repeat: %s", requestBody.Query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"User":{"name":"konan","avatar":{"large":"https://example.com/avatar.jpg"}},"anime":{"lists":[{"entries":[{"id":700,"status":"CURRENT","score":8,"progress":12,"repeat":2,"notes":"great","media":{"id":20,"siteUrl":"https://anilist.co/anime/20","format":"TV","status":"FINISHED","description":"Ninjas.<br>More ninjas.","episodes":220,"duration":23,"genres":["Action"],"averageScore":79,"title":{"romaji":"NARUTO","english":"Naruto","native":"NARUTO -ナルト-"},"coverImage":{"extraLarge":"https://example.com/naruto.jpg"},"startDate":{"year":2002,"month":10,"day":3},"endDate":{"year":2007,"month":2,"day":8},"studios":{"nodes":[{"name":"Pierrot"}]},"staff":{"edges":[{"role":"Original Creator","node":{"name":{"full":"Masashi Kishimoto"}}}]}}}]}]},"manga":{"lists":[{"entries":[{"id":701,"status":"PLANNING","score":0,"progress":0,"repeat":1,"notes":"","media":{"id":123,"siteUrl":"https://anilist.co/manga/123","format":"NOVEL","description":"A novel.","chapters":10,"title":{"romaji":"Novel","english":"A Novel","native":"小説"},"coverImage":{"extraLarge":"https://example.com/novel.jpg"},"startDate":{"year":2020},"studios":{"nodes":[]}}}]}]}}}`))
	}))
	defer server.Close()

	store, err := newStore(filepath.Join(t.TempDir(), "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	syncer, err := newAniListSync(testAniListConfig(store.path), store)
	if err != nil {
		t.Fatal(err)
	}
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "konan", ExpiresAt: time.Now().Add(time.Hour)}
	application := &app{store: store, discovery: testDiscoveryService(server.URL), anilist: syncer}
	body, _ := json.Marshal(anilistImportRequest{Username: "konan", Types: []string{"anime", "light_novel"}, Statuses: []string{"in_progress", "planned"}})
	request := httptest.NewRequest(http.MethodPost, "/api/import/anilist", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	application.importAniList(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if len(store.items) != 2 || store.items[0].Provider != "anilist" || store.items[1].Type != "light_novel" {
		t.Fatalf("unexpected imported items: %+v", store.items)
	}
	if store.items[0].ProviderListEntryID != 700 || store.items[1].ProviderListEntryID != 701 || store.items[0].SyncStatus != "synced" ||
		store.items[0].RepeatCount != 2 || !store.items[0].AniListRepeatKnown || store.items[0].AniListUserID != 7 || store.items[1].RepeatCount != 1 {
		t.Fatalf("connected import did not retain owned AniList state: %+v", store.items)
	}
	if strings.Contains(store.items[0].Description, "<br>") || store.items[0].Progress != 12 {
		t.Fatalf("metadata was not normalized: %+v", store.items[0])
	}
	metadata := store.items[0]
	if metadata.Format != "TV" || strings.Join(metadata.Genres, ",") != "Action" || metadata.ReleaseStatus != "finished" || metadata.StartDate != "2002-10-03" || metadata.EndDate != "2007-02-08" || metadata.DurationMinutes != 23 || metadata.CatalogTotal != 220 || metadata.CommunityRating != 7.9 || len(metadata.Credits) != 2 {
		t.Fatalf("expanded import metadata was not persisted: %+v", metadata)
	}
	if len(store.activities) != 2 || store.activities[0].Action != "imported" || store.activities[1].Action != "imported" || store.nextActivityID != 3 {
		t.Fatalf("import activity was not recorded: activities=%+v next=%d", store.activities, store.nextActivityID)
	}
}

func TestConnectedAniListImportReconcilesRepeatAndQueuesLocalDifferences(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"User":{"name":"konan","avatar":{}},"anime":{"lists":[{"entries":[{"id":700,"status":"CURRENT","score":3,"progress":12,"repeat":4,"notes":"remote","media":{"id":20,"siteUrl":"https://anilist.co/anime/20","format":"TV","episodes":26,"title":{"romaji":"Cowboy Bebop","english":"Cowboy Bebop","native":"カウボーイビバップ"},"coverImage":{},"startDate":{},"endDate":{},"studios":{"nodes":[]},"staff":{"edges":[]}}}]}]},"manga":{"lists":[]}}}`))
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "media.json")
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	store.items = []Media{{
		ID: 1, Title: "Cowboy Bebop", Type: "anime", Status: "completed", Progress: 26, Total: 26,
		Rating: 9, RepeatCount: 0, Notes: "local", Provider: "anilist", ProviderID: "20", SyncStatus: "local_only",
	}}
	store.nextID = 2
	syncer, err := newAniListSync(testAniListConfig(path), store)
	if err != nil {
		t.Fatal(err)
	}
	syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "konan", ExpiresAt: time.Now().Add(time.Hour)}
	application := &app{store: store, discovery: testDiscoveryService(server.URL), anilist: syncer}
	body, _ := json.Marshal(anilistImportRequest{Username: "konan", Types: []string{"anime"}, Statuses: []string{"in_progress"}})
	request := httptest.NewRequest(http.MethodPost, "/api/import/anilist", bytes.NewReader(body))
	response := httptest.NewRecorder()
	application.importAniList(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("reconciliation = %d: %s", response.Code, response.Body.String())
	}
	var result struct {
		Imported   int     `json:"imported"`
		Reconciled int     `json:"reconciled"`
		Items      []Media `json:"items"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	item := store.items[0]
	if result.Imported != 0 || result.Reconciled != 1 || len(result.Items) != 0 || item.RepeatCount != 4 ||
		!item.AniListRepeatKnown || item.AniListUserID != 7 || item.ProviderListEntryID != 700 || item.SyncStatus != "pending" ||
		len(store.syncJobs) != 1 || store.syncJobs[0].AniListUserID != 7 {
		t.Fatalf("existing item was not reconciled: result=%+v item=%+v", result, item)
	}
	if item.Status != "completed" || item.Progress != 26 || item.Rating != 9 || item.Notes != "local" {
		t.Fatalf("reconciliation overwrote local tracking: %+v", item)
	}
	if len(store.activities) != 0 {
		t.Fatalf("reconciliation should not create bulk activity events: %+v", store.activities)
	}
	reopened, err := newStore(path)
	if err != nil || reopened.items[0].RepeatCount != 4 || !reopened.items[0].AniListRepeatKnown || reopened.items[0].AniListUserID != 7 || len(reopened.syncJobs) != 1 {
		t.Fatalf("reconciled state did not survive restart: store=%+v err=%v", reopened, err)
	}
}

func TestAniListImportRepeatOwnership(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"User":{"name":"konan","avatar":{}},"anime":{"lists":[{"entries":[{"id":700,"status":"CURRENT","score":3,"progress":12,"repeat":4,"notes":"remote","media":{"id":20,"siteUrl":"https://anilist.co/anime/20","format":"TV","episodes":26,"title":{"romaji":"Cowboy Bebop"},"coverImage":{},"startDate":{},"endDate":{},"studios":{"nodes":[]},"staff":{"edges":[]}}}]}]},"manga":{"lists":[]}}}`))
	}))
	defer server.Close()

	t.Run("matching existing tracking needs no outbox job", func(t *testing.T) {
		store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
		store.items = []Media{{
			ID: 1, Title: "Cowboy Bebop", Type: "anime", Status: "in_progress", Progress: 12,
			Rating: 3, Notes: "remote", Provider: "anilist", ProviderID: "20", SyncStatus: "local_only",
		}}
		store.nextID = 2
		syncer, _ := newAniListSync(testAniListConfig(store.path), store)
		syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "konan", ExpiresAt: time.Now().Add(time.Hour)}
		application := &app{store: store, discovery: testDiscoveryService(server.URL), anilist: syncer}
		body, _ := json.Marshal(anilistImportRequest{Username: "konan", Types: []string{"anime"}, Statuses: []string{"in_progress"}})
		response := httptest.NewRecorder()
		application.importAniList(response, httptest.NewRequest(http.MethodPost, "/api/import/anilist", bytes.NewReader(body)))

		item := store.items[0]
		if response.Code != http.StatusOK || item.RepeatCount != 4 || !item.AniListRepeatKnown || item.AniListUserID != 7 || item.SyncStatus != "synced" || len(store.syncJobs) != 0 {
			t.Fatalf("matching item was not safely reconciled: code=%d item=%+v jobs=%+v", response.Code, item, store.syncJobs)
		}
	})

	t.Run("public import keeps repeat local and unowned", func(t *testing.T) {
		store, _ := newStore(filepath.Join(t.TempDir(), "media.json"))
		syncer, _ := newAniListSync(testAniListConfig(store.path), store)
		application := &app{store: store, discovery: testDiscoveryService(server.URL), anilist: syncer}
		body, _ := json.Marshal(anilistImportRequest{Username: "konan", Types: []string{"anime"}, Statuses: []string{"in_progress"}})
		response := httptest.NewRecorder()
		application.importAniList(response, httptest.NewRequest(http.MethodPost, "/api/import/anilist", bytes.NewReader(body)))

		item := store.items[0]
		if response.Code != http.StatusOK || item.RepeatCount != 4 || item.AniListRepeatKnown || item.AniListUserID != 0 || item.SyncStatus != "local_only" {
			t.Fatalf("public repeat import gained AniList ownership: code=%d item=%+v", response.Code, item)
		}
	})

	t.Run("persistence failure rolls reconciliation back", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "media.json")
		if err := os.Mkdir(path, 0o755); err != nil {
			t.Fatal(err)
		}
		store := &store{
			path: path,
			items: []Media{{
				ID: 1, Title: "Cowboy Bebop", Type: "anime", Status: "completed", Provider: "anilist", ProviderID: "20", SyncStatus: "local_only",
			}},
			syncJobs: []syncJob{}, activities: []Activity{}, nextID: 2, nextJobID: 1, nextActivityID: 1,
		}
		syncer, _ := newAniListSync(testAniListConfig(path), store)
		syncer.auth = &aniListAuth{AccessToken: "token", UserID: 7, Username: "konan", ExpiresAt: time.Now().Add(time.Hour)}
		application := &app{store: store, discovery: testDiscoveryService(server.URL), anilist: syncer}
		body, _ := json.Marshal(anilistImportRequest{Username: "konan", Types: []string{"anime"}, Statuses: []string{"in_progress"}})
		response := httptest.NewRecorder()
		application.importAniList(response, httptest.NewRequest(http.MethodPost, "/api/import/anilist", bytes.NewReader(body)))

		item := store.items[0]
		if response.Code != http.StatusInternalServerError || item.RepeatCount != 0 || item.AniListRepeatKnown || item.AniListUserID != 0 ||
			item.SyncStatus != "local_only" || len(store.syncJobs) != 0 || store.nextJobID != 1 {
			t.Fatalf("failed reconciliation left partial state: code=%d item=%+v jobs=%+v nextJobID=%d", response.Code, item, store.syncJobs, store.nextJobID)
		}
	})
}

func testDiscoveryService(baseURL string) *discoveryService {
	return &discoveryService{
		client:      &http.Client{Timeout: time.Second},
		anilistBase: baseURL,
		booksBase:   baseURL,
		tmdbBase:    baseURL,
		cache:       make(map[string]cachedDiscovery),
	}
}
