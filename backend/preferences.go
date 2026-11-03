package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

type appPreferences struct {
	StartPage string `json:"startPage"`
}

var errInvalidStartPage = errors.New("choose Overview, Library, Monthly Log, or Activity as the start page")

func defaultPreferences() appPreferences {
	return appPreferences{StartPage: "overview"}
}

func validStartPage(page string) bool {
	switch page {
	case "overview", "library", "monthly_log", "activity":
		return true
	default:
		return false
	}
}

func normalizeSnapshotPreferences(snapshot *persistedStore) error {
	if snapshot.Preferences == nil {
		preferences := defaultPreferences()
		snapshot.Preferences = &preferences
		return nil
	}
	if snapshot.Version < 11 {
		return errors.New("application preferences require backup version 11")
	}
	if !validStartPage(snapshot.Preferences.StartPage) {
		return errors.New("invalid start page")
	}
	return nil
}

func preferencesFromSnapshot(snapshot persistedStore) appPreferences {
	if snapshot.Preferences == nil {
		return defaultPreferences()
	}
	return *snapshot.Preferences
}

func (s *store) getPreferences() appPreferences {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.preferences.StartPage == "" {
		return defaultPreferences()
	}
	return s.preferences
}

func (s *store) replacePreferences(preferences appPreferences) error {
	if !validStartPage(preferences.StartPage) {
		return errInvalidStartPage
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.preferences
	s.preferences = preferences
	if err := s.persistLocked(); err != nil {
		s.preferences = previous
		return fmt.Errorf("persist application preferences: %w", err)
	}
	return nil
}

func (a *app) getPreferences(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.store.getPreferences())
}

func (a *app) updatePreferences(w http.ResponseWriter, r *http.Request) {
	var input appPreferences
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
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
	if err := a.store.replacePreferences(input); err != nil {
		if errors.Is(err, errInvalidStartPage) {
			writeError(w, http.StatusUnprocessableEntity, err.Error())
		} else {
			writeError(w, http.StatusInternalServerError, "could not save application preferences")
		}
		return
	}
	writeJSON(w, http.StatusOK, input)
}
