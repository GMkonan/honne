package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
)

type anilistListEntry struct {
	ID       int          `json:"id"`
	Status   string       `json:"status"`
	Score    float64      `json:"score"`
	Progress int          `json:"progress"`
	Repeat   int          `json:"repeat"`
	Notes    string       `json:"notes"`
	Media    anilistMedia `json:"media"`
}

type anilistImportEntry struct {
	mediaInput
	ProviderListEntryID int  `json:"providerListEntryId,omitempty"`
	AlreadyExists       bool `json:"alreadyExists"`
}

type anilistImportPreview struct {
	Username string               `json:"username"`
	Avatar   string               `json:"avatar,omitempty"`
	Entries  []anilistImportEntry `json:"entries"`
}

type anilistImportRequest struct {
	Username string   `json:"username"`
	Types    []string `json:"types"`
	Statuses []string `json:"statuses"`
}

func (a *app) previewAniListImport(w http.ResponseWriter, r *http.Request) {
	username := strings.TrimSpace(r.URL.Query().Get("username"))
	if len([]rune(username)) < 2 || len([]rune(username)) > 50 {
		writeError(w, http.StatusBadRequest, "AniList username must contain between 2 and 50 characters")
		return
	}
	if a.anilist != nil {
		if connectedUsername, connected := a.anilist.connectedUsername(); connected && !strings.EqualFold(username, connectedUsername) {
			writeError(w, http.StatusUnprocessableEntity, "imports must use the connected AniList account")
			return
		}
	}
	preview, err := a.discovery.fetchAniListList(r.Context(), username)
	if err != nil {
		logProviderError("anilist_import", err)
		writeError(w, http.StatusBadGateway, "could not load this public AniList profile")
		return
	}

	a.store.mu.RLock()
	existing := make(map[string]bool, len(a.store.items))
	for _, item := range a.store.items {
		if item.Provider == "anilist" {
			existing[item.ProviderID] = true
		}
	}
	a.store.mu.RUnlock()
	for index := range preview.Entries {
		preview.Entries[index].AlreadyExists = existing[preview.Entries[index].ProviderID]
	}
	writeJSON(w, http.StatusOK, preview)
}

