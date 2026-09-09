package main

import "errors"

const maxRepeatCount = 1_000

func validateTrackingForCreate(input mediaInput) error {
	if input.Type == "movie" && (input.Progress != 0 || input.Total != 0) {
		return errors.New("movies do not support numeric progress")
	}
	return nil
}

func validateTrackingForUpdate(existing Media, input mediaInput) error {
	if input.Type != "movie" || (input.Progress == 0 && input.Total == 0) {
		return nil
	}
	if input.Progress == existing.Progress && input.Total == existing.Total {
		return nil
	}
	return errors.New("movies do not support numeric progress")
}

func repeatCountValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
