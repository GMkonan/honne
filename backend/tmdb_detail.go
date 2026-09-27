package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	maxTMDBSeasons         = 100
	maxTMDBCollectionParts = 24
	maxTMDBRecommendations = 8
	maxTMDBContributors    = 12
)

type tmdbDetailPayload struct {
	ID               int            `json:"id"`
	Adult            bool           `json:"adult"`
	Title            string         `json:"title"`
	Name             string         `json:"name"`
	OriginalTitle    string         `json:"original_title"`
	OriginalName     string         `json:"original_name"`
	Overview         string         `json:"overview"`
	PosterPath       string         `json:"poster_path"`
	ReleaseDate      string         `json:"release_date"`
	FirstAirDate     string         `json:"first_air_date"`
	LastAirDate      string         `json:"last_air_date"`
	Runtime          int            `json:"runtime"`
	EpisodeRunTime   []int          `json:"episode_run_time"`
	NumberOfEpisodes int            `json:"number_of_episodes"`
	Status           string         `json:"status"`
	VoteAverage      float64        `json:"vote_average"`
	Genres           []providerName `json:"genres"`
	CreatedBy        []struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		ProfilePath string `json:"profile_path"`
	} `json:"created_by"`
	Credits struct {
		Crew []struct {
			ID          int    `json:"id"`
			Name        string `json:"name"`
			Job         string `json:"job"`
			ProfilePath string `json:"profile_path"`
		} `json:"crew"`
	} `json:"credits"`
	ProductionCompanies []struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"production_companies"`
	Seasons []struct {
		ID           int     `json:"id"`
		Name         string  `json:"name"`
		Overview     string  `json:"overview"`
		PosterPath   string  `json:"poster_path"`
		AirDate      string  `json:"air_date"`
		SeasonNumber int     `json:"season_number"`
		EpisodeCount int     `json:"episode_count"`
		VoteAverage  float64 `json:"vote_average"`
	} `json:"seasons"`
	BelongsToCollection *struct {
		ID int `json:"id"`
	} `json:"belongs_to_collection"`
	Recommendations struct {
		Results []tmdbTitleSummary `json:"results"`
	} `json:"recommendations"`
}

type tmdbTitleSummary struct {
	ID           int     `json:"id"`
	Adult        bool    `json:"adult"`
	MediaType    string  `json:"media_type"`
	Job          string  `json:"job"`
	Title        string  `json:"title"`
	Name         string  `json:"name"`
	Original     string  `json:"original_title"`
	OriginalName string  `json:"original_name"`
	Overview     string  `json:"overview"`
	PosterPath   string  `json:"poster_path"`
	ReleaseDate  string  `json:"release_date"`
	FirstAirDate string  `json:"first_air_date"`
	VoteAverage  float64 `json:"vote_average"`
	GenreIDs     []int   `json:"genre_ids"`
}

func (s *discoveryService) fetchTMDBDetail(ctx context.Context, mediaType, providerID string) (discoveryDetail, error) {
	if s.tmdbToken == "" {
		return discoveryDetail{}, errProviderUnavailable
	}
	resource := "movie"
	if mediaType == "series" {
		resource = "tv"
	}
	values := url.Values{
		"append_to_response": {"recommendations"},
		"language":           {"en-US"},
	}
	if mediaType == "movie" {
		values.Set("append_to_response", "credits,recommendations")
	}
	endpoint := strings.TrimRight(s.tmdbBase, "/") + "/" + resource + "/" + providerID + "?" + values.Encode()
	var payload tmdbDetailPayload
	if err := s.getJSON(ctx, endpoint, s.tmdbToken, &payload); err != nil {
		var responseErr *providerHTTPError
		if errors.As(err, &responseErr) && responseErr.StatusCode == http.StatusNotFound {
			return discoveryDetail{}, errCatalogNotFound
		}
		return discoveryDetail{}, err
	}
	expectedID, _ := strconv.Atoi(providerID)
	result, contributors, ok := boundedTMDBDetailResult(payload, mediaType)
	if !ok || payload.ID != expectedID {
		return discoveryDetail{}, errCatalogNotFound
	}
	detail := emptyDiscoveryDetail(result)
	detail.AlternativeTitles = tmdbAlternativeTitles(payload, result.Title, mediaType)
	detail.Contributors = contributors
	detail.Seasons = tmdbSeasons(payload, mediaType)
	detail.Recommendations = tmdbSummaries(payload.Recommendations.Results, mediaType, providerID, maxTMDBRecommendations)
	if mediaType == "movie" && payload.BelongsToCollection != nil && payload.BelongsToCollection.ID > 0 {
		collection, err := s.fetchTMDBCollection(ctx, payload.BelongsToCollection.ID, providerID)
		if err != nil {
			if ctx.Err() != nil {
				return discoveryDetail{}, ctx.Err()
			}
			slog.Warn("tmdb_collection_fetch_failed", "collection_id", payload.BelongsToCollection.ID, "error", err)
		} else {
			detail.Collection = collection
		}
	}
	return detail, nil
}

func boundedTMDBDetailResult(item tmdbDetailPayload, mediaType string) (discoveryResult, []discoveryContributor, bool) {
	title, originalTitle := item.Title, item.OriginalTitle
	startDate, endDate := item.ReleaseDate, ""
	duration, catalogTotal := item.Runtime, 0
	credits := make([]mediaCredit, 0, 4)
	contributors := make([]discoveryContributor, 0, 4)
	if mediaType == "series" {
		title, originalTitle = item.Name, item.OriginalName
		startDate, endDate = item.FirstAirDate, item.LastAirDate
		if len(item.EpisodeRunTime) > 0 {
			duration = item.EpisodeRunTime[0]
		}
		catalogTotal = boundedPositive(item.NumberOfEpisodes, 1_000_000)
		for _, creator := range item.CreatedBy {
			credits = append(credits, mediaCredit{Name: creator.Name, Role: "Creator"})
			contributors = append(contributors, discoveryContributor{
				Name: creator.Name, Role: "Creator", ImageURL: tmdbProfileURL(creator.ProfilePath),
			})
		}
	} else {
		for _, member := range item.Credits.Crew {
			if strings.EqualFold(strings.TrimSpace(member.Job), "Director") {
				credits = append(credits, mediaCredit{Name: member.Name, Role: "Director"})
				contributors = append(contributors, discoveryContributor{
					Name: member.Name, Role: "Director", ImageURL: tmdbProfileURL(member.ProfilePath),
					Provider: "tmdb", ProviderID: strconv.Itoa(member.ID), Kind: "person", Relation: "director",
				})
			}
		}
	}
	for _, company := range item.ProductionCompanies {
		credits = append(credits, mediaCredit{Name: company.Name, Role: "Production company"})
		contributors = append(contributors, discoveryContributor{
			Name: company.Name, Role: "Production company", Provider: "tmdb",
			ProviderID: strconv.Itoa(company.ID), Kind: "organization", Relation: "production_company",
		})
	}
	title = limitedProviderText(title, 200)
	if item.ID < 1 || item.Adult || title == "" {
		return discoveryResult{}, []discoveryContributor{}, false
	}
	startDate, endDate = boundedTMDBDate(startDate), boundedTMDBDate(endDate)
	return discoveryResult{
		Provider: "tmdb", ProviderID: strconv.Itoa(item.ID), ProviderURL: tmdbProviderURL(mediaType, item.ID), Type: mediaType,
		Title: title, OriginalTitle: limitedProviderText(originalTitle, 200), Description: limitedProviderText(item.Overview, 10_000),
		CoverURL: tmdbCoverURL(item.PosterPath), ReleaseYear: yearFromDate(startDate), Genres: normalizedMetadataStrings(namesOf(item.Genres)),
		Credits: normalizedMediaCredits(credits), ReleaseStatus: tmdbReleaseStatus(item.Status), StartDate: startDate, EndDate: endDate,
		DurationMinutes: boundedPositive(duration, 10_080), CatalogTotal: catalogTotal, CommunityRating: boundedTMDBRating(item.VoteAverage),
	}, normalizedTMDBContributors(contributors), true
}

func tmdbSeasons(item tmdbDetailPayload, mediaType string) []discoverySeason {
	result := make([]discoverySeason, 0, min(len(item.Seasons), maxTMDBSeasons))
	if mediaType != "series" {
		return result
	}
	seen := make(map[int]bool)
	for _, season := range item.Seasons {
		title := limitedProviderText(season.Name, 200)
		if season.ID < 1 || season.SeasonNumber < 0 || title == "" || seen[season.SeasonNumber] {
			continue
		}
		seen[season.SeasonNumber] = true
		result = append(result, discoverySeason{
			ProviderID: strconv.Itoa(season.ID), SeasonNumber: season.SeasonNumber, Title: title,
			Description: limitedProviderText(season.Overview, 10_000), CoverURL: tmdbCoverURL(season.PosterPath),
			StartDate: boundedTMDBDate(season.AirDate), EpisodeCount: boundedPositive(season.EpisodeCount, 10_000),
		})
		if len(result) == maxTMDBSeasons {
			break
		}
	}
	return result
}

func (s *discoveryService) fetchTMDBCollection(ctx context.Context, collectionID int, currentID string) ([]discoveryResult, error) {
	values := url.Values{"language": {"en-US"}}
	endpoint := fmt.Sprintf("%s/collection/%d?%s", strings.TrimRight(s.tmdbBase, "/"), collectionID, values.Encode())
	var payload struct {
		ID    int                `json:"id"`
		Parts []tmdbTitleSummary `json:"parts"`
	}
	if err := s.getJSON(ctx, endpoint, s.tmdbToken, &payload); err != nil {
		return nil, err
	}
	if payload.ID != collectionID {
		return nil, fmt.Errorf("TMDB returned a different collection")
	}
	return tmdbSummaries(payload.Parts, "movie", currentID, maxTMDBCollectionParts), nil
}

func tmdbSummaries(items []tmdbTitleSummary, mediaType, currentID string, limit int) []discoveryResult {
	result := make([]discoveryResult, 0, min(len(items), limit))
	seen := make(map[int]bool)
	for _, item := range items {
		if item.ID < 1 || item.Adult || strconv.Itoa(item.ID) == currentID || seen[item.ID] {
			continue
		}
		title, originalTitle, date := item.Title, item.Original, item.ReleaseDate
		if mediaType == "series" {
			title, originalTitle, date = item.Name, item.OriginalName, item.FirstAirDate
		}
		title = limitedProviderText(title, 200)
		if title == "" {
			continue
		}
		seen[item.ID] = true
		date = boundedTMDBDate(date)
		result = append(result, discoveryResult{
			Provider: "tmdb", ProviderID: strconv.Itoa(item.ID), ProviderURL: tmdbProviderURL(mediaType, item.ID), Type: mediaType,
			Title: title, OriginalTitle: limitedProviderText(originalTitle, 200), Description: limitedProviderText(item.Overview, 10_000),
			CoverURL: tmdbCoverURL(item.PosterPath), ReleaseYear: yearFromDate(date), StartDate: date,
			Genres: tmdbGenres(mediaType, item.GenreIDs), CommunityRating: boundedTMDBRating(item.VoteAverage),
		})
		if len(result) == limit {
			break
		}
	}
	return result
}

func tmdbAlternativeTitles(item tmdbDetailPayload, primary, mediaType string) []string {
	alternative := item.OriginalTitle
	if mediaType == "series" {
		alternative = item.OriginalName
	}
	alternative = limitedProviderText(alternative, 200)
	if alternative == "" || strings.EqualFold(alternative, primary) {
		return []string{}
	}
	return []string{alternative}
}

func tmdbProviderURL(mediaType string, id int) string {
	resource := "movie"
	if mediaType == "series" {
		resource = "tv"
	}
	return fmt.Sprintf("https://www.themoviedb.org/%s/%d", resource, id)
}

func tmdbCoverURL(path string) string {
	return tmdbImageURL(path, "w500")
}

func tmdbProfileURL(path string) string {
	return tmdbImageURL(path, "w185")
}

func tmdbImageURL(path, size string) string {
	path = strings.TrimSpace(path)
	if path == "" || !strings.HasPrefix(path, "/") || len([]rune(path)) > 500 {
		return ""
	}
	return safeProviderURL("https://image.tmdb.org/t/p/" + size + path)
}

func normalizedTMDBContributors(values []discoveryContributor) []discoveryContributor {
	result := make([]discoveryContributor, 0, min(len(values), maxTMDBContributors))
	seen := make(map[string]bool)
	for _, contributor := range values {
		name := limitedProviderText(contributor.Name, 100)
		role := limitedProviderText(contributor.Role, 100)
		if name == "" || role == "" {
			continue
		}
		normalized := discoveryContributor{Name: name, Role: role, ImageURL: safeProviderURL(contributor.ImageURL)}
		id, err := strconv.Atoi(contributor.ProviderID)
		if err == nil && contributor.Provider == "tmdb" && id > 0 && strconv.Itoa(id) == contributor.ProviderID &&
			slicesContains([]string{"person", "organization"}, contributor.Kind) &&
			slicesContains([]string{"director", "production_company"}, contributor.Relation) {
			normalized.Provider = contributor.Provider
			normalized.ProviderID = contributor.ProviderID
			normalized.Kind = contributor.Kind
			normalized.Relation = contributor.Relation
		}
		key := strings.ToLower(name + "\x00" + role)
		if normalized.ProviderID != "" {
			key = normalized.Provider + "\x00" + normalized.Relation + "\x00" + normalized.ProviderID
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, normalized)
		if len(result) == maxTMDBContributors {
			break
		}
	}
	return result
}

func boundedTMDBDate(value string) string {
	value = strings.TrimSpace(value)
	if !validPartialDate(value) {
		return ""
	}
	return value
}

func boundedTMDBRating(value float64) float64 {
	if value < 0 || value > 10 {
		return 0
	}
	return value
}

func boundedPositive(value, maximum int) int {
	if value < 0 || value > maximum {
		return 0
	}
	return value
}

func tmdbReleaseStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "released", "ended":
		return "finished"
	case "returning series":
		return "releasing"
	case "canceled", "cancelled":
		return "cancelled"
	case "planned", "pilot", "in production", "post production":
		return "upcoming"
	default:
		return ""
	}
}
