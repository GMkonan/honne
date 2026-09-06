package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestProfileConfigDefaults(t *testing.T) {
	unsetEnv(t, "PROFILE_NAME")
	t.Setenv("PROFILE_AVATAR_URL", "")
	t.Setenv("APP_USERNAME", "")
	t.Setenv("APP_PASSWORD", "")
	t.Setenv("ANILIST_CLIENT_ID", "")
	t.Setenv("ANILIST_CLIENT_SECRET", "")
	t.Setenv("ANILIST_REDIRECT_URL", "")
	t.Setenv("ANILIST_DELETE_ON_LOCAL_DELETE", "true")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProfileName != "My Library" || cfg.ProfileAvatarURL != "" {
		t.Fatalf("unexpected profile defaults: %+v", cfg)
	}
}

func TestProfileConfigAcceptsValidValues(t *testing.T) {
	t.Setenv("PROFILE_NAME", "  Konan の Library  ")
	t.Setenv("PROFILE_AVATAR_URL", "https://images.example.com/avatar.png")

	name, err := loadProfileName()
	if err != nil {
		t.Fatal(err)
	}
	avatarURL, err := validateProfileAvatarURL(os.Getenv("PROFILE_AVATAR_URL"))
	if err != nil {
		t.Fatal(err)
	}
	if name != "Konan の Library" || avatarURL != "https://images.example.com/avatar.png" {
		t.Fatalf("unexpected profile: name=%q avatar=%q", name, avatarURL)
	}
}

func TestProfileConfigRejectsInvalidValues(t *testing.T) {
	invalidNames := []string{"   ", strings.Repeat("界", 81)}
	for _, value := range invalidNames {
		t.Setenv("PROFILE_NAME", value)
		if _, err := loadProfileName(); err == nil {
			t.Errorf("accepted invalid profile name %q", value)
		}
	}

	invalidURLs := []string{
		"avatar.png",
		"ftp://images.example.com/avatar.png",
		"https://owner:secret@images.example.com/avatar.png",
	}
	for _, value := range invalidURLs {
		if _, err := validateProfileAvatarURL(value); err == nil {
			t.Errorf("accepted invalid avatar URL %q", value)
		}
	}
}

func TestProfileEndpointReturnsOnlyPublicFields(t *testing.T) {
	application := &app{config: config{
		ProfileName:      "Konan",
		ProfileAvatarURL: "https://images.example.com/avatar.png",
		TMDBAPIToken:     "must-not-leak",
		AppPassword:      "must-not-leak",
	}}
	response := httptest.NewRecorder()

	application.getProfile(response, httptest.NewRequest(http.MethodGet, "/api/profile", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 2 || body["name"] != "Konan" || body["avatarUrl"] != "https://images.example.com/avatar.png" {
		t.Fatalf("unexpected response: %#v", body)
	}
}

func unsetEnv(t *testing.T, key string) {
	t.Helper()
	original, existed := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if existed {
			_ = os.Setenv(key, original)
		} else {
			_ = os.Unsetenv(key)
		}
	})
}
