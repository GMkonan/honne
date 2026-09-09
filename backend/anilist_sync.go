package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	syncUpsert = "upsert"
	syncDelete = "delete"
)

var errAniListUnauthorized = errors.New("AniList authorization is no longer valid")

type aniListUpsertResult struct {
	ListEntryID int
	Repeat      *int
	RepeatSent  bool
}

type syncJob struct {
	ID                  int64     `json:"id"`
	MediaID             int       `json:"mediaId"`
	Operation           string    `json:"operation"`
	ProviderMediaID     int       `json:"providerMediaId"`
	ProviderListEntryID int       `json:"providerListEntryId,omitempty"`
	AniListUserID       int       `json:"anilistUserId,omitempty"`
	Generation          int64     `json:"generation"`
	Attempts            int       `json:"attempts,omitempty"`
	NextAttemptAt       time.Time `json:"nextAttemptAt"`
	LastError           string    `json:"lastError,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type aniListAuth struct {
	AccessToken string    `json:"accessToken"`
	TokenType   string    `json:"tokenType"`
	ExpiresAt   time.Time `json:"expiresAt"`
	UserID      int       `json:"userId"`
	Username    string    `json:"username"`
	Avatar      string    `json:"avatar,omitempty"`
}

type oauthAttempt struct {
	ExpiresAt time.Time
}

type aniListSync struct {
	cfg    config
	store  *store
	client *http.Client

	mu       sync.RWMutex
	auth     *aniListAuth
	attempts map[string]oauthAttempt
	wake     chan struct{}
}

type aniListIntegrationStatus struct {
	Configured    bool       `json:"configured"`
	Connected     bool       `json:"connected"`
	Username      string     `json:"username,omitempty"`
	Avatar        string     `json:"avatar,omitempty"`
	ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
	DeleteEnabled bool       `json:"deleteOnLocalDelete"`
	Pending       int        `json:"pending"`
	Errors        int        `json:"errors"`
}

func newAniListSync(cfg config, store *store) (*aniListSync, error) {
	s := &aniListSync{
		cfg:      cfg,
		store:    store,
		client:   &http.Client{Timeout: 10 * time.Second},
		attempts: make(map[string]oauthAttempt),
		wake:     make(chan struct{}, 1),
	}
	data, err := os.ReadFile(cfg.AniListAuthPath)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read AniList auth: %w", err)
	}
	var auth aniListAuth
	if err := json.Unmarshal(data, &auth); err != nil {
		return nil, fmt.Errorf("decode AniList auth: %w", err)
	}
	if auth.AccessToken != "" {
		s.auth = &auth
	}
	return s, nil
}

func (s *aniListSync) connectedUsername() (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.cfg.aniListConfigured() || s.auth == nil || s.auth.AccessToken == "" || (!s.auth.ExpiresAt.IsZero() && !time.Now().Before(s.auth.ExpiresAt)) {
		return "", false
	}
	return s.auth.Username, true
}

func (s *aniListSync) authSnapshot() (aniListAuth, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.cfg.aniListConfigured() || s.auth == nil || s.auth.AccessToken == "" || (!s.auth.ExpiresAt.IsZero() && !time.Now().Before(s.auth.ExpiresAt)) {
		return aniListAuth{}, false
	}
	return *s.auth, true
}

func (s *aniListSync) knownUserID() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.auth == nil {
		return 0
	}
	return s.auth.UserID
}

func (s *aniListSync) queueUpsertLocked(index int) {
	item := &s.store.items[index]
	if !isAniListLinked(*item) || !s.cfg.aniListConfigured() {
		if slices.Contains([]string{"anime", "manga", "light_novel"}, item.Type) {
			item.SyncStatus = "local_only"
			item.SyncError = ""
		}
		return
	}

	now := time.Now().UTC()
	providerID, _ := strconv.Atoi(item.ProviderID)
	connected := false
	if _, ok := s.authSnapshot(); ok {
		connected = true
	}
	knownUserID := s.knownUserID()
	if item.AniListRepeatKnown && item.AniListUserID > 0 {
		knownUserID = item.AniListUserID
	}
	for jobIndex := range s.store.syncJobs {
		job := &s.store.syncJobs[jobIndex]
		if job.MediaID != item.ID {
			continue
		}
		job.Operation = syncUpsert
		job.ProviderMediaID = providerID
		job.ProviderListEntryID = item.ProviderListEntryID
		if job.AniListUserID == 0 {
			job.AniListUserID = knownUserID
		}
		job.Generation++
		job.Attempts = 0
		job.NextAttemptAt = now
		job.LastError = ""
		job.UpdatedAt = now
		item.SyncStatus = syncState(connected)
		item.SyncError = ""
		return
	}
	s.store.syncJobs = append(s.store.syncJobs, syncJob{
		ID:                  s.store.nextJobID,
		MediaID:             item.ID,
		Operation:           syncUpsert,
		ProviderMediaID:     providerID,
		ProviderListEntryID: item.ProviderListEntryID,
		AniListUserID:       knownUserID,
		Generation:          1,
		NextAttemptAt:       now,
		CreatedAt:           now,
		UpdatedAt:           now,
	})
	s.store.nextJobID++
	item.SyncStatus = syncState(connected)
	item.SyncError = ""
}

func syncState(connected bool) string {
	if connected {
		return "pending"
	}
	return "waiting_auth"
}

func (s *aniListSync) queueDeleteLocked(item Media) {
	jobIndex := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return job.MediaID == item.ID })
	// A local-only item has never been associated with the connected account.
	// In particular, it may have been imported from somebody else's public list.
	if jobIndex < 0 && item.ProviderListEntryID == 0 && (item.SyncStatus == "local_only" || item.SyncStatus == "") {
		return
	}
	// If an upsert was queued before any account was connected, deleting the
	// local item should cancel it rather than delete that title from whichever
	// account happens to connect in the future.
	if jobIndex >= 0 && s.store.syncJobs[jobIndex].Operation == syncUpsert &&
		item.ProviderListEntryID == 0 && s.store.syncJobs[jobIndex].AniListUserID == 0 {
		s.store.syncJobs = slices.Delete(s.store.syncJobs, jobIndex, jobIndex+1)
		return
	}
	// Legacy snapshots can contain a list-entry ID without recording which
	// AniList account owns it. Require a connected import or a safely owned
	// pending job before allowing remote deletion.
	if item.AniListUserID == 0 && (jobIndex < 0 || s.store.syncJobs[jobIndex].AniListUserID == 0) {
		if jobIndex >= 0 {
			s.store.syncJobs = slices.Delete(s.store.syncJobs, jobIndex, jobIndex+1)
		}
		return
	}
	if !s.cfg.aniListConfigured() || !s.cfg.AniListDeleteEnabled || !isAniListLinked(item) {
		if jobIndex >= 0 {
			s.store.syncJobs = slices.Delete(s.store.syncJobs, jobIndex, jobIndex+1)
		}
		return
	}
	now := time.Now().UTC()
	providerID, _ := strconv.Atoi(item.ProviderID)
	knownUserID := s.knownUserID()
	if item.AniListUserID > 0 {
		knownUserID = item.AniListUserID
	}
	if jobIndex >= 0 {
		job := &s.store.syncJobs[jobIndex]
		job.Operation = syncDelete
		job.ProviderMediaID = providerID
		if item.ProviderListEntryID > 0 {
			job.ProviderListEntryID = item.ProviderListEntryID
		}
		if job.AniListUserID == 0 {
			job.AniListUserID = knownUserID
		}
		job.Generation++
		job.Attempts = 0
		job.NextAttemptAt = now
		job.LastError = ""
		job.UpdatedAt = now
		return
	}
	s.store.syncJobs = append(s.store.syncJobs, syncJob{
		ID:                  s.store.nextJobID,
		MediaID:             item.ID,
		Operation:           syncDelete,
		ProviderMediaID:     providerID,
		ProviderListEntryID: item.ProviderListEntryID,
		AniListUserID:       knownUserID,
		Generation:          1,
		NextAttemptAt:       now,
		CreatedAt:           now,
		UpdatedAt:           now,
	})
	s.store.nextJobID++
}

func aniListWritableFieldsChanged(before, after Media) bool {
	return before.Status != after.Status || before.Progress != after.Progress ||
		before.Rating != after.Rating || before.Notes != after.Notes ||
		(after.AniListRepeatKnown && after.AniListUserID > 0 && before.RepeatCount != after.RepeatCount)
}

func isAniListLinked(item Media) bool {
	if item.Provider != "anilist" || !slices.Contains([]string{"anime", "manga", "light_novel"}, item.Type) {
		return false
	}
	id, err := strconv.Atoi(item.ProviderID)
	return err == nil && id > 0
}

func (s *aniListSync) wakeWorker() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *aniListSync) run(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.wake:
		}
		for s.processNext(ctx) {
		}
	}
}

func (s *aniListSync) processNext(ctx context.Context) bool {
	now := time.Now().UTC()
	s.store.mu.Lock()
	jobIndex := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return !job.NextAttemptAt.After(now) })
	if jobIndex < 0 {
		s.store.mu.Unlock()
		return false
	}
	job := s.store.syncJobs[jobIndex]
	var item Media
	if job.Operation == syncUpsert {
		itemIndex := slices.IndexFunc(s.store.items, func(candidate Media) bool { return candidate.ID == job.MediaID })
		if itemIndex < 0 {
			s.store.syncJobs = slices.Delete(s.store.syncJobs, jobIndex, jobIndex+1)
			_ = s.store.persistLocked()
			s.store.mu.Unlock()
			return true
		}
		item = s.store.items[itemIndex]
	}
	s.store.mu.Unlock()

	auth, connected := s.authSnapshot()
	if !connected {
		s.deferForAuth(job)
		return false
	}
	if job.AniListUserID == 0 {
		exists, err := s.bindJobToUser(job.ID, auth.UserID)
		if err != nil {
			s.recordFailure(job, err)
			return true
		}
		if !exists {
			return true
		}
		job.AniListUserID = auth.UserID
	}
	if job.AniListUserID != auth.UserID {
		s.deferForDifferentAccount(job)
		return false
	}

	var result aniListUpsertResult
	var err error
	if job.Operation == syncDelete {
		err = s.deleteRemote(ctx, auth, job)
	} else {
		result, err = s.upsertRemote(ctx, auth, item)
	}
	if err != nil {
		if errors.Is(err, errAniListUnauthorized) {
			s.invalidateAuth()
			s.deferForAuth(job)
			return false
		}
		s.recordFailure(job, err)
		return true
	}
	if err := s.recordSuccess(job, result, item, auth.UserID); err != nil {
		slog.Error("anilist_sync_persist_failed", "job_id", job.ID, "media_id", job.MediaID, "error", err)
		return false
	}
	return true
}

func (s *aniListSync) bindJobToUser(jobID int64, userID int) (bool, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	index := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return job.ID == jobID })
	if index < 0 {
		return false, nil
	}
	job := &s.store.syncJobs[index]
	if job.AniListUserID != 0 && job.AniListUserID != userID {
		return true, errors.New("pending AniList change belongs to another account")
	}
	if job.AniListUserID == userID {
		return true, nil
	}
	job.AniListUserID = userID
	if err := s.store.persistLocked(); err != nil {
		job.AniListUserID = 0
		return true, fmt.Errorf("persist AniList job owner: %w", err)
	}
	return true, nil
}

func (s *aniListSync) deferForDifferentAccount(snapshot syncJob) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	index := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return job.ID == snapshot.ID })
	if index < 0 {
		return
	}
	job := &s.store.syncJobs[index]
	job.NextAttemptAt = time.Now().UTC().Add(time.Minute)
	job.LastError = "pending change belongs to a different AniList account"
	if itemIndex := slices.IndexFunc(s.store.items, func(item Media) bool { return item.ID == snapshot.MediaID }); itemIndex >= 0 {
		s.store.items[itemIndex].SyncStatus = "waiting_auth"
		s.store.items[itemIndex].SyncError = "Reconnect the AniList account that owns this pending change, or discard it"
	}
	_ = s.store.persistLocked()
}

func (s *aniListSync) invalidateAuth() {
	s.mu.Lock()
	if s.auth != nil {
		s.auth.ExpiresAt = time.Now().UTC()
		_ = s.persistAuth(*s.auth)
	}
	s.mu.Unlock()
}

func (s *aniListSync) deferForAuth(snapshot syncJob) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	index := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return job.ID == snapshot.ID })
	if index < 0 {
		return
	}
	s.store.syncJobs[index].NextAttemptAt = time.Now().UTC().Add(time.Minute)
	if itemIndex := slices.IndexFunc(s.store.items, func(item Media) bool { return item.ID == snapshot.MediaID }); itemIndex >= 0 {
		s.store.items[itemIndex].SyncStatus = "waiting_auth"
	}
	_ = s.store.persistLocked()
}

func (s *aniListSync) recordFailure(snapshot syncJob, syncErr error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	index := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return job.ID == snapshot.ID })
	if index < 0 {
		return
	}
	job := &s.store.syncJobs[index]
	if job.Generation != snapshot.Generation || job.Operation != snapshot.Operation {
		job.NextAttemptAt = time.Now().UTC()
		_ = s.store.persistLocked()
		return
	}
	job.Attempts++
	delay := time.Duration(1<<min(job.Attempts, 10)) * time.Second
	if delay > time.Hour {
		delay = time.Hour
	}
	job.NextAttemptAt = time.Now().UTC().Add(delay)
	job.LastError = syncErr.Error()
	job.UpdatedAt = time.Now().UTC()
	if itemIndex := slices.IndexFunc(s.store.items, func(item Media) bool { return item.ID == snapshot.MediaID }); itemIndex >= 0 {
		s.store.items[itemIndex].SyncStatus = "error"
		s.store.items[itemIndex].SyncError = "AniList synchronization failed; it will be retried"
	}
	_ = s.store.persistLocked()
}

func (s *aniListSync) recordSuccess(snapshot syncJob, result aniListUpsertResult, sentItem Media, authUserID int) error {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	index := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return job.ID == snapshot.ID })
	if index < 0 {
		return nil
	}
	originalItems := slices.Clone(s.store.items)
	originalJobs := slices.Clone(s.store.syncJobs)
	originalNextJobID := s.store.nextJobID
	job := &s.store.syncJobs[index]
	generationCurrent := job.Generation == snapshot.Generation && job.Operation == snapshot.Operation
	itemIndex := slices.IndexFunc(s.store.items, func(item Media) bool { return item.ID == snapshot.MediaID })
	if snapshot.Operation == syncUpsert && result.ListEntryID > 0 {
		job.ProviderListEntryID = result.ListEntryID
		if itemIndex >= 0 {
			s.store.items[itemIndex].ProviderListEntryID = result.ListEntryID
		}
	}

	repeatChangedWhileUnknown := false
	if snapshot.Operation == syncUpsert && itemIndex >= 0 && result.Repeat != nil &&
		*result.Repeat >= 0 && *result.Repeat <= maxRepeatCount && authUserID > 0 {
		item := &s.store.items[itemIndex]
		wasKnownForAccount := sentItem.AniListRepeatKnown && sentItem.AniListUserID == authUserID
		item.AniListUserID = authUserID
		item.AniListRepeatKnown = true
		if result.RepeatSent {
			if generationCurrent {
				item.RepeatCount = *result.Repeat
			}
		} else if !wasKnownForAccount {
			if sentItem.RepeatCount == 0 && item.RepeatCount == 0 {
				item.RepeatCount = *result.Repeat
			} else if item.RepeatCount != *result.Repeat {
				repeatChangedWhileUnknown = true
			}
		}
	}

	if generationCurrent {
		if snapshot.Operation == syncUpsert && itemIndex >= 0 {
			s.store.items[itemIndex].SyncStatus = "synced"
			s.store.items[itemIndex].SyncError = ""
		}
		s.store.syncJobs = slices.Delete(s.store.syncJobs, index, index+1)
		if repeatChangedWhileUnknown && itemIndex >= 0 {
			s.queueUpsertLocked(itemIndex)
		}
	} else {
		job.NextAttemptAt = time.Now().UTC()
		job.Attempts = 0
		job.LastError = ""
	}
	if err := s.store.persistLocked(); err != nil {
		s.store.items = originalItems
		s.store.syncJobs = originalJobs
		s.store.nextJobID = originalNextJobID
		retryIndex := slices.IndexFunc(s.store.syncJobs, func(job syncJob) bool { return job.ID == snapshot.ID })
		if retryIndex >= 0 {
			retry := &s.store.syncJobs[retryIndex]
			retry.Attempts++
			retry.NextAttemptAt = time.Now().UTC().Add(15 * time.Second)
			retry.LastError = "could not persist AniList synchronization result"
			retry.UpdatedAt = time.Now().UTC()
		}
		if retryItemIndex := slices.IndexFunc(s.store.items, func(item Media) bool { return item.ID == snapshot.MediaID }); retryItemIndex >= 0 {
			s.store.items[retryItemIndex].SyncStatus = "error"
			s.store.items[retryItemIndex].SyncError = "AniList synchronization succeeded, but the local result could not be saved; it will be retried"
		}
		return fmt.Errorf("persist AniList synchronization result: %w", err)
	}
	return nil
}

func (s *aniListSync) upsertRemote(ctx context.Context, auth aniListAuth, item Media) (aniListUpsertResult, error) {
	mediaID, err := strconv.Atoi(item.ProviderID)
	if err != nil || mediaID < 1 {
		return aniListUpsertResult{}, errors.New("invalid AniList media ID")
	}
	repeatSent := item.AniListRepeatKnown && item.AniListUserID == auth.UserID
	mutation := `mutation ($mediaId: Int, $status: MediaListStatus, $scoreRaw: Int, $progress: Int, $notes: String) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw, progress: $progress, notes: $notes) { id repeat }
}`
	variables := map[string]any{
		"mediaId":  mediaID,
		"status":   mapLocalStatus(item.Status),
		"scoreRaw": item.Rating * 10,
		"progress": item.Progress,
		"notes":    item.Notes,
	}
	if repeatSent {
		mutation = `mutation ($mediaId: Int, $status: MediaListStatus, $scoreRaw: Int, $progress: Int, $repeat: Int, $notes: String) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw, progress: $progress, repeat: $repeat, notes: $notes) { id repeat }
}`
		variables["repeat"] = item.RepeatCount
	}
	var data struct {
		Entry struct {
			ID     int  `json:"id"`
			Repeat *int `json:"repeat"`
		} `json:"SaveMediaListEntry"`
	}
	if err := s.graphQL(ctx, auth.AccessToken, mutation, variables, &data); err != nil {
		return aniListUpsertResult{}, err
	}
	if data.Entry.ID < 1 {
		return aniListUpsertResult{}, errors.New("AniList did not return a list entry ID")
	}
	if data.Entry.Repeat != nil && (*data.Entry.Repeat < 0 || *data.Entry.Repeat > maxRepeatCount) {
		return aniListUpsertResult{}, errors.New("AniList returned an invalid repeat count")
	}
	if repeatSent && data.Entry.Repeat == nil {
		return aniListUpsertResult{}, errors.New("AniList did not confirm the repeat count")
	}
	return aniListUpsertResult{ListEntryID: data.Entry.ID, Repeat: data.Entry.Repeat, RepeatSent: repeatSent}, nil
}

func mapLocalStatus(status string) string {
	switch status {
	case "in_progress":
		return "CURRENT"
	case "completed":
		return "COMPLETED"
	case "paused":
		return "PAUSED"
	case "dropped":
		return "DROPPED"
	default:
		return "PLANNING"
	}
}

func (s *aniListSync) deleteRemote(ctx context.Context, auth aniListAuth, job syncJob) error {
	entryID := job.ProviderListEntryID
	if entryID < 1 {
		var err error
		entryID, err = s.findListEntry(ctx, auth, job.ProviderMediaID)
		if err != nil {
			return err
		}
		if entryID < 1 {
			return nil
		}
	}
	const mutation = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`
	var data struct {
		Result struct {
			Deleted bool `json:"deleted"`
		} `json:"DeleteMediaListEntry"`
	}
	if err := s.graphQL(ctx, auth.AccessToken, mutation, map[string]any{"id": entryID}, &data); err != nil {
		if isAniListNotFound(err) {
			return nil
		}
		return err
	}
	if !data.Result.Deleted {
		return errors.New("AniList did not confirm list entry deletion")
	}
	return nil
}

