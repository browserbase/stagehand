package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

type Book struct {
	Title        string `json:"title"`
	Price        string `json:"price"`
	Availability string `json:"availability"`
}
type CatalogPage struct {
	Books []Book `json:"books"`
}
type Catalog struct {
	Pages int    `json:"pages"`
	Count int    `json:"count"`
	Books []Book `json:"books"`
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
	provider := os.Getenv("MODEL_PROVIDER")
	if provider != "" && provider != "gateway" {
		return errors.New("MODEL_PROVIDER must be gateway or unset")
	}
	openaiKey := os.Getenv("OPENAI_API_KEY")
	if provider != "gateway" && openaiKey == "" {
		return errors.New("OPENAI_API_KEY is required unless MODEL_PROVIDER=gateway")
	}
	maxPages, err := strconv.Atoi(envDefault("MAX_PAGES", "50"))
	if err != nil || maxPages < 1 {
		return errors.New("MAX_PAGES must be a positive integer")
	}
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()
	opts := stagehand.CreateOptions{Browser: browser}
	if provider != "gateway" {
		opts.Model = &stagehand.ModelConfig{ModelName: "openai/gpt-5.4-mini", APIKey: &openaiKey}
	}
	client, err := stagehand.Create(ctx, opts)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()
	bc, err := browser.Context()
	if err != nil {
		return err
	}
	page, err := bc.ActivePage(ctx)
	if err != nil {
		return err
	}
	if page == nil {
		return errors.New("no active page")
	}
	if _, err = page.Goto(ctx, envDefault("CATALOG_URL", "https://books.toscrape.com/"), nil); err != nil {
		return err
	}
	visited := map[string]bool{}
	books := []Book{}
	for index := 0; index < maxPages; index++ {
		url, urlErr := page.URL(ctx)
		if urlErr != nil {
			return urlErr
		}
		if visited[url] {
			return fmt.Errorf("pagination cycle at %s", url)
		}
		visited[url] = true
		result, extractErr := stagehand.Extract[CatalogPage](ctx, client,
			"Extract every book in the product grid, including title, displayed price, and availability.",
			&stagehand.StagehandClientExtractOptions{Page: page})
		if extractErr != nil {
			return extractErr
		}
		if len(result.Data.Books) == 0 {
			return errors.New("extract returned no books")
		}
		for _, book := range result.Data.Books {
			if strings.TrimSpace(book.Title) == "" || strings.TrimSpace(book.Price) == "" || strings.TrimSpace(book.Availability) == "" {
				return errors.New("extract returned an incomplete book")
			}
		}
		books = append(books, result.Data.Books...)
		instruction := "Find the enabled Next pagination link. Return no actions if there is no next page."
		observed, observeErr := client.Observe(ctx, &instruction, &stagehand.StagehandClientObserveOptions{Page: page})
		if observeErr != nil {
			return observeErr
		}
		if len(observed.Data) == 0 {
			output, marshalErr := json.MarshalIndent(Catalog{Pages: len(visited), Count: len(books), Books: books}, "", "  ")
			if marshalErr != nil {
				return marshalErr
			}
			if mkdirErr := os.MkdirAll("out", 0755); mkdirErr != nil {
				return mkdirErr
			}
			target := filepath.Join("out", "catalog.json")
			if writeErr := os.WriteFile(target, append(output, '\n'), 0644); writeErr != nil {
				return writeErr
			}
			fmt.Printf("Saved %d books from %d pages to %s\n", len(books), len(visited), target)
			return nil
		}
		if index+1 == maxPages {
			return fmt.Errorf("MAX_PAGES=%d reached before the final page", maxPages)
		}
		acted, actErr := client.Act(ctx, stagehand.ObservedAction(observed.Data[0]), &stagehand.StagehandClientActOptions{Page: page})
		if actErr != nil {
			return actErr
		}
		if !acted.Data.Success {
			return fmt.Errorf("next-page act failed: %s", acted.Data.Message)
		}
		if waitErr := page.WaitForLoadState(ctx, stagehand.LoadStateDOMContentLoaded, nil); waitErr != nil {
			return waitErr
		}
		nextURL, urlErr := page.URL(ctx)
		if urlErr != nil {
			return urlErr
		}
		if nextURL == url {
			return fmt.Errorf("next-page action did not navigate from %s", url)
		}
	}
	return errors.New("catalog ended without a final page")
}
func envDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
