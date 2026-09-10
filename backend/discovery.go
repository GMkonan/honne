package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	discoveryPageSize = 20
	kitsuPageSize     = 10
)

var errProviderUnavailable = errors.New("provider is not configured")

var htmlTagPattern = regexp.MustCompile(`<[^>]*>`)

type discoveryResult struct {
	Provider         string        `json:"provider"`
	ProviderID       string        `json:"providerId"`
	ProviderURL      string        `json:"providerUrl"`
	Type             string        `json:"type"`
	Title            string        `json:"title"`
	OriginalTitle    string        `json:"originalTitle,omitempty"`
	Description      string        `json:"description,omitempty"`
	CoverURL         string        `json:"coverUrl,omitempty"`
	ReleaseYear      int           `json:"releaseYear,omitempty"`
	Format           string        `json:"format,omitempty"`
	Total            int           `json:"total,omitempty"`
	Subtitle         string        `json:"subtitle,omitempty"`
	Genres           []string      `json:"genres,omitempty"`
	Credits          []mediaCredit `json:"credits,omitempty"`
	ReleaseStatus    string        `json:"releaseStatus,omitempty"`
	StartDate        string        `json:"startDate,omitempty"`
	EndDate          string        `json:"endDate,omitempty"`
	DurationMinutes  int           `json:"durationMinutes,omitempty"`
	CatalogTotal     int           `json:"catalogTotal,omitempty"`
	CommunityRating  float64       `json:"communityRating,omitempty"`
	CatalogPlatforms []string      `json:"catalogPlatforms,omitempty"`
}

type discoveryResponse struct {
	Results []discoveryResult `json:"results"`
	Page    int               `json:"page"`
	HasMore bool              `json:"hasMore"`
}

type globalDiscoveryResponse struct {
	Results          []discoveryResult `json:"results"`
	UnavailableTypes []string          `json:"unavailableTypes"`
}

type providerName struct {
	Name string `json:"name"`
}

type providerDate struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

type anilistMedia struct {
	ID           int      `json:"id"`
	SiteURL      string   `json:"siteUrl"`
	Description  string   `json:"description"`
	Episodes     int      `json:"episodes"`
	Chapters     int      `json:"chapters"`
	Format       string   `json:"format"`
	Status       string   `json:"status"`
	Duration     int      `json:"duration"`
	Genres       []string `json:"genres"`
	AverageScore int      `json:"averageScore"`
	Title        struct {
		Romaji  string `json:"romaji"`
		English string `json:"english"`
		Native  string `json:"native"`
	} `json:"title"`
	CoverImage struct {
		ExtraLarge string `json:"extraLarge"`
	} `json:"coverImage"`
	StartDate providerDate `json:"startDate"`
	EndDate   providerDate `json:"endDate"`
	Studios   struct {
		Nodes []providerName `json:"nodes"`
	} `json:"studios"`
	Staff struct {
		Edges []struct {
			Role string `json:"role"`
			Node struct {
				Name struct {
					Full string `json:"full"`
				} `json:"name"`
			} `json:"node"`
		} `json:"edges"`
	} `json:"staff"`
}

type cachedDiscovery struct {
	response  discoveryResponse
	expiresAt time.Time
}

type cachedDiscoveryDetail struct {
	result    discoveryResult
	expiresAt time.Time
}

type discoveryService struct {
	client       *http.Client
	anilistBase  string
	kitsuBase    string
	booksBase    string
	tmdbBase     string
	tmdbToken    string
	rawgBase     string
	rawgKey      string
	contactEmail string

	mu          sync.Mutex
	cache       map[string]cachedDiscovery
	detailCache map[string]cachedDiscoveryDetail
}

