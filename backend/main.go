package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	validTypes    = []string{"anime", "series", "movie", "book", "manga", "light_novel"}
	validStatuses = []string{"planned", "in_progress", "completed", "paused", "dropped"}
)

type Media struct {
	ID                  int       `json:"id"`
	Title               string    `json:"title"`
	Type                string    `json:"type"`
	Status              string    `json:"status"`
	Progress            int       `json:"progress"`
	Total               int       `json:"total"`
	Rating              int       `json:"rating"`
	Notes               string    `json:"notes"`
	CoverURL            string    `json:"coverUrl"`
	Provider            string    `json:"provider,omitempty"`
	ProviderID          string    `json:"providerId,omitempty"`
	ProviderURL         string    `json:"providerUrl,omitempty"`
	OriginalTitle       string    `json:"originalTitle,omitempty"`
	Description         string    `json:"description,omitempty"`
	ReleaseYear         int       `json:"releaseYear,omitempty"`
	ProviderListEntryID int       `json:"providerListEntryId,omitempty"`
	SyncStatus          string    `json:"syncStatus,omitempty"`
	SyncError           string    `json:"syncError,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type mediaInput struct {
	Title         string `json:"title"`
	Type          string `json:"type"`
	Status        string `json:"status"`
	Progress      int    `json:"progress"`
	Total         int    `json:"total"`
	Rating        int    `json:"rating"`
	Notes         string `json:"notes"`
	CoverURL      string `json:"coverUrl"`
	Provider      string `json:"provider"`
	ProviderID    string `json:"providerId"`
	ProviderURL   string `json:"providerUrl"`
	OriginalTitle string `json:"originalTitle"`
	Description   string `json:"description"`
	ReleaseYear   int    `json:"releaseYear"`
}

type persistedStore struct {
	Version        int        `json:"version"`
	Items          []Media    `json:"items"`
	SyncJobs       []syncJob  `json:"syncJobs,omitempty"`
	Activities     []Activity `json:"activities,omitempty"`
	NextID         int        `json:"nextId,omitempty"`
	NextJobID      int64      `json:"nextJobId,omitempty"`
	NextActivityID int64      `json:"nextActivityId,omitempty"`
}

type store struct {
	mu             sync.RWMutex
	path           string
	items          []Media
	syncJobs       []syncJob
	activities     []Activity
	nextID         int
	nextJobID      int64
	nextActivityID int64
}

func newStore(path string) (*store, error) {
	s := &store{path: path, items: []Media{}, syncJobs: []syncJob{}, activities: []Activity{}, nextID: 1, nextJobID: 1, nextActivityID: 1}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return s, nil
	}
	if trimmed[0] == '[' {
		if err := json.Unmarshal(trimmed, &s.items); err != nil {
			return nil, fmt.Errorf("decode legacy data file: %w", err)
		}
	} else {
		var persisted persistedStore
		if err := json.Unmarshal(trimmed, &persisted); err != nil {
			return nil, fmt.Errorf("decode data file: %w", err)
		}
		if persisted.Version != 1 {
			return nil, fmt.Errorf("unsupported data file version %d", persisted.Version)
		}
		s.items = persisted.Items
		s.syncJobs = persisted.SyncJobs
		if persisted.Activities != nil {
			s.activities = persisted.Activities
		}
		if persisted.NextID > s.nextID {
			s.nextID = persisted.NextID
		}
		if persisted.NextJobID > s.nextJobID {
			s.nextJobID = persisted.NextJobID
		}
		if persisted.NextActivityID > s.nextActivityID {
			s.nextActivityID = persisted.NextActivityID
		}
	}
	for _, item := range s.items {
		if item.ID >= s.nextID {
			s.nextID = item.ID + 1
		}
	}
	for _, job := range s.syncJobs {
		if job.ID >= s.nextJobID {
			s.nextJobID = job.ID + 1
		}
		if job.MediaID >= s.nextID {
			s.nextID = job.MediaID + 1
		}
	}
	for _, activity := range s.activities {
		if activity.ID >= s.nextActivityID {
			s.nextActivityID = activity.ID + 1
		}
	}
	if overflow := len(s.activities) - maxStoredActivities; overflow > 0 {
		s.activities = slices.Delete(s.activities, 0, overflow)
	}
	return s, nil
}

func (s *store) persistLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(persistedStore{
		Version: 1, Items: s.items, SyncJobs: s.syncJobs, Activities: s.activities,
		NextID: s.nextID, NextJobID: s.nextJobID, NextActivityID: s.nextActivityID,
	}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

type app struct {
	store     *store
	discovery *discoveryService
	anilist   *aniListSync
	config    config
}

func main() {
	loadEnvFile(envOr("ENV_FILE", ".env"))

	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	s, err := newStore(cfg.DataPath)
	if err != nil {
		log.Fatal(err)
	}

	anilist, err := newAniListSync(cfg, s)
	if err != nil {
		log.Fatal(err)
	}
	application := &app{store: s, discovery: newDiscoveryService(cfg), anilist: anilist, config: cfg}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", application.health)
	mux.HandleFunc("GET /api/auth/check", application.authCheck)
	mux.HandleFunc("GET /api/media", application.listMedia)
	mux.HandleFunc("GET /api/activity", application.listActivity)
	mux.HandleFunc("GET /api/discovery/search", application.searchDiscovery)
	mux.HandleFunc("GET /api/discovery/global", application.searchGlobalDiscovery)
	mux.HandleFunc("GET /api/import/anilist", application.previewAniListImport)
	mux.HandleFunc("POST /api/import/anilist", application.importAniList)
	mux.HandleFunc("GET /api/integrations/anilist", application.anilist.statusHandler)
	mux.HandleFunc("GET /api/integrations/anilist/connect", application.anilist.connectHandler)
	mux.HandleFunc("GET /api/integrations/anilist/callback", application.anilist.callbackHandler)
	mux.HandleFunc("DELETE /api/integrations/anilist", application.anilist.disconnectHandler)
	mux.HandleFunc("POST /api/integrations/anilist/retry", application.anilist.retryHandler)
	mux.HandleFunc("POST /api/media", application.createMedia)
	mux.HandleFunc("PATCH /api/media/{id}", application.updateMedia)
	mux.HandleFunc("DELETE /api/media/{id}", application.deleteMedia)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go application.anilist.run(ctx)

	addr := ":" + cfg.Port
	log.Printf("API listening on http://localhost%s", addr)
	handler := cors(basicAuth(mux, cfg), cfg.AllowedOrigin)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}

func (a *app) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *app) authCheck(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) listMedia(w http.ResponseWriter, _ *http.Request) {
	a.store.mu.RLock()
	items := slices.Clone(a.store.items)
	a.store.mu.RUnlock()
	slices.SortFunc(items, func(a, b Media) int { return b.UpdatedAt.Compare(a.UpdatedAt) })
	writeJSON(w, http.StatusOK, items)
}

func (a *app) createMedia(w http.ResponseWriter, r *http.Request) {
	input, err := decodeInput(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateInput(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	now := time.Now().UTC()
	a.store.mu.Lock()
	if input.Provider != "" && input.ProviderID != "" {
		duplicate := slices.IndexFunc(a.store.items, func(item Media) bool {
			return item.Provider == input.Provider && item.ProviderID == input.ProviderID
		})
		if duplicate != -1 {
			existingID := a.store.items[duplicate].ID
			a.store.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]any{"error": "this title is already in your collection", "existingId": existingID})
			return
		}
	}
	item := Media{ID: a.store.nextID, Title: strings.TrimSpace(input.Title), Type: input.Type, Status: input.Status, Progress: input.Progress, Total: input.Total, Rating: input.Rating, Notes: strings.TrimSpace(input.Notes), CoverURL: strings.TrimSpace(input.CoverURL), Provider: input.Provider, ProviderID: input.ProviderID, ProviderURL: strings.TrimSpace(input.ProviderURL), OriginalTitle: strings.TrimSpace(input.OriginalTitle), Description: strings.TrimSpace(input.Description), ReleaseYear: input.ReleaseYear, CreatedAt: now, UpdatedAt: now}
	originalNextID := a.store.nextID
	originalNextJobID := a.store.nextJobID
	originalNextActivityID := a.store.nextActivityID
	originalJobs := slices.Clone(a.store.syncJobs)
	originalActivities := slices.Clone(a.store.activities)
	a.store.nextID++
	a.store.items = append(a.store.items, item)
	index := len(a.store.items) - 1
	if a.anilist != nil {
		a.anilist.queueUpsertLocked(index)
	}
	item = a.store.items[index]
	a.store.appendActivityLocked(activityForNewMedia(item, "added"))
	err = a.store.persistLocked()
	if err != nil {
		a.store.items = a.store.items[:len(a.store.items)-1]
		a.store.syncJobs = originalJobs
		a.store.activities = originalActivities
		a.store.nextID = originalNextID
		a.store.nextJobID = originalNextJobID
		a.store.nextActivityID = originalNextActivityID
	}
	a.store.mu.Unlock()
	if err == nil && a.anilist != nil {
		a.anilist.wakeWorker()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save media")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (a *app) updateMedia(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id < 1 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	input, err := decodeInput(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateInput(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	a.store.mu.Lock()
	index := slices.IndexFunc(a.store.items, func(item Media) bool { return item.ID == id })
	if index == -1 {
		a.store.mu.Unlock()
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	item := &a.store.items[index]
	original := *item
	if original.Provider == "anilist" && (input.Provider != original.Provider || input.ProviderID != original.ProviderID || input.Type != original.Type) {
		a.store.mu.Unlock()
		writeError(w, http.StatusUnprocessableEntity, "AniList-linked media identity cannot be changed")
		return
	}
	originalJobs := slices.Clone(a.store.syncJobs)
	originalNextJobID := a.store.nextJobID
	originalActivities := slices.Clone(a.store.activities)
	originalNextActivityID := a.store.nextActivityID
	item.Title = strings.TrimSpace(input.Title)
	item.Type = input.Type
	item.Status = input.Status
	item.Progress = input.Progress
	item.Total = input.Total
	item.Rating = input.Rating
	item.Notes = strings.TrimSpace(input.Notes)
	item.CoverURL = strings.TrimSpace(input.CoverURL)
	item.Provider = input.Provider
	item.ProviderID = input.ProviderID
	item.ProviderURL = strings.TrimSpace(input.ProviderURL)
	item.OriginalTitle = strings.TrimSpace(input.OriginalTitle)
	item.Description = strings.TrimSpace(input.Description)
	item.ReleaseYear = input.ReleaseYear
	item.UpdatedAt = time.Now().UTC()
	if a.anilist != nil {
		a.anilist.queueUpsertLocked(index)
	}
	updated := *item
	a.store.appendActivityLocked(activityForUpdatedMedia(original, updated))
	err = a.store.persistLocked()
	if err != nil {
		a.store.items[index] = original
		a.store.syncJobs = originalJobs
		a.store.activities = originalActivities
		a.store.nextJobID = originalNextJobID
		a.store.nextActivityID = originalNextActivityID
	}
	a.store.mu.Unlock()
	if err == nil && a.anilist != nil {
		a.anilist.wakeWorker()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save media")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (a *app) deleteMedia(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id < 1 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	a.store.mu.Lock()
	index := slices.IndexFunc(a.store.items, func(item Media) bool { return item.ID == id })
	if index == -1 {
		a.store.mu.Unlock()
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	originalItems := slices.Clone(a.store.items)
	originalJobs := slices.Clone(a.store.syncJobs)
	originalActivities := slices.Clone(a.store.activities)
	originalNextJobID := a.store.nextJobID
	originalNextActivityID := a.store.nextActivityID
	deleted := a.store.items[index]
	if a.anilist != nil {
		a.anilist.queueDeleteLocked(deleted)
	}
	a.store.items = slices.Delete(a.store.items, index, index+1)
	a.store.appendActivityLocked(Activity{
		MediaID: deleted.ID, Title: deleted.Title, MediaType: deleted.Type, Action: "deleted",
		Changes: ActivityChanges{FromStatus: deleted.Status}, OccurredAt: time.Now().UTC(),
	})
	err = a.store.persistLocked()
	if err != nil {
		a.store.items = originalItems
		a.store.syncJobs = originalJobs
		a.store.activities = originalActivities
		a.store.nextJobID = originalNextJobID
		a.store.nextActivityID = originalNextActivityID
	}
	a.store.mu.Unlock()
	if err == nil && a.anilist != nil {
		a.anilist.wakeWorker()
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save changes")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeInput(r *http.Request) (mediaInput, error) {
	var input mediaInput
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return input, errors.New("invalid request body")
	}
	return input, nil
}

func validateInput(input mediaInput) error {
	if strings.TrimSpace(input.Title) == "" {
		return errors.New("title is required")
	}
	if !slices.Contains(validTypes, input.Type) {
		return errors.New("invalid media type")
	}
	if !slices.Contains(validStatuses, input.Status) {
		return errors.New("invalid status")
	}
	if input.Progress < 0 || input.Total < 0 || (input.Total > 0 && input.Progress > input.Total) {
		return errors.New("invalid progress")
	}
	if input.Rating < 0 || input.Rating > 10 {
		return errors.New("rating must be between 0 and 10")
	}
	if (input.Provider == "") != (input.ProviderID == "") {
		return errors.New("provider and providerId must be supplied together")
	}
	if input.ReleaseYear < 0 || input.ReleaseYear > 9999 {
		return errors.New("invalid release year")
	}
	return nil
}

func basicAuth(next http.Handler, cfg config) http.Handler {
	if cfg.AppUsername == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions || r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		username, password, ok := r.BasicAuth()
		usernameMatches := subtle.ConstantTimeCompare([]byte(username), []byte(cfg.AppUsername)) == 1
		passwordMatches := subtle.ConstantTimeCompare([]byte(password), []byte(cfg.AppPassword)) == 1
		if !ok || !usernameMatches || !passwordMatches {
			w.Header().Set("WWW-Authenticate", `Basic realm="Honne", charset="UTF-8"`)
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func cors(next http.Handler, allowedOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && origin == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// loadEnvFile reads KEY=VALUE pairs from a dotenv file and sets them as
// environment variables. Values already present in the environment are never
// overridden, so real environment variables always win.
func loadEnvFile(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key == "" || os.Getenv(key) != "" {
			continue
		}
		os.Setenv(key, value)
	}
}
