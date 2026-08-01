package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func newBrowserTestCDP(t *testing.T) *cdpClient {
	t.Helper()
	client, err := newCDPClient(newFakeCDPWebSocket(), "ws://browser.test", time.Second)
	if err != nil {
		t.Fatalf("newCDPClient() error = %v", err)
	}
	return client
}

func TestBrowserClaimAndCloseSemantics(t *testing.T) {
	t.Run("claim release and reclaim", func(t *testing.T) {
		browser := &Browser{}
		if _, err := claimBrowser(browser); err != nil {
			t.Fatalf("claimBrowser() error = %v", err)
		}
		if _, err := claimBrowser(browser); err == nil || err.Error() != "this browser is already attached to a Stagehand instance" {
			t.Fatalf("second claim error = %v", err)
		}
		releaseBrowserClaim(browser)
		if _, err := claimBrowser(browser); err != nil {
			t.Fatalf("claim after release error = %v", err)
		}
	})

	t.Run("close is memoized", func(t *testing.T) {
		sourceErr := errors.New("source failed")
		cleanupErr := errors.New("cleanup failed")
		sourceCalls, cleanupCalls := 0, 0
		browser := &Browser{
			ownsSource: true,
			closeSource: func(context.Context) error {
				sourceCalls++
				return sourceErr
			},
			cleanup: func() error {
				cleanupCalls++
				return cleanupErr
			},
		}
		first := browser.Close(context.Background())
		if !browser.Closed() {
			t.Fatal("Closed() = false after Close")
		}
		second := browser.Close(context.Background())
		if first != second || !errors.Is(first, sourceErr) || !errors.Is(first, cleanupErr) {
			t.Fatalf("Close() errors = %v, %v", first, second)
		}
		if sourceCalls != 1 || cleanupCalls != 1 {
			t.Fatalf("teardown calls = %d, %d; want 1, 1", sourceCalls, cleanupCalls)
		}
		if _, err := claimBrowser(browser); err == nil || err.Error() != "cannot attach Stagehand to a closed browser" {
			t.Fatalf("claim after close error = %v", err)
		}
	})

	t.Run("closed flips before teardown finishes", func(t *testing.T) {
		started := make(chan struct{})
		finish := make(chan struct{})
		browser := &Browser{
			ownsSource: true,
			closeSource: func(context.Context) error {
				close(started)
				<-finish
				return nil
			},
		}
		closed := make(chan error, 1)
		go func() { closed <- browser.Close(context.Background()) }()
		<-started
		if !browser.Closed() {
			t.Fatal("Closed() = false while teardown is in progress")
		}
		close(finish)
		if err := <-closed; err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})

	t.Run("concurrent close honors caller context", func(t *testing.T) {
		sourceErr := errors.New("source failed")
		started := make(chan struct{})
		finish := make(chan struct{})
		browser := &Browser{
			ownsSource: true,
			closeSource: func(context.Context) error {
				close(started)
				<-finish
				return sourceErr
			},
		}
		firstDone := make(chan error, 1)
		go func() { firstDone <- browser.Close(context.Background()) }()
		<-started

		canceled, cancel := context.WithCancel(context.Background())
		cancel()
		secondDone := make(chan error, 1)
		go func() { secondDone <- browser.Close(canceled) }()
		select {
		case err := <-secondDone:
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("second Close() error = %v, want context.Canceled", err)
			}
		case <-time.After(time.Second):
			t.Fatal("second Close() did not honor canceled context")
		}

		close(finish)
		first := <-firstDone
		if !errors.Is(first, sourceErr) {
			t.Fatalf("first Close() error = %v, want source error", first)
		}
		third := browser.Close(context.Background())
		if third != first {
			t.Fatalf("third Close() error = %v, want memoized %v", third, first)
		}
	})
}

func TestConnectBrowserOwnsSourceMatrix(t *testing.T) {
	tests := []struct {
		name      string
		origin    BrowserOrigin
		keepAlive bool
		wantClose int
	}{
		{name: "launched", origin: BrowserOriginLaunched, wantClose: 1},
		{name: "launched keep alive", origin: BrowserOriginLaunched, keepAlive: true},
		{name: "connected", origin: BrowserOriginConnected},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sourceCloses := 0
			browser, err := connectBrowser(context.Background(), connectBrowserOptions{
				provider: BrowserProviderLocal, origin: test.origin,
				source: browserConnectionSource{
					cdpURL: "ws://browser.test", keepAlive: test.keepAlive,
					close: func(context.Context) error { sourceCloses++; return nil },
				},
			}, browserFactoryDependencies{
				connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
					return newBrowserTestCDP(t), nil
				},
			})
			if err != nil {
				t.Fatalf("connectBrowser() error = %v", err)
			}
			if err := browser.Close(context.Background()); err != nil {
				t.Fatalf("Close() error = %v", err)
			}
			if sourceCloses != test.wantClose {
				t.Fatalf("source closes = %d, want %d", sourceCloses, test.wantClose)
			}
		})
	}
}

