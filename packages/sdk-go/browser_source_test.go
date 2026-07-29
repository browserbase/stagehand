package stagehand

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

type recordingBrowserbaseSessionCreator struct {
	params BrowserbaseClientBrowserSource
	result resolvedBrowserSource
	err    error
}

func (creator *recordingBrowserbaseSessionCreator) createSession(
	_ context.Context,
	params BrowserbaseClientBrowserSource,
) (resolvedBrowserSource, error) {
	creator.params = params
	return creator.result, creator.err
}

func TestResolveBrowserSourceSupportsEveryClientMode(t *testing.T) {
	t.Run("Browserbase", func(t *testing.T) {
		apiKey := "bb_test"
		keepAlive := true
		creator := &recordingBrowserbaseSessionCreator{
			result: resolvedBrowserSource{
				cdpURL:               "wss://connect.browserbase.test/session",
				browserbaseSessionID: "session_123",
				keepAlive:            true,
			},
		}
		factoryAPIKey := ""
		materializeCalls := 0

		resolved, err := resolveBrowserSourceWithDependencies(
			context.Background(),
			StagehandClientInitParams{
				APIKey: &apiKey,
				Browser: BrowserbaseClientBrowserSource{
					KeepAlive: &keepAlive,
				},
			},
			browserSourceResolverDependencies{
				createBrowserbaseClient: func(
					apiKey string,
				) (browserbaseSessionCreator, error) {
					factoryAPIKey = apiKey
					return creator, nil
				},
				materializeExtension: func() (string, func() error, error) {
					materializeCalls++
					return "", nil, errors.New("must not materialize")
				},
			},
		)
		if err != nil {
			t.Fatalf("resolveBrowserSourceWithDependencies() error = %v", err)
		}
		if factoryAPIKey != apiKey {
			t.Fatalf("factory API key = %q, want %q", factoryAPIKey, apiKey)
		}
		if creator.params.KeepAlive != &keepAlive {
			t.Fatalf("Browserbase params = %#v", creator.params)
		}
		if !resolved.preloadedExtension {
			t.Fatal("preloadedExtension = false, want true")
		}
		if materializeCalls != 0 {
			t.Fatalf("materialize calls = %d, want 0", materializeCalls)
		}
	})

	t.Run("local", func(t *testing.T) {
		cleanupCalls := 0
		launchCalls := 0
		closeCalls := 0
		source := LocalBrowserSource{Headless: true}

		resolved, err := resolveBrowserSourceWithDependencies(
			context.Background(),
			StagehandClientInitParams{Browser: source},
			browserSourceResolverDependencies{
				launchLocal: func(
					_ context.Context,
					got LocalBrowserSource,
				) (resolvedBrowserSource, error) {
					launchCalls++
					if !reflect.DeepEqual(got, source) {
						t.Fatalf("local source = %#v, want %#v", got, source)
					}
					return resolvedBrowserSource{
						cdpURL: "http://127.0.0.1:9222",
						close: func(context.Context) error {
							closeCalls++
							return nil
						},
					}, nil
				},
				materializeExtension: func() (string, func() error, error) {
					return "/tmp/stagehand-extension", func() error {
						cleanupCalls++
						return nil
					}, nil
				},
			},
		)
		if err != nil {
			t.Fatalf("resolveBrowserSourceWithDependencies() error = %v", err)
		}
		if launchCalls != 1 {
			t.Fatalf("launch calls = %d, want 1", launchCalls)
		}
		if resolved.extensionDir != "/tmp/stagehand-extension" {
			t.Fatalf("extensionDir = %q", resolved.extensionDir)
		}
		if err := resolved.close(context.Background()); err != nil {
			t.Fatalf("close() error = %v", err)
		}
		if err := resolved.cleanup(); err != nil {
			t.Fatalf("cleanup() error = %v", err)
		}
		if closeCalls != 1 || cleanupCalls != 1 {
			t.Fatalf(
				"close calls = %d, cleanup calls = %d; want 1 and 1",
				closeCalls,
				cleanupCalls,
			)
		}
	})

	t.Run("existing CDP", func(t *testing.T) {
		cleanupCalls := 0
		resolved, err := resolveBrowserSourceWithDependencies(
			context.Background(),
			StagehandClientInitParams{Browser: CDPBrowserSource{
				CDPURL: "  http://browser.test:9222  ",
				Headers: map[string]string{
					"X-Browser-Token": "secret",
				},
			}},
			browserSourceResolverDependencies{
				materializeExtension: func() (string, func() error, error) {
					return "/tmp/stagehand-extension", func() error {
						cleanupCalls++
						return nil
					}, nil
				},
			},
		)
		if err != nil {
			t.Fatalf("resolveBrowserSourceWithDependencies() error = %v", err)
		}
		if resolved.cdpURL != "http://browser.test:9222" {
			t.Fatalf("cdpURL = %q", resolved.cdpURL)
		}
		if !reflect.DeepEqual(
			resolved.cdpHeaders,
			http.Header{"X-Browser-Token": []string{"secret"}},
		) {
			t.Fatalf("cdpHeaders = %#v", resolved.cdpHeaders)
		}
		if !resolved.keepAlive || resolved.close != nil {
			t.Fatalf("existing CDP ownership = %#v", resolved)
		}
		if err := resolved.cleanup(); err != nil {
			t.Fatalf("cleanup() error = %v", err)
		}
		if cleanupCalls != 1 {
			t.Fatalf("cleanup calls = %d, want 1", cleanupCalls)
		}
	})
}

