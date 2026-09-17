package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func (s *discoveryService) fetchAniListDetail(ctx context.Context, mediaType, providerID string) (discoveryDetail, error) {
	const graphQL = `query ($id: Int!, $type: MediaType!) {
  Media(id: $id, type: $type) {
    id siteUrl type format status description(asHtml: false) episodes chapters duration genres averageScore isAdult
    title { romaji english native }
    coverImage { extraLarge }
    startDate { year month day }
    endDate { year month day }
    studios(isMain: true) { nodes { name } }
    staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
    relations {
      edges {
        relationType(version: 2)
        node {
          id siteUrl type format isAdult
          title { romaji english native }
          coverImage { extraLarge }
          startDate { year month day }
        }
      }
    }
  }
}`
	id, _ := strconv.Atoi(providerID)
	anilistType := "ANIME"
	if mediaType != "anime" {
		anilistType = "MANGA"
	}
	request := map[string]any{
		"query":     graphQL,
		"variables": map[string]any{"id": id, "type": anilistType},
	}
	var payload struct {
		Data struct {
			Media *anilistMedia `json:"Media"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := s.postJSON(ctx, s.anilistBase, request, &payload); err != nil {
		var responseErr *providerHTTPError
		if errors.As(err, &responseErr) && responseErr.StatusCode == http.StatusNotFound {
			return discoveryDetail{}, errCatalogNotFound
		}
		return discoveryDetail{}, err
	}
	if len(payload.Errors) > 0 {
		if strings.Contains(strings.ToLower(payload.Errors[0].Message), "not found") {
			return discoveryDetail{}, errCatalogNotFound
		}
		return discoveryDetail{}, fmt.Errorf("AniList: %s", payload.Errors[0].Message)
	}
	item := payload.Data.Media
	if item == nil || item.ID != id || item.IsAdult || anilistResultType(*item) != mediaType {
		return discoveryDetail{}, errCatalogNotFound
	}
	result, ok := boundedAniListResult(*item, mediaType)
	if !ok {
		return discoveryDetail{}, errCatalogNotFound
	}
	return discoveryDetail{
		discoveryResult:   result,
		AlternativeTitles: aniListAlternativeTitles(*item, result.Title),
		Relations:         aniListRelations(*item, providerID),
	}, nil
}

func anilistResultType(item anilistMedia) string {
	if item.MediaType == "ANIME" {
		return "anime"
	}
	if item.MediaType == "MANGA" && item.Format == "NOVEL" {
		return "light_novel"
	}
	if item.MediaType == "MANGA" {
		return "manga"
	}
	return ""
}

func boundedAniListResult(item anilistMedia, mediaType string) (discoveryResult, bool) {
	result := anilistDiscoveryResult(item, mediaType)
	result.Title = limitedProviderText(result.Title, 200)
	if result.Title == "" {
		result.Title = limitedProviderText(item.Title.Native, 200)
	}
	result.OriginalTitle = limitedProviderText(result.OriginalTitle, 200)
	result.Description = limitedProviderText(result.Description, 10_000)
	result.ProviderURL = safeProviderURL(result.ProviderURL)
	result.CoverURL = safeProviderURL(result.CoverURL)
	result.Format = limitedProviderText(result.Format, 50)
	return result, item.ID > 0 && result.Title != ""
}

func aniListAlternativeTitles(item anilistMedia, primary string) []string {
	values := []string{item.Title.Romaji, item.Title.English, item.Title.Native}
	result := make([]string, 0, len(values))
	seen := map[string]bool{strings.ToLower(strings.TrimSpace(primary)): true}
	for _, value := range values {
		value = limitedProviderText(value, 200)
		key := strings.ToLower(value)
		if value == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
	}
	return result
}

func aniListRelations(item anilistMedia, currentID string) []discoveryRelation {
	labels := map[string]string{
		"SEQUEL": "sequel", "PREQUEL": "prequel", "SOURCE": "source",
		"ADAPTATION": "adaptation", "SIDE_STORY": "side story",
		"SPIN_OFF": "spin-off", "PARENT": "parent",
	}
	priority := []string{"SEQUEL", "PREQUEL", "SOURCE", "ADAPTATION", "SIDE_STORY", "SPIN_OFF", "PARENT"}
	result := make([]discoveryRelation, 0, min(len(item.Relations.Edges), 12))
	seen := make(map[string]bool)
	for _, relationType := range priority {
		for _, edge := range item.Relations.Edges {
			if edge.RelationType != relationType || edge.Node.IsAdult || strconv.Itoa(edge.Node.ID) == currentID {
				continue
			}
			mediaType := anilistResultType(edge.Node)
			key := mediaType + "|" + strconv.Itoa(edge.Node.ID)
			if mediaType == "" || seen[key] {
				continue
			}
			related, ok := boundedAniListRelationResult(edge.Node, mediaType)
			if !ok {
				continue
			}
			seen[key] = true
			result = append(result, discoveryRelation{Relation: labels[relationType], Result: related})
			if len(result) == 12 {
				return result
			}
		}
	}
	return result
}

func boundedAniListRelationResult(item anilistMedia, mediaType string) (discoveryResult, bool) {
	title := limitedProviderText(preferredAniListTitle(item), 200)
	if title == "" {
		title = limitedProviderText(item.Title.Native, 200)
	}
	return discoveryResult{
		Provider: "anilist", ProviderID: strconv.Itoa(item.ID), ProviderURL: safeProviderURL(item.SiteURL),
		Type: mediaType, Title: title, OriginalTitle: limitedProviderText(item.Title.Native, 200),
		CoverURL: safeProviderURL(item.CoverImage.ExtraLarge), ReleaseYear: item.StartDate.Year,
	}, item.ID > 0 && title != ""
}
