package main

import (
	"errors"
	"fmt"
	"slices"
)

const (
	maxFavoritesPerType = 9
	maxFavorites        = maxFavoritesPerType * 7
)

var errInvalidFavorites = errors.New("invalid favorites")

func validateFavorites(ids []int, items []Media) error {
	if len(ids) > maxFavorites {
		return fmt.Errorf("%w: favorites cannot contain more than 63 titles", errInvalidFavorites)
	}
	byID := make(map[int]Media, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	seen := make(map[int]bool, len(ids))
	counts := make(map[string]int)
	for _, id := range ids {
		item, exists := byID[id]
		if id < 1 || !exists || seen[id] {
			return fmt.Errorf("%w: favorites must contain unique titles from the current Library", errInvalidFavorites)
		}
		seen[id] = true
		counts[item.Type]++
		if counts[item.Type] > maxFavoritesPerType {
			return fmt.Errorf("%w: favorites cannot contain more than 9 titles per media type", errInvalidFavorites)
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
	s.favoriteMediaIDs = slices.Clone(ids)
	if err := s.persistLocked(); err != nil {
		s.favoriteMediaIDs = previous
		return fmt.Errorf("persist favorites: %w", err)
	}
	return nil
}
