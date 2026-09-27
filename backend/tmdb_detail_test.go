package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestTMDBSeriesDetailMapsCreatorsSeasonsRecommendationsAndUsesCache(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/tv/1399" || r.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("unexpected request: %s auth=%q", r.URL.String(), r.Header.Get("Authorization"))
		}
		if r.URL.Query().Get("append_to_response") != "recommendations" || r.URL.Query().Get("language") != "en-US" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":1399,"name":"Game of Thrones","original_name":"Game of Thrones","overview":"Seven kingdoms.",
			"poster_path":"/show.jpg","first_air_date":"2011-04-17","last_air_date":"2019-05-19",
			"episode_run_time":[60],"number_of_episodes":73,"status":"Ended","vote_average":8.4,
			"genres":[{"name":"Drama"}],"created_by":[{"name":"David Benioff","profile_path":"/benioff.jpg"},{"name":"D. B. Weiss"}],
			"seasons":[
				{"id":10,"name":"Specials","season_number":0,"episode_count":5,"air_date":"2010-12-05","poster_path":"/specials.jpg"},
				{"id":11,"name":"Season 1","season_number":1,"episode_count":10,"air_date":"2011-04-17","poster_path":"/s1.jpg"},
				{"id":12,"name":"Duplicate","season_number":1,"episode_count":10},
				{"id":0,"name":"Invalid","season_number":2}
			],
			"recommendations":{"results":[
				{"id":1399,"name":"Current"},
				{"id":1402,"name":"The Walking Dead","first_air_date":"2010-10-31","poster_path":"/related.jpg","vote_average":8.1,"genre_ids":[18]},
				{"id":1403,"name":"Adult","adult":true}
			]}
		}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"
	detail, err := service.detail(context.Background(), "tmdb", "series", "1399")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Title != "Game of Thrones" || detail.ReleaseStatus != "finished" || detail.CatalogTotal != 73 || detail.DurationMinutes != 60 || detail.EndDate != "2019-05-19" {
		t.Fatalf("unexpected series detail: %+v", detail.discoveryResult)
	}
	if len(detail.Credits) != 2 || detail.Credits[0] != (mediaCredit{Name: "David Benioff", Role: "Creator"}) {
		t.Fatalf("unexpected creators: %+v", detail.Credits)
	}
	if len(detail.Contributors) != 2 || detail.Contributors[0] != (discoveryContributor{Name: "David Benioff", Role: "Creator", ImageURL: "https://image.tmdb.org/t/p/w185/benioff.jpg"}) {
		t.Fatalf("unexpected contributor profiles: %+v", detail.Contributors)
	}
	if len(detail.Seasons) != 2 || detail.Seasons[0].SeasonNumber != 0 || detail.Seasons[1].EpisodeCount != 10 {
		t.Fatalf("unexpected seasons: %+v", detail.Seasons)
	}
	if len(detail.Recommendations) != 1 || detail.Recommendations[0].ProviderID != "1402" || detail.Recommendations[0].Type != "series" {
		t.Fatalf("unexpected recommendations: %+v", detail.Recommendations)
	}
	if detail.Relations == nil || detail.Collection == nil || detail.AlternativeTitles == nil || detail.Contributors == nil {
		t.Fatalf("detail lists must not be nil: %+v", detail)
	}
	if _, err := service.detail(context.Background(), "tmdb", "series", "1399"); err != nil || requests.Load() != 1 {
		t.Fatalf("detail cache miss: requests=%d err=%v", requests.Load(), err)
	}
}

func TestTMDBMovieDetailMapsDirectorAndCollection(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("missing bearer token")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/movie/550":
			if r.URL.Query().Get("append_to_response") != "credits,recommendations" {
				t.Fatalf("unexpected append_to_response: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{
				"id":550,"title":"Fight Club","overview":"An insomniac.","poster_path":"/fight.jpg",
				"release_date":"1999-10-15","runtime":139,"status":"Released","vote_average":8.4,
				"genres":[{"name":"Drama"}],"credits":{"crew":[{"name":"David Fincher","job":"Director","profile_path":"/fincher.jpg"},{"name":"Someone","job":"Writer"}]},
				"belongs_to_collection":{"id":100},"recommendations":{"results":[]}
			}`))
		case "/collection/100":
			_, _ = w.Write([]byte(`{"id":100,"parts":[
				{"id":550,"title":"Fight Club"},
				{"id":551,"title":"Another Club","release_date":"2001-01-01","poster_path":"/other.jpg"}
			]}`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"
	detail, err := service.detail(context.Background(), "tmdb", "movie", "550")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Credits) != 1 || detail.Credits[0] != (mediaCredit{Name: "David Fincher", Role: "Director"}) {
		t.Fatalf("unexpected director: %+v", detail.Credits)
	}
	if len(detail.Contributors) != 1 || detail.Contributors[0].ImageURL != "https://image.tmdb.org/t/p/w185/fincher.jpg" {
		t.Fatalf("unexpected director profile: %+v", detail.Contributors)
	}
	if len(detail.Collection) != 1 || detail.Collection[0].ProviderID != "551" || detail.Collection[0].Type != "movie" {
		t.Fatalf("unexpected collection: %+v", detail.Collection)
	}
	if detail.Seasons == nil || detail.Recommendations == nil || detail.Relations == nil {
		t.Fatalf("empty arrays must be initialized: %+v", detail)
	}
	if _, err := service.detail(context.Background(), "tmdb", "movie", "550"); err != nil || requests.Load() != 2 {
		t.Fatalf("detail cache miss: requests=%d err=%v", requests.Load(), err)
	}
}

func TestTMDBDetailPreservesMovieWhenCollectionFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/movie/1" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":1,"title":"Movie","belongs_to_collection":{"id":2},"recommendations":{"results":[]}}`))
			return
		}
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"
	detail, err := service.detail(context.Background(), "tmdb", "movie", "1")
	if err != nil || detail.Title != "Movie" || detail.Collection == nil || len(detail.Collection) != 0 {
		t.Fatalf("collection failure discarded valid detail: detail=%+v err=%v", detail, err)
	}
}

