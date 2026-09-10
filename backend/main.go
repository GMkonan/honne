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

const persistedStoreVersion = 5

var (
	validTypes    = []string{"anime", "series", "movie", "book", "manga", "light_novel", "game"}
	catalogTypes  = []string{"anime", "series", "movie", "book", "manga", "light_novel"}
	validStatuses = []string{"planned", "in_progress", "completed", "paused", "dropped"}
)

type mediaCredit struct {
	Name string `json:"name"`
	Role string `json:"role"`
}

type Media struct {
	ID                  int           `json:"id"`
	Title               string        `json:"title"`
	Type                string        `json:"type"`
	Status              string        `json:"status"`
	Progress            int           `json:"progress"`
	Total               int           `json:"total"`
	Rating              int           `json:"rating"`
	RepeatCount         int           `json:"repeatCount"`
	PlaytimeMinutes     int           `json:"playtimeMinutes"`
	PlayedOnPlatforms   []string      `json:"playedOnPlatforms"`
	CatalogPlatforms    []string      `json:"catalogPlatforms"`
	Notes               string        `json:"notes"`
	CoverURL            string        `json:"coverUrl"`
	Provider            string        `json:"provider,omitempty"`
	ProviderID          string        `json:"providerId,omitempty"`
	ProviderURL         string        `json:"providerUrl,omitempty"`
	OriginalTitle       string        `json:"originalTitle,omitempty"`
	Description         string        `json:"description,omitempty"`
	ReleaseYear         int           `json:"releaseYear,omitempty"`
	Format              string        `json:"format,omitempty"`
	Genres              []string      `json:"genres,omitempty"`
	Credits             []mediaCredit `json:"credits,omitempty"`
	ReleaseStatus       string        `json:"releaseStatus,omitempty"`
	StartDate           string        `json:"startDate,omitempty"`
	EndDate             string        `json:"endDate,omitempty"`
	DurationMinutes     int           `json:"durationMinutes,omitempty"`
	CatalogTotal        int           `json:"catalogTotal,omitempty"`
	CommunityRating     float64       `json:"communityRating,omitempty"`
	ProviderListEntryID int           `json:"providerListEntryId,omitempty"`
	AniListUserID       int           `json:"anilistUserId,omitempty"`
	AniListRepeatKnown  bool          `json:"anilistRepeatKnown,omitempty"`
	SyncStatus          string        `json:"syncStatus,omitempty"`
	SyncError           string        `json:"syncError,omitempty"`
	CreatedAt           time.Time     `json:"createdAt"`
	UpdatedAt           time.Time     `json:"updatedAt"`
}

