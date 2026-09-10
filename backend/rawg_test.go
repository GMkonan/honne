package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRAWGSearchMapsCatalogMetadata(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/games" || r.URL.Query().Get("key") != "secret" ||
			r.URL.Query().Get("search") != "Hades" || r.URL.Query().Get("page") != "2" ||
			r.URL.Query().Get("page_size") != "20" {
			t.Fatalf("unexpected RAWG request: %s", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"next":"https://api.rawg.io/api/games?page=3","results":[{"id":420,"slug":"hades","name":"Hades","background_image":"https://images.example/hades.jpg","released":"2020-09-17","rating":4.6,"genres":[{"name":"Action"},{"name":"Indie"}],"platforms":[{"platform":{"name":"PC"}},{"platform":{"name":"Nintendo Switch"}}]}]}`))
	}))
	defer server.Close()

	service := rawgTestService(server.URL, "secret")
	response, err := service.search(context.Background(), "game", "Hades", 2)
	if err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 || response.Page != 2 || !response.HasMore || len(response.Results) != 1 {
		t.Fatalf("unexpected search response: requests=%d response=%+v", requests.Load(), response)
	}
	result := response.Results[0]
	if result.Provider != "rawg" || result.ProviderID != "420" || result.ProviderURL != "https://rawg.io/games/hades" ||
		result.Type != "game" || result.Title != "Hades" || result.CoverURL == "" || result.ReleaseYear != 2020 ||
		result.StartDate != "2020-09-17" || result.ReleaseStatus != "finished" || result.CommunityRating != 9.2 ||
		strings.Join(result.Genres, ",") != "Action,Indie" || strings.Join(result.CatalogPlatforms, ",") != "PC,Nintendo Switch" {
		t.Fatalf("unexpected RAWG mapping: %+v", result)
	}
	if _, err := service.search(context.Background(), "game", "Hades", 2); err != nil || requests.Load() != 1 {
		t.Fatalf("search cache missed: requests=%d err=%v", requests.Load(), err)
	}
}

func TestRAWGDetailMapsCreditsAndUsesCache(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/games/420" || r.URL.Query().Get("key") != "secret" {
			t.Fatalf("unexpected RAWG detail request: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"id":420,"slug":"hades","name":"Hades","description_raw":"Escape the Underworld.","released":"2999-09-17","rating":4.5,"developers":[{"name":"Supergiant Games"}],"publishers":[{"name":"Supergiant Games"}],"platforms":[{"platform":{"name":"PC"}}]}`))
	}))
	defer server.Close()

	service := rawgTestService(server.URL, "secret")
	result, err := service.detail(context.Background(), "rawg", "game", "420")
	if err != nil {
		t.Fatal(err)
	}
	if result.Description != "Escape the Underworld." || result.ReleaseStatus != "upcoming" ||
		len(result.Credits) != 2 || result.Credits[0].Role != "Developer" || result.Credits[1].Role != "Publisher" {
		t.Fatalf("unexpected RAWG detail: %+v", result)
	}
	if _, err := service.detail(context.Background(), "rawg", "game", "420"); err != nil || requests.Load() != 1 {
		t.Fatalf("detail cache missed: requests=%d err=%v", requests.Load(), err)
	}
}

func TestRAWGRequiresKeyWithoutMakingRequest(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		requests.Add(1)
	}))
	defer server.Close()
	service := rawgTestService(server.URL, "")

	_, err := service.searchRAWG(context.Background(), "Hades", 1)
	if !errors.Is(err, errProviderUnavailable) || requests.Load() != 0 {
		t.Fatalf("missing key result: requests=%d err=%v", requests.Load(), err)
	}
}

func TestRAWGTransportErrorsDoNotExposeKey(t *testing.T) {
	service := rawgTestService("https://api.example.invalid", "super-secret")
	service.client = &http.Client{Transport: failingRoundTripper{}}

	_, err := service.searchRAWG(context.Background(), "Hades", 1)
	if err == nil || strings.Contains(err.Error(), "super-secret") || err.Error() != "RAWG request failed" {
		t.Fatalf("unsafe RAWG error: %v", err)
	}
}

