package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// LocalBrowserLaunchOptions configures a Chromium process launched by the SDK.
type LocalBrowserLaunchOptions struct {
	Args                []string
	ExecutablePath      string
	Port                int
	UserDataDir         string
	PreserveUserDataDir bool
	Headless            bool
	Devtools            bool
	ChromiumSandbox     *bool
	IgnoreDefaultArgs   *IgnoreDefaultArgs
	Proxy               *LocalProxyConfig
	Locale              string
	Viewport            *LocalViewport
	DeviceScaleFactor   *float64
	HasTouch            bool
	IgnoreHTTPSErrors   bool
	ConnectTimeoutMs    int
	DownloadsPath       string
	AcceptDownloads     *bool
	KeepAlive           bool
}

// LocalBrowserConnectOptions configures a connection to an existing local browser.
type LocalBrowserConnectOptions struct {
	CDPURL           string
	ConnectTimeoutMs int
	ExtensionID      string
}

// BrowserbaseLaunchOptions configures a newly launched Browserbase session.
type BrowserbaseLaunchOptions struct {
	APIKey          string
	BrowserSettings *BrowserbaseBrowserSettings
	ExtensionID     *string
	KeepAlive       *bool
	Proxies         *BrowserbaseProxies
	Region          *BrowserbaseRegion
	Timeout         *float64
	UserMetadata    map[string]json.RawMessage
}

// BrowserbaseConnectOptions configures a connection to an existing Browserbase session.
type BrowserbaseConnectOptions struct {
	APIKey           string
	SessionID        string
	ConnectTimeoutMs int
	ExtensionID      string
}

type browserbaseFactoryClient interface {
	createSession(context.Context, BrowserbaseClientBrowserSource) (resolvedBrowserSource, error)
	connectSession(context.Context, string) (browserbaseSessionConnection, error)
}

type browserFactoryDependencies struct {
	launchLocal             func(context.Context, LocalBrowserLaunchOptions) (resolvedBrowserSource, error)
	createBrowserbaseClient func(string) (browserbaseFactoryClient, error)
	connectCDP              func(context.Context, cdpClientOptions) (*cdpClient, error)
	materializeExtension    func() (string, func() error, error)
	commandSender           func(*cdpClient, time.Duration) browserCommandSender
}

type browserCommandSender interface {
	sendCommand(context.Context, string, any) error
}

type cdpBrowserCommandSender struct {
	cdp     *cdpClient
	timeout time.Duration
}

func (sender cdpBrowserCommandSender) sendCommand(ctx context.Context, method string, params any) error {
	return sender.cdp.sendCommand(ctx, method, params, "", sender.timeout, &struct{}{})
}

type browserConnectionSource struct {
	cdpURL    string
	keepAlive bool
	close     func(context.Context) error
	cleanup   func() error
}

type connectBrowserOptions struct {
	provider           BrowserProvider
	origin             BrowserOrigin
	source             browserConnectionSource
	extensionDir       string
	extensionID        string
	preloadedExtension bool
	connectTimeoutMs   int
	afterConnect       func(context.Context, browserCommandSender) error
	workerAPIKey       *string
	workerBrowser      *BrowserSessionMetadata
}

// LaunchLocalBrowser launches a local browser and connects its Stagehand extension.
func LaunchLocalBrowser(ctx context.Context, options *LocalBrowserLaunchOptions) (*Browser, error) {
	return launchLocalBrowserWithDependencies(ctx, options, browserFactoryDependencies{})
}