func (s *aniListSync) findListEntry(ctx context.Context, auth aniListAuth, mediaID int) (int, error) {
	const query = `query ($mediaId: Int, $userId: Int) { MediaList(mediaId: $mediaId, userId: $userId) { id } }`
	var data struct {
		Entry *struct {
			ID int `json:"id"`
		} `json:"MediaList"`
	}
	if err := s.graphQL(ctx, auth.AccessToken, query, map[string]any{"mediaId": mediaID, "userId": auth.UserID}, &data); err != nil {
		// AniList reports a GraphQL error when the entry does not exist. Deletion is idempotent.
		if isAniListNotFound(err) {
			return 0, nil
		}
		return 0, err
	}
	if data.Entry == nil {
		return 0, nil
	}
	return data.Entry.ID, nil
}

func isAniListNotFound(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "not found") || strings.Contains(message, "does not exist")
}

func isAniListAuthMessage(message string) bool {
	message = strings.ToLower(message)
	return strings.Contains(message, "unauthorized") ||
		strings.Contains(message, "not authenticated") ||
		strings.Contains(message, "authentication required") ||
		strings.Contains(message, "invalid token") ||
		strings.Contains(message, "token has expired")
}

func (s *aniListSync) graphQL(ctx context.Context, token, query string, variables map[string]any, target any) error {
	body, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.AniListAPIURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "Honne/0.1")
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return errAniListUnauthorized
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("AniList returned %s", response.Status)
	}
	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("decode AniList response: %w", err)
	}
	if len(envelope.Errors) > 0 {
		message := envelope.Errors[0].Message
		if isAniListAuthMessage(message) {
			return errAniListUnauthorized
		}
		return fmt.Errorf("AniList: %s", message)
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return fmt.Errorf("decode AniList data: %w", err)
	}
	return nil
}

