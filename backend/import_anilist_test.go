package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestPreviewAniListImportReportsProviderOutage(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"errors":[{"message":"The AniList API has been temporarily disabled due to severe stability issues."}]}`))
	}))
	defer provider.Close()

	response := previewAniListImportFromProvider(t, provider, "robbsbro69")
	if response.Code != http.StatusServiceUnavailable ||
		!strings.Contains(response.Body.String(), "AniList is currently unavailable; try again later") ||
		strings.Contains(response.Body.String(), "public AniList profile") {
		t.Fatalf("unexpected outage response: %d %s", response.Code, response.Body.String())
	}
}

func TestPreviewAniListImportReportsGraphQLOutagesWithHTTP200(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errors":[{"message":"Internal server error."}],"data":null}`))
	}))
	defer provider.Close()

	response := previewAniListImportFromProvider(t, provider, "robbsbro69")
	if response.Code != http.StatusServiceUnavailable ||
		!strings.Contains(response.Body.String(), "AniList is currently unavailable; try again later") {
		t.Fatalf("unexpected GraphQL outage response: %d %s", response.Code, response.Body.String())
	}
}

func TestPreviewAniListImportKeepsProfileGuidanceForSemanticErrors(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errors":[{"message":"User not found."}],"data":null}`))
	}))
	defer provider.Close()

	response := previewAniListImportFromProvider(t, provider, "missing-user")
	if response.Code != http.StatusBadGateway ||
		!strings.Contains(response.Body.String(), "check the username and profile visibility") {
		t.Fatalf("unexpected profile response: %d %s", response.Code, response.Body.String())
	}
}

func previewAniListImportFromProvider(t *testing.T, provider *httptest.Server, username string) *httptest.ResponseRecorder {
	t.Helper()
	store, err := newStore(filepath.Join(t.TempDir(), "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store, discovery: &discoveryService{
		client: provider.Client(), anilistBase: provider.URL,
	}}
	response := httptest.NewRecorder()
	application.previewAniListImport(
		response,
		httptest.NewRequest(http.MethodGet, "/api/import/anilist?username="+username, nil),
	)
	return response
}
