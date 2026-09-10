package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxRAWGResponseBytes = 4 << 20

type rawgGame struct {
	ID              int            `json:"id"`
	Slug            string         `json:"slug"`
	Name            string         `json:"name"`
	DescriptionRaw  string         `json:"description_raw"`
	BackgroundImage string         `json:"background_image"`
	Released        string         `json:"released"`
	TBA             bool           `json:"tba"`
	Rating          float64        `json:"rating"`
	Genres          []providerName `json:"genres"`
	Developers      []providerName `json:"developers"`
	Publishers      []providerName `json:"publishers"`
	Platforms       []struct {
		Platform providerName `json:"platform"`
	} `json:"platforms"`
}

func (a *app) getDiscoveryDetail(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	mediaType := r.URL.Query().Get("type")
	providerID := r.URL.Query().Get("id")
	id, err := strconv.Atoi(providerID)
	if provider != "rawg" || mediaType != "game" || err != nil || id < 1 || strconv.Itoa(id) != providerID {
		writeError(w, http.StatusBadRequest, "invalid catalog identity")
		return
	}
	result, err := a.discovery.detail(r.Context(), provider, mediaType, providerID)
	if errors.Is(err, errProviderUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "game details require RAWG_API_KEY")
		return
	}
	if err != nil {
		logProviderError(mediaType, err)
		writeError(w, http.StatusBadGateway, "the metadata provider is temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *discoveryService) detail(ctx context.Context, provider, mediaType, providerID string) (discoveryResult, error) {
	if provider != "rawg" || mediaType != "game" {
		return discoveryResult{}, fmt.Errorf("unsupported catalog identity")
	}
	key := provider + "|" + mediaType + "|" + providerID
	s.mu.Lock()
	if cached, ok := s.detailCache[key]; ok && time.Now().Before(cached.expiresAt) {
		s.mu.Unlock()
		return cached.result, nil
	}
	s.mu.Unlock()

	result, err := s.fetchRAWGDetail(ctx, providerID)
	if err != nil {
		return discoveryResult{}, err
	}
	s.mu.Lock()
	if s.detailCache == nil {
		s.detailCache = make(map[string]cachedDiscoveryDetail)
	}
	s.detailCache[key] = cachedDiscoveryDetail{result: result, expiresAt: time.Now().Add(10 * time.Minute)}
	s.mu.Unlock()
	return result, nil
}

func (s *discoveryService) searchRAWG(ctx context.Context, query string, page int) (discoveryResponse, error) {
	values := url.Values{
		"search":    {query},
		"page":      {strconv.Itoa(page)},
		"page_size": {strconv.Itoa(discoveryPageSize)},
	}
	var payload struct {
		Next    string     `json:"next"`
		Results []rawgGame `json:"results"`
	}
	if err := s.getRAWGJSON(ctx, "/games", values, &payload); err != nil {
		return discoveryResponse{}, err
	}
	results := make([]discoveryResult, 0, len(payload.Results))
	for _, item := range payload.Results {
		if result, ok := rawgDiscoveryResult(item, time.Now()); ok {
			results = append(results, result)
		}
	}
	return discoveryResponse{Results: results, Page: page, HasMore: payload.Next != ""}, nil
}

func (s *discoveryService) fetchRAWGDetail(ctx context.Context, providerID string) (discoveryResult, error) {
	var item rawgGame
	if err := s.getRAWGJSON(ctx, "/games/"+url.PathEscape(providerID), nil, &item); err != nil {
		return discoveryResult{}, err
	}
	result, ok := rawgDiscoveryResult(item, time.Now())
	if !ok || result.ProviderID != providerID {
		return discoveryResult{}, errors.New("RAWG returned an invalid game identity")
	}
	return result, nil
}

func rawgDiscoveryResult(item rawgGame, now time.Time) (discoveryResult, bool) {
	title := limitedProviderText(item.Name, 200)
	if item.ID < 1 || title == "" {
		return discoveryResult{}, false
	}
	platforms := make([]string, 0, len(item.Platforms))
	for _, platform := range item.Platforms {
		platforms = append(platforms, platform.Platform.Name)
	}
	platforms = normalizedMetadataStrings(platforms)
	credits := make([]mediaCredit, 0, len(item.Developers)+len(item.Publishers))
	for _, developer := range item.Developers {
		credits = append(credits, mediaCredit{Name: developer.Name, Role: "Developer"})
	}
	for _, publisher := range item.Publishers {
		credits = append(credits, mediaCredit{Name: publisher.Name, Role: "Publisher"})
	}
	startDate, releaseStatus := rawgReleaseMetadata(item.Released, item.TBA, now)
	communityRating := 0.0
	if item.Rating > 0 && item.Rating <= 5 {
		communityRating = item.Rating * 2
	}
	providerURL := ""
	if slug := limitedProviderText(item.Slug, 200); slug != "" {
		providerURL = "https://rawg.io/games/" + url.PathEscape(slug)
	}
	return discoveryResult{
		Provider: "rawg", ProviderID: strconv.Itoa(item.ID), ProviderURL: providerURL,
		Type: "game", Title: title, Description: limitedProviderText(cleanDescription(item.DescriptionRaw), 10_000),
		CoverURL: safeProviderURL(item.BackgroundImage), ReleaseYear: yearFromDate(startDate),
		Subtitle: strings.Join(platforms[:min(3, len(platforms))], " · "),
		Genres:   normalizedMetadataStrings(namesOf(item.Genres)), Credits: normalizedMediaCredits(credits),
		ReleaseStatus: releaseStatus, StartDate: startDate, CommunityRating: communityRating,
		CatalogPlatforms: platforms,
	}, true
}

func rawgReleaseMetadata(value string, tba bool, now time.Time) (string, string) {
	value = strings.TrimSpace(value)
	if !validPartialDate(value) {
		value = ""
	}
	if tba {
		return value, "upcoming"
	}
	if value == "" {
		return "", ""
	}
	released, err := time.Parse("2006-01-02", value)
	if err == nil && released.After(now) {
		return value, "upcoming"
	}
	return value, "finished"
}

func namesOf(values []providerName) []string {
	names := make([]string, 0, len(values))
	for _, value := range values {
		names = append(names, value.Name)
	}
	return names
}

func limitedProviderText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maximum {
		return string(runes[:maximum])
	}
	return value
}

func safeProviderURL(value string) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) > 2048 {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return ""
	}
	return parsed.String()
}

func (s *discoveryService) getRAWGJSON(ctx context.Context, path string, values url.Values, target any) error {
	if s.rawgKey == "" {
		return errProviderUnavailable
	}
	endpoint, err := url.Parse(strings.TrimRight(s.rawgBase, "/") + path)
	if err != nil {
		return errors.New("invalid RAWG endpoint")
	}
	query := endpoint.Query()
	for key, entries := range values {
		for _, value := range entries {
			query.Add(key, value)
		}
	}
	query.Set("key", s.rawgKey)
	endpoint.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return errors.New("could not create RAWG request")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Honne/0.1")
	client := *s.client
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("RAWG request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("RAWG returned %s", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxRAWGResponseBytes+1))
	if err != nil {
		return errors.New("could not read RAWG response")
	}
	if len(body) > maxRAWGResponseBytes {
		return errors.New("RAWG response is too large")
	}
	if err := json.Unmarshal(body, target); err != nil {
		return errors.New("could not decode RAWG response")
	}
	return nil
}
