package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type discoveryWorksQuery struct {
	Provider   string
	MediaType  string
	ProviderID string
	Relation   string
	ExcludeID  string
	Page       int
}

func (a *app) getDiscoveryWorks(w http.ResponseWriter, r *http.Request) {
	query := discoveryWorksQuery{
		Provider: r.URL.Query().Get("provider"), MediaType: r.URL.Query().Get("type"),
		ProviderID: r.URL.Query().Get("id"), Relation: r.URL.Query().Get("relation"),
		ExcludeID: r.URL.Query().Get("exclude"), Page: 1,
	}
	if rawPage := r.URL.Query().Get("page"); rawPage != "" {
		page, err := strconv.Atoi(rawPage)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid contributor works query")
			return
		}
		query.Page = page
	}
	if !validDiscoveryWorksQuery(query) {
		writeError(w, http.StatusBadRequest, "invalid contributor works query")
		return
	}
	response, err := a.discovery.works(r.Context(), query)
	if errors.Is(err, errProviderUnavailable) {
		message := "game contributor works require RAWG_API_KEY"
		if query.Provider == "tmdb" {
			message = "movie and series contributor works require TMDB_API_TOKEN"
		}
		writeError(w, http.StatusServiceUnavailable, message)
		return
	}
	if err != nil {
		logProviderError(query.MediaType, err)
		writeError(w, http.StatusBadGateway, "the metadata provider is temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func validDiscoveryWorksQuery(query discoveryWorksQuery) bool {
	if query.Page < 1 || query.Page > 20 || !canonicalPositiveID(query.ProviderID) ||
		(query.ExcludeID != "" && !canonicalPositiveID(query.ExcludeID)) {
		return false
	}
	switch query.Provider {
	case "tmdb":
		return slicesContains([]string{"movie", "series"}, query.MediaType) &&
			slicesContains([]string{"director", "production_company"}, query.Relation)
	case "rawg":
		return query.MediaType == "game" && slicesContains([]string{"developer", "publisher"}, query.Relation)
	default:
		return false
	}
}

func canonicalPositiveID(value string) bool {
	id, err := strconv.Atoi(value)
	return err == nil && id > 0 && strconv.Itoa(id) == value
}

func (s *discoveryService) works(ctx context.Context, query discoveryWorksQuery) (discoveryResponse, error) {
	if !validDiscoveryWorksQuery(query) {
		return discoveryResponse{}, fmt.Errorf("unsupported contributor works query")
	}
	pageKey := query.Page
	if query.Provider == "tmdb" && query.Relation == "director" {
		pageKey = 0
	}
	key := fmt.Sprintf("works|%s|%s|%s|%s|%s|%d", query.Provider, query.MediaType,
		query.Relation, query.ProviderID, query.ExcludeID, pageKey)
	s.mu.Lock()
	if cached, ok := s.cache[key]; ok && time.Now().Before(cached.expiresAt) {
		s.mu.Unlock()
		if pageKey == 0 {
			return paginatedDiscoveryWorks(cached.response.Results, query.Page), nil
		}
		return cached.response, nil
	}
	s.mu.Unlock()

	var response discoveryResponse
	var err error
	if query.Provider == "tmdb" {
		response, err = s.fetchTMDBWorks(ctx, query)
	} else {
		response, err = s.fetchRAWGWorks(ctx, query)
	}
	if err != nil {
		return discoveryResponse{}, err
	}
	if response.Results == nil {
		response.Results = []discoveryResult{}
	}
	response.Page = query.Page

	s.mu.Lock()
	if s.cache == nil {
		s.cache = make(map[string]cachedDiscovery)
	}
	s.cache[key] = cachedDiscovery{response: response, expiresAt: time.Now().Add(10 * time.Minute)}
	s.mu.Unlock()
	if pageKey == 0 {
		return paginatedDiscoveryWorks(response.Results, query.Page), nil
	}
	return response, nil
}

func paginatedDiscoveryWorks(results []discoveryResult, page int) discoveryResponse {
	start := (page - 1) * discoveryPageSize
	if start >= len(results) {
		return discoveryResponse{Results: []discoveryResult{}, Page: page}
	}
	end := min(start+discoveryPageSize, len(results))
	return discoveryResponse{
		Results: append([]discoveryResult{}, results[start:end]...), Page: page, HasMore: end < len(results),
	}
}

func discoveryWorksResource(mediaType string) string {
	if strings.EqualFold(mediaType, "series") {
		return "tv"
	}
	return "movie"
}