func TestRAWGDoesNotFollowRedirectsWithSecretReferrer(t *testing.T) {
	var targetRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		targetRequests.Add(1)
	}))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(http.StatusFound)
	}))
	defer redirect.Close()

	_, err := rawgTestService(redirect.URL, "super-secret").searchRAWG(context.Background(), "Hades", 1)
	if err == nil || targetRequests.Load() != 0 || strings.Contains(err.Error(), "super-secret") {
		t.Fatalf("unsafe RAWG redirect: targetRequests=%d err=%v", targetRequests.Load(), err)
	}
}

func TestRAWGHonorsContextCancellation(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	_, err := rawgTestService(server.URL, "secret").searchRAWG(ctx, "Hades", 1)
	if !errors.Is(err, context.DeadlineExceeded) || requests.Load() != 1 {
		t.Fatalf("RAWG cancellation: requests=%d err=%v", requests.Load(), err)
	}
}

func TestRAWGRejectsInvalidResponses(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
	}{
		{name: "status", status: http.StatusTooManyRequests, body: `{}`},
		{name: "json", status: http.StatusOK, body: `{`},
		{name: "oversized", status: http.StatusOK, body: strings.Repeat(" ", maxRAWGResponseBytes+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			_, err := rawgTestService(server.URL, "secret").searchRAWG(context.Background(), "Hades", 1)
			if err == nil {
				t.Fatal("invalid RAWG response was accepted")
			}
		})
	}
}

func TestRAWGMappingRejectsInvalidProviderFields(t *testing.T) {
	item := rawgGame{ID: 1, Slug: "unsafe/slug", Name: "Game", BackgroundImage: "javascript:alert(1)", Released: "not-a-date", Rating: 6}
	item.Platforms = append(item.Platforms, struct {
		Platform providerName `json:"platform"`
	}{Platform: providerName{Name: "PC"}})
	result, ok := rawgDiscoveryResult(item, time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	if !ok || result.CoverURL != "" || result.StartDate != "" || result.ReleaseYear != 0 || result.CommunityRating != 0 ||
		result.ProviderURL != "https://rawg.io/games/unsafe%2Fslug" {
		t.Fatalf("invalid fields were not sanitized: %+v", result)
	}
	if _, ok := rawgDiscoveryResult(rawgGame{Name: "Missing ID"}, time.Now()); ok {
		t.Fatal("accepted RAWG game without identity")
	}
}

func TestRAWGDetailHandlerValidatesIdentityAndConfiguration(t *testing.T) {
	application := &app{discovery: rawgTestService("https://example.invalid", "")}
	for _, test := range []struct {
		target string
		want   int
	}{
		{target: "/api/discovery/detail?provider=other&type=game&id=1", want: http.StatusBadRequest},
		{target: "/api/discovery/detail?provider=rawg&type=game&id=bad", want: http.StatusBadRequest},
		{target: "/api/discovery/detail?provider=rawg&type=game&id=1", want: http.StatusServiceUnavailable},
	} {
		response := httptest.NewRecorder()
		application.getDiscoveryDetail(response, httptest.NewRequest(http.MethodGet, test.target, nil))
		if response.Code != test.want {
			t.Fatalf("%s = %d, want %d: %s", test.target, response.Code, test.want, response.Body.String())
		}
	}
}

type failingRoundTripper struct{}

func (failingRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return nil, fmt.Errorf("request to %s failed", request.URL.String())
}

func rawgTestService(baseURL, key string) *discoveryService {
	return &discoveryService{
		client:      &http.Client{Timeout: time.Second},
		rawgBase:    baseURL,
		rawgKey:     key,
		cache:       make(map[string]cachedDiscovery),
		detailCache: make(map[string]cachedDiscoveryDetail),
	}
}