func (s *aniListSync) statusHandler(w http.ResponseWriter, _ *http.Request) {
	status := aniListIntegrationStatus{Configured: s.cfg.aniListConfigured(), DeleteEnabled: s.cfg.AniListDeleteEnabled}
	if auth, ok := s.authSnapshot(); ok {
		status.Connected = true
		status.Username = auth.Username
		status.Avatar = auth.Avatar
		status.ExpiresAt = &auth.ExpiresAt
	}
	s.store.mu.RLock()
	status.Pending = len(s.store.syncJobs)
	for _, job := range s.store.syncJobs {
		if job.LastError != "" {
			status.Errors++
		}
	}
	s.store.mu.RUnlock()
	writeJSON(w, http.StatusOK, status)
}

func (s *aniListSync) connectHandler(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.aniListConfigured() {
		writeError(w, http.StatusServiceUnavailable, "AniList OAuth is not configured")
		return
	}
	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "could not start AniList authorization")
		return
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)
	now := time.Now()
	s.mu.Lock()
	for key, attempt := range s.attempts {
		if now.After(attempt.ExpiresAt) {
			delete(s.attempts, key)
		}
	}
	s.attempts[state] = oauthAttempt{ExpiresAt: now.Add(10 * time.Minute)}
	s.mu.Unlock()
	redirectURL, _ := url.Parse(s.cfg.AniListRedirectURL)
	http.SetCookie(w, &http.Cookie{
		Name:     "honne_anilist_oauth",
		Value:    state,
		Path:     "/api/integrations/anilist/callback",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   redirectURL != nil && redirectURL.Scheme == "https",
		SameSite: http.SameSiteLaxMode,
	})
	values := url.Values{
		"client_id":     {s.cfg.AniListClientID},
		"redirect_uri":  {s.cfg.AniListRedirectURL},
		"response_type": {"code"},
		"state":         {state},
	}
	http.Redirect(w, r, s.cfg.AniListAuthorizeURL+"?"+values.Encode(), http.StatusFound)
}

