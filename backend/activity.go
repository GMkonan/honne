package main

import (
	"net/http"
	"slices"
	"strconv"
	"time"
)

const maxStoredActivities = 500

type ActivityChanges struct {
	FromStatus      string `json:"fromStatus,omitempty"`
	ToStatus        string `json:"toStatus,omitempty"`
	FromProgress    *int   `json:"fromProgress,omitempty"`
	ToProgress      *int   `json:"toProgress,omitempty"`
	FromRating      *int   `json:"fromRating,omitempty"`
	ToRating        *int   `json:"toRating,omitempty"`
	FromRepeatCount *int   `json:"fromRepeatCount,omitempty"`
	ToRepeatCount   *int   `json:"toRepeatCount,omitempty"`
}

type Activity struct {
	ID         int64           `json:"id"`
	MediaID    int             `json:"mediaId,omitempty"`
	Title      string          `json:"title"`
	MediaType  string          `json:"mediaType"`
	Action     string          `json:"action"`
	Changes    ActivityChanges `json:"changes"`
	OccurredAt time.Time       `json:"occurredAt"`
}

func (s *store) appendActivityLocked(activity Activity) {
	activity.ID = s.nextActivityID
	s.nextActivityID++
	if activity.OccurredAt.IsZero() {
		activity.OccurredAt = time.Now().UTC()
	}
	s.activities = append(s.activities, activity)
	if overflow := len(s.activities) - maxStoredActivities; overflow > 0 {
		s.activities = slices.Delete(s.activities, 0, overflow)
	}
}

func activityForNewMedia(item Media, action string) Activity {
	return Activity{
		MediaID:    item.ID,
		Title:      item.Title,
		MediaType:  item.Type,
		Action:     action,
		Changes:    ActivityChanges{ToStatus: item.Status},
		OccurredAt: item.UpdatedAt,
	}
}

func activityForUpdatedMedia(before, after Media) Activity {
	changes := ActivityChanges{}
	if before.Status != after.Status {
		changes.FromStatus = before.Status
		changes.ToStatus = after.Status
	}
	if before.Progress != after.Progress {
		from, to := before.Progress, after.Progress
		changes.FromProgress = &from
		changes.ToProgress = &to
	}
	if before.Rating != after.Rating {
		from, to := before.Rating, after.Rating
		changes.FromRating = &from
		changes.ToRating = &to
	}
	if before.RepeatCount != after.RepeatCount {
		from, to := before.RepeatCount, after.RepeatCount
		changes.FromRepeatCount = &from
		changes.ToRepeatCount = &to
	}
	return Activity{
		MediaID:    after.ID,
		Title:      after.Title,
		MediaType:  after.Type,
		Action:     "updated",
		Changes:    changes,
		OccurredAt: after.UpdatedAt,
	}
}

func (a *app) listActivity(w http.ResponseWriter, r *http.Request) {
	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		if parsed > 100 {
			parsed = 100
		}
		limit = parsed
	}

	a.store.mu.RLock()
	activities := slices.Clone(a.store.activities)
	a.store.mu.RUnlock()
	if len(activities) > limit {
		activities = activities[len(activities)-limit:]
	}
	slices.Reverse(activities)
	writeJSON(w, http.StatusOK, activities)
}
