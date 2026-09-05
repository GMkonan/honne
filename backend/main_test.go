package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateInput(t *testing.T) {
	valid := mediaInput{Title: "Duna", Type: "book", Status: "in_progress", Progress: 120, Total: 600, Rating: 8}
	if err := validateInput(valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}

	cases := []mediaInput{
		{Type: "book", Status: "planned"},
		{Title: "Duna", Type: "game", Status: "planned"},
		{Title: "Duna", Type: "book", Status: "unknown"},
		{Title: "Duna", Type: "book", Status: "in_progress", Progress: 2, Total: 1},
		{Title: "Duna", Type: "book", Status: "completed", Rating: 11},
	}
	for i, input := range cases {
		if err := validateInput(input); err == nil {
			t.Errorf("case %d: invalid input accepted", i)
		}
	}
}

func TestLoadConfigValidatesOptionalAuthentication(t *testing.T) {
	t.Setenv("ANILIST_CLIENT_ID", "")
	t.Setenv("ANILIST_CLIENT_SECRET", "")
	t.Setenv("ANILIST_REDIRECT_URL", "")
	t.Setenv("APP_USERNAME", "owner")
	t.Setenv("APP_PASSWORD", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected incomplete credentials to be rejected")
	}

	t.Setenv("APP_PASSWORD", "secret")
	t.Setenv("ANILIST_DELETE_ON_LOCAL_DELETE", "false")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AppUsername != "owner" || cfg.AniListDeleteEnabled {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestBasicAuthIsOptionalAndLeavesHealthPublic(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := basicAuth(next, config{AppUsername: "owner", AppPassword: "secret"})

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/media", nil))
	if unauthorized.Code != http.StatusUnauthorized || unauthorized.Header().Get("WWW-Authenticate") == "" {
		t.Fatalf("expected an authentication challenge, got %d", unauthorized.Code)
	}

	authorizedRequest := httptest.NewRequest(http.MethodGet, "/api/media", nil)
	authorizedRequest.SetBasicAuth("owner", "secret")
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, authorizedRequest)
	if authorized.Code != http.StatusNoContent {
		t.Fatalf("expected authorized request to pass, got %d", authorized.Code)
	}

	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if health.Code != http.StatusNoContent {
		t.Fatalf("expected health endpoint to remain public, got %d", health.Code)
	}
}

func TestLoadEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.env")
	content := "# comment\n\nPORT=9099\nQUOTED=\"hello world\"\nexport EXPORTED=yes\nBROKEN_LINE\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PORT", "")
	t.Setenv("QUOTED", "")
	t.Setenv("EXPORTED", "")
	t.Setenv("KEEP", "original")

	loadEnvFile(path)

	if got := os.Getenv("PORT"); got != "9099" {
		t.Errorf("PORT = %q, want 9099", got)
	}
	if got := os.Getenv("QUOTED"); got != "hello world" {
		t.Errorf("QUOTED = %q, want %q", got, "hello world")
	}
	if got := os.Getenv("EXPORTED"); got != "yes" {
		t.Errorf("EXPORTED = %q, want yes", got)
	}
	if got := os.Getenv("KEEP"); got != "original" {
		t.Errorf("KEEP = %q, want original (existing env must not be overridden)", got)
	}

	loadEnvFile(filepath.Join(t.TempDir(), "missing.env"))
}