func TestTMDBDetailHandlerValidatesIdentityAndReportsMissingToken(t *testing.T) {
	service := testDiscoveryService("http://example.invalid")
	application := &app{discovery: service}
	for _, testCase := range []struct {
		target string
		status int
		body   string
	}{
		{target: "/api/discovery/detail?provider=tmdb&type=book&id=1", status: http.StatusBadRequest, body: "invalid catalog identity"},
		{target: "/api/discovery/detail?provider=tmdb&type=movie&id=01", status: http.StatusBadRequest, body: "invalid catalog identity"},
		{target: "/api/discovery/detail?provider=tmdb&type=series&id=1", status: http.StatusServiceUnavailable, body: "movie and series details require TMDB_API_TOKEN"},
	} {
		response := httptest.NewRecorder()
		application.getDiscoveryDetail(response, httptest.NewRequest(http.MethodGet, testCase.target, nil))
		if response.Code != testCase.status || !strings.Contains(response.Body.String(), testCase.body) {
			t.Fatalf("%s = %d %s", testCase.target, response.Code, response.Body.String())
		}
	}
}

func TestTMDBDetailRejectsMissingAndMismatchedTitles(t *testing.T) {
	t.Run("provider unavailable", func(t *testing.T) {
		service := testDiscoveryService("http://example.invalid")
		_, err := service.detail(context.Background(), "tmdb", "movie", "1")
		if !errors.Is(err, errProviderUnavailable) {
			t.Fatalf("expected provider unavailable, got %v", err)
		}
	})

	for name, testCase := range map[string]struct {
		status int
		body   string
	}{
		"not found":   {status: http.StatusNotFound, body: `{}`},
		"mismatched":  {status: http.StatusOK, body: `{"id":2,"title":"Other"}`},
		"adult title": {status: http.StatusOK, body: `{"id":1,"title":"Adult","adult":true}`},
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(testCase.status)
				_, _ = w.Write([]byte(testCase.body))
			}))
			defer server.Close()
			service := testDiscoveryService(server.URL)
			service.tmdbToken = "test-token"
			_, err := service.detail(context.Background(), "tmdb", "movie", "1")
			if !errors.Is(err, errCatalogNotFound) {
				t.Fatalf("expected catalog not found, got %v", err)
			}
		})
	}
}

func TestTMDBDetailRejectsOversizedProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, strings.Repeat(" ", maxProviderResponseBytes+1))
	}))
	defer server.Close()
	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"

	_, err := service.detail(context.Background(), "tmdb", "movie", "1")
	if err == nil || !strings.Contains(err.Error(), "provider response exceeds") {
		t.Fatalf("expected bounded provider response error, got %v", err)
	}
}

func TestTMDBDetailBoundsUntrustedMetadata(t *testing.T) {
	payload := tmdbDetailPayload{
		ID:               1,
		Name:             strings.Repeat("x", 250),
		FirstAirDate:     "2024-99-99",
		LastAirDate:      "not-a-date",
		EpisodeRunTime:   []int{20_000},
		NumberOfEpisodes: 2_000_000,
		VoteAverage:      11,
	}
	for index := 0; index < maxTMDBSeasons+5; index++ {
		payload.Seasons = append(payload.Seasons, struct {
			ID           int     `json:"id"`
			Name         string  `json:"name"`
			Overview     string  `json:"overview"`
			PosterPath   string  `json:"poster_path"`
			AirDate      string  `json:"air_date"`
			SeasonNumber int     `json:"season_number"`
			EpisodeCount int     `json:"episode_count"`
			VoteAverage  float64 `json:"vote_average"`
		}{ID: index + 1, Name: "Season " + strconv.Itoa(index), SeasonNumber: index, EpisodeCount: 10})
	}
	for index := 0; index < maxTMDBRecommendations+5; index++ {
		payload.Recommendations.Results = append(payload.Recommendations.Results, tmdbTitleSummary{ID: index + 2, Name: "Recommendation " + strconv.Itoa(index)})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer server.Close()
	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"

	detail, err := service.detail(context.Background(), "tmdb", "series", "1")
	if err != nil {
		t.Fatal(err)
	}
	if len([]rune(detail.Title)) != 200 || detail.StartDate != "" || detail.EndDate != "" || detail.DurationMinutes != 0 || detail.CatalogTotal != 0 || detail.CommunityRating != 0 {
		t.Fatalf("untrusted scalar metadata was not bounded: %+v", detail.discoveryResult)
	}
	if len(detail.Seasons) != maxTMDBSeasons || len(detail.Recommendations) != maxTMDBRecommendations {
		t.Fatalf("untrusted arrays were not bounded: seasons=%d recommendations=%d", len(detail.Seasons), len(detail.Recommendations))
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"alternativeTitles":[]`, `"relations":[]`, `"collection":[]`, `"contributors":[]`} {
		if !strings.Contains(string(encoded), expected) {
			t.Fatalf("detail JSON missing non-null array %s: %s", expected, encoded)
		}
	}
}
