package main

import (
	"context"
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
		AverageRating  string            `json:"averageRating"`
		EpisodeCount   int               `json:"episodeCount"`
		ChapterCount   int               `json:"chapterCount"`
		Subtype        string            `json:"subtype"`
		PosterImage    struct {
			Large    string `json:"large"`
			Original string `json:"original"`
		} `json:"posterImage"`
	} `json:"attributes"`
}

func (s *discoveryService) searchKitsu(ctx context.Context, mediaType, query string, page int) (discoveryResponse, error) {
	resource := "anime"
	values := url.Values{
		"filter[text]": {query},
		"page[limit]":  {strconv.Itoa(kitsuPageSize)},
		"page[offset]": {strconv.Itoa((page - 1) * kitsuPageSize)},
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
		Data  []kitsuMedia `json:"data"`
		Links struct {
			Next string `json:"next"`
		} `json:"links"`
	}
	endpoint := strings.TrimRight(s.kitsuBase, "/") + "/" + resource + "?" + values.Encode()
	if err := s.getJSONAccept(ctx, endpoint, "application/vnd.api+json", &payload); err != nil {
		return discoveryResponse{}, err
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
		rating, _ := strconv.ParseFloat(item.Attributes.AverageRating, 64)
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
			Total:           total,
			Subtitle:        item.Attributes.Subtype,
			CommunityRating: rating / 10,
		})
	}
	return discoveryResponse{Results: results, Page: page, HasMore: payload.Links.Next != ""}, nil
}
