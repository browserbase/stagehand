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
	fetchResult, err := stagehand.FetchBrowserbase(ctx, stagehand.BrowserbaseFetchOptions{
		APIKey: apiKey,
		URL:    "https://example.com",
		Format: stagehand.BrowserbaseFetchFormatMarkdown,
	})
	if err != nil {
		return err
	}
	content, ok := fetchResult.Content.AsString()
	if !ok {
		return errors.New("fetch returned non-string content")
	}
	fmt.Println(content)
	return nil
}
