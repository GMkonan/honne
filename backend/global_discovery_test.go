package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGlobalDiscoveryAggregatesInTypeOrderCapsAndDeduplicates(t *testing.T) {
	server := httptest.NewServer(globalDiscoveryProviderHandler(false))
	defer server.Close()
	application := globalDiscoveryTestApp(server.URL, "tmdb-token")

	response := httptest.NewRecorder()
	application.searchGlobalDiscovery(response, httptest.NewRequest(http.MethodGet, "/api/discovery/global?q=story", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("global search = %d: %s", response.Code, response.Body.String())
	}
	var payload globalDiscoveryResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.UnavailableTypes) != 0 {
		t.Fatalf("unexpected unavailable types: %v", payload.UnavailableTypes)
	}
	// Six anime results (the per-type cap), then series, movie, book, the
	// manga/light-novel result once, and the game result.
	if len(payload.Results) != 11 {
		t.Fatalf("results = %d, want 11: %+v", len(payload.Results), payload.Results)
	}
	wantTypes := []string{"anime", "anime", "anime", "anime", "anime", "anime", "series", "movie", "book", "manga", "game"}
	for index, want := range wantTypes {
		if payload.Results[index].Type != want {
			t.Fatalf("result %d type = %q, want %q; results=%+v", index, payload.Results[index].Type, want, payload.Results)
		}
	}
	seen := 0
	for _, result := range payload.Results {
		if result.Provider == "anilist" && result.ProviderID == "100" {
			seen++
		}
	}
	if seen != 1 {
		t.Fatalf("overlapping AniList ID appeared %d times, want once", seen)
	}
}

func TestGlobalDiscoveryReturnsPartialResultsAndUnavailableTypes(t *testing.T) {
	server := httptest.NewServer(globalDiscoveryProviderHandler(false))
	defer server.Close()
	application := globalDiscoveryTestApp(server.URL, "")

	response := httptest.NewRecorder()
	application.searchGlobalDiscovery(response, httptest.NewRequest(http.MethodGet, "/api/discovery/global?q=story", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("partial global search = %d: %s", response.Code, response.Body.String())
	}
	var payload globalDiscoveryResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Join(payload.UnavailableTypes, ",") != "series,movie" {
		t.Fatalf("unavailable types = %v, want [series movie]", payload.UnavailableTypes)
	}
	if len(payload.Results) == 0 {
		t.Fatal("configured providers should still return partial results")
	}
}

func TestGlobalDiscoveryReportsUnconfiguredRAWGAsPartial(t *testing.T) {
	server := httptest.NewServer(globalDiscoveryProviderHandler(false))
	defer server.Close()
	application := globalDiscoveryTestApp(server.URL, "tmdb-token")
	application.discovery.rawgKey = ""

	response := httptest.NewRecorder()
	application.searchGlobalDiscovery(response, httptest.NewRequest(http.MethodGet, "/api/discovery/global?q=story", nil))
	var payload globalDiscoveryResponse
	if response.Code != http.StatusOK {
		t.Fatalf("partial RAWG search = %d: %s", response.Code, response.Body.String())
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Join(payload.UnavailableTypes, ",") != "game" || len(payload.Results) == 0 {
		t.Fatalf("unexpected RAWG partial response: %+v", payload)
	}
}

func TestGlobalDiscoveryFailsOnlyWhenEveryTypeFails(t *testing.T) {
	server := httptest.NewServer(globalDiscoveryProviderHandler(true))
	defer server.Close()
	application := globalDiscoveryTestApp(server.URL, "tmdb-token")

	response := httptest.NewRecorder()
	application.searchGlobalDiscovery(response, httptest.NewRequest(http.MethodGet, "/api/discovery/global?q=story", nil))
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "all metadata providers") {
		t.Fatalf("all-failed global search = %d: %s", response.Code, response.Body.String())
	}
}

func TestGameCatalogRequiresRAWGKey(t *testing.T) {
	if !slicesContains(validTypes, "game") || !slicesContains(catalogTypes, "game") {
		t.Fatalf("unexpected game capabilities: valid=%v catalog=%v", validTypes, catalogTypes)
	}
	application := globalDiscoveryTestApp("http://example.invalid", "")
	application.discovery.rawgKey = ""
	response := httptest.NewRecorder()
	application.searchDiscovery(response, httptest.NewRequest(http.MethodGet, "/api/discovery/search?type=game&q=hades", nil))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "RAWG_API_KEY") {
		t.Fatalf("game catalog search = %d, want configured-key error: %s", response.Code, response.Body.String())
	}
}