func (s *aniListSync) callbackHandler(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	cookie, cookieErr := r.Cookie("honne_anilist_oauth")
	http.SetCookie(w, &http.Cookie{
		Name:     "honne_anilist_oauth",
		Value:    "",
		Path:     "/api/integrations/anilist/callback",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	s.mu.Lock()
	attempt, ok := s.attempts[state]
	delete(s.attempts, state)
	s.mu.Unlock()
	if !ok || state == "" || cookieErr != nil || cookie.Value != state || time.Now().After(attempt.ExpiresAt) {
		writeError(w, http.StatusBadRequest, "invalid or expired AniList OAuth state")
		return
	}
	if providerError := r.URL.Query().Get("error"); providerError != "" {
		writeError(w, http.StatusBadRequest, "AniList authorization was denied")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "AniList authorization code is missing")
		return
	}
	auth, err := s.exchangeCode(r.Context(), code)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not complete AniList authorization")
		return
	}
	s.mu.RLock()
	previousUserID := 0
	if s.auth != nil {
		previousUserID = s.auth.UserID
	}
	s.mu.RUnlock()
	if previousUserID > 0 && previousUserID != auth.UserID {
		if err := s.detachAccountItems(false); err != nil {
			if errors.Is(err, errPendingAniListJobs) {
				writeError(w, http.StatusConflict, err.Error())
			} else {
				writeError(w, http.StatusInternalServerError, "could not switch AniList accounts")
			}
			return
		}
	}
	if err := s.persistAuth(auth); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save AniList authorization")
		return
	}
	s.mu.Lock()
	s.auth = &auth
	s.mu.Unlock()
	s.retryAll()
	http.Redirect(w, r, strings.TrimRight(s.cfg.AllowedOrigin, "/")+"/?anilist=connected#settings", http.StatusFound)
}

