package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) error {
	apiKey := os.Getenv("BROWSERBASE_API_KEY")
	if apiKey == "" {
		return errors.New("BROWSERBASE_API_KEY is required")
	}
	numResults := 5
	searchResult, err := stagehand.SearchBrowserbase(ctx, stagehand.BrowserbaseSearchOptions{
		APIKey:     apiKey,
		Query:      "browser agent frameworks",
		NumResults: &numResults,
	})
	if err != nil {
		return err
	}
	for _, result := range searchResult.Results {
		fmt.Printf("%s: %s\n", result.Title, result.URL)
	}
	return nil
}
