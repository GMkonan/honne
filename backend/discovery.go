package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const discoveryPageSize = 20

var errProviderUnavailable = errors.New("provider is not configured")

var htmlTagPattern = regexp.MustCompile(`<[^>]*>`)

type discoveryResult struct {
	Provider        string  `json:"provider"`
	ProviderID      string  `json:"providerId"`
	ProviderURL     string  `json:"providerUrl"`
	Type            string  `json:"type"`
	Title           string  `json:"title"`
	OriginalTitle   string  `json:"originalTitle,omitempty"`
	Description     string  `json:"description,omitempty"`
	CoverURL        string  `json:"coverUrl,omitempty"`
	ReleaseYear     int     `json:"releaseYear,omitempty"`
	Total           int     `json:"total,omitempty"`
	Subtitle        string  `json:"subtitle,omitempty"`
	CommunityRating float64 `json:"communityRating,omitempty"`
}

type discoveryResponse struct {
	Results []discoveryResult `json:"results"`
	Page    int               `json:"page"`
	HasMore bool              `json:"hasMore"`
}

type providerName struct {
	Name string `json:"name"`
}

type anilistMedia struct {
	ID           int    `json:"id"`
	SiteURL      string `json:"siteUrl"`
	Description  string `json:"description"`
	Episodes     int    `json:"episodes"`
	Chapters     int    `json:"chapters"`
	Format       string `json:"format"`
	AverageScore int    `json:"averageScore"`
	Title        struct {
		Romaji  string `json:"romaji"`
		English string `json:"english"`
		Native  string `json:"native"`
	} `json:"title"`
	CoverImage struct {
		ExtraLarge string `json:"extraLarge"`
	} `json:"coverImage"`
	StartDate struct {
		Year int `json:"year"`
	} `json:"startDate"`
	Studios struct {
		Nodes []providerName `json:"nodes"`
	} `json:"studios"`
}

type cachedDiscovery struct {
	response  discoveryResponse
	expiresAt time.Time
}

type discoveryService struct {
	client       *http.Client
	anilistBase  string
	booksBase    string
	tmdbBase     string
	tmdbToken    string
	contactEmail string

	mu    sync.Mutex
	cache map[string]cachedDiscovery
}

func newDiscoveryService(cfg config) *discoveryService {
	return &discoveryService{
		client:       &http.Client{Timeout: 8 * time.Second},
		anilistBase:  cfg.AniListAPIURL,
		booksBase:    cfg.OpenLibraryAPIURL,
		tmdbBase:     cfg.TMDBAPIURL,
		tmdbToken:    cfg.TMDBAPIToken,
		contactEmail: cfg.AppContactEmail,
		cache:        make(map[string]cachedDiscovery),
	}
}

