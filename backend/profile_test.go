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
	unsetEnv(t, "PROFILE_CAT_ENABLED")
	t.Setenv("APP_USERNAME", "")
	t.Setenv("APP_PASSWORD", "")
	t.Setenv("ANILIST_CLIENT_ID", "")
	t.Setenv("ANILIST_CLIENT_SECRET", "")
	t.Setenv("ANILIST_REDIRECT_URL", "")
	t.Setenv("ANILIST_DELETE_ON_LOCAL_DELETE", "true")
	unsetEnv(t, "RAWG_API_URL")
	t.Setenv("RAWG_API_KEY", "")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ProfileName != "My Library" || cfg.ProfileAvatarURL != "" || cfg.ProfileCatEnabled || cfg.RAWGAPIURL != "https://api.rawg.io/api" {
		t.Fatalf("unexpected profile defaults: %+v", cfg)
	}
	t.Setenv("RAWG_API_URL", "ftp://example.com")
	if _, err := loadConfig(); err == nil || !strings.Contains(err.Error(), "RAWG_API_URL") {
		t.Fatalf("invalid RAWG URL was accepted: %v", err)
	}
}

func TestProfileConfigAcceptsValidValues(t *testing.T) {
	t.Setenv("PROFILE_NAME", "  Konan の Library  ")
	t.Setenv("PROFILE_AVATAR_URL", "https://images.example.com/avatar.png")
	t.Setenv("PROFILE_CAT_ENABLED", "true")

	name, err := loadProfileName()
	if err != nil {
		t.Fatal(err)
	}
	avatarURL, err := validateProfileAvatarURL(os.Getenv("PROFILE_AVATAR_URL"))
	if err != nil {
		t.Fatal(err)
	}
	catEnabled, err := envBool("PROFILE_CAT_ENABLED", false)
	if err != nil {
		t.Fatal(err)
	}
	if name != "Konan の Library" || avatarURL != "https://images.example.com/avatar.png" || !catEnabled {
		t.Fatalf("unexpected profile: name=%q avatar=%q cat=%t", name, avatarURL, catEnabled)
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

	t.Setenv("PROFILE_CAT_ENABLED", "sometimes")
	if _, err := envBool("PROFILE_CAT_ENABLED", false); err == nil {
		t.Error("accepted invalid profile cat toggle")
	}
}

func TestProfileEndpointReturnsOnlyPublicFields(t *testing.T) {
	application := &app{config: config{
		ProfileName:       "Konan",
		ProfileAvatarURL:  "https://images.example.com/avatar.png",
		ProfileCatEnabled: true,
		TMDBAPIToken:      "must-not-leak",
		RAWGAPIKey:        "must-not-leak",
		AppPassword:       "must-not-leak",
	}}
	response := httptest.NewRecorder()

	application.getProfile(response, httptest.NewRequest(http.MethodGet, "/api/profile", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 3 || body["name"] != "Konan" || body["avatarUrl"] != "https://images.example.com/avatar.png" || body["catEnabled"] != true {
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
