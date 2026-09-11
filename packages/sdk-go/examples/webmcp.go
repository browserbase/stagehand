package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

const webMCPTestSite = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/"

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	browser, err := stagehand.LaunchLocalBrowser(ctx, &stagehand.LocalBrowserLaunchOptions{Headless: false})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser})
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
	// Subscribe before navigation: hooks report future changes, not existing tools.
	added, err := page.OnToolsAdded(ctx, func(tools []*stagehand.WebMCPTool) {
		for _, tool := range tools {
			descriptor := tool.Descriptor()
			fmt.Printf("Tool added: %s (%s)\n", descriptor.Name, descriptor.FrameID)
		}
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, added.Close(ctx)) }()
	removalReceived := make(chan struct{}, 1)
	removed, err := page.OnToolsRemoved(ctx, func(tools []stagehand.WebMCPToolIdentity) {
		for _, tool := range tools {
			fmt.Printf("Tool removed: %s (%s)\n", tool.Name, tool.FrameID)
		}
		if len(tools) > 0 {
			select {
			case removalReceived <- struct{}{}:
			default:
			}
		}
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, removed.Close(ctx)) }()
	if _, err := page.Goto(ctx, webMCPTestSite, nil); err != nil {
		return err
	}

	tools, err := page.Tools(ctx, &stagehand.WebMCPToolsOptions{Timeout: 5_000})
	if err != nil {
		return err
	}
	var calculateSum *stagehand.WebMCPTool
	for _, tool := range tools {
		if tool.Descriptor().Name == "calculateSum" {
			calculateSum = tool
			break
		}
	}
	if calculateSum == nil {
		return errors.New("calculateSum was not registered by the page")
	}

	invocation, err := calculateSum.Invoke(ctx, stagehand.WebMCPInput{"a": 19, "b": 23})
	if err != nil {
		return err
	}
	result, err := invocation.Result(ctx, nil)
	if err != nil {
		return err
	}

	fmt.Printf("status: %s\noutput: %s\n", result.Status, result.Output)
	// Leaving the document removes its registered tools.
	if _, err := page.Goto(ctx, "about:blank", nil); err != nil {
		return err
	}
	select {
	case <-removalReceived:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(5 * time.Second):
		return errors.New("timed out waiting for tool removal")
	}
}