func (s *aniListSync) exchangeCode(ctx context.Context, code string) (aniListAuth, error) {
	payload := map[string]any{
		"grant_type":    "authorization_code",
		"client_id":     s.cfg.AniListClientID,
		"client_secret": s.cfg.AniListClientSecret,
		"redirect_uri":  s.cfg.AniListRedirectURL,
		"code":          code,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.AniListTokenURL, bytes.NewReader(body))
	if err != nil {
		return aniListAuth{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		return aniListAuth{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return aniListAuth{}, fmt.Errorf("AniList token endpoint returned %s", response.Status)
	}
	var token struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil {
		return aniListAuth{}, err
	}
	if token.AccessToken == "" {
		return aniListAuth{}, errors.New("AniList token response is missing access_token")
	}
	if token.ExpiresIn <= 0 {
		token.ExpiresIn = 365 * 24 * 60 * 60
	}
	auth := aniListAuth{AccessToken: token.AccessToken, TokenType: token.TokenType, ExpiresAt: time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)}
	const viewerQuery = `query { Viewer { id name avatar { large } } }`
	var data struct {
		Viewer struct {
			ID     int    `json:"id"`
			Name   string `json:"name"`
			Avatar struct {
				Large string `json:"large"`
			} `json:"avatar"`
		} `json:"Viewer"`
	}
	if err := s.graphQL(ctx, auth.AccessToken, viewerQuery, nil, &data); err != nil {
		return aniListAuth{}, err
	}
	if data.Viewer.ID < 1 || data.Viewer.Name == "" {
		return aniListAuth{}, errors.New("AniList Viewer response is incomplete")
	}
	auth.UserID = data.Viewer.ID
	auth.Username = data.Viewer.Name
	auth.Avatar = data.Viewer.Avatar.Large
	return auth, nil
}

func (s *aniListSync) persistAuth(auth aniListAuth) error {
	if err := os.MkdirAll(filepath.Dir(s.cfg.AniListAuthPath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(auth, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.cfg.AniListAuthPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.cfg.AniListAuthPath)
}

var errPendingAniListJobs = errors.New("pending AniList changes must finish before switching or disconnecting accounts")

func (s *aniListSync) detachAccountItems(discardPending bool) error {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if len(s.store.syncJobs) > 0 && !discardPending {
		return errPendingAniListJobs
	}
	original := slices.Clone(s.store.items)
	originalJobs := slices.Clone(s.store.syncJobs)
	if discardPending {
		s.store.syncJobs = nil
	}
	for index := range s.store.items {
		if isAniListLinked(s.store.items[index]) {
			s.store.items[index].ProviderListEntryID = 0
			s.store.items[index].AniListUserID = 0
			s.store.items[index].AniListRepeatKnown = false
			s.store.items[index].SyncStatus = "local_only"
			s.store.items[index].SyncError = ""
		}
	}
	if err := s.store.persistLocked(); err != nil {
		s.store.items = original
		s.store.syncJobs = originalJobs
		return err
	}
	return nil
}

func (s *aniListSync) disconnectHandler(w http.ResponseWriter, r *http.Request) {
	discardPending := r.URL.Query().Get("discardPending") == "true"
	if err := s.detachAccountItems(discardPending); err != nil {
		if errors.Is(err, errPendingAniListJobs) {
			writeError(w, http.StatusConflict, err.Error())
		} else {
			writeError(w, http.StatusInternalServerError, "could not disconnect AniList")
		}
		return
	}
	if err := os.Remove(s.cfg.AniListAuthPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "could not remove AniList authorization")
		return
	}
	s.mu.Lock()
	s.auth = nil
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *aniListSync) retryHandler(w http.ResponseWriter, _ *http.Request) {
	count := s.retryAll()
	writeJSON(w, http.StatusOK, map[string]int{"queued": count})
}

func (s *aniListSync) retryAll() int {
	now := time.Now().UTC()
	s.store.mu.Lock()
	for index := range s.store.syncJobs {
		s.store.syncJobs[index].Attempts = 0
		s.store.syncJobs[index].LastError = ""
		s.store.syncJobs[index].NextAttemptAt = now
		if itemIndex := slices.IndexFunc(s.store.items, func(item Media) bool { return item.ID == s.store.syncJobs[index].MediaID }); itemIndex >= 0 {
			s.store.items[itemIndex].SyncStatus = "pending"
			s.store.items[itemIndex].SyncError = ""
		}
	}
	count := len(s.store.syncJobs)
	_ = s.store.persistLocked()
	s.store.mu.Unlock()
	s.wakeWorker()
	return count
}
