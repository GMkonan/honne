package main

import (
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
)

func (a *app) refreshMediaMetadata(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id < 1 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	a.store.mu.RLock()
	index := slices.IndexFunc(a.store.items, func(item Media) bool { return item.ID == id })
	if index == -1 {
		a.store.mu.RUnlock()
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	snapshot := a.store.items[index]
	a.store.mu.RUnlock()

	if snapshot.Provider == "" || snapshot.ProviderID == "" {
		writeError(w, http.StatusUnprocessableEntity, "local-only media has no catalog metadata to refresh")
		return
	}
	if a.discovery == nil {
		writeError(w, http.StatusInternalServerError, "metadata discovery is unavailable")
		return
	}

	var matched *discoveryResult
	exact := false
	var discoveryErr error
	if snapshot.Provider == "rawg" && snapshot.Type == "game" {
		var result discoveryResult
		result, discoveryErr = a.discovery.detail(r.Context(), snapshot.Provider, snapshot.Type, snapshot.ProviderID)
		if discoveryErr == nil {
			matched, exact = &result, true
		}
	} else {
		var response discoveryResponse
		response, discoveryErr = a.discovery.search(r.Context(), snapshot.Type, snapshot.Title, 1)
		if discoveryErr == nil {
			matched, exact = refreshedMetadataMatch(snapshot, response.Results)
		}
	}
	if errors.Is(discoveryErr, errProviderUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "the metadata provider is not configured")
		return
	}
	if discoveryErr != nil {
		logProviderError(snapshot.Type, discoveryErr)
		writeError(w, http.StatusBadGateway, "the metadata provider is temporarily unavailable")
		return
	}
	if matched == nil {
		writeError(w, http.StatusNotFound, "catalog metadata was not found for this title")
		return
	}

	a.store.mu.Lock()
	index = slices.IndexFunc(a.store.items, func(item Media) bool { return item.ID == id })
	if index == -1 {
		a.store.mu.Unlock()
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	current := &a.store.items[index]
	if current.Title != snapshot.Title || current.Type != snapshot.Type ||
		current.Provider != snapshot.Provider || current.ProviderID != snapshot.ProviderID {
		a.store.mu.Unlock()
		writeError(w, http.StatusConflict, "media identity changed while metadata was loading")
		return
	}

	original := *current
	applyRefreshedMetadata(current, *matched, exact)
	if err := a.store.persistLocked(); err != nil {
		a.store.items[index] = original
		a.store.mu.Unlock()
		writeError(w, http.StatusInternalServerError, "could not save refreshed metadata")
		return
	}
	updated := *current
	a.store.mu.Unlock()
	writeJSON(w, http.StatusOK, updated)
}

func refreshedMetadataMatch(item Media, results []discoveryResult) (*discoveryResult, bool) {
	for index := range results {
		candidate := &results[index]
		if candidate.Type == item.Type && candidate.Provider == item.Provider &&
			candidate.ProviderID == item.ProviderID {
			return candidate, true
		}
	}

	itemTitles := normalizedTitles(item.Title, item.OriginalTitle)
	for index := range results {
		candidate := &results[index]
		if candidate.Type != item.Type ||
			(item.ReleaseYear > 0 && candidate.ReleaseYear > 0 && item.ReleaseYear != candidate.ReleaseYear) {
			continue
		}
		for title := range normalizedTitles(candidate.Title, candidate.OriginalTitle) {
			if itemTitles[title] {
				return candidate, false
			}
		}
	}
	return nil, false
}

func normalizedTitles(values ...string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		if normalized := strings.ToLower(strings.TrimSpace(value)); normalized != "" {
			result[normalized] = true
		}
	}
	return result
}

func applyRefreshedMetadata(item *Media, result discoveryResult, exactIdentity bool) {
	// Refresh is additive so a fallback provider with a narrower contract cannot
	// erase richer metadata previously obtained from the title's own provider.
	if length := len([]rune(strings.TrimSpace(result.Format))); length > 0 && length <= 50 {
		item.Format = strings.TrimSpace(result.Format)
	}
	if len(result.Genres) > 0 {
		item.Genres = normalizedMetadataStrings(result.Genres)
	}
	if len(result.CatalogPlatforms) > 0 {
		item.CatalogPlatforms = normalizedMetadataStrings(result.CatalogPlatforms)
	}
	if len(result.Credits) > 0 {
		item.Credits = normalizedMediaCredits(result.Credits)
	}
	if slices.Contains([]string{"announced", "upcoming", "releasing", "finished", "cancelled", "hiatus"}, result.ReleaseStatus) {
		item.ReleaseStatus = result.ReleaseStatus
	}
	if validPartialDate(result.StartDate) && validPartialDate(result.EndDate) &&
		!(result.StartDate != "" && result.EndDate != "" && partialDateDefinitelyAfter(result.StartDate, result.EndDate)) {
		if result.StartDate != "" {
			item.StartDate = result.StartDate
		}
		if result.EndDate != "" {
			item.EndDate = result.EndDate
		}
	}
	if result.DurationMinutes > 0 && result.DurationMinutes <= 10080 {
		item.DurationMinutes = result.DurationMinutes
	}
	if result.CatalogTotal > 0 {
		item.CatalogTotal = result.CatalogTotal
	}
	if result.CommunityRating > 0 && result.CommunityRating <= 10 &&
		!math.IsNaN(result.CommunityRating) && !math.IsInf(result.CommunityRating, 0) {
		item.CommunityRating = result.CommunityRating
	}
	if item.OriginalTitle == "" && result.OriginalTitle != "" {
		item.OriginalTitle = strings.TrimSpace(result.OriginalTitle)
	}
	if item.Description == "" && result.Description != "" {
		item.Description = strings.TrimSpace(result.Description)
	}
	if item.CoverURL == "" && result.CoverURL != "" {
		item.CoverURL = strings.TrimSpace(result.CoverURL)
	}
	if item.ReleaseYear == 0 && result.ReleaseYear > 0 {
		item.ReleaseYear = result.ReleaseYear
	}
	if exactIdentity && item.ProviderURL == "" && result.ProviderURL != "" {
		item.ProviderURL = strings.TrimSpace(result.ProviderURL)
	}
}
