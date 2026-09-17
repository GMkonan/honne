package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAniListDetailMapsAlternativeTitlesAndRelations(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Variables["id"] != float64(21366) || body.Variables["type"] != "ANIME" ||
			!strings.Contains(body.Query, "relations") || strings.Contains(body.Query, "synonyms") {
			t.Fatalf("unexpected AniList detail request: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"Media":{"id":21366,"siteUrl":"https://anilist.co/anime/21366","type":"ANIME","format":"TV","status":"FINISHED","description":"A story.","episodes":22,"duration":25,"genres":["Drama"],"averageScore":84,"isAdult":false,"synonyms":["Sangatsu no Lion","march COMES IN LIKE A LION"],"title":{"romaji":"3-gatsu no Lion","english":"March comes in like a lion","native":"３月のライオン"},"coverImage":{"extraLarge":"https://images.example/21366.jpg"},"startDate":{"year":2016,"month":10,"day":8},"endDate":{"year":2017,"month":3,"day":18},"studios":{"nodes":[{"name":"Shaft"}]},"staff":{"edges":[]},"relations":{"edges":[{"relationType":"SOURCE","node":{"id":31224,"siteUrl":"https://anilist.co/manga/31224","type":"MANGA","format":"MANGA","title":{"romaji":"3-gatsu no Lion","english":"March Comes in Like a Lion","native":"３月のライオン"},"coverImage":{"extraLarge":"https://images.example/31224.jpg"},"startDate":{"year":2007},"isAdult":false}},{"relationType":"SEQUEL","node":{"id":98478,"siteUrl":"https://anilist.co/anime/98478","type":"ANIME","format":"TV","episodes":22,"title":{"romaji":"3-gatsu no Lion 2nd Season","english":"March comes in like a lion Season 2","native":"３月のライオン 第２シリーズ"},"coverImage":{"extraLarge":"https://images.example/98478.jpg"},"startDate":{"year":2017},"isAdult":false}},{"relationType":"PREQUEL","node":{"id":100,"siteUrl":"https://anilist.co/manga/100","type":"MANGA","format":"NOVEL","chapters":4,"title":{"romaji":"A Novel"},"isAdult":false}},{"relationType":"ADAPTATION","node":{"id":31224,"type":"MANGA","format":"MANGA","title":{"romaji":"Duplicate"},"isAdult":false}},{"relationType":"SIDE_STORY","node":{"id":9,"type":"ANIME","format":"TV","title":{"romaji":"Adult"},"isAdult":true}},{"relationType":"OTHER","node":{"id":10,"type":"ANIME","format":"TV","title":{"romaji":"Noise"},"isAdult":false}},{"relationType":"SEQUEL","node":{"id":21366,"type":"ANIME","format":"TV","title":{"romaji":"Self"},"isAdult":false}}]}}}}`))
	}))
	defer server.Close()

	service := anilistDetailTestService(server.URL)
	detail, err := service.detail(context.Background(), "anilist", "anime", "21366")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Title != "March comes in like a lion" || detail.CatalogTotal != 22 ||
		strings.Join(detail.AlternativeTitles, "|") != "3-gatsu no Lion|３月のライオン" {
		t.Fatalf("unexpected title detail: %+v", detail)
	}
	if len(detail.Relations) != 3 || detail.Relations[0].Relation != "sequel" ||
		detail.Relations[0].Result.ProviderID != "98478" || detail.Relations[0].Result.Format != "" ||
		detail.Relations[0].Result.CatalogTotal != 0 || detail.Relations[1].Relation != "prequel" ||
		detail.Relations[1].Result.Type != "light_novel" || detail.Relations[2].Relation != "source" ||
		detail.Relations[2].Result.Type != "manga" {
		t.Fatalf("unexpected relations: %+v", detail.Relations)
	}
	if _, err := service.detail(context.Background(), "anilist", "anime", "21366"); err != nil || requests.Load() != 1 {
		t.Fatalf("detail cache missed: requests=%d err=%v", requests.Load(), err)
	}
	response := httptest.NewRecorder()
	(&app{discovery: service}).getDiscoveryDetail(response, httptest.NewRequest(
		http.MethodGet,
		"/api/discovery/detail?provider=anilist&type=anime&id=21366",
		nil,
	))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"alternativeTitles":[`) ||
		!strings.Contains(response.Body.String(), `"relations":[`) {
		t.Fatalf("unexpected handler response: %d %s", response.Code, response.Body.String())
	}
}

func TestAniListDetailRejectsMismatchedAndMissingMedia(t *testing.T) {
	for _, body := range []string{
		`{"data":{"Media":null}}`,
		`{"data":{"Media":null},"errors":[{"message":"Not Found."}]}`,
		`{"data":{"Media":{"id":1,"type":"MANGA","format":"NOVEL","title":{"romaji":"Novel"}}}}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(body))
		}))
		service := anilistDetailTestService(server.URL)
		_, err := service.detail(context.Background(), "anilist", "manga", "1")
		server.Close()
		if err != errCatalogNotFound {
			t.Fatalf("body %s: err=%v", body, err)
		}
	}
}

func TestDiscoveryDetailHandlerMapsAniListFailures(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	application := &app{discovery: anilistDetailTestService(server.URL)}

	for _, test := range []struct {
		target string
		want   int
	}{
		{target: "/api/discovery/detail?provider=anilist&type=series&id=1", want: http.StatusBadRequest},
		{target: "/api/discovery/detail?provider=anilist&type=anime&id=01", want: http.StatusBadRequest},
		{target: "/api/discovery/detail?provider=anilist&type=anime&id=1", want: http.StatusServiceUnavailable},
	} {
		response := httptest.NewRecorder()
		application.getDiscoveryDetail(response, httptest.NewRequest(http.MethodGet, test.target, nil))
		if response.Code != test.want {
			t.Fatalf("%s = %d, want %d: %s", test.target, response.Code, test.want, response.Body.String())
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("invalid identities contacted AniList: requests=%d", requests.Load())
	}
}

func anilistDetailTestService(baseURL string) *discoveryService {
	return &discoveryService{
		client:      &http.Client{Timeout: time.Second},
		anilistBase: baseURL,
		cache:       make(map[string]cachedDiscovery),
		detailCache: make(map[string]cachedDiscoveryDetail),
	}
}
