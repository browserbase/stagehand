package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestStagehandLocalBrowserIntegration(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client := New(StagehandClientInitParams{
		Browser: LocalBrowserSource{
			ExecutablePath: chromePath,
			Headless:       true,
		},
	})
	closeStagehandAfterTest(t, client)

	if err := client.Init(ctx); err != nil {
		t.Fatalf("Stagehand.Init() with local browser error = %v", err)
	}
	extensionDir := client.browser.extensionDir
	assertLiveStagehand(t, ctx, client)
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with local browser error = %v", err)
	}
	assertExtensionDirectoryRemoved(t, extensionDir)
}

func TestStagehandExistingCDPBrowserIntegration(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	launched, err := launchChrome(ctx, LocalBrowserSource{
		ExecutablePath: chromePath,
		Headless:       true,
	})
	if err != nil {
		t.Fatalf("launch Chrome for existing CDP source: %v", err)
	}
	t.Cleanup(func() {
		closeContext, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		if err := launched.close(closeContext); err != nil {
			t.Errorf("close existing CDP Chrome: %v", err)
		}
	})

	client := New(StagehandClientInitParams{
		Browser: CDPBrowserSource{CDPURL: launched.cdpURL},
	})
	closeStagehandAfterTest(t, client)
	if err := client.Init(ctx); err != nil {
		t.Fatalf("Stagehand.Init() with existing CDP error = %v", err)
	}
	extensionDir := client.browser.extensionDir
	assertLiveStagehand(t, ctx, client)
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with existing CDP error = %v", err)
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		launched.cdpURL+"/json/version",
		nil,
	)
	if err != nil {
		t.Fatalf("create kept-alive existing CDP browser request: %v", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("kept-alive existing CDP browser is unavailable: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf(
			"kept-alive existing CDP browser status = %d, want 200",
			response.StatusCode,
		)
	}
	if _, err := os.Stat(extensionDir); err != nil {
		t.Fatalf("kept-alive extension directory is unavailable: %v", err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(extensionDir); err != nil {
			t.Errorf("remove kept-alive extension directory: %v", err)
		}
	})
}

func TestStagehandBrowserbaseIntegration(t *testing.T) {
	if os.Getenv("BROWSERBASE_SMOKE") != "1" {
		t.Skip("set BROWSERBASE_SMOKE=1 to run the Browserbase integration test")
	}
	apiKey := os.Getenv("BROWSERBASE_API_KEY")
	if apiKey == "" {
		t.Fatal("BROWSERBASE_API_KEY is required when BROWSERBASE_SMOKE=1")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := New(StagehandClientInitParams{
		APIKey: &apiKey,
		Browser: BrowserbaseClientBrowserSource{
			KeepAlive: testPointer(false),
			Timeout:   testPointer(300.0),
			UserMetadata: map[string]json.RawMessage{
				"suite": json.RawMessage(`"stagehand-v4-go-public-smoke"`),
			},
		},
	})
	closeStagehandAfterTest(t, client)

	if err := client.Init(ctx); err != nil {
		t.Fatalf("Stagehand.Init() with Browserbase error = %v", err)
	}
	sessionID := client.browser.browserbaseSessionID
	assertLiveStagehand(t, ctx, client)
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with Browserbase error = %v", err)
	}
	t.Logf("created and released Browserbase session %s", sessionID)
}

func assertLiveStagehand(
	t *testing.T,
	ctx context.Context,
	client *Stagehand,
) {
	t.Helper()
	if !client.Initialized() {
		t.Fatal("Stagehand.Initialized() = false after Init")
	}
	browserContext, err := client.Context()
	if err != nil {
		t.Fatalf("Stagehand.Context() error = %v", err)
	}
	page, err := browserContext.ActivePage(ctx)
	if err != nil {
		t.Fatalf("BrowserContext.ActivePage() error = %v", err)
	}
	if page == nil || page.PageID() == "" {
		t.Fatalf("BrowserContext.ActivePage() = %#v", page)
	}
}

func closeStagehandAfterTest(t *testing.T, client *Stagehand) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := client.Close(ctx); err != nil &&
			!errors.Is(err, ErrCDPClientClosed) &&
			!errors.Is(err, ErrCDPConnectionClosed) {
			t.Errorf("clean up Stagehand client: %v", err)
		}
	})
}

func assertExtensionDirectoryRemoved(t *testing.T, directory string) {
	t.Helper()
	if _, err := os.Stat(directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary extension directory still exists after close: %v", err)
	}
}
