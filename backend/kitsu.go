package main

import (
	"context"
	"math"
	"net/url"
	"strconv"
	"strings"
)

type kitsuMedia struct {
	ID         string `json:"id"`
	Attributes struct {
		CanonicalTitle string            `json:"canonicalTitle"`
		Titles         map[string]string `json:"titles"`
		Synopsis       string            `json:"synopsis"`
		StartDate      string            `json:"startDate"`
		EndDate        string            `json:"endDate"`
		Status         string            `json:"status"`
		AverageRating  string            `json:"averageRating"`
		EpisodeCount   int               `json:"episodeCount"`
		EpisodeLength  int               `json:"episodeLength"`
		ChapterCount   int               `json:"chapterCount"`
		Subtype        string            `json:"subtype"`
		PosterImage    struct {
			Large    string `json:"large"`
			Original string `json:"original"`
		} `json:"posterImage"`
	} `json:"attributes"`
	Relationships struct {
		Genres struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		} `json:"genres"`
	} `json:"relationships"`
}

func (s *discoveryService) searchKitsu(ctx context.Context, mediaType, query string, page int) (discoveryResponse, error) {
	resource := "anime"
	values := url.Values{
		"filter[text]": {query},
		"page[limit]":  {strconv.Itoa(kitsuPageSize)},
		"page[offset]": {strconv.Itoa((page - 1) * kitsuPageSize)},
		"include":      {"genres"},
	}
	if mediaType != "anime" {
		resource = "manga"
		subtype := "manga"
		if mediaType == "light_novel" {
			subtype = "novel"
		}
		values.Set("filter[subtype]", subtype)
	}

	var payload struct {
		Data     []kitsuMedia `json:"data"`
		Included []struct {
			ID         string `json:"id"`
			Type       string `json:"type"`
			Attributes struct {
				Name string `json:"name"`
			} `json:"attributes"`
		} `json:"included"`
		Links struct {
			Next string `json:"next"`
		} `json:"links"`
	}
	endpoint := strings.TrimRight(s.kitsuBase, "/") + "/" + resource + "?" + values.Encode()
	if err := s.getJSONAccept(ctx, endpoint, "application/vnd.api+json", &payload); err != nil {
		return discoveryResponse{}, err
	}

	genreNames := make(map[string]string, len(payload.Included))
	for _, included := range payload.Included {
		if included.Type == "genres" {
			genreNames[included.ID] = included.Attributes.Name
		}
	}
	results := make([]discoveryResult, 0, len(payload.Data))
	for _, item := range payload.Data {
		title := item.Attributes.Titles["en"]
		if title == "" {
			title = item.Attributes.CanonicalTitle
		}
		originalTitle := item.Attributes.Titles["ja_jp"]
		cover := item.Attributes.PosterImage.Large
		if cover == "" {
			cover = item.Attributes.PosterImage.Original
		}
		total := item.Attributes.EpisodeCount
		if mediaType != "anime" {
			total = item.Attributes.ChapterCount
		}
		rating, err := strconv.ParseFloat(item.Attributes.AverageRating, 64)
		if err != nil || math.IsNaN(rating) || math.IsInf(rating, 0) {
			rating = 0
		}
		genres := make([]string, 0, len(item.Relationships.Genres.Data))
		for _, genre := range item.Relationships.Genres.Data {
			if name := genreNames[genre.ID]; name != "" {
				genres = append(genres, name)
			}
		}
		results = append(results, discoveryResult{
			Provider:        "kitsu",
			ProviderID:      item.ID,
			ProviderURL:     "https://kitsu.io/" + resource + "/" + item.ID,
			Type:            mediaType,
			Title:           title,
			OriginalTitle:   originalTitle,
			Description:     item.Attributes.Synopsis,
			CoverURL:        cover,
			ReleaseYear:     yearFromDate(item.Attributes.StartDate),
			Format:          strings.TrimSpace(item.Attributes.Subtype),
			Total:           total,
			Subtitle:        item.Attributes.Subtype,
			Genres:          normalizedMetadataStrings(genres),
			ReleaseStatus:   normalizedReleaseStatus(item.Attributes.Status),
			StartDate:       item.Attributes.StartDate,
			EndDate:         item.Attributes.EndDate,
			DurationMinutes: item.Attributes.EpisodeLength,
			CatalogTotal:    total,
			CommunityRating: rating / 10,
		})
	}
	return discoveryResponse{Results: results, Page: page, HasMore: payload.Links.Next != ""}, nil
}
