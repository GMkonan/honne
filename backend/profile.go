package main

import (
	"net/http"
)

type publicProfile struct {
	Name       string `json:"name"`
	AvatarURL  string `json:"avatarUrl"`
	CatEnabled bool   `json:"catEnabled"`
}

func (a *app) getProfile(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, publicProfile{
		Name:       a.config.ProfileName,
		AvatarURL:  a.config.ProfileAvatarURL,
		CatEnabled: a.config.ProfileCatEnabled,
	})
}
