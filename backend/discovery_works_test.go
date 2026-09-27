package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDiscoveryWorksHandlerValidatesQueryAndReportsMissingCredentials(t *testing.T) {
	application := &app{discovery: testDiscoveryService("http://example.invalid")}
	for _, testCase := range []struct {
		target string
		status int
		body   string
	}{
		{target: "/api/discovery/works?provider=tmdb&type=movie&id=01&relation=director", status: http.StatusBadRequest, body: "invalid contributor works query"},
		{target: "/api/discovery/works?provider=tmdb&type=book&id=1&relation=director", status: http.StatusBadRequest, body: "invalid contributor works query"},
		{target: "/api/discovery/works?provider=rawg&type=game&id=1&relation=director", status: http.StatusBadRequest, body: "invalid contributor works query"},
		{target: "/api/discovery/works?provider=tmdb&type=movie&id=1&relation=director&page=21", status: http.StatusBadRequest, body: "invalid contributor works query"},
		{target: "/api/discovery/works?provider=tmdb&type=movie&id=1&relation=director", status: http.StatusServiceUnavailable, body: "TMDB_API_TOKEN"},
		{target: "/api/discovery/works?provider=rawg&type=game&id=1&relation=developer", status: http.StatusServiceUnavailable, body: "RAWG_API_KEY"},
	} {
		response := httptest.NewRecorder()
		application.getDiscoveryWorks(response, httptest.NewRequest(http.MethodGet, testCase.target, nil))
		if response.Code != testCase.status || !strings.Contains(response.Body.String(), testCase.body) {
			t.Fatalf("%s = %d %s", testCase.target, response.Code, response.Body.String())
		}
	}
}

func TestTMDBDirectorWorksFiltersByRoleTypeAndUsesCache(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/person/7467/combined_credits" || r.URL.Query().Get("language") != "en-US" ||
			r.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("unexpected TMDB request: %s auth=%q", r.URL.String(), r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"id":7467,"crew":[
			{"id":550,"media_type":"movie","job":"Director","title":"Current"},
			{"id":551,"media_type":"movie","job":"Writer","title":"Written"},
			{"id":552,"media_type":"tv","job":"Director","name":"Series"},
			{"id":553,"media_type":"movie","job":"Director","title":"Adult","adult":true},
			{"id":554,"media_type":"movie","job":"Director","title":"Zodiac","release_date":"2007-03-02","poster_path":"/zodiac.jpg"},
			{"id":554,"media_type":"movie","job":"Director","title":"Duplicate"}
		]}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"
	query := discoveryWorksQuery{Provider: "tmdb", MediaType: "movie", ProviderID: "7467", Relation: "director", ExcludeID: "550", Page: 1}
	response, err := service.works(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 1 || response.Results[0].ProviderID != "554" || response.Results[0].Title != "Zodiac" ||
		response.Results[0].Type != "movie" || response.HasMore {
		t.Fatalf("unexpected director works: %+v", response)
	}
	query.Page = 2
	secondPage, err := service.works(context.Background(), query)
	if err != nil || len(secondPage.Results) != 0 || secondPage.Page != 2 || requests.Load() != 1 {
		t.Fatalf("works cache miss across pages: requests=%d response=%+v err=%v", requests.Load(), secondPage, err)
	}
}

func TestTMDBCompanyWorksUsesTypedDiscoverPagination(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/discover/tv" || r.URL.Query().Get("with_companies") != "508" ||
			r.URL.Query().Get("page") != "2" || r.URL.Query().Get("include_adult") != "false" {
			t.Fatalf("unexpected TMDB company request: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"page":2,"total_pages":3,"results":[
			{"id":10,"name":"Current"},
			{"id":11,"name":"Another Series","first_air_date":"2024-01-02"}
		]}`))
	}))
	defer server.Close()

	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"
	response, err := service.works(context.Background(), discoveryWorksQuery{
		Provider: "tmdb", MediaType: "series", ProviderID: "508", Relation: "production_company", ExcludeID: "10", Page: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Page != 2 || !response.HasMore || len(response.Results) != 1 || response.Results[0].ProviderID != "11" ||
		response.Results[0].Type != "series" {
		t.Fatalf("unexpected company works: %+v", response)
	}
}

func TestRAWGWorksUsesRelationFilterAndExcludesCurrentGame(t *testing.T) {
	for _, testCase := range []struct {
		relation string
		filter   string
	}{
		{relation: "developer", filter: "developers"},
		{relation: "publisher", filter: "publishers"},
	} {
		t.Run(testCase.relation, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/games" || r.URL.Query().Get(testCase.filter) != "19" ||
					r.URL.Query().Get("page") != "1" || r.URL.Query().Get("page_size") != "20" ||
					r.URL.Query().Get("key") != "secret" {
					t.Fatalf("unexpected RAWG works request: %s", r.URL.String())
				}
				otherFilter := "developers"
				if testCase.filter == otherFilter {
					otherFilter = "publishers"
				}
				if r.URL.Query().Get(otherFilter) != "" {
					t.Fatalf("unexpected intersecting RAWG filter: %s", r.URL.RawQuery)
				}
				_, _ = w.Write([]byte(`{"next":"next-page","results":[
					{"id":420,"slug":"current","name":"Current"},
					{"id":421,"slug":"next","name":"Next Game","released":"2020-01-02"}
				]}`))
			}))
			defer server.Close()

			service := rawgTestService(server.URL, "secret")
			response, err := service.works(context.Background(), discoveryWorksQuery{
				Provider: "rawg", MediaType: "game", ProviderID: "19", Relation: testCase.relation, ExcludeID: "420", Page: 1,
			})
			if err != nil {
				t.Fatal(err)
			}
			if !response.HasMore || len(response.Results) != 1 || response.Results[0].ProviderID != "421" {
				t.Fatalf("unexpected RAWG works: %+v", response)
			}
		})
	}
}

func TestDiscoveryWorksHandlerReturnsNonNullResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":1,"crew":[]}`))
	}))
	defer server.Close()
	service := testDiscoveryService(server.URL)
	service.tmdbToken = "test-token"
	response := httptest.NewRecorder()
	(&app{discovery: service}).getDiscoveryWorks(response, httptest.NewRequest(
		http.MethodGet, "/api/discovery/works?provider=tmdb&type=movie&id=1&relation=director", nil,
	))
	var payload discoveryResponse
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &payload) != nil || payload.Results == nil {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}
