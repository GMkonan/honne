package main

import (
	"context"
	"net/url"
	"strconv"
	"time"
)

func (s *discoveryService) fetchRAWGWorks(ctx context.Context, query discoveryWorksQuery) (discoveryResponse, error) {
	if s.rawgKey == "" {
		return discoveryResponse{}, errProviderUnavailable
	}
	filter := "developers"
	if query.Relation == "publisher" {
		filter = "publishers"
	}
	values := url.Values{
		filter: {query.ProviderID}, "page": {strconv.Itoa(query.Page)},
		"page_size": {strconv.Itoa(discoveryPageSize)},
	}
	var payload struct {
		Next    string     `json:"next"`
		Results []rawgGame `json:"results"`
	}
	if err := s.getRAWGJSON(ctx, "/games", values, &payload); err != nil {
		return discoveryResponse{}, err
	}
	results := make([]discoveryResult, 0, min(len(payload.Results), discoveryPageSize))
	for _, item := range payload.Results {
		result, ok := rawgDiscoveryResult(item, time.Now())
		if !ok || result.ProviderID == query.ExcludeID {
			continue
		}
		results = append(results, result)
		if len(results) == discoveryPageSize {
			break
		}
	}
	return discoveryResponse{Results: results, Page: query.Page, HasMore: payload.Next != ""}, nil
}