func launchLocalBrowserWithDependencies(ctx context.Context, options *LocalBrowserLaunchOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	resolvedOptions := LocalBrowserLaunchOptions{}
	if options != nil {
		resolvedOptions = *options
	}
	if resolvedOptions.AcceptDownloads != nil && *resolvedOptions.AcceptDownloads && resolvedOptions.DownloadsPath == "" {
		return nil, errors.New("downloadsPath is required when acceptDownloads is true")
	}
	extensionDir, cleanup, err := materializeBrowserExtension(dependencies)
	if err != nil {
		return nil, err
	}
	launch := dependencies.launchLocal
	if launch == nil {
		launch = launchLocalBrowser
	}
	source, err := launch(ctx, resolvedOptions)
	if err != nil {
		return nil, errors.Join(err, cleanup())
	}
	var afterConnect func(context.Context, browserCommandSender) error
	if resolvedOptions.AcceptDownloads != nil || resolvedOptions.DownloadsPath != "" {
		afterConnect = func(ctx context.Context, sender browserCommandSender) error {
			behavior := "allow"
			if resolvedOptions.AcceptDownloads != nil && !*resolvedOptions.AcceptDownloads {
				behavior = "deny"
			}
			params := map[string]any{"behavior": behavior}
			if resolvedOptions.DownloadsPath != "" {
				params["downloadPath"] = resolvedOptions.DownloadsPath
			}
			return sender.sendCommand(ctx, "Browser.setDownloadBehavior", params)
		}
	}
	return connectBrowser(ctx, connectBrowserOptions{
		provider: BrowserProviderLocal, origin: BrowserOriginLaunched,
		source:       browserConnectionSource{cdpURL: source.cdpURL, keepAlive: resolvedOptions.KeepAlive, close: source.close, cleanup: cleanup},
		extensionDir: extensionDir, connectTimeoutMs: resolvedOptions.ConnectTimeoutMs,
		afterConnect: afterConnect,
	}, dependencies)
}

// ConnectLocalBrowser connects an existing local browser and its Stagehand extension.
func ConnectLocalBrowser(ctx context.Context, options LocalBrowserConnectOptions) (*Browser, error) {
	return connectLocalBrowserWithDependencies(ctx, options, browserFactoryDependencies{})
}

func connectLocalBrowserWithDependencies(ctx context.Context, options LocalBrowserConnectOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	extensionDir := ""
	var cleanup func() error
	if options.ExtensionID == "" {
		var err error
		extensionDir, cleanup, err = materializeBrowserExtension(dependencies)
		if err != nil {
			return nil, err
		}
	}
	return connectBrowser(ctx, connectBrowserOptions{
		provider: BrowserProviderLocal, origin: BrowserOriginConnected,
		source:       browserConnectionSource{cdpURL: options.CDPURL, keepAlive: true, cleanup: cleanup},
		extensionDir: extensionDir, extensionID: options.ExtensionID, connectTimeoutMs: options.ConnectTimeoutMs,
	}, dependencies)
}

// LaunchBrowserbase launches and connects a Browserbase session.
func LaunchBrowserbase(ctx context.Context, options BrowserbaseLaunchOptions) (*Browser, error) {
	return launchBrowserbaseWithDependencies(ctx, options, browserFactoryDependencies{})
}

func launchBrowserbaseWithDependencies(ctx context.Context, options BrowserbaseLaunchOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	client, err := browserbaseClientForFactory(options.APIKey, dependencies)
	if err != nil {
		return nil, err
	}
	source, err := client.createSession(ctx, BrowserbaseClientBrowserSource{
		BrowserSettings: options.BrowserSettings, ExtensionID: options.ExtensionID,
		KeepAlive: options.KeepAlive, Proxies: options.Proxies, Region: options.Region,
		Timeout: options.Timeout, UserMetadata: options.UserMetadata,
	})
	if err != nil {
		return nil, err
	}
	keepAlive := options.KeepAlive != nil && *options.KeepAlive
	return connectBrowser(ctx, connectBrowserOptions{
		provider: BrowserProviderBrowserbase, origin: BrowserOriginLaunched,
		source:             browserConnectionSource{cdpURL: source.cdpURL, keepAlive: keepAlive, close: source.close},
		preloadedExtension: true, workerAPIKey: &options.APIKey,
		workerBrowser: &BrowserSessionMetadata{SessionID: source.browserbaseSessionID, Region: options.Region},
	}, dependencies)
}

