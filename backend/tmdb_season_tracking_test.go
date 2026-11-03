package main

import (
	"encoding/json"
	"testing"
)

func TestTMDBSeasonCompletionRequiresConfirmedAiredEpisodes(t *testing.T) {
	for _, test := range []struct {
		name string
		last string
		next string
		want []bool
	}{
		{"ongoing second season", `{"season_number":2,"episode_number":5,"air_date":"2026-10-01"}`, `null`, []bool{true, false, false}},
		{"finished second season", `{"season_number":2,"episode_number":13,"air_date":"2026-10-01"}`, `null`, []bool{true, true, false}},
		{"next season scheduled", `{"season_number":2,"episode_number":13,"air_date":"2026-10-01"}`, `{"season_number":3,"episode_number":1}`, []bool{true, true, false}},
		{"same season still scheduled", `{"season_number":2,"episode_number":13,"air_date":"2026-10-01"}`, `{"season_number":2,"episode_number":14}`, []bool{true, false, false}},
		{"unknown last aired episode", `null`, `null`, []bool{false, false, false}},
		{"future last aired episode", `{"season_number":2,"episode_number":13,"air_date":"2026-12-01"}`, `null`, []bool{false, false, false}},
		{"partial air date", `{"season_number":2,"episode_number":13,"air_date":"2026-10"}`, `null`, []bool{false, false, false}},
		{"invalid episode", `{"season_number":2,"episode_number":0,"air_date":"2026-10-01"}`, `null`, []bool{false, false, false}},
	} {
		t.Run(test.name, func(t *testing.T) {
			var payload tmdbDetailPayload
			if err := json.Unmarshal([]byte(`{"last_episode_to_air":`+test.last+`,"next_episode_to_air":`+test.next+`}`), &payload); err != nil {
				t.Fatal(err)
			}
			for i, count := range []int{12, 13, 16} {
				if got := tmdbSeasonCompleted(payload, i+1, count, "2026-11-03"); got != test.want[i] {
					t.Fatalf("season %d: got completed=%v, want %v", i+1, got, test.want[i])
				}
			}
			for _, count := range []int{-1, 0, 10_001} {
				if tmdbSeasonCompleted(payload, 1, count, "2026-11-03") {
					t.Fatal("invalid count was marked completed")
				}
			}
			if tmdbSeasonCompleted(payload, 0, 5, "2026-11-03") {
				t.Fatal("specials were marked completed")
			}
		})
	}
}