func (a *app) importAniList(w http.ResponseWriter, r *http.Request) {
	var input anilistImportRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	if input.Username == "" {
		writeError(w, http.StatusBadRequest, "AniList username is required")
		return
	}
	connectedAuth := aniListAuth{}
	connected := false
	if a.anilist != nil {
		if auth, ok := a.anilist.authSnapshot(); ok {
			connectedAuth = auth
			connected = true
			if !strings.EqualFold(input.Username, auth.Username) {
				writeError(w, http.StatusUnprocessableEntity, "imports must use the connected AniList account")
				return
			}
		}
	}
	for _, mediaType := range input.Types {
		if !slices.Contains(validTypes, mediaType) || mediaType == "book" || mediaType == "movie" || mediaType == "series" {
			writeError(w, http.StatusBadRequest, "invalid import media type")
			return
		}
	}
	for _, status := range input.Statuses {
		if !slices.Contains(validStatuses, status) {
			writeError(w, http.StatusBadRequest, "invalid import status")
			return
		}
	}

	preview, err := a.discovery.fetchAniListList(r.Context(), input.Username)
	if err != nil {
		logProviderError("anilist_import", err)
		writeError(w, http.StatusBadGateway, "could not load this public AniList profile")
		return
	}
	allowedTypes := stringSet(input.Types)
	allowedStatuses := stringSet(input.Statuses)
	selected := func(entry anilistImportEntry) bool {
		return (len(allowedTypes) == 0 || allowedTypes[entry.Type]) &&
			(len(allowedStatuses) == 0 || allowedStatuses[entry.Status])
	}

	a.store.mu.Lock()
	originalItems := slices.Clone(a.store.items)
	originalJobs := slices.Clone(a.store.syncJobs)
	originalActivities := slices.Clone(a.store.activities)
	originalNextID := a.store.nextID
	originalNextJobID := a.store.nextJobID
	originalNextActivityID := a.store.nextActivityID
	existing := make(map[string]int, len(a.store.items))
	for index, item := range a.store.items {
		if item.Provider == "anilist" {
			existing[item.ProviderID] = index
		}
	}
	if connected {
		for _, entry := range preview.Entries {
			index, exists := existing[entry.ProviderID]
			if !exists || !selected(entry) {
				continue
			}
			mediaID := a.store.items[index].ID
			for _, job := range a.store.syncJobs {
				if job.MediaID == mediaID && job.AniListUserID != 0 && job.AniListUserID != connectedAuth.UserID {
					a.store.mu.Unlock()
					writeError(w, http.StatusConflict, "an existing AniList change belongs to another account")
					return
				}
			}
		}
	}

	imported := make([]Media, 0)
	reconciledItems := make([]Media, 0)
	skipped := 0
	queuedSync := false
	now := time.Now().UTC()
	for _, entry := range preview.Entries {
		if !selected(entry) {
			skipped++
			continue
		}
		if index, exists := existing[entry.ProviderID]; exists {
			if !connected {
				skipped++
				continue
			}
			item := &a.store.items[index]
			remoteRepeat := repeatCountValue(entry.RepeatCount)
			repeatKnownForAccount := item.AniListRepeatKnown && item.AniListUserID == connectedAuth.UserID
			needsUpsert := item.Status != entry.Status || item.Progress != entry.Progress ||
				item.Rating != entry.Rating || item.Notes != strings.TrimSpace(entry.Notes)
			if repeatKnownForAccount {
				needsUpsert = needsUpsert || item.RepeatCount != remoteRepeat
			} else if item.AniListUserID != 0 && item.AniListUserID != connectedAuth.UserID {
				item.RepeatCount = remoteRepeat
			} else if item.RepeatCount == 0 {
				item.RepeatCount = remoteRepeat
			} else {
				needsUpsert = needsUpsert || item.RepeatCount != remoteRepeat
			}
			item.ProviderListEntryID = entry.ProviderListEntryID
			item.AniListUserID = connectedAuth.UserID
			item.AniListRepeatKnown = true
			item.UpdatedAt = now
			hasPendingJob := false
			for jobIndex := range a.store.syncJobs {
				job := &a.store.syncJobs[jobIndex]
				if job.MediaID != item.ID {
					continue
				}
				hasPendingJob = true
				job.ProviderListEntryID = entry.ProviderListEntryID
				job.AniListUserID = connectedAuth.UserID
			}
			if needsUpsert {
				a.anilist.queueUpsertLocked(index)
				queuedSync = true
			} else if !hasPendingJob {
				item.SyncStatus = "synced"
				item.SyncError = ""
			}
			reconciledItems = append(reconciledItems, *item)
			continue
		}

		item := mediaFromInput(a.store.nextID, entry.mediaInput, now)
		if connected {
			// A list-entry ID and repeat count belong to a specific AniList
			// account. Keep them only after matching the import to OAuth Viewer.
			item.ProviderListEntryID = entry.ProviderListEntryID
			item.AniListUserID = connectedAuth.UserID
			item.AniListRepeatKnown = true
			item.SyncStatus = "synced"
		} else {
			item.SyncStatus = "local_only"
		}
		a.store.nextID++
		a.store.items = append(a.store.items, item)
		a.store.appendActivityLocked(activityForNewMedia(item, "imported"))
		imported = append(imported, item)
		existing[item.ProviderID] = len(a.store.items) - 1
	}
	if len(imported) > 0 || len(reconciledItems) > 0 {
		err = a.store.persistLocked()
	}
	if err != nil {
		a.store.items = originalItems
		a.store.syncJobs = originalJobs
		a.store.activities = originalActivities
		a.store.nextID = originalNextID
		a.store.nextJobID = originalNextJobID
		a.store.nextActivityID = originalNextActivityID
		a.store.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not save imported titles")
		return
	}
	a.store.mu.Unlock()
	if queuedSync {
		a.anilist.wakeWorker()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"imported": len(imported), "reconciled": len(reconciledItems), "skipped": skipped,
		"items": imported, "reconciledItems": reconciledItems,
	})
}

