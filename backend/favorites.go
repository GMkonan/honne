package main

import (
	"errors"
	"fmt"
	"slices"
)

const maxTopNinePerType = 9

var errInvalidFavorites = errors.New("invalid favorites")
var errInvalidTopNine = errors.New("invalid 3×3 selection")

func validateFavorites(ids []int, items []Media) error {
	byID := make(map[int]bool, len(items))
	for _, item := range items {
		byID[item.ID] = true
	}
	seen := make(map[int]bool, len(ids))
	for _, id := range ids {
		if id < 1 || !byID[id] || seen[id] {
			return fmt.Errorf("%w: favorites must contain unique titles from the current Library", errInvalidFavorites)
		}
		seen[id] = true
	}
	return nil
}

func validateTopNine(ids, favorites []int, items []Media) error {
	if len(ids) > maxTopNinePerType*len(validTypes) {
		return fmt.Errorf("%w: choose up to nine favorites per media type", errInvalidTopNine)
	}
	byID := make(map[int]string, len(items))
	for _, item := range items {
		byID[item.ID] = item.Type
	}
	allowed := make(map[int]bool, len(favorites))
	for _, id := range favorites {
		allowed[id] = true
	}
	seen := make(map[int]bool, len(ids))
	counts := make(map[string]int)
	for _, id := range ids {
		mediaType, exists := byID[id]
		if id < 1 || !exists || !allowed[id] || seen[id] {
			return fmt.Errorf("%w: choose unique titles from your current favorites", errInvalidTopNine)
		}
		seen[id] = true
		counts[mediaType]++
		if counts[mediaType] > maxTopNinePerType {
			return fmt.Errorf("%w: choose up to nine favorites per media type", errInvalidTopNine)
		}
	}
	return nil
}

func (s *store) replaceFavorites(ids []int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validateFavorites(ids, s.items); err != nil {
		return err
	}
	previous := slices.Clone(s.favoriteMediaIDs)
	previousTopNine := slices.Clone(s.topNineMediaIDs)
	s.favoriteMediaIDs = slices.Clone(ids)
	s.topNineMediaIDs = slices.DeleteFunc(s.topNineMediaIDs, func(id int) bool { return !slices.Contains(ids, id) })
	if err := s.persistLocked(); err != nil {
		s.favoriteMediaIDs = previous
		s.topNineMediaIDs = previousTopNine
		return fmt.Errorf("persist favorites: %w", err)
	}
	return nil
}

func (s *store) replaceTopNine(ids []int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validateTopNine(ids, s.favoriteMediaIDs, s.items); err != nil {
		return err
	}
	previous := slices.Clone(s.topNineMediaIDs)
	s.topNineMediaIDs = slices.Clone(ids)
	if err := s.persistLocked(); err != nil {
		s.topNineMediaIDs = previous
		return fmt.Errorf("persist 3×3 selection: %w", err)
	}
	return nil
}
