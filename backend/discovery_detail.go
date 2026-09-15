package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

var errCatalogNotFound = errors.New("catalog title not found")

func (a *app) getDiscoveryDetail(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	mediaType := r.URL.Query().Get("type")
	providerID := r.URL.Query().Get("id")
	if !validDiscoveryDetailIdentity(provider, mediaType, providerID) {
		writeError(w, http.StatusBadRequest, "invalid catalog identity")
		return
	}
	result, err := a.discovery.detail(r.Context(), provider, mediaType, providerID)
	if errors.Is(err, errProviderUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "game details require RAWG_API_KEY")
		return
	}
	if errors.Is(err, errCatalogNotFound) {
		writeError(w, http.StatusNotFound, "catalog title not found")
		return
	}
	if err != nil && provider == "anilist" && isAniListAvailabilityError(err) {
		logProviderError(mediaType, err)
		writeError(w, http.StatusServiceUnavailable, "AniList is currently unavailable; try again later")
		return
	}
	if err != nil {
		logProviderError(mediaType, err)
		writeError(w, http.StatusBadGateway, "the metadata provider is temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func validDiscoveryDetailIdentity(provider, mediaType, providerID string) bool {
	id, err := strconv.Atoi(providerID)
	if err != nil || id < 1 || strconv.Itoa(id) != providerID {
		return false
	}
	return provider == "rawg" && mediaType == "game" ||
		provider == "anilist" && slicesContains([]string{"anime", "manga", "light_novel"}, mediaType)
}

func (s *discoveryService) detail(ctx context.Context, provider, mediaType, providerID string) (discoveryDetail, error) {
	if !validDiscoveryDetailIdentity(provider, mediaType, providerID) {
		return discoveryDetail{}, fmt.Errorf("unsupported catalog identity")
	}
	key := provider + "|" + mediaType + "|" + providerID
	s.mu.Lock()
	if cached, ok := s.detailCache[key]; ok && time.Now().Before(cached.expiresAt) {
		s.mu.Unlock()
		return cached.result, nil
	}
	s.mu.Unlock()

	var result discoveryDetail
	var err error
	if provider == "rawg" {
		var rawgResult discoveryResult
		rawgResult, err = s.fetchRAWGDetail(ctx, providerID)
		result = discoveryDetail{discoveryResult: rawgResult, AlternativeTitles: []string{}, Relations: []discoveryRelation{}}
	} else {
		result, err = s.fetchAniListDetail(ctx, mediaType, providerID)
	}
	if err != nil {
		return discoveryDetail{}, err
	}
	s.mu.Lock()
	if s.detailCache == nil {
		s.detailCache = make(map[string]cachedDiscoveryDetail)
	}
	s.detailCache[key] = cachedDiscoveryDetail{result: result, expiresAt: time.Now().Add(10 * time.Minute)}
	s.mu.Unlock()
	return result, nil
}