type recordingBrowserCommandSender struct {
	method string
	params any
}

func (sender *recordingBrowserCommandSender) sendCommand(_ context.Context, method string, params any) error {
	sender.method, sender.params = method, params
	return nil
}

func TestLaunchLocalBrowserDownloadBehaviorAndExtension(t *testing.T) {
	accept := false
	sender := &recordingBrowserCommandSender{}
	var connected cdpClientOptions
	materializeCalls := 0
	browser, err := launchLocalBrowserWithDependencies(context.Background(), &LocalBrowserLaunchOptions{
		AcceptDownloads: &accept, DownloadsPath: "/tmp/downloads", KeepAlive: true,
	}, browserFactoryDependencies{
		launchLocal: func(context.Context, LocalBrowserLaunchOptions) (resolvedBrowserSource, error) {
			return resolvedBrowserSource{cdpURL: "ws://browser.test"}, nil
		},
		materializeExtension: func() (string, func() error, error) {
			materializeCalls++
			return "/tmp/extension", func() error { return nil }, nil
		},
		connectCDP: func(_ context.Context, options cdpClientOptions) (*cdpClient, error) {
			connected = options
			return newBrowserTestCDP(t), nil
		},
		commandSender: func(*cdpClient, time.Duration) browserCommandSender { return sender },
	})
	if err != nil {
		t.Fatalf("LaunchLocalBrowser() error = %v", err)
	}
	defer browser.Close(context.Background())
	if materializeCalls != 1 || connected.extensionDir != "/tmp/extension" || connected.serviceWorkerURLIncludes != "service-worker.js" {
		t.Fatalf("extension connect options = %#v", connected)
	}
	wantParams := map[string]any{"behavior": "deny", "downloadPath": "/tmp/downloads"}
	if sender.method != "Browser.setDownloadBehavior" || !reflect.DeepEqual(sender.params, wantParams) {
		t.Fatalf("download command = %q %#v", sender.method, sender.params)
	}
}

func TestConnectLocalBrowserExtensionIDSkipsMaterialization(t *testing.T) {
	materializeCalls := 0
	var connected cdpClientOptions
	browser, err := connectLocalBrowserWithDependencies(context.Background(), LocalBrowserConnectOptions{
		CDPURL: "ws://browser.test", ExtensionID: "extension-id", ConnectTimeoutMs: 250,
	}, browserFactoryDependencies{
		materializeExtension: func() (string, func() error, error) {
			materializeCalls++
			return "", nil, errors.New("unexpected materialization")
		},
		connectCDP: func(_ context.Context, options cdpClientOptions) (*cdpClient, error) {
			connected = options
			return newBrowserTestCDP(t), nil
		},
	})
	if err != nil {
		t.Fatalf("ConnectLocalBrowser() error = %v", err)
	}
	defer browser.Close(context.Background())
	if materializeCalls != 0 || connected.extensionID != "extension-id" || connected.extensionDir != "" {
		t.Fatalf("extension routing = calls %d, options %#v", materializeCalls, connected)
	}
	if connected.connectTimeout != 250*time.Millisecond || connected.discoveryTimeout != 250*time.Millisecond {
		t.Fatalf("timeouts = %v, %v", connected.connectTimeout, connected.discoveryTimeout)
	}
}

func TestLaunchLocalBrowserValidatesDownloadsPath(t *testing.T) {
	accept := true
	_, err := launchLocalBrowserWithDependencies(context.Background(), &LocalBrowserLaunchOptions{AcceptDownloads: &accept}, browserFactoryDependencies{})
	if err == nil || err.Error() != "downloadsPath is required when acceptDownloads is true" {
		t.Fatalf("error = %v", err)
	}
}

func TestConnectBrowserFailureCleansOwnedResources(t *testing.T) {
	connectErr, sourceErr, cleanupErr := errors.New("connect"), errors.New("source"), errors.New("cleanup")
	sourceCloses := 0
	_, err := connectBrowser(context.Background(), connectBrowserOptions{
		provider: BrowserProviderLocal, origin: BrowserOriginLaunched,
		source: browserConnectionSource{
			cdpURL:  "ws://browser.test",
			close:   func(context.Context) error { sourceCloses++; return sourceErr },
			cleanup: func() error { return cleanupErr },
		},
	}, browserFactoryDependencies{
		connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) { return nil, connectErr },
	})
	if !errors.Is(err, connectErr) || !errors.Is(err, sourceErr) || !errors.Is(err, cleanupErr) || sourceCloses != 1 {
		t.Fatalf("connect error = %v, source closes = %d", err, sourceCloses)
	}

	sourceCloses = 0
	_, err = connectBrowser(context.Background(), connectBrowserOptions{
		provider: BrowserProviderLocal, origin: BrowserOriginLaunched,
		source: browserConnectionSource{
			cdpURL: "ws://browser.test", keepAlive: true,
			close: func(context.Context) error { sourceCloses++; return nil },
		},
	}, browserFactoryDependencies{
		connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) { return nil, connectErr },
	})
	if !errors.Is(err, connectErr) || sourceCloses != 0 {
		t.Fatalf("keep-alive failure = %v, source closes = %d", err, sourceCloses)
	}
}