func TestGlobalDiscoveryValidatesQuery(t *testing.T) {
	application := globalDiscoveryTestApp("http://example.invalid", "")
	for _, target := range []string{
		"/api/discovery/global",
		"/api/discovery/global?q=x",
		"/api/discovery/global?q=" + strings.Repeat("x", 101),
	} {
		response := httptest.NewRecorder()
		application.searchGlobalDiscovery(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", target, response.Code)
		}
	}
}

func globalDiscoveryTestApp(baseURL, tmdbToken string) *app {
	return &app{discovery: &discoveryService{
		client:      &http.Client{},
		anilistBase: baseURL + "/graphql",
		booksBase:   baseURL,
		tmdbBase:    baseURL,
		tmdbToken:   tmdbToken,
		rawgBase:    baseURL,
		rawgKey:     "rawg-key",
		cache:       make(map[string]cachedDiscovery),
		detailCache: make(map[string]cachedDiscoveryDetail),
	}}
}

func globalDiscoveryProviderHandler(fail bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/graphql":
			var request struct {
				Query     string `json:"query"`
				Variables struct {
					Type string `json:"type"`
				} `json:"variables"`
			}
			_ = json.NewDecoder(r.Body).Decode(&request)
			if strings.Contains(request.Query, "format: NOVEL") {
				_, _ = w.Write([]byte(anilistGlobalResult(100, "NOVEL", "Shared title")))
				return
			}
			if request.Variables.Type == "ANIME" {
				_, _ = w.Write([]byte(anilistGlobalResults(8, "TV")))
				return
			}
			_, _ = w.Write([]byte(anilistGlobalResult(100, "MANGA", "Shared title")))
			return
		case r.URL.Path == "/search.json":
			_, _ = w.Write([]byte(`{"numFound":1,"docs":[{"key":"/works/OL1W","title":"Book","author_name":["Author"],"first_publish_year":2000,"cover_i":1,"number_of_pages_median":300}]}`))
			return
		case r.URL.Path == "/search/tv":
			_, _ = w.Write([]byte(`{"total_pages":1,"results":[{"id":201,"name":"Series","original_name":"Series","first_air_date":"2020-01-01","vote_average":8}]}`))
			return
		case r.URL.Path == "/search/movie":
			_, _ = w.Write([]byte(`{"total_pages":1,"results":[{"id":202,"title":"Movie","original_title":"Movie","release_date":"2021-01-01","vote_average":7}]}`))
			return
		case r.URL.Path == "/games":
			_, _ = w.Write([]byte(`{"next":null,"results":[{"id":203,"slug":"game","name":"Game","released":"2022-01-01","rating":4}]}`))
			return
		}
		http.NotFound(w, r)
	})
}

func anilistGlobalResult(id int, format, title string) string {
	return fmt.Sprintf(`{"data":{"Page":{"pageInfo":{"hasNextPage":false},"media":[{"id":%d,"siteUrl":"https://anilist.co/media/%d","format":%q,"title":{"english":%q},"coverImage":{},"startDate":{},"studios":{"nodes":[]}}]}}}`, id, id, format, title)
}

func anilistGlobalResults(count int, format string) string {
	items := make([]string, 0, count)
	for index := 1; index <= count; index++ {
		items = append(items, fmt.Sprintf(`{"id":%d,"format":%q,"title":{"english":"Anime %d"},"coverImage":{},"startDate":{},"studios":{"nodes":[]}}`, index, format, index))
	}
	return `{"data":{"Page":{"pageInfo":{"hasNextPage":false},"media":[` + strings.Join(items, ",") + `]}}}`
}
