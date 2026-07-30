package stagehand

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"testing"
	"time"
)

func TestBrowserRequiresInitialization(t *testing.T) {
	t.Parallel()

	client := New(StagehandClientInitParams{})
	if _, err := client.Browser(); !errors.Is(err, ErrNotInitialized) {
		t.Fatalf("Browser() error = %v, want ErrNotInitialized", err)
	}
}

func TestBrowserReturnsDetachedResolvedSourceSnapshot(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"runtime.configure": RuntimeConfigureResult{Configured: true},
		"stagehand.init":    StagehandInitResult{Initialized: true},
	}}
	client := newStagehandWithClient(StagehandClientInitParams{}, rpc)
	client.adapters.resolveBrowserSource = func(
		context.Context,
		StagehandClientInitParams,
	) (resolvedBrowserSource, error) {
		return resolvedBrowserSource{
			cdpURL: "wss://connect.example/session",
			cdpHeaders: http.Header{
				"Authorization": []string{"Bearer secret"},
			},
			browserbaseSessionID: "session-123",
			extensionDir:         "/private/sdk-extension",
			preloadedExtension:   true,
			connectTimeout:       15 * time.Second,
			keepAlive:            true,
			close:                func(context.Context) error { return nil },
			cleanup:              func() error { return nil },
		}, nil
	}

	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	browser, err := client.Browser()
	if err != nil {
		t.Fatalf("Browser() error = %v", err)
	}
	if browser.CDPURL != "wss://connect.example/session" ||
		browser.CDPHeaders["Authorization"] != "Bearer secret" ||
		browser.BrowserbaseSessionID != "session-123" ||
		!browser.PreloadedExtension ||
		browser.ConnectTimeout != 15*time.Second ||
		!browser.KeepAlive {
		t.Fatalf("Browser() = %#v", browser)
	}

	browser.CDPHeaders["Authorization"] = "mutated"
	next, err := client.Browser()
	if err != nil {
		t.Fatalf("second Browser() error = %v", err)
	}
	if next.CDPHeaders["Authorization"] != "Bearer secret" {
		t.Fatalf("Browser() exposed mutable SDK state: %#v", next.CDPHeaders)
	}

	publicType := reflect.TypeOf(browser)
	for _, forbiddenField := range []string{"ExtensionDir", "Cleanup", "Close"} {
		if _, exposed := publicType.FieldByName(forbiddenField); exposed {
			t.Errorf("ResolvedBrowserSource exposes forbidden field %s", forbiddenField)
		}
	}
	if _, exposed := publicType.MethodByName("Close"); exposed {
		t.Error("ResolvedBrowserSource exposes lifecycle method Close")
	}
}
