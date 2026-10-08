package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCheckpointAndValidation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "checkpoint.json")
	books := []Book{{Title: " Book ", Price: " £1 ", Availability: " In stock "}}
	if err := validateBooks(books); err != nil {
		t.Fatal(err)
	}
	state := Checkpoint{Version: 1, Source: "https://catalog.test/", Pages: []SavedPage{{URL: "https://catalog.test/1", Books: books}}}
	if err := atomicJSON(path, state); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var saved Checkpoint
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Pages[0].Books[0].Title != "Book" || saved.Complete {
		t.Fatalf("invalid recovery state: %+v", saved)
	}
	saved.Complete = true
	if err := atomicJSON(path, saved); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temporary file survived atomic replacement")
	}
	if validateBooks(nil) == nil || validateBooks([]Book{{Title: " ", Price: "1", Availability: "yes"}}) == nil {
		t.Fatal("invalid records accepted")
	}
}