type mediaInput struct {
	Title             string        `json:"title"`
	Type              string        `json:"type"`
	Status            string        `json:"status"`
	Progress          int           `json:"progress"`
	Total             int           `json:"total"`
	Rating            int           `json:"rating"`
	RepeatCount       *int          `json:"repeatCount,omitempty"`
	PlaytimeMinutes   *int          `json:"playtimeMinutes,omitempty"`
	PlayedOnPlatforms *[]string     `json:"playedOnPlatforms,omitempty"`
	CatalogPlatforms  []string      `json:"catalogPlatforms,omitempty"`
	Notes             string        `json:"notes"`
	CoverURL          string        `json:"coverUrl"`
	Provider          string        `json:"provider"`
	ProviderID        string        `json:"providerId"`
	ProviderURL       string        `json:"providerUrl"`
	OriginalTitle     string        `json:"originalTitle"`
	Description       string        `json:"description"`
	ReleaseYear       int           `json:"releaseYear"`
	Format            string        `json:"format,omitempty"`
	Genres            []string      `json:"genres,omitempty"`
	Credits           []mediaCredit `json:"credits,omitempty"`
	ReleaseStatus     string        `json:"releaseStatus,omitempty"`
	StartDate         string        `json:"startDate,omitempty"`
	EndDate           string        `json:"endDate,omitempty"`
	DurationMinutes   int           `json:"durationMinutes,omitempty"`
	CatalogTotal      int           `json:"catalogTotal,omitempty"`
	CommunityRating   float64       `json:"communityRating,omitempty"`
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
		if persisted.Version < 1 || persisted.Version > persistedStoreVersion {
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
	for index := range s.items {
		if s.items[index].PlayedOnPlatforms == nil {
			s.items[index].PlayedOnPlatforms = []string{}
		}
		if s.items[index].CatalogPlatforms == nil {
			s.items[index].CatalogPlatforms = []string{}
		}
		item := s.items[index]
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

func (s *store) marshalSnapshotLocked() ([]byte, error) {
	return json.MarshalIndent(persistedStore{
		Version: persistedStoreVersion, Items: s.items, SyncJobs: s.syncJobs, Activities: s.activities,
		NextID: s.nextID, NextJobID: s.nextJobID, NextActivityID: s.nextActivityID,
	}, "", "  ")
}

func (s *store) persistLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := s.marshalSnapshotLocked()
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
	mux.HandleFunc("GET /api/profile", application.getProfile)
	mux.HandleFunc("GET /api/media", application.listMedia)
	mux.HandleFunc("GET /api/activity", application.listActivity)
	mux.HandleFunc("GET /api/backup", application.downloadBackup)
	mux.HandleFunc("GET /api/discovery/search", application.searchDiscovery)
	mux.HandleFunc("GET /api/discovery/global", application.searchGlobalDiscovery)
	mux.HandleFunc("GET /api/discovery/detail", application.getDiscoveryDetail)
	mux.HandleFunc("GET /api/import/anilist", application.previewAniListImport)
	mux.HandleFunc("POST /api/import/anilist", application.importAniList)
	mux.HandleFunc("GET /api/integrations/anilist", application.anilist.statusHandler)
	mux.HandleFunc("GET /api/integrations/anilist/connect", application.anilist.connectHandler)
	mux.HandleFunc("GET /api/integrations/anilist/callback", application.anilist.callbackHandler)
	mux.HandleFunc("DELETE /api/integrations/anilist", application.anilist.disconnectHandler)
	mux.HandleFunc("POST /api/integrations/anilist/retry", application.anilist.retryHandler)
	mux.HandleFunc("POST /api/media", application.createMedia)
	mux.HandleFunc("PATCH /api/media/{id}", application.updateMedia)
	mux.HandleFunc("POST /api/media/{id}/refresh-metadata", application.refreshMediaMetadata)
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
	if err := validateTrackingForCreate(input); err != nil {
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
	item := mediaFromInput(a.store.nextID, input, now)
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
	if original.Provider != "" && (input.Provider != original.Provider || input.ProviderID != original.ProviderID || input.Type != original.Type) {
		a.store.mu.Unlock()
		writeError(w, http.StatusUnprocessableEntity, "provider-linked media identity cannot be changed")
		return
	}
	if err := validateTrackingForUpdate(original, input); err != nil {
		a.store.mu.Unlock()
		writeError(w, http.StatusUnprocessableEntity, err.Error())
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
	if input.RepeatCount != nil {
		item.RepeatCount = *input.RepeatCount
	}
	if input.PlaytimeMinutes != nil {
		item.PlaytimeMinutes = *input.PlaytimeMinutes
	}
	if input.PlayedOnPlatforms != nil {
		item.PlayedOnPlatforms = normalizedPersonalPlatforms(*input.PlayedOnPlatforms)
	}
	item.Notes = strings.TrimSpace(input.Notes)
	item.CoverURL = strings.TrimSpace(input.CoverURL)
	item.Provider = input.Provider
	item.ProviderID = input.ProviderID
	item.ProviderURL = strings.TrimSpace(input.ProviderURL)
	item.OriginalTitle = strings.TrimSpace(input.OriginalTitle)
	item.Description = strings.TrimSpace(input.Description)
	item.ReleaseYear = input.ReleaseYear
	// Catalog metadata is provider-owned and intentionally preserved on regular
	// updates. This also prevents older clients from clearing fields they do not
	// know about when sending their complete legacy payload.
	item.UpdatedAt = time.Now().UTC()
	queuedAniListUpsert := a.anilist != nil && aniListWritableFieldsChanged(original, *item)
	if queuedAniListUpsert {
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
	if err == nil && queuedAniListUpsert {
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
	if input.RepeatCount != nil && (*input.RepeatCount < 0 || *input.RepeatCount > maxRepeatCount) {
		return fmt.Errorf("repeat count must be between 0 and %d", maxRepeatCount)
	}
	if input.PlaytimeMinutes != nil && (*input.PlaytimeMinutes < 0 || *input.PlaytimeMinutes > maxPlaytimeMinutes) {
		return fmt.Errorf("playtime must be between 0 and %d minutes", maxPlaytimeMinutes)
	}
	if input.PlayedOnPlatforms != nil {
		if len(*input.PlayedOnPlatforms) > maxPersonalPlatforms {
			return fmt.Errorf("played-on platforms cannot contain more than %d entries", maxPersonalPlatforms)
		}
		for _, platform := range *input.PlayedOnPlatforms {
			if length := len([]rune(strings.TrimSpace(platform))); length < 1 || length > maxPersonalPlatformLength {
				return fmt.Errorf("played-on platforms must contain between 1 and %d characters", maxPersonalPlatformLength)
			}
		}
	}
	if (input.Provider == "") != (input.ProviderID == "") {
		return errors.New("provider and providerId must be supplied together")
	}
	if input.ReleaseYear < 0 || input.ReleaseYear > 9999 {
		return errors.New("invalid release year")
	}
	if len([]rune(strings.TrimSpace(input.Format))) > 50 {
		return errors.New("format cannot contain more than 50 characters")
	}
	if len(input.Genres) > 12 {
		return errors.New("genres cannot contain more than 12 entries")
	}
	for _, genre := range input.Genres {
		if length := len([]rune(strings.TrimSpace(genre))); length < 1 || length > 100 {
			return errors.New("genres must contain between 1 and 100 characters")
		}
	}
	if input.Type != "game" && len(input.CatalogPlatforms) > 0 {
		return errors.New("catalog platforms are only supported for games")
	}
	if len(input.CatalogPlatforms) > 12 {
		return errors.New("catalog platforms cannot contain more than 12 entries")
	}
	for _, platform := range input.CatalogPlatforms {
		if length := len([]rune(strings.TrimSpace(platform))); length < 1 || length > 100 {
			return errors.New("catalog platforms must contain between 1 and 100 characters")
		}
	}
	if len(input.Credits) > 12 {
		return errors.New("credits cannot contain more than 12 entries")
	}
	for _, credit := range input.Credits {
		nameLength := len([]rune(strings.TrimSpace(credit.Name)))
		roleLength := len([]rune(strings.TrimSpace(credit.Role)))
		if nameLength < 1 || nameLength > 100 || roleLength < 1 || roleLength > 100 {
			return errors.New("credit names and roles must contain between 1 and 100 characters")
		}
	}
	if input.ReleaseStatus != "" && !slices.Contains([]string{"announced", "upcoming", "releasing", "finished", "cancelled", "hiatus"}, input.ReleaseStatus) {
		return errors.New("invalid release status")
	}
	if !validPartialDate(input.StartDate) || !validPartialDate(input.EndDate) {
		return errors.New("dates must use YYYY, YYYY-MM, or YYYY-MM-DD")
	}
	if input.StartDate != "" && input.EndDate != "" && partialDateDefinitelyAfter(input.StartDate, input.EndDate) {
		return errors.New("end date cannot be before start date")
	}
	if input.ReleaseYear > 0 && len(input.StartDate) >= 4 {
		startYear, _ := strconv.Atoi(input.StartDate[:4])
		if startYear != input.ReleaseYear {
			return errors.New("release year must match start date")
		}
	}
	if input.DurationMinutes < 0 || input.DurationMinutes > 10080 {
		return errors.New("duration must be between 0 and 10080 minutes")
	}
	if input.CatalogTotal < 0 {
		return errors.New("catalog total cannot be negative")
	}
	if input.CommunityRating < 0 || input.CommunityRating > 10 {
		return errors.New("community rating must be between 0 and 10")
	}
	return nil
}

func validPartialDate(value string) bool {
	if value == "" {
		return true
	}
	layout := ""
	switch len(value) {
	case 4:
		layout = "2006"
	case 7:
		layout = "2006-01"
	case 10:
		layout = "2006-01-02"
	default:
		return false
	}
	_, err := time.Parse(layout, value)
	return err == nil
}

func partialDateDefinitelyAfter(start, end string) bool {
	startEarliest, _ := partialDateRange(start)
	_, endLatest := partialDateRange(end)
	return startEarliest.After(endLatest)
}

func partialDateRange(value string) (time.Time, time.Time) {
	parts := strings.Split(value, "-")
	year, _ := strconv.Atoi(parts[0])
	startMonth, endMonth := time.January, time.December
	if len(parts) >= 2 {
		month, _ := strconv.Atoi(parts[1])
		startMonth, endMonth = time.Month(month), time.Month(month)
	}
	startDay := 1
	endDay := time.Date(year, endMonth+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if len(parts) == 3 {
		day, _ := strconv.Atoi(parts[2])
		startDay, endDay = day, day
	}
	return time.Date(year, startMonth, startDay, 0, 0, 0, 0, time.UTC),
		time.Date(year, endMonth, endDay, 0, 0, 0, 0, time.UTC)
}

func normalizedMetadataStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if length := len([]rune(value)); length < 1 || length > 100 || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
		if len(result) == 12 {
			break
		}
	}
	return result
}

func normalizedPersonalPlatforms(values []string) []string {
	result := make([]string, 0, min(len(values), maxPersonalPlatforms))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if length := len([]rune(value)); length < 1 || length > maxPersonalPlatformLength || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
		if len(result) == maxPersonalPlatforms {
			break
		}
	}
	return result
}

func normalizedMediaCredits(values []mediaCredit) []mediaCredit {
	if len(values) == 0 {
		return nil
	}
	result := make([]mediaCredit, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value.Name = strings.TrimSpace(value.Name)
		value.Role = strings.TrimSpace(value.Role)
		key := strings.ToLower(value.Name) + "\x00" + strings.ToLower(value.Role)
		nameLength := len([]rune(value.Name))
		roleLength := len([]rune(value.Role))
		if nameLength < 1 || nameLength > 100 || roleLength < 1 || roleLength > 100 || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
		if len(result) == 12 {
			break
		}
	}
	return result
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
