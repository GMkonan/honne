package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
)

type config struct {
	Port          string
	DataPath      string
	AllowedOrigin string
	AppUsername   string
	AppPassword   string

	AniListAPIURL     string
	OpenLibraryAPIURL string
	TMDBAPIURL        string
	TMDBAPIToken      string
	AppContactEmail   string

	AniListClientID      string
	AniListClientSecret  string
	AniListRedirectURL   string
	AniListAuthPath      string
	AniListAuthorizeURL  string
	AniListTokenURL      string
	AniListDeleteEnabled bool
}

func loadConfig() (config, error) {
	deleteEnabled, err := envBool("ANILIST_DELETE_ON_LOCAL_DELETE", true)
	if err != nil {
		return config{}, err
	}

	dataPath := envOr("DATA_PATH", "data/media.json")
	cfg := config{
		Port:                 envOr("PORT", "8080"),
		DataPath:             dataPath,
		AllowedOrigin:        envOr("APP_ORIGIN", "http://localhost:5173"),
		AppUsername:          os.Getenv("APP_USERNAME"),
		AppPassword:          os.Getenv("APP_PASSWORD"),
		AniListAPIURL:        envOr("ANILIST_API_URL", "https://graphql.anilist.co"),
		OpenLibraryAPIURL:    envOr("OPEN_LIBRARY_API_URL", "https://openlibrary.org"),
		TMDBAPIURL:           envOr("TMDB_API_URL", "https://api.themoviedb.org/3"),
		TMDBAPIToken:         os.Getenv("TMDB_API_TOKEN"),
		AppContactEmail:      os.Getenv("APP_CONTACT_EMAIL"),
		AniListClientID:      os.Getenv("ANILIST_CLIENT_ID"),
		AniListClientSecret:  os.Getenv("ANILIST_CLIENT_SECRET"),
		AniListRedirectURL:   os.Getenv("ANILIST_REDIRECT_URL"),
		AniListAuthPath:      envOr("ANILIST_AUTH_PATH", filepath.Join(filepath.Dir(dataPath), "anilist-auth.json")),
		AniListAuthorizeURL:  envOr("ANILIST_AUTHORIZE_URL", "https://anilist.co/api/v2/oauth/authorize"),
		AniListTokenURL:      envOr("ANILIST_TOKEN_URL", "https://anilist.co/api/v2/oauth/token"),
		AniListDeleteEnabled: deleteEnabled,
	}

	if (cfg.AppUsername == "") != (cfg.AppPassword == "") {
		return config{}, errors.New("APP_USERNAME and APP_PASSWORD must be supplied together")
	}
	oauthValues := []string{cfg.AniListClientID, cfg.AniListClientSecret, cfg.AniListRedirectURL}
	configured := 0
	for _, value := range oauthValues {
		if value != "" {
			configured++
		}
	}
	if configured != 0 && configured != len(oauthValues) {
		return config{}, errors.New("ANILIST_CLIENT_ID, ANILIST_CLIENT_SECRET, and ANILIST_REDIRECT_URL must be supplied together")
	}
	return cfg, nil
}

func (c config) aniListConfigured() bool {
	return c.AniListClientID != "" && c.AniListClientSecret != "" && c.AniListRedirectURL != ""
}

func envBool(key string, fallback bool) (bool, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, errors.New(key + " must be true or false")
	}
	return parsed, nil
}
