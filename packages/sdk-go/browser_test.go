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
	client, err := newCDPClient(newFakeCDPWebSocket(), "ws://browser.test")
	if err != nil {
		t.Fatalf("newCDPClient() error = %v", err)
	}
	return client
}

func TestBrowserClaimAndCloseSemantics(t *testing.T) {
	t.Run("context requires a Stagehand attachment", func(t *testing.T) {
		browser := &Browser{}
		if _, err := browser.Context(); !errors.Is(err, ErrNotInitialized) {
			t.Fatalf("Context() error = %v, want ErrNotInitialized", err)
		}
		if err := attachBrowserContext(browser, nil); err == nil || err.Error() != "browser context is required" {
			t.Fatalf("attachBrowserContext(nil) error = %v", err)
		}
		if err := attachBrowserContext(browser, &BrowserContext{}); err == nil {
			t.Fatal("attachBrowserContext() before claim error = nil")
		}
		if _, err := claimBrowser(browser); err != nil {
			t.Fatalf("claimBrowser() error = %v", err)
		}
		browserContext := &BrowserContext{}
		if err := attachBrowserContext(browser, browserContext); err != nil {
			t.Fatalf("attachBrowserContext() error = %v", err)
		}
		got, err := browser.Context()
		if err != nil || got != browserContext {
			t.Fatalf("Context() = %p, %v; want %p, nil", got, err, browserContext)
		}
		if err := attachBrowserContext(browser, &BrowserContext{}); err == nil {
			t.Fatal("second attachBrowserContext() error = nil")
		}
		detachBrowserContext(browser)
		if _, err := browser.Context(); !errors.Is(err, ErrNotInitialized) {
			t.Fatalf("Context() after detach error = %v, want ErrNotInitialized", err)
		}
	})

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
			terminateSource: func(context.Context) error {
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
			terminateSource: func(context.Context) error {
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
			terminateSource: func(context.Context) error {
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

func TestBrowserExplicitCloseMatrix(t *testing.T) {
	tests := []struct {
		name      string
		provider  BrowserProvider
		origin    BrowserOrigin
		keepAlive bool
		wantClose int
	}{
		{name: "local launched", provider: BrowserProviderLocal, origin: BrowserOriginLaunched, wantClose: 1},
		{name: "local launched keep alive", provider: BrowserProviderLocal, origin: BrowserOriginLaunched, keepAlive: true, wantClose: 1},
		{name: "local connected", provider: BrowserProviderLocal, origin: BrowserOriginConnected},
		{name: "Browserbase launched", provider: BrowserProviderBrowserbase, origin: BrowserOriginLaunched, wantClose: 1},
		{name: "Browserbase launched keep alive", provider: BrowserProviderBrowserbase, origin: BrowserOriginLaunched, keepAlive: true, wantClose: 1},
		{name: "Browserbase connected", provider: BrowserProviderBrowserbase, origin: BrowserOriginConnected, keepAlive: true, wantClose: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sourceCloses := 0
			sender := &recordingBrowserCommandSender{}
			browser, err := connectBrowser(context.Background(), connectBrowserOptions{
				provider: test.provider, origin: test.origin,
				source: browserConnectionSource{
					cdpURL: "ws://browser.test", keepAlive: test.keepAlive,
					close: func(context.Context) error { sourceCloses++; return nil },
				},
			}, browserFactoryDependencies{
				connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
					return newBrowserTestCDP(t), nil
				},
				commandSender: func(*cdpClient) browserCommandSender { return sender },
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
			if test.provider == BrowserProviderLocal && test.origin == BrowserOriginConnected && sender.method != "Browser.close" {
				t.Fatalf("close command = %q, want Browser.close", sender.method)
			}
		})
	}
}

func TestConnectedLocalBrowserCloseAcceptsCommandTransportLoss(t *testing.T) {
	for _, commandErr := range []error{ErrCDPClientClosed, ErrCDPConnectionClosed} {
		t.Run(commandErr.Error(), func(t *testing.T) {
			sender := &recordingBrowserCommandSender{err: commandErr}
			browser, err := connectBrowser(context.Background(), connectBrowserOptions{
				provider: BrowserProviderLocal,
				origin:   BrowserOriginConnected,
				source:   browserConnectionSource{cdpURL: "ws://browser.test", keepAlive: true},
			}, browserFactoryDependencies{
				connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
					return newBrowserTestCDP(t), nil
				},
				commandSender: func(*cdpClient) browserCommandSender { return sender },
			})
			if err != nil {
				t.Fatalf("connectBrowser() error = %v", err)
			}
			if err := browser.Close(context.Background()); err != nil {
				t.Fatalf("Close() error = %v", err)
			}
		})
	}
}

func TestConnectedLocalBrowserCloseRejectsPreexistingTransportLoss(t *testing.T) {
	sender := &recordingBrowserCommandSender{}
	browser, err := connectBrowser(context.Background(), connectBrowserOptions{
		provider: BrowserProviderLocal,
		origin:   BrowserOriginConnected,
		source:   browserConnectionSource{cdpURL: "ws://browser.test", keepAlive: true},
	}, browserFactoryDependencies{
		connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
			return newBrowserTestCDP(t), nil
		},
		commandSender: func(*cdpClient) browserCommandSender { return sender },
	})
	if err != nil {
		t.Fatalf("connectBrowser() error = %v", err)
	}
	if err := browser.cdp.Close(); err != nil {
		t.Fatalf("CDP Close() error = %v", err)
	}
	err = browser.Close(context.Background())
	if err == nil || !strings.Contains(err.Error(), "CDP connection is already closed") {
		t.Fatalf("Browser.Close() error = %v", err)
	}
	if sender.method != "" {
		t.Fatalf("command dispatched after transport loss: %q", sender.method)
	}
}

func TestBrowserInvalidationOwnsSourceMatrix(t *testing.T) {
	tests := []struct {
		name      string
		provider  BrowserProvider
		origin    BrowserOrigin
		keepAlive bool
		wantClose int
	}{
		{name: "local launched", provider: BrowserProviderLocal, origin: BrowserOriginLaunched, wantClose: 1},
		{name: "local launched keep alive", provider: BrowserProviderLocal, origin: BrowserOriginLaunched, keepAlive: true},
		{name: "local connected", provider: BrowserProviderLocal, origin: BrowserOriginConnected, keepAlive: true},
		{name: "Browserbase launched", provider: BrowserProviderBrowserbase, origin: BrowserOriginLaunched, wantClose: 1},
		{name: "Browserbase launched keep alive", provider: BrowserProviderBrowserbase, origin: BrowserOriginLaunched, keepAlive: true},
		{name: "Browserbase connected", provider: BrowserProviderBrowserbase, origin: BrowserOriginConnected, keepAlive: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sourceCloses := 0
			browser, err := connectBrowser(context.Background(), connectBrowserOptions{
				provider: test.provider, origin: test.origin,
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
			if err := browser.invalidate(context.Background()); err != nil {
				t.Fatalf("invalidate() error = %v", err)
			}
			if !browser.Closed() {
				t.Fatal("Closed() = false after invalidation")
			}
			if sourceCloses != test.wantClose {
				t.Fatalf("source closes = %d, want %d", sourceCloses, test.wantClose)
			}
		})
	}
}

func TestLaunchLocalBrowserExplicitCloseIgnoresKeepAlive(t *testing.T) {
	tests := []struct {
		name      string
		keepAlive bool
		wantClose int
	}{
		{name: "owns launched chrome", wantClose: 1},
		{name: "keep alive", keepAlive: true, wantClose: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			launchCloses, cleanupCalls := 0, 0
			browser, err := launchLocalBrowserWithDependencies(context.Background(), &LocalBrowserLaunchOptions{
				KeepAlive: test.keepAlive,
			}, browserFactoryDependencies{
				launchLocal: func(context.Context, LocalBrowserLaunchOptions) (resolvedBrowserSource, error) {
					return resolvedBrowserSource{
						cdpURL: "ws://browser.test",
						close:  func(context.Context) error { launchCloses++; return nil },
					}, nil
				},
				materializeExtension: func() (string, func() error, error) {
					return "/tmp/extension", func() error { cleanupCalls++; return nil }, nil
				},
				connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
					return newBrowserTestCDP(t), nil
				},
			})
			if err != nil {
				t.Fatalf("LaunchLocalBrowser() error = %v", err)
			}
			if err := browser.Close(context.Background()); err != nil {
				t.Fatalf("Close() error = %v", err)
			}
			if launchCloses != test.wantClose || cleanupCalls != 1 {
				t.Fatalf("launch closes = %d, cleanup calls = %d; want %d, 1", launchCloses, cleanupCalls, test.wantClose)
			}
		})
	}
}

type recordingBrowserCommandSender struct {
	method string
	params any
	err    error
}

func (sender *recordingBrowserCommandSender) sendCommand(_ context.Context, method string, params any) error {
	sender.method, sender.params = method, params
	return sender.err
}

func TestLaunchLocalBrowserDownloadBehaviorAndExtension(t *testing.T) {
	accept := false
	sender := &recordingBrowserCommandSender{}
	var connected cdpClientOptions
	var launchDeadline time.Time
	var connectDeadline time.Time
	materializeCalls := 0
	browser, err := launchLocalBrowserWithDependencies(context.Background(), &LocalBrowserLaunchOptions{
		AcceptDownloads: &accept, DownloadsPath: "/tmp/downloads", KeepAlive: true,
	}, browserFactoryDependencies{
		launchLocal: func(ctx context.Context, _ LocalBrowserLaunchOptions) (resolvedBrowserSource, error) {
			var ok bool
			launchDeadline, ok = ctx.Deadline()
			if !ok {
				t.Fatal("local launch context has no initialization deadline")
			}
			return resolvedBrowserSource{cdpURL: "ws://browser.test"}, nil
		},
		materializeExtension: func() (string, func() error, error) {
			materializeCalls++
			return "/tmp/extension", func() error { return nil }, nil
		},
		connectCDP: func(ctx context.Context, options cdpClientOptions) (*cdpClient, error) {
			connected = options
			var ok bool
			connectDeadline, ok = ctx.Deadline()
			if !ok {
				t.Fatal("CDP setup context has no initialization deadline")
			}
			return newBrowserTestCDP(t), nil
		},
		commandSender: func(*cdpClient) browserCommandSender { return sender },
	})
	if err != nil {
		t.Fatalf("LaunchLocalBrowser() error = %v", err)
	}
	defer browser.Close(context.Background())
	if materializeCalls != 1 || connected.extensionDir != "/tmp/extension" || connected.serviceWorkerURLIncludes != "service-worker.js" {
		t.Fatalf("extension connect options = %#v", connected)
	}
	if !connectDeadline.Equal(launchDeadline) {
		t.Fatalf("factory lifecycle deadlines differ: launch %v, connect %v", launchDeadline, connectDeadline)
	}
	wantParams := map[string]any{"behavior": "deny", "downloadPath": "/tmp/downloads"}
	if sender.method != "Browser.setDownloadBehavior" || !reflect.DeepEqual(sender.params, wantParams) {
		t.Fatalf("download command = %q %#v", sender.method, sender.params)
	}
}

func TestConnectLocalBrowserExtensionIDSkipsMaterialization(t *testing.T) {
	materializeCalls := 0
	var connected cdpClientOptions
	var connectDeadline time.Duration
	browser, err := connectLocalBrowserWithDependencies(context.Background(), LocalBrowserConnectOptions{
		CDPURL: "ws://browser.test", ExtensionID: "extension-id",
	}, browserFactoryDependencies{
		materializeExtension: func() (string, func() error, error) {
			materializeCalls++
			return "", nil, errors.New("unexpected materialization")
		},
		connectCDP: func(ctx context.Context, options cdpClientOptions) (*cdpClient, error) {
			connected = options
			deadline, ok := ctx.Deadline()
			if !ok {
				t.Fatal("browser connect context has no deadline")
			}
			connectDeadline = time.Until(deadline)
			return newBrowserTestCDP(t), nil
		},
		commandSender: func(*cdpClient) browserCommandSender {
			return &recordingBrowserCommandSender{}
		},
	})
	if err != nil {
		t.Fatalf("ConnectLocalBrowser() error = %v", err)
	}
	defer browser.Close(context.Background())
	if materializeCalls != 0 || connected.extensionID != "extension-id" || connected.extensionDir != "" {
		t.Fatalf("extension routing = calls %d, options %#v", materializeCalls, connected)
	}
	if connectDeadline < stagehandInitTimeout-time.Second || connectDeadline > stagehandInitTimeout {
		t.Fatalf("browser connect deadline = %v, want approximately %v", connectDeadline, stagehandInitTimeout)
	}
}

func TestBrowserLifecycleContextIsInternalAndCallerCapped(t *testing.T) {
	t.Run("uses the internal initialization deadline", func(t *testing.T) {
		lifecycleCtx, cancelLifecycle, err := browserLifecycleContext(context.Background())
		if err != nil {
			t.Fatalf("browserLifecycleContext() error = %v", err)
		}
		defer cancelLifecycle()
		deadline, ok := lifecycleCtx.Deadline()
		remaining := time.Until(deadline)
		if !ok || remaining < stagehandInitTimeout-time.Second || remaining > stagehandInitTimeout {
			t.Fatalf("lifecycle deadline remaining = %v, %t", remaining, ok)
		}
	})

	t.Run("preserves a shorter caller deadline", func(t *testing.T) {
		callerCtx, cancelCaller := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelCaller()

		lifecycleCtx, cancelLifecycle, err := browserLifecycleContext(callerCtx)
		if err != nil {
			t.Fatalf("browserLifecycleContext() error = %v", err)
		}
		defer cancelLifecycle()
		callerDeadline, _ := callerCtx.Deadline()
		lifecycleDeadline, ok := lifecycleCtx.Deadline()
		if !ok || !lifecycleDeadline.Equal(callerDeadline) {
			t.Fatalf("lifecycle deadline = %v, %t; want caller deadline %v", lifecycleDeadline, ok, callerDeadline)
		}
	})

	t.Run("rejects nil context", func(t *testing.T) {
		if _, _, err := browserLifecycleContext(nil); err == nil {
			t.Fatal("browserLifecycleContext(nil) error = nil")
		}
	})
}

func TestBrowserFactoriesRejectNilContext(t *testing.T) {
	tests := []struct {
		name string
		call func() error
	}{
		{
			name: "launch local",
			call: func() error {
				_, err := LaunchLocalBrowser(nil, nil)
				return err
			},
		},
		{
			name: "connect local",
			call: func() error {
				_, err := ConnectLocalBrowser(nil, LocalBrowserConnectOptions{})
				return err
			},
		},
		{
			name: "launch Browserbase",
			call: func() error {
				_, err := LaunchBrowserbase(nil, BrowserbaseLaunchOptions{})
				return err
			},
		},
		{
			name: "connect Browserbase",
			call: func() error {
				_, err := ConnectBrowserbase(nil, BrowserbaseConnectOptions{})
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.call(); err == nil ||
				err.Error() != "stagehand browser initialization context is required" {
				t.Fatalf("factory error = %v", err)
			}
		})
	}
}

func TestBrowserFactoryOptionsDoNotExposeConnectTimeout(t *testing.T) {
	for _, options := range []any{
		LocalBrowserLaunchOptions{},
		LocalBrowserConnectOptions{},
		BrowserbaseLaunchOptions{},
		BrowserbaseConnectOptions{},
	} {
		if _, exposed := reflect.TypeOf(options).FieldByName("ConnectTimeoutMs"); exposed {
			t.Fatalf("%T exposes ConnectTimeoutMs", options)
		}
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

func TestConnectBrowserFailureClosesSourceWithLiveContext(t *testing.T) {
	type contextKey struct{}
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), contextKey{}, "value"))
	cancel()
	closeCalls := 0
	closeCanceled := false
	closeValue := ""
	_, err := connectBrowser(ctx, connectBrowserOptions{
		provider: BrowserProviderBrowserbase, origin: BrowserOriginLaunched,
		source: browserConnectionSource{
			cdpURL: "ws://browser.test",
			close: func(ctx context.Context) error {
				closeCalls++
				closeCanceled = ctx.Err() != nil
				closeValue, _ = ctx.Value(contextKey{}).(string)
				return nil
			},
		},
	}, browserFactoryDependencies{
		connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
			return nil, errors.New("connect")
		},
	})
	if err == nil {
		t.Fatal("connectBrowser() error = nil")
	}
	if closeCalls != 1 || closeCanceled || closeValue != "value" {
		t.Fatalf("source close = calls %d, canceled %t, value %q", closeCalls, closeCanceled, closeValue)
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
			sessionCloses := 0
			closeSession := func(context.Context) error { sessionCloses++; return nil }
			client := &fakeBrowserbaseFactoryClient{
				created: resolvedBrowserSource{
					cdpURL: "ws://browser.test", browserbaseSessionID: "created", close: closeSession,
				},
				connected: browserbaseSessionConnection{
					cdpURL: "ws://browser.test", sessionID: "retrieved", region: &region, close: closeSession,
				},
			}
			var connected cdpClientOptions
			var configuredBaseURL string
			dependencies := browserFactoryDependencies{
				createBrowserbaseClient: func(_ string, baseURL string) (browserbaseFactoryClient, error) {
					configuredBaseURL = baseURL
					return client, nil
				},
				connectCDP: func(_ context.Context, options cdpClientOptions) (*cdpClient, error) {
					connected = options
					return newBrowserTestCDP(t), nil
				},
			}
			var browser *Browser
			var err error
			if test.connect {
				browser, err = connectBrowserbaseWithDependencies(context.Background(), BrowserbaseConnectOptions{APIKey: "key", BaseURL: "https://api.dev.browserbase.com", SessionID: "retrieved", ExtensionID: test.extensionID}, dependencies)
			} else {
				browser, err = launchBrowserbaseWithDependencies(context.Background(), BrowserbaseLaunchOptions{
					APIKey: "key", BaseURL: "https://api.dev.browserbase.com", ExtensionID: &extensionID, KeepAlive: &keepAlive,
					Region: &region, UserMetadata: userMetadata,
				}, dependencies)
			}
			if err != nil {
				t.Fatalf("factory error = %v", err)
			}
			if configuredBaseURL != "https://api.dev.browserbase.com" {
				t.Fatalf("Browserbase base URL = %q", configuredBaseURL)
			}
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
			if err := browser.Close(context.Background()); err != nil {
				t.Fatalf("Browser.Close() error = %v", err)
			}
			if sessionCloses != 1 {
				t.Fatalf("session closes = %d, want 1", sessionCloses)
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