type fakeBrowserbaseFactoryClient struct {
	created       resolvedBrowserSource
	createOptions BrowserbaseLaunchOptions
	connected     browserbaseSessionConnection
}

func (client *fakeBrowserbaseFactoryClient) createSession(_ context.Context, options BrowserbaseLaunchOptions) (resolvedBrowserSource, error) {
	client.createOptions = options
	return client.created, nil
}

func (client *fakeBrowserbaseFactoryClient) connectSession(context.Context, string) (browserbaseSessionConnection, error) {
	return client.connected, nil
}

func TestBrowserbaseFactoryMetadataAndExtensionRouting(t *testing.T) {
	tests := []struct {
		name            string
		connect         bool
		extensionID     string
		wantPreloaded   bool
		wantExtensionID string
	}{
		{name: "launch", wantPreloaded: true},
		{name: "connect extension ID", connect: true, extensionID: "ext", wantExtensionID: "ext"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			region := BrowserbaseRegion("us-west-2")
			extensionID := "caller-ext"
			keepAlive := true
			userMetadata := map[string]json.RawMessage{"team": json.RawMessage(`"qa"`)}
			client := &fakeBrowserbaseFactoryClient{
				created:   resolvedBrowserSource{cdpURL: "ws://browser.test", browserbaseSessionID: "created"},
				connected: browserbaseSessionConnection{cdpURL: "ws://browser.test", sessionID: "retrieved", region: &region},
			}
			var connected cdpClientOptions
			dependencies := browserFactoryDependencies{
				createBrowserbaseClient: func(string) (browserbaseFactoryClient, error) { return client, nil },
				connectCDP: func(_ context.Context, options cdpClientOptions) (*cdpClient, error) {
					connected = options
					return newBrowserTestCDP(t), nil
				},
			}
			var browser *Browser
			var err error
			if test.connect {
				browser, err = connectBrowserbaseWithDependencies(context.Background(), BrowserbaseConnectOptions{APIKey: "key", SessionID: "retrieved", ExtensionID: test.extensionID}, dependencies)
			} else {
				browser, err = launchBrowserbaseWithDependencies(context.Background(), BrowserbaseLaunchOptions{
					APIKey: "key", ExtensionID: &extensionID, KeepAlive: &keepAlive,
					Region: &region, UserMetadata: userMetadata,
				}, dependencies)
			}
			if err != nil {
				t.Fatalf("factory error = %v", err)
			}
			defer browser.Close(context.Background())
			if !test.connect {
				created := client.createOptions
				if created.ExtensionID == nil || *created.ExtensionID != extensionID ||
					created.KeepAlive == nil || *created.KeepAlive != keepAlive ||
					created.Region == nil || *created.Region != region ||
					!reflect.DeepEqual(created.UserMetadata, userMetadata) {
					t.Fatalf("session create options = %#v", created)
				}
				region = BrowserbaseRegion("eu-central-1")
			}
			claimed, err := claimBrowser(browser)
			if err != nil {
				t.Fatalf("claimBrowser() error = %v", err)
			}
			if claimed.workerAPIKey == nil || *claimed.workerAPIKey != "key" || claimed.workerBrowser == nil || claimed.workerBrowser.Region == nil {
				t.Fatalf("worker metadata = %#v %#v", claimed.workerAPIKey, claimed.workerBrowser)
			}
			if !test.connect && *claimed.workerBrowser.Region != BrowserbaseRegion("us-west-2") {
				t.Fatalf("worker region = %q, want copied us-west-2", *claimed.workerBrowser.Region)
			}
			if connected.preloadedExtension != test.wantPreloaded || connected.extensionID != test.wantExtensionID {
				t.Fatalf("extension options = %#v", connected)
			}
			if test.connect && claimed.workerBrowser.SessionID != "retrieved" {
				t.Fatalf("session ID = %q", claimed.workerBrowser.SessionID)
			}
		})
	}
}

func TestBrowserbaseFactoriesRequireAPIKey(t *testing.T) {
	_, err := LaunchBrowserbase(context.Background(), BrowserbaseLaunchOptions{})
	if err == nil || !strings.Contains(err.Error(), "Browserbase API key is required") {
		t.Fatalf("error = %v", err)
	}
}
