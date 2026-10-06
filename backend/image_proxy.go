package main

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxProxiedImageBytes = 5 << 20

var allowedImageHosts = map[string]struct{}{
	"covers.openlibrary.org": {},
	"image.tmdb.org":         {},
	"img.anili.st":           {},
	"media.kitsu.app":        {},
	"media.rawg.io":          {},
	"s1.anilist.co":          {},
	"s2.anilist.co":          {},
	"s3.anilist.co":          {},
	"s4.anilist.co":          {},
}

func validProxiedImageURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" {
		return nil, fmt.Errorf("invalid image URL")
	}
	if _, allowed := allowedImageHosts[strings.ToLower(parsed.Hostname())]; !allowed {
		return nil, fmt.Errorf("image host is not allowed")
	}
	return parsed, nil
}

func newImageProxyClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(request *http.Request, _ []*http.Request) error {
			_, err := validProxiedImageURL(request.URL.String())
			return err
		},
	}
}

func (a *app) proxyImage(w http.ResponseWriter, r *http.Request) {
	imageURL, err := validProxiedImageURL(r.URL.Query().Get("url"))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, imageURL.String(), nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid image URL")
		return
	}
	request.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif")
	request.Header.Set("User-Agent", "Honne image export")
	client := a.imageClient
	if client == nil {
		client = newImageProxyClient()
	}
	response, err := client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not load cover image")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		writeError(w, http.StatusBadGateway, "cover image provider returned an error")
		return
	}
	if response.ContentLength > maxProxiedImageBytes {
		writeError(w, http.StatusBadGateway, "cover image is too large")
		return
	}
	contentType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || !allowedImageType(contentType) {
		writeError(w, http.StatusBadGateway, "cover response is not a supported image")
		return
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxProxiedImageBytes+1))
	if err != nil || len(data) > maxProxiedImageBytes {
		writeError(w, http.StatusBadGateway, "could not load cover image")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func allowedImageType(contentType string) bool {
	switch contentType {
	case "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}
