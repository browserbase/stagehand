package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go"
)

type company struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type companies struct {
	Companies []company `json:"companies"`
}

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	apiKey := os.Getenv("BROWSERBASE_API_KEY")
	if apiKey == "" {
		return errors.New("BROWSERBASE_API_KEY is required")
	}
	model, err := modelFromEnvironment()
	if err != nil {
		return err
	}
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser, Model: &model})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()

	browserContext, err := browser.Context()
	if err != nil {
		return err
	}
	pages, err := browserContext.Pages(ctx)
	if err != nil {
		return err
	}
	if len(pages) == 0 {
		return errors.New("Stagehand initialized without an active page")
	}
	page := pages[0]
	if _, err := page.Goto(ctx, "https://aigrant.com", nil); err != nil {
		return err
	}

	cache := stagehand.CacheWithThreshold(1)
	extractOptions := &stagehand.StagehandClientExtractOptions{
		Page:  page,
		Cache: &cache,
	}
	extractCompanies := func() (companies, time.Duration, error) {
		start := time.Now()
		extractResult, extractErr := stagehand.Extract[companies](
			ctx,
			client,
			"Extract the names and descriptions of the first five companies listed on the page",
			extractOptions,
		)
		if extractErr != nil {
			return companies{}, time.Since(start), extractErr
		}
		return extractResult.Data, time.Since(start), nil
	}

	first, firstDuration, err := extractCompanies()
	if err != nil {
		return err
	}
	fmt.Printf("First extraction (expected cache miss, %dms):\n", firstDuration.Milliseconds())
	printJSON(first)

	second, secondDuration, err := extractCompanies()
	if err != nil {
		return err
	}
	fmt.Printf("Second extraction (expected cache hit, %dms):\n", secondDuration.Milliseconds())
	printJSON(second)
	return nil
}

func modelFromEnvironment() (stagehand.ModelConfig, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return stagehand.ModelConfig{}, errors.New("OPENAI_API_KEY is required")
	}
	return stagehand.ModelConfig{
		ModelName: "openai/gpt-5.4-mini",
		APIKey:    &apiKey,
	}, nil
}

func printJSON(value any) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(data))
}