// ConnectBrowserbase connects an existing Browserbase session.
func ConnectBrowserbase(ctx context.Context, options BrowserbaseConnectOptions) (*Browser, error) {
	return connectBrowserbaseWithDependencies(ctx, options, browserFactoryDependencies{})
}

func connectBrowserbaseWithDependencies(ctx context.Context, options BrowserbaseConnectOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	client, err := browserbaseClientForFactory(options.APIKey, dependencies)
	if err != nil {
		return nil, err
	}
	session, err := client.connectSession(ctx, options.SessionID)
	if err != nil {
		return nil, err
	}
	return connectBrowser(ctx, connectBrowserOptions{
		provider: BrowserProviderBrowserbase, origin: BrowserOriginConnected,
		source:      browserConnectionSource{cdpURL: session.cdpURL, keepAlive: true},
		extensionID: options.ExtensionID, preloadedExtension: options.ExtensionID == "",
		connectTimeoutMs: options.ConnectTimeoutMs, workerAPIKey: &options.APIKey,
		workerBrowser: &BrowserSessionMetadata{SessionID: session.sessionID, Region: session.region},
	}, dependencies)
}

func browserbaseClientForFactory(apiKey string, dependencies browserFactoryDependencies) (browserbaseFactoryClient, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("stagehand Browserbase API key is required")
	}
	factory := dependencies.createBrowserbaseClient
	if factory == nil {
		factory = func(apiKey string) (browserbaseFactoryClient, error) {
			return newBrowserbaseSessionClient(apiKey, browserbaseSessionClientOptions{})
		}
	}
	client, err := factory(apiKey)
	if err != nil {
		return nil, fmt.Errorf("create Stagehand Browserbase client: %w", err)
	}
	return client, nil
}

func materializeBrowserExtension(dependencies browserFactoryDependencies) (string, func() error, error) {
	return materializeStagehandExtension(browserSourceResolverDependencies{materializeExtension: dependencies.materializeExtension})
}

func connectBrowser(ctx context.Context, options connectBrowserOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	commandTimeout := defaultCDPCommandTimeout
	ownsSource := options.origin == BrowserOriginLaunched && !options.source.keepAlive
	connect := dependencies.connectCDP
	if connect == nil {
		connect = connectCDPClient
	}
	timeout := time.Duration(options.connectTimeoutMs) * time.Millisecond
	cdp, err := connect(ctx, cdpClientOptions{
		cdpURL: options.source.cdpURL, extensionDir: options.extensionDir,
		extensionID: options.extensionID, preloadedExtension: options.preloadedExtension,
		serviceWorkerURLIncludes: "service-worker.js", connectTimeout: timeout,
		discoveryTimeout: timeout, commandTimeout: commandTimeout,
	})
	if err == nil && options.afterConnect != nil {
		commandSender := dependencies.commandSender
		if commandSender == nil {
			commandSender = func(cdp *cdpClient, timeout time.Duration) browserCommandSender {
				return cdpBrowserCommandSender{cdp: cdp, timeout: timeout}
			}
		}
		err = options.afterConnect(ctx, commandSender(cdp, commandTimeout))
	}
	if err != nil {
		var cdpErr error
		if cdp != nil {
			cdpErr = cdp.Close()
		}
		var sourceErr error
		if ownsSource && options.source.close != nil {
			sourceErr = options.source.close(ctx)
		}
		var cleanupErr error
		if options.source.cleanup != nil {
			cleanupErr = options.source.cleanup()
		}
		return nil, errors.Join(err, cdpErr, sourceErr, cleanupErr)
	}
	return &Browser{
		provider: options.provider, origin: options.origin, cdp: cdp,
		commandTimeout: commandTimeout, workerAPIKey: options.workerAPIKey,
		workerBrowser: options.workerBrowser, ownsSource: ownsSource,
		closeSource: options.source.close, cleanup: options.source.cleanup,
	}, nil
}
