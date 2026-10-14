package main

import (
	"net/http"
)

type publicProfile struct {
	Name       string `json:"name"`
	AvatarURL  string `json:"avatarUrl"`
	CatEnabled bool   `json:"catEnabled"`
	BannerURL  string `json:"bannerUrl"`
}

func (a *app) getProfile(w http.ResponseWriter, _ *http.Request) {
	bannerURL := ""
	if revision := a.store.bannerRevision(); revision != "" {
		bannerURL = "/api/profile/banner?v=" + revision
	}
	avatarURL := a.config.ProfileAvatarURL
	if revision := a.store.avatarRevision(); revision != "" {
		avatarURL = "/api/profile/avatar?v=" + revision
	}
	writeJSON(w, http.StatusOK, publicProfile{
		Name:       a.config.ProfileName,
		AvatarURL:  avatarURL,
		CatEnabled: a.config.ProfileCatEnabled,
		BannerURL:  bannerURL,
	})
}
