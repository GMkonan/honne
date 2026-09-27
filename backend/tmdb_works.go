package main

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

const maxTMDBContributorWorks = 20 * discoveryPageSize

func (s *discoveryService) fetchTMDBWorks(ctx context.Context, query discoveryWorksQuery) (discoveryResponse, error) {
	if s.tmdbToken == "" {
		return discoveryResponse{}, errProviderUnavailable
	}
	if query.Relation == "director" {
		return s.fetchTMDBDirectorWorks(ctx, query)
	}
	return s.fetchTMDBCompanyWorks(ctx, query)
}

func (s *discoveryService) fetchTMDBDirectorWorks(ctx context.Context, query discoveryWorksQuery) (discoveryResponse, error) {
	values := url.Values{"language": {"en-US"}}
	endpoint := fmt.Sprintf("%s/person/%s/combined_credits?%s", strings.TrimRight(s.tmdbBase, "/"), query.ProviderID, values.Encode())
	var payload struct {
		ID   int                `json:"id"`
		Crew []tmdbTitleSummary `json:"crew"`
	}
	if err := s.getJSON(ctx, endpoint, s.tmdbToken, &payload); err != nil {
		return discoveryResponse{}, err
	}
	expectedID, _ := strconv.Atoi(query.ProviderID)
	if payload.ID != expectedID {
		return discoveryResponse{}, fmt.Errorf("TMDB returned a different person")
	}
	resource := discoveryWorksResource(query.MediaType)
	matches := make([]tmdbTitleSummary, 0, min(len(payload.Crew), maxTMDBContributorWorks))
	for _, credit := range payload.Crew {
		if strings.EqualFold(strings.TrimSpace(credit.Job), "Director") && credit.MediaType == resource {
			matches = append(matches, credit)
		}
	}
	return discoveryResponse{
		Results: tmdbSummaries(matches, query.MediaType, query.ExcludeID, maxTMDBContributorWorks),
	}, nil
}

func (s *discoveryService) fetchTMDBCompanyWorks(ctx context.Context, query discoveryWorksQuery) (discoveryResponse, error) {
	values := url.Values{
		"include_adult": {"false"}, "language": {"en-US"},
		"page": {fmt.Sprintf("%d", query.Page)}, "with_companies": {query.ProviderID},
	}
	endpoint := fmt.Sprintf("%s/discover/%s?%s", strings.TrimRight(s.tmdbBase, "/"),
		discoveryWorksResource(query.MediaType), values.Encode())
	var payload struct {
		Page       int                `json:"page"`
		TotalPages int                `json:"total_pages"`
		Results    []tmdbTitleSummary `json:"results"`
	}
	if err := s.getJSON(ctx, endpoint, s.tmdbToken, &payload); err != nil {
		return discoveryResponse{}, err
	}
	return discoveryResponse{
		Results: tmdbSummaries(payload.Results, query.MediaType, query.ExcludeID, discoveryPageSize),
		Page:    query.Page, HasMore: payload.Page > 0 && payload.Page < payload.TotalPages,
	}, nil
}
