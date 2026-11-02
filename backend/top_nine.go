package main

import (
	"errors"
	"net/http"
)

func (a *app) listTopNine(w http.ResponseWriter, _ *http.Request) {
	a.store.mu.RLock()
	ids := append([]int{}, a.store.topNineMediaIDs...)
	a.store.mu.RUnlock()
	writeJSON(w, http.StatusOK, favoritesResponse{MediaIDs: ids})
}

func (a *app) replaceTopNine(w http.ResponseWriter, r *http.Request) {
	ids, ok := decodeSelectionInput(w, r, 16<<10)
	if !ok {
		return
	}
	if err := a.store.replaceTopNine(ids); err != nil {
		if errors.Is(err, errInvalidTopNine) {
			writeError(w, http.StatusUnprocessableEntity, err.Error())
		} else {
			writeError(w, http.StatusInternalServerError, "could not save 3×3 selection")
		}
		return
	}
	writeJSON(w, http.StatusOK, favoritesResponse{MediaIDs: ids})
}