func newDiscoveryService(cfg config) *discoveryService {
	return &discoveryService{
		client:       &http.Client{Timeout: 15 * time.Second},
		anilistBase:  cfg.AniListAPIURL,
		kitsuBase:    cfg.KitsuAPIURL,
		booksBase:    cfg.OpenLibraryAPIURL,
		tmdbBase:     cfg.TMDBAPIURL,
		tmdbToken:    cfg.TMDBAPIToken,
		rawgBase:     cfg.RAWGAPIURL,
		rawgKey:      cfg.RAWGAPIKey,
		contactEmail: cfg.AppContactEmail,
		cache:        make(map[string]cachedDiscovery),
		detailCache:  make(map[string]cachedDiscoveryDetail),
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
	if !slicesContains(catalogTypes, mediaType) {
		writeError(w, http.StatusBadRequest, "invalid media type")
		return
	}
	if len([]rune(query)) < 2 || len([]rune(query)) > 100 {
		writeError(w, http.StatusBadRequest, "query must contain between 2 and 100 characters")
		return
	}

	response, err := a.discovery.search(r.Context(), mediaType, query, page)
	if errors.Is(err, errProviderUnavailable) {
		message := "movie and series search requires TMDB_API_TOKEN"
		if mediaType == "game" {
			message = "game search requires RAWG_API_KEY"
		}
		writeError(w, http.StatusServiceUnavailable, message)
		return
	}
	if err != nil {
		logProviderError(mediaType, err)
		writeError(w, http.StatusBadGateway, "the metadata provider is temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *app) searchGlobalDiscovery(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if length := len([]rune(query)); length < 2 || length > 100 {
		writeError(w, http.StatusBadRequest, "query must contain between 2 and 100 characters")
		return
	}

	type searchOutcome struct {
		index    int
		response discoveryResponse
		err      error
	}
	outcomes := make(chan searchOutcome, len(catalogTypes))
	for index, mediaType := range catalogTypes {
		go func() {
			response, err := a.discovery.search(r.Context(), mediaType, query, 1)
			outcomes <- searchOutcome{index: index, response: response, err: err}
		}()
	}

	ordered := make([]searchOutcome, len(catalogTypes))
	for range catalogTypes {
		outcome := <-outcomes
		ordered[outcome.index] = outcome
	}

	result := globalDiscoveryResponse{Results: []discoveryResult{}, UnavailableTypes: []string{}}
	seen := make(map[string]bool)
	successes := 0
	for index, outcome := range ordered {
		mediaType := catalogTypes[index]
		if outcome.err != nil {
			result.UnavailableTypes = append(result.UnavailableTypes, mediaType)
			logProviderError(mediaType, outcome.err)
			continue
		}
		successes++
		addedForType := 0
		for _, item := range outcome.response.Results {
			key := item.Provider + "\x00" + item.ProviderID
			if seen[key] {
				continue
			}
			seen[key] = true
			result.Results = append(result.Results, item)
			addedForType++
			if addedForType == 6 {
				break
			}
		}
	}
	if successes == 0 {
		writeError(w, http.StatusBadGateway, "all metadata providers are temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, result)
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
		if err != nil && s.kitsuBase != "" {
			anilistErr := err
			response, err = s.searchKitsu(ctx, mediaType, query, page)
			if err != nil {
				err = fmt.Errorf("AniList failed: %v; Kitsu failed: %w", anilistErr, err)
			}
		}
	case "book":
		response, err = s.searchBooks(ctx, query, page)
	case "movie", "series":
		response, err = s.searchTMDB(ctx, mediaType, query, page)
	case "game":
		response, err = s.searchRAWG(ctx, query, page)
	default:
		return discoveryResponse{}, fmt.Errorf("unsupported discovery media type %q", mediaType)
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
      id siteUrl format status description(asHtml: false) episodes chapters duration genres averageScore
      title { romaji english native }
      coverImage { extraLarge }
      startDate { year month day }
      endDate { year month day }
      studios(isMain: true) { nodes { name } }
      staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
    }
  }
}`
	const lightNovelGraphQL = `query ($search: String!, $page: Int!, $type: MediaType!) {
  Page(page: $page, perPage: 20) {
    pageInfo { hasNextPage }
    media(search: $search, type: $type, format: NOVEL, isAdult: false) {
      id siteUrl format status description(asHtml: false) episodes chapters duration genres averageScore
      title { romaji english native }
      coverImage { extraLarge }
      startDate { year month day }
      endDate { year month day }
      studios(isMain: true) { nodes { name } }
      staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
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
		results = append(results, anilistDiscoveryResult(item, resultType))
	}
	return discoveryResponse{Results: results, Page: page, HasMore: payload.Data.Page.PageInfo.HasNext}, nil
}

func anilistDiscoveryResult(item anilistMedia, mediaType string) discoveryResult {
	total := item.Episodes
	if mediaType != "anime" {
		total = item.Chapters
	}
	credits := make([]mediaCredit, 0, len(item.Studios.Nodes)+len(item.Staff.Edges))
	for _, studio := range item.Studios.Nodes {
		credits = append(credits, mediaCredit{Name: studio.Name, Role: "Studio"})
	}
	for _, staff := range item.Staff.Edges {
		credits = append(credits, mediaCredit{Name: staff.Node.Name.Full, Role: staff.Role})
	}
	return discoveryResult{
		Provider: "anilist", ProviderID: strconv.Itoa(item.ID), ProviderURL: item.SiteURL,
		Type: mediaType, Title: preferredAniListTitle(item), OriginalTitle: item.Title.Native,
		Description: cleanDescription(item.Description), CoverURL: item.CoverImage.ExtraLarge,
		ReleaseYear: item.StartDate.Year, Format: strings.TrimSpace(item.Format), Total: total,
		Subtitle: firstName(item.Studios.Nodes), Genres: normalizedMetadataStrings(item.Genres),
		Credits:       normalizedMediaCredits(credits),
		ReleaseStatus: normalizedReleaseStatus(item.Status), StartDate: formatProviderDate(item.StartDate),
		EndDate: formatProviderDate(item.EndDate), DurationMinutes: item.Duration, CatalogTotal: total,
		CommunityRating: float64(item.AverageScore) / 10,
	}
}

func formatProviderDate(value providerDate) string {
	if value.Year <= 0 {
		return ""
	}
	if value.Month <= 0 {
		return fmt.Sprintf("%04d", value.Year)
	}
	if value.Day <= 0 {
		return fmt.Sprintf("%04d-%02d", value.Year, value.Month)
	}
	return fmt.Sprintf("%04d-%02d-%02d", value.Year, value.Month, value.Day)
}

func normalizedReleaseStatus(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "ANNOUNCED":
		return "announced"
	case "NOT_YET_RELEASED", "UPCOMING", "UNRELEASED", "TBA":
		return "upcoming"
	case "RELEASING", "CURRENT":
		return "releasing"
	case "FINISHED":
		return "finished"
	case "CANCELLED":
		return "cancelled"
	case "HIATUS":
		return "hiatus"
	default:
		return ""
	}
}

func normalizedBookSubjects(subjects []string) []string {
	filtered := make([]string, 0, len(subjects))
	for _, subject := range subjects {
		trimmed := strings.TrimSpace(subject)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "nyt:") || strings.HasPrefix(lower, "award:") || strings.HasSuffix(lower, " reviewed") {
			continue
		}
		filtered = append(filtered, trimmed)
	}
	return normalizedMetadataStrings(filtered)
}

func (s *discoveryService) searchBooks(ctx context.Context, query string, page int) (discoveryResponse, error) {
	values := url.Values{"q": {query}, "page": {strconv.Itoa(page)}, "limit": {strconv.Itoa(discoveryPageSize)}, "fields": {"key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject"}}
	var payload struct {
		NumFound int `json:"numFound"`
		Docs     []struct {
			Key       string   `json:"key"`
			Title     string   `json:"title"`
			Authors   []string `json:"author_name"`
			Year      int      `json:"first_publish_year"`
			CoverID   int      `json:"cover_i"`
			PageCount int      `json:"number_of_pages_median"`
			Subjects  []string `json:"subject"`
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
		credits := make([]mediaCredit, 0, len(item.Authors))
		for _, author := range item.Authors {
			credits = append(credits, mediaCredit{Name: author, Role: "Author"})
		}
		results = append(results, discoveryResult{
			Provider: "open_library", ProviderID: id, ProviderURL: "https://openlibrary.org" + item.Key,
			Type: "book", Title: item.Title, ReleaseYear: item.Year, StartDate: formatProviderDate(providerDate{Year: item.Year}),
			CoverURL: cover, Total: item.PageCount, CatalogTotal: item.PageCount, Subtitle: strings.Join(item.Authors, ", "),
			Genres: normalizedBookSubjects(item.Subjects), Credits: normalizedMediaCredits(credits),
		})
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
			GenreIDs     []int   `json:"genre_ids"`
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
		results = append(results, discoveryResult{
			Provider: "tmdb", ProviderID: strconv.Itoa(item.ID), ProviderURL: fmt.Sprintf("https://www.themoviedb.org/%s/%d", resource, item.ID),
			Type: mediaType, Title: title, OriginalTitle: original, Description: item.Overview, CoverURL: cover,
			ReleaseYear: yearFromDate(date), StartDate: date, Genres: tmdbGenres(mediaType, item.GenreIDs), CommunityRating: item.Rating,
		})
	}
	return discoveryResponse{Results: results, Page: page, HasMore: page < payload.TotalPages}, nil
}

func tmdbGenres(mediaType string, ids []int) []string {
	movieGenres := map[int]string{
		28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
		99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
		27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
		10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
	}
	seriesGenres := map[int]string{
		10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
		99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery",
		10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
		10767: "Talk", 10768: "War & Politics", 37: "Western",
	}
	lookup := movieGenres
	if mediaType == "series" {
		lookup = seriesGenres
	}
	genres := make([]string, 0, len(ids))
	for _, id := range ids {
		if name := lookup[id]; name != "" {
			genres = append(genres, name)
		}
	}
	return normalizedMetadataStrings(genres)
}

func (s *discoveryService) getJSON(ctx context.Context, endpoint, token string, target any) error {
	return s.getJSONRequest(ctx, endpoint, token, "application/json", target)
}

func (s *discoveryService) getJSONAccept(ctx context.Context, endpoint, accept string, target any) error {
	return s.getJSONRequest(ctx, endpoint, "", accept, target)
}

func (s *discoveryService) getJSONRequest(ctx context.Context, endpoint, token, accept string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	userAgent := "Honne/0.1"
	if s.contactEmail != "" {
		userAgent += " (" + s.contactEmail + ")"
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
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
	slog.Error("discovery_provider_failed", "media_type", mediaType, "error", err)
}
