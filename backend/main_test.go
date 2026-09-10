package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateInput(t *testing.T) {
	valid := mediaInput{
		Title: "Duna", Type: "book", Status: "in_progress", Progress: 120, Total: 600, Rating: 8,
		Genres: []string{"Science Fiction"}, Credits: []mediaCredit{{Name: "Frank Herbert", Role: "Author"}},
		ReleaseYear: 1965, Format: "Hardcover", ReleaseStatus: "finished", StartDate: "1965", EndDate: "1965-08",
		DurationMinutes: 120, CatalogTotal: 412, CommunityRating: 8.7,
	}
	if err := validateInput(valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}

	cases := []mediaInput{
		{Type: "book", Status: "planned"},
		{Title: "Duna", Type: "podcast", Status: "planned"},
		{Title: "Duna", Type: "book", Status: "unknown"},
		{Title: "Duna", Type: "book", Status: "in_progress", Progress: 2, Total: 1},
		{Title: "Duna", Type: "book", Status: "completed", Rating: 11},
	}
	tooManyGenres := valid
	tooManyGenres.Genres = make([]string, 13)
	for index := range tooManyGenres.Genres {
		tooManyGenres.Genres[index] = "Genre"
	}
	tooManyCredits := valid
	tooManyCredits.Credits = make([]mediaCredit, 13)
	for index := range tooManyCredits.Credits {
		tooManyCredits.Credits[index] = mediaCredit{Name: "Person", Role: "Author"}
	}
	invalidGenre := valid
	invalidGenre.Genres = []string{strings.Repeat("x", 101)}
	invalidCredit := valid
	invalidCredit.Credits = []mediaCredit{{Name: "", Role: "Author"}}
	invalidReleaseStatus := valid
	invalidReleaseStatus.ReleaseStatus = "unknown"
	invalidDate := valid
	invalidDate.StartDate = "2024-02-30"
	invalidDuration := valid
	invalidDuration.DurationMinutes = 10081
	invalidCatalogTotal := valid
	invalidCatalogTotal.CatalogTotal = -1
	invalidCommunityRating := valid
	invalidCommunityRating.CommunityRating = 10.1
	invalidFormat := valid
	invalidFormat.Format = strings.Repeat("x", 51)
	reversedDates := valid
	reversedDates.StartDate = "1966"
	reversedDates.EndDate = "1965-12-31"
	mismatchedReleaseYear := valid
	mismatchedReleaseYear.ReleaseYear = 1964
	invalidRepeatCount := valid
	invalidRepeatCount.RepeatCount = intPointer(-1)
	tooManyRepeats := valid
	tooManyRepeats.RepeatCount = intPointer(maxRepeatCount + 1)
	invalidPlaytime := valid
	invalidPlaytime.Type = "game"
	invalidPlaytime.PlaytimeMinutes = intPointer(maxPlaytimeMinutes + 1)
	tooManyPlatforms := valid
	tooManyPlatforms.Type = "game"
	platforms := make([]string, maxPersonalPlatforms+1)
	for index := range platforms {
		platforms[index] = "PC"
	}
	tooManyPlatforms.PlayedOnPlatforms = &platforms
	invalidPlatform := valid
	invalidPlatform.Type = "game"
	invalidPlatforms := []string{""}
	invalidPlatform.PlayedOnPlatforms = &invalidPlatforms
	cases = append(cases, tooManyGenres, tooManyCredits, invalidGenre, invalidCredit, invalidReleaseStatus, invalidDate, invalidDuration, invalidCatalogTotal, invalidCommunityRating, invalidFormat, reversedDates, mismatchedReleaseYear, invalidRepeatCount, tooManyRepeats, invalidPlaytime, tooManyPlatforms, invalidPlatform)

	for i, input := range cases {
		if err := validateInput(input); err == nil {
			t.Errorf("case %d: invalid input accepted", i)
		}
	}
}