func TestResolveBrowserSourceCleansPartialFailures(t *testing.T) {
	cleanupErr := errors.New("cleanup failed")
	launchErr := errors.New("launch failed")
	cleanupCalls := 0
	_, err := resolveBrowserSourceWithDependencies(
		context.Background(),
		StagehandClientInitParams{Browser: LocalBrowserSource{}},
		browserSourceResolverDependencies{
			launchLocal: func(
				context.Context,
				LocalBrowserSource,
			) (resolvedBrowserSource, error) {
				return resolvedBrowserSource{}, launchErr
			},
			materializeExtension: func() (string, func() error, error) {
				return "/tmp/stagehand-extension", func() error {
					cleanupCalls++
					return cleanupErr
				}, nil
			},
		},
	)
	if !errors.Is(err, launchErr) || !errors.Is(err, cleanupErr) {
		t.Fatalf("resolve error = %v, want launch and cleanup errors", err)
	}
	if cleanupCalls != 1 {
		t.Fatalf("cleanup calls = %d, want 1", cleanupCalls)
	}
}

func TestResolveBrowserSourceValidatesClientInputs(t *testing.T) {
	tests := []struct {
		name   string
		params StagehandClientInitParams
		want   string
	}{
		{
			name:   "default Browserbase API key",
			params: StagehandClientInitParams{},
			want:   "Browserbase API key is required",
		},
		{
			name: "empty CDP URL",
			params: StagehandClientInitParams{
				Browser: CDPBrowserSource{},
			},
			want: "CDP URL is required",
		},
		{
			name: "nil local source",
			params: StagehandClientInitParams{
				Browser: (*LocalBrowserSource)(nil),
			},
			want: "local browser source is nil",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := resolveBrowserSourceWithDependencies(
				context.Background(),
				test.params,
				browserSourceResolverDependencies{
					materializeExtension: func() (string, func() error, error) {
						return "/tmp/stagehand-extension", func() error { return nil }, nil
					},
				},
			)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("resolve error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestStagehandReleasePreservesSuccessfulKeepAliveBrowser(t *testing.T) {
	closeCalls := 0
	cleanupCalls := 0
	client := New(StagehandClientInitParams{})
	newBrowser := func() *resolvedBrowserSource {
		return &resolvedBrowserSource{
			keepAlive: true,
			close: func(context.Context) error {
				closeCalls++
				return nil
			},
			cleanup: func() error {
				cleanupCalls++
				return nil
			},
		}
	}

	client.browser = newBrowser()
	if err := client.releaseBrowser(context.Background(), true); err != nil {
		t.Fatalf("releaseBrowser(preserve keepAlive) error = %v", err)
	}
	if closeCalls != 0 || cleanupCalls != 0 {
		t.Fatalf(
			"preserved browser close calls = %d, cleanup calls = %d; want 0 and 0",
			closeCalls,
			cleanupCalls,
		)
	}

	client.browser = newBrowser()
	if err := client.releaseBrowser(context.Background(), false); err != nil {
		t.Fatalf("releaseBrowser(after failed init) error = %v", err)
	}
	if closeCalls != 1 || cleanupCalls != 1 {
		t.Fatalf(
			"failed-init close calls = %d, cleanup calls = %d; want 1 and 1",
			closeCalls,
			cleanupCalls,
		)
	}
}
