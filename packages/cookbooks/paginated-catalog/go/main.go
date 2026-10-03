package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
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
	if provider == "" {
		if os.Getenv("OPENAI_API_KEY") != "" {
			provider = "openai"
		} else {
			provider = "gateway"
		}
	}
	if provider != "openai" && provider != "gateway" {
		return errors.New("MODEL_PROVIDER must be gateway or openai")
	}
	openaiKey := os.Getenv("OPENAI_API_KEY")
	if provider != "gateway" && openaiKey == "" {
		return errors.New("OPENAI_API_KEY is required unless MODEL_PROVIDER=gateway")
	}
	maxPages, err := strconv.Atoi(envDefault("MAX_PAGES", "2"))
	if err != nil || maxPages < 1 || maxPages > 100 {
		return errors.New("MAX_PAGES must be an integer between 1 and 100")
	}
	timeout := float64(300)
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey, Timeout: &timeout})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(context.Background())) }()
	fmt.Printf("Session: https://www.browserbase.com/sessions/%s\n", browser.SessionID())
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
	source := envDefault("CATALOG_URL", "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html")
	origin, err := url.Parse(source)
	if err != nil || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Host == "" {
		return errors.New("CATALOG_URL must use HTTP or HTTPS")
	}
	outDir := envDefault("OUT_DIR", "out")
	if err = os.MkdirAll(outDir, 0755); err != nil {
		return err
	}
	checkpointPath := filepath.Join(outDir, "checkpoint.json")
	state := Checkpoint{Version: 1, Source: source, Pages: []SavedPage{}}
	data, readErr := os.ReadFile(checkpointPath)
	if readErr == nil {
		if err = json.Unmarshal(data, &state); err != nil {
			return err
		}
		if state.Version != 1 || state.Source != source {
			return errors.New("checkpoint version or CATALOG_URL mismatch")
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return readErr
	}
	if state.Complete && len(state.Pages) == 0 {
		return errors.New("completed checkpoint has no pages")
	}
	visited := map[string]bool{}
	for _, saved := range state.Pages {
		parsed, parseErr := url.Parse(saved.URL)
		if parseErr != nil || parsed.Scheme != origin.Scheme || parsed.Host != origin.Host || visited[saved.URL] {
			return errors.New("checkpoint contains a cycle or an unapproved origin")
		}
		if err = validateBooks(saved.Books); err != nil {
			return err
		}
		visited[saved.URL] = true
	}
	if !state.Complete {
		target := source
		revisit := len(state.Pages) > 0
		if revisit {
			target = state.Pages[len(state.Pages)-1].URL
		}
		if _, err = page.Goto(ctx, target, nil); err != nil {
			return err
		}
		for {
			current, urlErr := page.URL(ctx)
			if urlErr != nil {
				return urlErr
			}
			parsed, parseErr := url.Parse(current)
			if parseErr != nil || parsed.Scheme != origin.Scheme || parsed.Host != origin.Host {
				return errors.New("navigation left the catalog origin")
			}
			if revisit && current != target {
				return errors.New("checkpoint page redirected; start a fresh export")
			}
			if !revisit {
				if visited[current] {
					return fmt.Errorf("pagination cycle at %s", current)
				}
				if len(state.Pages) >= maxPages {
					return fmt.Errorf("MAX_PAGES=%d reached; checkpoint saved", maxPages)
				}
				result, extractErr := stagehand.Extract[CatalogPage](ctx, client,
					"Extract every book in the product grid, including title, displayed price, and availability.",
					&stagehand.StagehandClientExtractOptions{Page: page})
				if extractErr != nil {
					return extractErr
				}
				if err = validateBooks(result.Data.Books); err != nil {
					return err
				}
				state.Pages = append(state.Pages, SavedPage{URL: current, Books: result.Data.Books})
				visited[current] = true
				if err = atomicJSON(checkpointPath, state); err != nil {
					return err
				}
			}
			revisit = false
			nextCount, nextErr := page.Locator(envDefault("NEXT_SELECTOR", "li.next a")).Count(ctx)
			if nextErr != nil {
				return nextErr
			}
			if nextCount == 0 {
				state.Complete = true
				if err = atomicJSON(checkpointPath, state); err != nil {
					return err
				}
				break
			}
			instruction := "Find the enabled Next pagination link. Return no actions if there is no next page."
			observed, observeErr := client.Observe(ctx, &instruction, &stagehand.StagehandClientObserveOptions{Page: page})
			if observeErr != nil {
				return observeErr
			}
			if len(observed.Data) == 0 {
				return errors.New("Next link exists but observe returned no action")
			}
			acted, actErr := client.Act(ctx, stagehand.ObservedAction(observed.Data[0]), &stagehand.StagehandClientActOptions{Page: page})
			if actErr != nil {
				return actErr
			}
			if !acted.Data.Success {
				return fmt.Errorf("next-page act failed: %s", acted.Data.Message)
			}
			if err = page.WaitForLoadState(ctx, stagehand.LoadStateDOMContentLoaded, nil); err != nil {
				return err
			}
			nextURL, urlErr := page.URL(ctx)
			if urlErr != nil {
				return urlErr
			}
			if nextURL == current {
				return fmt.Errorf("next-page action did not navigate from %s", current)
			}
		}
	}
	books := []Book{}
	seen := map[Book]bool{}
	for _, saved := range state.Pages {
		for _, book := range saved.Books {
			if !seen[book] {
				books = append(books, book)
				seen[book] = true
			}
		}
	}
	target := filepath.Join(outDir, "catalog.json")
	if err = atomicJSON(target, Catalog{Pages: len(state.Pages), Count: len(books), Books: books}); err != nil {
		return err
	}
	fmt.Printf("Saved %d books from %d pages to %s\n", len(books), len(state.Pages), target)
	return nil
}
func envDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

type SavedPage struct {
	URL   string `json:"url"`
	Books []Book `json:"books"`
}
type Checkpoint struct {
	Version  int         `json:"version"`
	Source   string      `json:"source"`
	Complete bool        `json:"complete"`
	Pages    []SavedPage `json:"pages"`
}

func validateBooks(books []Book) error {
	if len(books) == 0 {
		return errors.New("extract returned no books")
	}
	for index := range books {
		books[index].Title = strings.TrimSpace(books[index].Title)
		books[index].Price = strings.TrimSpace(books[index].Price)
		books[index].Availability = strings.TrimSpace(books[index].Availability)
		if books[index].Title == "" || books[index].Price == "" || books[index].Availability == "" {
			return errors.New("extract returned an incomplete book")
		}
	}
	return nil
}
func atomicJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(path+".tmp", append(data, '\n'), 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}