func (a *app) searchDiscovery(w http.ResponseWriter, r *http.Request) {
	mediaType := r.URL.Query().Get("type")
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	page := 1
	if rawPage := r.URL.Query().Get("page"); rawPage != "" {
		parsed, err := strconv.Atoi(rawPage)
		if err != nil || parsed < 1 || parsed > 20 {
			writeError(w, http.StatusBadRequest, "page must be between 1 and 20")
			return
		}
		page = parsed
	}
	if !slicesContains(validTypes, mediaType) {
		writeError(w, http.StatusBadRequest, "invalid media type")
		return
	}
	if len([]rune(query)) < 2 || len([]rune(query)) > 100 {
		writeError(w, http.StatusBadRequest, "query must contain between 2 and 100 characters")
		return
	}

	response, err := a.discovery.search(r.Context(), mediaType, query, page)
	if errors.Is(err, errProviderUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "movie and series search requires TMDB_API_TOKEN")
		return
	}
	if err != nil {
		logProviderError(mediaType, err)
		writeError(w, http.StatusBadGateway, "the metadata provider is temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *discoveryService) search(ctx context.Context, mediaType, query string, page int) (discoveryResponse, error) {
	key := fmt.Sprintf("%s|%s|%d", mediaType, strings.ToLower(query), page)
	s.mu.Lock()
	if cached, ok := s.cache[key]; ok && time.Now().Before(cached.expiresAt) {
		s.mu.Unlock()
		return cached.response, nil
	}
	s.mu.Unlock()

	var response discoveryResponse
	var err error
	switch mediaType {
	case "anime", "manga", "light_novel":
		response, err = s.searchAniList(ctx, mediaType, query, page)
	case "book":
		response, err = s.searchBooks(ctx, query, page)
	case "movie", "series":
		response, err = s.searchTMDB(ctx, mediaType, query, page)
	}
	if err != nil {
		return discoveryResponse{}, err
	}

	s.mu.Lock()
	s.cache[key] = cachedDiscovery{response: response, expiresAt: time.Now().Add(10 * time.Minute)}
	s.mu.Unlock()
	return response, nil
}

func (s *discoveryService) searchAniList(ctx context.Context, mediaType, query string, page int) (discoveryResponse, error) {
	const graphQL = `query ($search: String!, $page: Int!, $type: MediaType!) {
  Page(page: $page, perPage: 20) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, isAdult: false) {
      id siteUrl format description(asHtml: false) episodes chapters averageScore
      title { romaji english native }
      coverImage { extraLarge }
      startDate { year }
      studios(isMain: true) { nodes { name } }
    }
  }
}`
	const lightNovelGraphQL = `query ($search: String!, $page: Int!, $type: MediaType!) {
  Page(page: $page, perPage: 20) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, format: NOVEL, isAdult: false) {
      id siteUrl format description(asHtml: false) episodes chapters averageScore
      title { romaji english native }
      coverImage { extraLarge }
      startDate { year }
      studios(isMain: true) { nodes { name } }
    }
  }
}`
	anilistType := "ANIME"
	if mediaType != "anime" {
		anilistType = "MANGA"
	}
	searchQuery := graphQL
	if mediaType == "light_novel" {
		searchQuery = lightNovelGraphQL
	}
	request := map[string]any{
		"query":     searchQuery,
		"variables": map[string]any{"search": query, "page": page, "type": anilistType},
	}
	var payload struct {
		Data struct {
			Page struct {
				PageInfo struct {
					HasNext bool `json:"hasNextPage"`
				} `json:"pageInfo"`
				Media []anilistMedia `json:"media"`
			} `json:"Page"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := s.postJSON(ctx, s.anilistBase, request, &payload); err != nil {
		return discoveryResponse{}, err
	}
	if len(payload.Errors) > 0 {
		return discoveryResponse{}, fmt.Errorf("AniList: %s", payload.Errors[0].Message)
	}
	results := make([]discoveryResult, 0, len(payload.Data.Page.Media))
	for _, item := range payload.Data.Page.Media {
		resultType := mediaType
		if item.Format == "NOVEL" {
			resultType = "light_novel"
		}
		total := item.Episodes
		if resultType != "anime" {
			total = item.Chapters
		}
		results = append(results, discoveryResult{Provider: "anilist", ProviderID: strconv.Itoa(item.ID), ProviderURL: item.SiteURL, Type: resultType, Title: preferredAniListTitle(item), OriginalTitle: item.Title.Native, Description: cleanDescription(item.Description), CoverURL: item.CoverImage.ExtraLarge, ReleaseYear: item.StartDate.Year, Total: total, Subtitle: firstName(item.Studios.Nodes), CommunityRating: float64(item.AverageScore) / 10})
	}
	return discoveryResponse{Results: results, Page: page, HasMore: payload.Data.Page.PageInfo.HasNext}, nil
}

func (s *discoveryService) searchBooks(ctx context.Context, query string, page int) (discoveryResponse, error) {
	values := url.Values{"q": {query}, "page": {strconv.Itoa(page)}, "limit": {strconv.Itoa(discoveryPageSize)}, "fields": {"key,title,author_name,first_publish_year,cover_i,number_of_pages_median"}}
	var payload struct {
		NumFound int `json:"numFound"`
		Docs     []struct {
			Key       string   `json:"key"`
			Title     string   `json:"title"`
			Authors   []string `json:"author_name"`
			Year      int      `json:"first_publish_year"`
			CoverID   int      `json:"cover_i"`
			PageCount int      `json:"number_of_pages_median"`
		} `json:"docs"`
	}
	if err := s.getJSON(ctx, s.booksBase+"/search.json?"+values.Encode(), "", &payload); err != nil {
		return discoveryResponse{}, err
	}
	results := make([]discoveryResult, 0, len(payload.Docs))
	for _, item := range payload.Docs {
		id := strings.TrimPrefix(item.Key, "/works/")
		cover := ""
		if item.CoverID > 0 {
			cover = fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-L.jpg", item.CoverID)
		}
		results = append(results, discoveryResult{Provider: "open_library", ProviderID: id, ProviderURL: "https://openlibrary.org" + item.Key, Type: "book", Title: item.Title, CoverURL: cover, ReleaseYear: item.Year, Total: item.PageCount, Subtitle: strings.Join(item.Authors, ", ")})
	}
	return discoveryResponse{Results: results, Page: page, HasMore: page*discoveryPageSize < payload.NumFound}, nil
}

func (s *discoveryService) searchTMDB(ctx context.Context, mediaType, query string, page int) (discoveryResponse, error) {
	if s.tmdbToken == "" {
		return discoveryResponse{}, errProviderUnavailable
	}
	resource := "movie"
	if mediaType == "series" {
		resource = "tv"
	}
	values := url.Values{"query": {query}, "page": {strconv.Itoa(page)}, "include_adult": {"false"}, "language": {"en-US"}}
	var payload struct {
		TotalPages int `json:"total_pages"`
		Results    []struct {
			ID           int     `json:"id"`
			Title        string  `json:"title"`
			Name         string  `json:"name"`
			Original     string  `json:"original_title"`
			OriginalName string  `json:"original_name"`
			Overview     string  `json:"overview"`
			Poster       string  `json:"poster_path"`
			ReleaseDate  string  `json:"release_date"`
			FirstAirDate string  `json:"first_air_date"`
			Rating       float64 `json:"vote_average"`
		} `json:"results"`
	}
	if err := s.getJSON(ctx, s.tmdbBase+"/search/"+resource+"?"+values.Encode(), s.tmdbToken, &payload); err != nil {
		return discoveryResponse{}, err
	}
	results := make([]discoveryResult, 0, len(payload.Results))
	for _, item := range payload.Results {
		title, original, date := item.Title, item.Original, item.ReleaseDate
		if mediaType == "series" {
			title, original, date = item.Name, item.OriginalName, item.FirstAirDate
		}
		cover := ""
		if item.Poster != "" {
			cover = "https://image.tmdb.org/t/p/w500" + item.Poster
		}
		results = append(results, discoveryResult{Provider: "tmdb", ProviderID: strconv.Itoa(item.ID), ProviderURL: fmt.Sprintf("https://www.themoviedb.org/%s/%d", resource, item.ID), Type: mediaType, Title: title, OriginalTitle: original, Description: item.Overview, CoverURL: cover, ReleaseYear: yearFromDate(date), CommunityRating: item.Rating})
	}
	return discoveryResponse{Results: results, Page: page, HasMore: page < payload.TotalPages}, nil
}

func (s *discoveryService) getJSON(ctx context.Context, endpoint, token string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	userAgent := "Honne/0.1"
	if s.contactEmail != "" {
		userAgent += " (" + s.contactEmail + ")"
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("provider returned %s", response.Status)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode provider response: %w", err)
	}
	return nil
}

func (s *discoveryService) postJSON(ctx context.Context, endpoint string, payload, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Honne/0.1")
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("provider returned %s", response.Status)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode provider response: %w", err)
	}
	return nil
}

func preferredAniListTitle(item anilistMedia) string {
	if item.Title.English != "" {
		return item.Title.English
	}
	return item.Title.Romaji
}

func cleanDescription(value string) string {
	value = strings.ReplaceAll(value, "<br>", "\n")
	value = strings.ReplaceAll(value, "<br/>", "\n")
	value = strings.ReplaceAll(value, "<br />", "\n")
	return strings.TrimSpace(html.UnescapeString(htmlTagPattern.ReplaceAllString(value, "")))
}

func yearFromDate(value string) int {
	if len(value) < 4 {
		return 0
	}
	year, _ := strconv.Atoi(value[:4])
	return year
}

func firstName(items []providerName) string {
	if len(items) == 0 {
		return ""
	}
	return items[0].Name
}

func slicesContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func logProviderError(mediaType string, err error) {
	fmt.Fprintf(os.Stderr, "discovery provider error for %s: %v\n", mediaType, err)
}