func TestExpandedMediaMetadataPersistsAcrossCreateAndUpdate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}
	input := mediaInput{
		Title: "Dune", Type: "book", Status: "planned", Total: 412,
		Provider: "open_library", ProviderID: "OL123W", ProviderURL: "https://openlibrary.org/works/OL123W",
		Genres:      []string{"Science Fiction", " science fiction ", "Politics"},
		Credits:     []mediaCredit{{Name: " Frank Herbert ", Role: " Author "}},
		ReleaseYear: 1965, Format: "Hardcover", ReleaseStatus: "finished", StartDate: "1965",
		DurationMinutes: 120, CatalogTotal: 412, CommunityRating: 8.7,
	}
	created := httptest.NewRecorder()
	application.createMedia(created, jsonRequest(http.MethodPost, "/api/media", input))
	if created.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", created.Code, created.Body.String())
	}
	if len(store.items) != 1 || strings.Join(store.items[0].Genres, ",") != "Science Fiction,Politics" || store.items[0].Credits[0] != (mediaCredit{Name: "Frank Herbert", Role: "Author"}) {
		t.Fatalf("create did not normalize metadata: %+v", store.items)
	}

	input.Status = "completed"
	input.Format = "Paperback"
	input.Genres = nil
	input.Credits = nil
	input.ReleaseStatus = ""
	input.StartDate = ""
	input.DurationMinutes = 155
	input.CatalogTotal = 0
	input.CommunityRating = 0
	updated := httptest.NewRecorder()
	request := jsonRequest(http.MethodPatch, "/api/media/1", input)
	request.SetPathValue("id", "1")
	application.updateMedia(updated, request)
	if updated.Code != http.StatusOK {
		t.Fatalf("update = %d: %s", updated.Code, updated.Body.String())
	}

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	item := reopened.items[0]
	if item.Format != "Hardcover" || item.ReleaseStatus != "finished" || item.StartDate != "1965" || item.DurationMinutes != 120 || item.CatalogTotal != 412 || item.CommunityRating != 8.7 || len(item.Genres) != 2 || len(item.Credits) != 1 {
		t.Fatalf("expanded metadata did not survive legacy update/reopen: %+v", item)
	}

	identityChange := mediaInput{Title: item.Title, Type: "movie", Status: item.Status, Progress: item.Progress, Total: item.Total, Rating: item.Rating, Notes: item.Notes, CoverURL: item.CoverURL, Provider: item.Provider, ProviderID: item.ProviderID, ProviderURL: item.ProviderURL, OriginalTitle: item.OriginalTitle, Description: item.Description, ReleaseYear: item.ReleaseYear}
	identityResponse := httptest.NewRecorder()
	identityRequest := jsonRequest(http.MethodPatch, "/api/media/1", identityChange)
	identityRequest.SetPathValue("id", "1")
	application.updateMedia(identityResponse, identityRequest)
	if identityResponse.Code != http.StatusUnprocessableEntity || store.items[0].Type != "book" {
		t.Fatalf("provider identity change = %d, item=%+v", identityResponse.Code, store.items[0])
	}
}

func TestManualMediaIdentityRemainsEditable(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}
	created := httptest.NewRecorder()
	application.createMedia(created, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Manual title", Type: "anime", Status: "planned", Progress: 1, Total: 1,
	}))
	if created.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", created.Code, created.Body.String())
	}

	updated := httptest.NewRecorder()
	request := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Manual movie", Type: "movie", Status: "completed", Progress: 1, Total: 1,
	})
	request.SetPathValue("id", "1")
	application.updateMedia(updated, request)
	if updated.Code != http.StatusOK || store.items[0].Type != "movie" || store.items[0].Title != "Manual movie" {
		t.Fatalf("manual identity update = %d, item=%+v", updated.Code, store.items[0])
	}
}

func TestMovieTrackingRejectsNewProgressAndPreservesLegacyValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}

	invalidCreate := httptest.NewRecorder()
	application.createMedia(invalidCreate, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Legacy-style movie", Type: "movie", Status: "completed", Progress: 1, Total: 1,
	}))
	if invalidCreate.Code != http.StatusUnprocessableEntity || len(store.items) != 0 {
		t.Fatalf("movie create = %d, items=%+v", invalidCreate.Code, store.items)
	}

	created := httptest.NewRecorder()
	application.createMedia(created, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Movie", Type: "movie", Status: "completed",
	}))
	if created.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", created.Code, created.Body.String())
	}

	store.mu.Lock()
	store.items[0].Progress = 1
	store.items[0].Total = 1
	if err := store.persistLocked(); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()

	preserved := httptest.NewRecorder()
	preserveRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Movie", Type: "movie", Status: "completed", Progress: 1, Total: 1, Rating: 9,
	})
	preserveRequest.SetPathValue("id", "1")
	application.updateMedia(preserved, preserveRequest)
	if preserved.Code != http.StatusOK || store.items[0].Progress != 1 || store.items[0].Total != 1 {
		t.Fatalf("legacy movie update = %d, item=%+v", preserved.Code, store.items[0])
	}

	changed := httptest.NewRecorder()
	changeRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Movie", Type: "movie", Status: "completed", Progress: 1, Total: 2, Rating: 9,
	})
	changeRequest.SetPathValue("id", "1")
	application.updateMedia(changed, changeRequest)
	if changed.Code != http.StatusUnprocessableEntity || store.items[0].Total != 1 {
		t.Fatalf("movie progress change = %d, item=%+v", changed.Code, store.items[0])
	}

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.items[0].Progress != 1 || reopened.items[0].Total != 1 || reopened.items[0].Rating != 9 {
		t.Fatalf("legacy movie values did not survive reopen: %+v", reopened.items[0])
	}
}

