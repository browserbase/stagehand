package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go"
)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	directory, err := os.MkdirTemp("", "stagehand-upload-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(directory)
	filePath := filepath.Join(directory, "hello.txt")
	if err := os.WriteFile(filePath, []byte("hello from Go"), 0o600); err != nil {
		return err
	}

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
	if err := page.Goto(ctx, `data:text/html,<input id="upload" type="file">`, nil); err != nil {
		return err
	}
	if err := page.Locator("#upload").SetInputFiles(ctx, stagehand.FilePath(filePath)); err != nil {
		return err
	}

	raw, err := page.Evaluate(ctx, `(async () => {
      const file = document.querySelector('#upload').files[0];
      return file ? { name: file.name, text: await file.text() } : null;
    })()`)
	if err != nil {
		return err
	}
	var uploaded struct {
		Name string `json:"name"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &uploaded); err != nil {
		return err
	}
	if uploaded.Name != "hello.txt" || uploaded.Text != "hello from Go" {
		return fmt.Errorf("unexpected uploaded file: %+v", uploaded)
	}
	fmt.Printf("%+v\n", uploaded)
	return nil
}
