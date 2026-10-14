package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestCustomBannerPersistsAndCanBeReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store := emptyStore(path)
	application := &app{store: store, config: config{ProfileName: "My Library"}}
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)

	request := httptest.NewRequest(http.MethodPut, "/api/profile/banner", bytes.NewReader(png))
	request.Header.Set("Content-Type", "image/png")
	response := httptest.NewRecorder()
	application.updateLibraryBanner(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("upload status = %d: %s", response.Code, response.Body.String())
	}

	profileResponse := httptest.NewRecorder()
	application.getProfile(profileResponse, httptest.NewRequest(http.MethodGet, "/api/profile", nil))
	if !strings.Contains(profileResponse.Body.String(), `"bannerUrl":"/api/profile/banner?v=`) {
		t.Fatalf("profile did not expose the custom banner: %s", profileResponse.Body.String())
	}

	bannerResponse := httptest.NewRecorder()
	application.getLibraryBanner(bannerResponse, httptest.NewRequest(http.MethodGet, "/api/profile/banner", nil))
	if bannerResponse.Code != http.StatusOK || bannerResponse.Header().Get("Content-Type") != "image/png" || !bytes.Equal(bannerResponse.Body.Bytes(), png) {
		t.Fatalf("unexpected banner response: %d %v", bannerResponse.Code, bannerResponse.Header())
	}

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.appearance.BannerContentType != "image/png" || !bytes.Equal(reopened.appearance.BannerData, png) {
		t.Fatal("custom banner was not durable")
	}

	resetResponse := httptest.NewRecorder()
	application.resetLibraryBanner(resetResponse, httptest.NewRequest(http.MethodDelete, "/api/profile/banner", nil))
	if resetResponse.Code != http.StatusNoContent || len(store.appearance.BannerData) != 0 {
		t.Fatalf("banner reset failed: %d", resetResponse.Code)
	}
}

func TestCustomBannerRejectsMismatchedOrOversizedInput(t *testing.T) {
	application := &app{store: emptyStore(filepath.Join(t.TempDir(), "media.json"))}

	mismatch := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/profile/banner", strings.NewReader("not an image"))
	request.Header.Set("Content-Type", "image/png")
	application.updateLibraryBanner(mismatch, request)
	if mismatch.Code != http.StatusUnprocessableEntity {
		t.Fatalf("mismatched image status = %d", mismatch.Code)
	}

	oversized := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPut, "/api/profile/banner", bytes.NewReader(bytes.Repeat([]byte{0}, maxBannerBytes+1)))
	request.Header.Set("Content-Type", "image/png")
	application.updateLibraryBanner(oversized, request)
	if oversized.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized image status = %d", oversized.Code)
	}
}

func TestFavoritesPreserveOrderAndAreRemovedWithMedia(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store := emptyStore(path)
	store.items = []Media{{ID: 1, Title: "One"}, {ID: 2, Title: "Two"}, {ID: 3, Title: "Three"}}
	store.nextID = 4
	application := &app{store: store}

	request := httptest.NewRequest(http.MethodPut, "/api/favorites", strings.NewReader(`{"mediaIds":[3,1,2]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	application.replaceFavorites(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("replace favorites status = %d: %s", response.Code, response.Body.String())
	}
	var body favoritesResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.MediaIDs) != 3 || body.MediaIDs[0] != 3 || body.MediaIDs[1] != 1 || body.MediaIDs[2] != 2 {
		t.Fatalf("favorite order changed: %+v", body.MediaIDs)
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/media/1", nil)
	deleteRequest.SetPathValue("id", "1")
	deleteResponse := httptest.NewRecorder()
	application.deleteMedia(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusNoContent || len(store.favoriteMediaIDs) != 2 || store.favoriteMediaIDs[0] != 3 || store.favoriteMediaIDs[1] != 2 {
		t.Fatalf("deleting media did not clean favorites: status=%d ids=%v", deleteResponse.Code, store.favoriteMediaIDs)
	}

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.favoriteMediaIDs) != 2 || reopened.favoriteMediaIDs[0] != 3 || reopened.favoriteMediaIDs[1] != 2 {
		t.Fatalf("favorites were not durable: %v", reopened.favoriteMediaIDs)
	}
}

func TestFavoritesRejectInvalidReferencesAndDuplicates(t *testing.T) {
	store := emptyStore(filepath.Join(t.TempDir(), "media.json"))
	store.items = []Media{{ID: 1, Title: "One"}}
	application := &app{store: store}
	for _, body := range []string{`{"mediaIds":[1,1]}`, `{"mediaIds":[2]}`, `{"mediaIds":[1,2,3,4,5,6,7,8,9,10]}`} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPut, "/api/favorites", strings.NewReader(body))
		application.replaceFavorites(response, request)
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("invalid favorites %s returned %d", body, response.Code)
		}
	}
}