func TestGameTrackingPersistsAndLegacyUpdatesPreserveIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}
	platforms := []string{" PC ", "pc", "Steam Deck"}

	created := httptest.NewRecorder()
	application.createMedia(created, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Hades", Type: "game", Status: "in_progress", PlaytimeMinutes: intPointer(95), PlayedOnPlatforms: &platforms,
	}))
	if created.Code != http.StatusCreated || store.items[0].PlaytimeMinutes != 95 || strings.Join(store.items[0].PlayedOnPlatforms, ",") != "PC,Steam Deck" {
		t.Fatalf("create = %d, item=%+v", created.Code, store.items[0])
	}

	legacyUpdate := httptest.NewRecorder()
	legacyRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Hades", Type: "game", Status: "completed", Rating: 9,
	})
	legacyRequest.SetPathValue("id", "1")
	application.updateMedia(legacyUpdate, legacyRequest)
	if legacyUpdate.Code != http.StatusOK || store.items[0].PlaytimeMinutes != 95 || len(store.items[0].PlayedOnPlatforms) != 2 {
		t.Fatalf("legacy update = %d, item=%+v", legacyUpdate.Code, store.items[0])
	}

	emptyPlatforms := []string{}
	cleared := httptest.NewRecorder()
	clearRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Hades", Type: "game", Status: "completed", Rating: 9,
		PlaytimeMinutes: intPointer(0), PlayedOnPlatforms: &emptyPlatforms,
	})
	clearRequest.SetPathValue("id", "1")
	application.updateMedia(cleared, clearRequest)
	if cleared.Code != http.StatusOK || store.items[0].PlaytimeMinutes != 0 || store.items[0].PlayedOnPlatforms == nil || len(store.items[0].PlayedOnPlatforms) != 0 {
		t.Fatalf("clear = %d, item=%+v", cleared.Code, store.items[0])
	}

	reopened, err := newStore(path)
	if err != nil || reopened.items[0].PlaytimeMinutes != 0 || reopened.items[0].PlayedOnPlatforms == nil {
		t.Fatalf("game tracking did not survive restart: store=%+v err=%v", reopened, err)
	}

	bookPlatforms := []string{"PC"}
	invalid := httptest.NewRecorder()
	application.createMedia(invalid, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Dune", Type: "book", Status: "planned", PlaytimeMinutes: intPointer(10), PlayedOnPlatforms: &bookPlatforms,
	}))
	if invalid.Code != http.StatusUnprocessableEntity || len(store.items) != 1 {
		t.Fatalf("non-game tracking create = %d, items=%+v", invalid.Code, store.items)
	}
}

func TestGameTrackingRejectsNumericProgress(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "media.json"))
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	(&app{store: store}).createMedia(response, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Hades", Type: "game", Status: "in_progress", Progress: 1, Total: 10,
	}))
	if response.Code != http.StatusUnprocessableEntity || len(store.items) != 0 {
		t.Fatalf("game progress create = %d, items=%+v", response.Code, store.items)
	}
}

func TestRepeatCountPersistsAndLegacyUpdatesPreserveIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	application := &app{store: store}

	created := httptest.NewRecorder()
	application.createMedia(created, jsonRequest(http.MethodPost, "/api/media", mediaInput{
		Title: "Dune", Type: "book", Status: "completed", RepeatCount: intPointer(2),
	}))
	if created.Code != http.StatusCreated || store.items[0].RepeatCount != 2 {
		t.Fatalf("create = %d, item=%+v", created.Code, store.items[0])
	}

	legacyUpdate := httptest.NewRecorder()
	legacyRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Dune", Type: "book", Status: "completed", Rating: 9,
	})
	legacyRequest.SetPathValue("id", "1")
	application.updateMedia(legacyUpdate, legacyRequest)
	if legacyUpdate.Code != http.StatusOK || store.items[0].RepeatCount != 2 {
		t.Fatalf("legacy update = %d, item=%+v", legacyUpdate.Code, store.items[0])
	}

	updated := httptest.NewRecorder()
	updateRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Dune", Type: "book", Status: "completed", Rating: 9, RepeatCount: intPointer(3),
	})
	updateRequest.SetPathValue("id", "1")
	application.updateMedia(updated, updateRequest)
	if updated.Code != http.StatusOK || store.items[0].RepeatCount != 3 {
		t.Fatalf("repeat update = %d, item=%+v", updated.Code, store.items[0])
	}

	invalid := httptest.NewRecorder()
	invalidRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Dune", Type: "book", Status: "completed", Rating: 9, RepeatCount: intPointer(maxRepeatCount + 1),
	})
	invalidRequest.SetPathValue("id", "1")
	application.updateMedia(invalid, invalidRequest)
	if invalid.Code != http.StatusUnprocessableEntity || store.items[0].RepeatCount != 3 {
		t.Fatalf("invalid repeat update = %d, item=%+v", invalid.Code, store.items[0])
	}

	reopened, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.items[0].RepeatCount != 3 {
		t.Fatalf("repeat count did not survive restart: %+v", reopened.items[0])
	}

	cleared := httptest.NewRecorder()
	clearRequest := jsonRequest(http.MethodPatch, "/api/media/1", mediaInput{
		Title: "Dune", Type: "book", Status: "completed", Rating: 9, RepeatCount: intPointer(0),
	})
	clearRequest.SetPathValue("id", "1")
	(&app{store: reopened}).updateMedia(cleared, clearRequest)
	if cleared.Code != http.StatusOK || reopened.items[0].RepeatCount != 0 {
		t.Fatalf("clear repeat count = %d, item=%+v", cleared.Code, reopened.items[0])
	}
	clearedStore, err := newStore(path)
	if err != nil || clearedStore.items[0].RepeatCount != 0 {
		t.Fatalf("cleared repeat count did not survive restart: store=%+v err=%v", clearedStore, err)
	}
}

