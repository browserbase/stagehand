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

var companiesSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "companies": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "description": {"type": "string"}
        },
        "required": ["name", "description"],
        "additionalProperties": false
      }
    }
  },
  "required": ["companies"],
  "additionalProperties": false
}`)

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
	client := stagehand.New(stagehand.StagehandClientInitParams{
		APIKey:  &apiKey,
		Browser: stagehand.BrowserbaseClientBrowserSource{},
		Model:   &model,
	})
	if err := client.Init(ctx); err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()

	browserContext, err := client.Context()
	if err != nil {
		return err
	}
	page, err := browserContext.ActivePage(ctx)
	if err != nil {
		return err
	}
	if page == nil {
		return errors.New("Stagehand initialized without an active page")
	}
	if err := page.Goto(ctx, "https://aigrant.com", nil); err != nil {
		return err
	}

	cache := stagehand.CacheWithThreshold(1)
	extractOptions := &stagehand.StagehandClientExtractOptions{
		ExtractOptions: stagehand.ExtractOptions{Cache: &cache},
		Page:           page,
	}
	extractCompanies := func() (companies, time.Duration, error) {
		start := time.Now()
		extractResult, extractErr := client.Extract(
			ctx,
			"Extract the names and descriptions of the first five companies listed on the page",
			companiesSchema,
			extractOptions,
		)
		if extractErr != nil {
			return companies{}, time.Since(start), extractErr
		}
		var result companies
		if decodeErr := json.Unmarshal(extractResult.Data, &result); decodeErr != nil {
			return companies{}, time.Since(start), decodeErr
		}
		return result, time.Since(start), nil
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
	return stagehand.KnownModel(stagehand.KnownModelConfig{
		ModelName: "openai/gpt-5.4-mini",
		APIKey:    &apiKey,
	}), nil
}

func printJSON(value any) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(data))
}
