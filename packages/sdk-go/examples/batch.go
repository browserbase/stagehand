package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go"
)

func main() {
	if err := runBatch(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func runBatch(ctx context.Context) (err error) {
	browser, err := stagehand.LaunchLocalBrowser(
		ctx,
		&stagehand.LocalBrowserLaunchOptions{Headless: true},
	)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()

	var result struct {
		Title   string `json:"title"`
		Heading string `json:"heading"`
	}
	err = client.ExperimentalBatch(
		ctx,
		`async (batch, input) => {
		  await batch.page.goto(input.url);
		  return {
		    title: await batch.page.title(),
		    heading: await batch.page.locator("h1").innerText(),
		  };
        }`,
		map[string]any{"url": "https://example.com"},
		&result,
		stagehand.ExperimentalBatchOptions{Timeout: 30 * time.Second},
	)
	if err != nil {
		return err
	}

	fmt.Printf("title: %s\nheading: %s\n", result.Title, result.Heading)
	return nil
}
