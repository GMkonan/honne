package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
)

const (
	maxBannerBytes = 8 << 20
	maxAvatarBytes = 4 << 20
)

var allowedImageTypes = []string{"image/jpeg", "image/png", "image/webp", "image/gif"}

type favoritesInput struct {
	MediaIDs []int `json:"mediaIds"`
}

type favoritesResponse struct {
	MediaIDs []int `json:"mediaIds"`
}

func imageRevision(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:8])
}

func (s *store) bannerRevision() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return imageRevision(s.appearance.BannerData)
}

func (s *store) avatarRevision() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return imageRevision(s.appearance.AvatarData)
}

func (a *app) getLibraryBanner(w http.ResponseWriter, _ *http.Request) {
	a.store.mu.RLock()
	contentType := a.store.appearance.BannerContentType
	data := slices.Clone(a.store.appearance.BannerData)
	a.store.mu.RUnlock()
	if len(data) == 0 {
		writeError(w, http.StatusNotFound, "custom banner not found")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (a *app) updateLibraryBanner(w http.ResponseWriter, r *http.Request) {
	contentType, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
	contentType = strings.TrimSpace(contentType)
	if !slices.Contains(allowedImageTypes, contentType) {
		writeError(w, http.StatusUnsupportedMediaType, "banner must be a JPEG, PNG, WebP, or GIF image")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBannerBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxBannerBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "banner must be no larger than 8 MiB")
		return
	}
	detectedType := http.DetectContentType(data)
	if detectedType != contentType || !slices.Contains(allowedImageTypes, detectedType) {
		writeError(w, http.StatusUnprocessableEntity, "banner contents do not match the selected image type")
		return
	}

	a.store.mu.Lock()
	previous := a.store.cloneSnapshotLocked()
	a.store.appearance = libraryAppearance{BannerContentType: contentType, BannerData: slices.Clone(data)}
	err = a.store.persistLocked()
	if err != nil {
		a.store.restoreSnapshotLocked(previous)
	}
	a.store.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save custom banner")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"revision": a.store.bannerRevision()})
}

func (a *app) resetLibraryBanner(w http.ResponseWriter, _ *http.Request) {
	a.store.mu.Lock()
	if len(a.store.appearance.BannerData) == 0 {
		a.store.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	previous := a.store.cloneSnapshotLocked()
	a.store.appearance.BannerContentType = ""
	a.store.appearance.BannerData = nil
	err := a.store.persistLocked()
	if err != nil {
		a.store.restoreSnapshotLocked(previous)
	}
	a.store.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not reset custom banner")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) getProfileAvatar(w http.ResponseWriter, _ *http.Request) {
	a.store.mu.RLock()
	contentType := a.store.appearance.AvatarContentType
	data := slices.Clone(a.store.appearance.AvatarData)
	a.store.mu.RUnlock()
	if len(data) == 0 {
		writeError(w, http.StatusNotFound, "custom profile picture not found")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (a *app) updateProfileAvatar(w http.ResponseWriter, r *http.Request) {
	contentType, _, _ := strings.Cut(r.Header.Get("Content-Type"), ";")
	contentType = strings.TrimSpace(contentType)
	if !slices.Contains(allowedImageTypes, contentType) {
		writeError(w, http.StatusUnsupportedMediaType, "profile picture must be a JPEG, PNG, WebP, or GIF image")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxAvatarBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxAvatarBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "profile picture must be no larger than 4 MiB")
		return
	}
	detectedType := http.DetectContentType(data)
	if detectedType != contentType || !slices.Contains(allowedImageTypes, detectedType) {
		writeError(w, http.StatusUnprocessableEntity, "profile picture contents do not match the selected image type")
		return
	}

	a.store.mu.Lock()
	previous := a.store.cloneSnapshotLocked()
	a.store.appearance.AvatarContentType = contentType
	a.store.appearance.AvatarData = slices.Clone(data)
	err = a.store.persistLocked()
	if err != nil {
		a.store.restoreSnapshotLocked(previous)
	}
	a.store.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save custom profile picture")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"revision": a.store.avatarRevision()})
}

func (a *app) resetProfileAvatar(w http.ResponseWriter, _ *http.Request) {
	a.store.mu.Lock()
	if len(a.store.appearance.AvatarData) == 0 {
		a.store.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		return
	}
	previous := a.store.cloneSnapshotLocked()
	a.store.appearance.AvatarContentType = ""
	a.store.appearance.AvatarData = nil
	err := a.store.persistLocked()
	if err != nil {
		a.store.restoreSnapshotLocked(previous)
	}
	a.store.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not reset custom profile picture")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) listFavorites(w http.ResponseWriter, _ *http.Request) {
	a.store.mu.RLock()
	ids := slices.Clone(a.store.favoriteMediaIDs)
	a.store.mu.RUnlock()
	writeJSON(w, http.StatusOK, favoritesResponse{MediaIDs: ids})
}

func (a *app) replaceFavorites(w http.ResponseWriter, r *http.Request) {
	var input favoritesInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.MediaIDs == nil {
		input.MediaIDs = []int{}
	}
	if err := a.store.replaceFavorites(input.MediaIDs); err != nil {
		if errors.Is(err, errInvalidFavorites) {
			writeError(w, http.StatusUnprocessableEntity, err.Error())
		} else {
			writeError(w, http.StatusInternalServerError, "could not save favorites")
		}
		return
	}
	writeJSON(w, http.StatusOK, favoritesResponse{MediaIDs: input.MediaIDs})
}
