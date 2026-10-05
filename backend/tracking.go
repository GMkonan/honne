package main

import (
	"errors"
	"slices"
)

const (
	maxRepeatCount            = 1_000
	maxPlaytimeMinutes        = 10_000_000
	maxPersonalPlatforms      = 12
	maxPersonalPlatformLength = 50
)

func validateTrackingForCreate(input mediaInput) error {
	if !supportsNumericProgress(input.Type) && (input.Progress != 0 || input.Total != 0) {
		return errors.New("this media type does not support numeric progress")
	}
	if input.Type != "game" && hasChangedGameTracking(Media{}, input) {
		return errors.New("only games support playtime and played-on platforms")
	}
	return nil
}

func validateTrackingForUpdate(existing Media, input mediaInput) error {
	if !supportsNumericProgress(input.Type) && (input.Progress != 0 || input.Total != 0) &&
		(input.Progress != existing.Progress || input.Total != existing.Total) {
		return errors.New("this media type does not support numeric progress")
	}
	if input.Type != "game" && hasChangedGameTracking(existing, input) {
		return errors.New("only games support playtime and played-on platforms")
	}
	plannedRepeat := existing.PlannedRepeat
	if input.PlannedRepeat != nil {
		plannedRepeat = *input.PlannedRepeat
	}
	if plannedRepeat && input.Status != "completed" {
		return errors.New("only completed media can be planned for a repeat")
	}
	return nil
}

func supportsNumericProgress(mediaType string) bool {
	return mediaType != "movie" && mediaType != "game"
}

func hasChangedGameTracking(existing Media, input mediaInput) bool {
	if input.PlaytimeMinutes != nil && *input.PlaytimeMinutes != existing.PlaytimeMinutes {
		return true
	}
	return input.PlayedOnPlatforms != nil &&
		!slices.Equal(normalizedPersonalPlatforms(*input.PlayedOnPlatforms), existing.PlayedOnPlatforms)
}

func repeatCountValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func plannedRepeatValue(value *bool) bool {
	return value != nil && *value
}

func playtimeMinutesValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func personalPlatformsValue(value *[]string) []string {
	if value == nil {
		return []string{}
	}
	return normalizedPersonalPlatforms(*value)
}