func (s *discoveryService) fetchAniListList(ctx context.Context, username string) (anilistImportPreview, error) {
	const graphQL = `query ($username: String!) {
  User(name: $username) { name avatar { large } }
  anime: MediaListCollection(userName: $username, type: ANIME) {
    lists { entries { id status score(format: POINT_10) progress repeat notes media { ...mediaFields } } }
  }
  manga: MediaListCollection(userName: $username, type: MANGA) {
    lists { entries { id status score(format: POINT_10) progress repeat notes media { ...mediaFields } } }
  }
}
fragment mediaFields on Media {
  id siteUrl format status description(asHtml: false) episodes chapters duration genres averageScore
  title { romaji english native }
  coverImage { extraLarge }
  startDate { year month day }
  endDate { year month day }
  studios(isMain: true) { nodes { name } }
  staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
}`
	request := map[string]any{"query": graphQL, "variables": map[string]any{"username": username}}
	var payload struct {
		Data struct {
			User struct {
				Name   string `json:"name"`
				Avatar struct {
					Large string `json:"large"`
				} `json:"avatar"`
			} `json:"User"`
			Anime anilistCollection `json:"anime"`
			Manga anilistCollection `json:"manga"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := s.postJSON(ctx, s.anilistBase, request, &payload); err != nil {
		return anilistImportPreview{}, err
	}
	if len(payload.Errors) > 0 {
		return anilistImportPreview{}, fmt.Errorf("AniList: %s", payload.Errors[0].Message)
	}
	entries := make([]anilistImportEntry, 0)
	seen := make(map[string]bool)
	appendCollection := func(collection anilistCollection, fallbackType string) {
		for _, list := range collection.Lists {
			for _, entry := range list.Entries {
				id := strconv.Itoa(entry.Media.ID)
				if seen[id] {
					continue
				}
				seen[id] = true
				mediaType := fallbackType
				if entry.Media.Format == "NOVEL" {
					mediaType = "light_novel"
				}
				catalog := anilistDiscoveryResult(entry.Media, mediaType)
				repeatCount := min(max(entry.Repeat, 0), maxRepeatCount)
				entries = append(entries, anilistImportEntry{mediaInput: mediaInput{
					Title: catalog.Title, Type: mediaType, Status: mapAniListStatus(entry.Status),
					Progress: entry.Progress, Total: catalog.Total, Rating: normalizedAniListRating(entry.Score), RepeatCount: &repeatCount, Notes: entry.Notes,
					CoverURL: catalog.CoverURL, Provider: catalog.Provider, ProviderID: id, ProviderURL: catalog.ProviderURL,
					OriginalTitle: catalog.OriginalTitle, Description: catalog.Description, ReleaseYear: catalog.ReleaseYear,
					Format: catalog.Format, Genres: catalog.Genres, Credits: catalog.Credits, ReleaseStatus: catalog.ReleaseStatus,
					StartDate: catalog.StartDate, EndDate: catalog.EndDate, DurationMinutes: catalog.DurationMinutes,
					CatalogTotal: catalog.CatalogTotal, CommunityRating: catalog.CommunityRating,
				}, ProviderListEntryID: entry.ID})
			}
		}
	}
	appendCollection(payload.Data.Anime, "anime")
	appendCollection(payload.Data.Manga, "manga")
	return anilistImportPreview{Username: payload.Data.User.Name, Avatar: payload.Data.User.Avatar.Large, Entries: entries}, nil
}

type anilistCollection struct {
	Lists []struct {
		Entries []anilistListEntry `json:"entries"`
	} `json:"lists"`
}

func mapAniListStatus(status string) string {
	switch status {
	case "CURRENT", "REPEATING":
		return "in_progress"
	case "COMPLETED":
		return "completed"
	case "PAUSED":
		return "paused"
	case "DROPPED":
		return "dropped"
	default:
		return "planned"
	}
}

func normalizedAniListRating(score float64) int {
	if score < 0 {
		return 0
	}
	if score > 10 {
		return 10
	}
	return int(score + 0.5)
}

func mediaFromInput(id int, input mediaInput, now time.Time) Media {
	return Media{
		ID: id, Title: strings.TrimSpace(input.Title), Type: input.Type, Status: input.Status,
		Progress: input.Progress, Total: input.Total, Rating: input.Rating, RepeatCount: repeatCountValue(input.RepeatCount), Notes: strings.TrimSpace(input.Notes),
		CoverURL: strings.TrimSpace(input.CoverURL), Provider: input.Provider, ProviderID: input.ProviderID,
		ProviderURL: strings.TrimSpace(input.ProviderURL), OriginalTitle: strings.TrimSpace(input.OriginalTitle),
		Description: strings.TrimSpace(input.Description), ReleaseYear: input.ReleaseYear,
		Format: strings.TrimSpace(input.Format), Genres: normalizedMetadataStrings(input.Genres), Credits: normalizedMediaCredits(input.Credits),
		ReleaseStatus: input.ReleaseStatus, StartDate: input.StartDate, EndDate: input.EndDate,
		DurationMinutes: input.DurationMinutes, CatalogTotal: input.CatalogTotal,
		CommunityRating: input.CommunityRating, CreatedAt: now, UpdatedAt: now,
	}
}

func stringSet(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}