func TestLegacyMediaSnapshotLoadsWithoutExpandedMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	legacy := `{"version":1,"items":[{"id":1,"title":"Legacy","type":"anime","status":"planned","progress":0,"total":12,"rating":0,"notes":"","coverUrl":"","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := newStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.items) != 1 || store.items[0].Title != "Legacy" || len(store.items[0].Genres) != 0 || len(store.items[0].Credits) != 0 || store.items[0].CatalogTotal != 0 {
		t.Fatalf("legacy snapshot did not load with metadata defaults: %+v", store.items)
	}
	store.mu.Lock()
	err = store.persistLocked()
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(persisted), `"version": 4`) || !strings.Contains(string(persisted), `"playedOnPlatforms": []`) {
		t.Fatalf("v1 snapshot was not upgraded on write: %s", persisted)
	}
	if _, err := newStore(path); err != nil {
		t.Fatalf("v4 snapshot did not reopen: %v", err)
	}

	v2Path := filepath.Join(t.TempDir(), "media.json")
	if err := os.WriteFile(v2Path, []byte(`{"version":2,"items":[{"id":1,"title":"Older","type":"movie","status":"completed","progress":0,"total":0,"rating":8,"notes":"","coverUrl":"","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	v2Store, err := newStore(v2Path)
	if err != nil || v2Store.items[0].RepeatCount != 0 {
		t.Fatalf("v2 snapshot did not migrate with a zero repeat count: store=%+v err=%v", v2Store, err)
	}
	v2Store.mu.Lock()
	err = v2Store.persistLocked()
	v2Store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	v2Persisted, err := os.ReadFile(v2Path)
	if err != nil || !strings.Contains(string(v2Persisted), `"version": 4`) {
		t.Fatalf("v2 snapshot was not upgraded on write: data=%s err=%v", v2Persisted, err)
	}
}

func TestVersionThreeSnapshotMigratesToVersionFour(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	if err := os.WriteFile(path, []byte(`{"version":3,"items":[{"id":1,"title":"Before games","type":"anime","status":"planned","progress":0,"total":0,"rating":0,"repeatCount":0,"notes":"","coverUrl":"","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := newStore(path)
	if err != nil || store.items[0].PlaytimeMinutes != 0 || store.items[0].PlayedOnPlatforms == nil {
		t.Fatalf("v3 snapshot did not migrate with game tracking defaults: store=%+v err=%v", store, err)
	}
	store.mu.Lock()
	err = store.persistLocked()
	store.mu.Unlock()
	data, readErr := os.ReadFile(path)
	if err != nil || readErr != nil || !strings.Contains(string(data), `"version": 4`) || !strings.Contains(string(data), `"playedOnPlatforms": []`) {
		t.Fatalf("v3 snapshot was not rewritten as v4: data=%s persistErr=%v readErr=%v", data, err, readErr)
	}
}

func TestNewStoreRejectsUnknownSnapshotVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.json")
	if err := os.WriteFile(path, []byte(`{"version":5,"items":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := newStore(path); err == nil || !strings.Contains(err.Error(), "unsupported data file version 5") {
		t.Fatalf("expected unsupported version error, got %v", err)
	}
}

func TestLoadConfigValidatesOptionalAuthentication(t *testing.T) {
	t.Setenv("PORT", "")
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
	if cfg.Port != "7417" || cfg.AppUsername != "owner" || cfg.AniListDeleteEnabled {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func intPointer(value int) *int {
	return &value
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
