package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/browserbase/stagehand/packages/sdk-go/v4/internal/extensionassets"
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
	DownloadsPath       string
	AcceptDownloads     *bool
	// KeepAlive preserves the launched browser after implicit SDK disconnection.
	// Explicit Browser.Close still terminates the process.
	KeepAlive bool
}

// LocalBrowserConnectOptions configures a connection to an existing local browser.
type LocalBrowserConnectOptions struct {
	CDPURL      string
	ExtensionID string
}

// BrowserbaseLaunchOptions configures a newly launched Browserbase session.
type BrowserbaseLaunchOptions struct {
	APIKey          string
	BaseURL         string
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
	APIKey      string
	BaseURL     string
	SessionID   string
	ExtensionID string
}

type browserbaseFactoryClient interface {
	createSession(context.Context, BrowserbaseLaunchOptions) (resolvedBrowserSource, error)
	connectSession(context.Context, string) (browserbaseSessionConnection, error)
}

type browserFactoryDependencies struct {
	launchLocal             func(context.Context, LocalBrowserLaunchOptions) (resolvedBrowserSource, error)
	createBrowserbaseClient func(string, string) (browserbaseFactoryClient, error)
	connectCDP              func(context.Context, cdpClientOptions) (*cdpClient, error)
	materializeExtension    func() (string, func() error, error)
	commandSender           func(*cdpClient) browserCommandSender
}

type browserCommandSender interface {
	sendCommand(context.Context, string, any) error
}

type cdpBrowserCommandSender struct {
	cdp *cdpClient
}

func (sender cdpBrowserCommandSender) sendCommand(ctx context.Context, method string, params any) error {
	return sender.cdp.sendCommand(ctx, method, params, "", &struct{}{})
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
	afterConnect       func(context.Context, browserCommandSender) error
	workerAPIKey       *string
	workerBrowser      *BrowserSessionMetadata
}

// LaunchLocalBrowser launches a local browser and connects its Stagehand extension.
func LaunchLocalBrowser(ctx context.Context, options *LocalBrowserLaunchOptions) (*Browser, error) {
	return launchLocalBrowserWithDependencies(ctx, options, browserFactoryDependencies{})
}

func launchLocalBrowserWithDependencies(ctx context.Context, options *LocalBrowserLaunchOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	lifecycleCtx, cancelLifecycle, err := browserLifecycleContext(ctx)
	if err != nil {
		return nil, err
	}
	defer cancelLifecycle()

	resolvedOptions := LocalBrowserLaunchOptions{}
	if options != nil {
		resolvedOptions = *options
	}
	if resolvedOptions.AcceptDownloads != nil && *resolvedOptions.AcceptDownloads && resolvedOptions.DownloadsPath == "" {
		return nil, errors.New("downloadsPath is required when acceptDownloads is true")
	}
	extensionDir, cleanup, err := materializeStagehandExtension(dependencies)
	if err != nil {
		return nil, err
	}
	launch := dependencies.launchLocal
	if launch == nil {
		launch = launchLocalBrowser
	}
	source, err := launch(lifecycleCtx, resolvedOptions)
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
	return connectBrowser(lifecycleCtx, connectBrowserOptions{
		provider: BrowserProviderLocal, origin: BrowserOriginLaunched,
		source:       browserConnectionSource{cdpURL: source.cdpURL, keepAlive: resolvedOptions.KeepAlive, close: source.close, cleanup: cleanup},
		extensionDir: extensionDir,
		afterConnect: afterConnect,
	}, dependencies)
}

// ConnectLocalBrowser connects an existing local browser and its Stagehand extension.
func ConnectLocalBrowser(ctx context.Context, options LocalBrowserConnectOptions) (*Browser, error) {
	return connectLocalBrowserWithDependencies(ctx, options, browserFactoryDependencies{})
}

func connectLocalBrowserWithDependencies(ctx context.Context, options LocalBrowserConnectOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	lifecycleCtx, cancelLifecycle, err := browserLifecycleContext(ctx)
	if err != nil {
		return nil, err
	}
	defer cancelLifecycle()

	extensionDir := ""
	var cleanup func() error
	if options.ExtensionID == "" {
		var err error
		extensionDir, cleanup, err = materializeStagehandExtension(dependencies)
		if err != nil {
			return nil, err
		}
	}
	return connectBrowser(lifecycleCtx, connectBrowserOptions{
		provider: BrowserProviderLocal, origin: BrowserOriginConnected,
		source:       browserConnectionSource{cdpURL: options.CDPURL, keepAlive: true, cleanup: cleanup},
		extensionDir: extensionDir, extensionID: options.ExtensionID,
	}, dependencies)
}

// LaunchBrowserbase launches and connects a Browserbase session.
func LaunchBrowserbase(ctx context.Context, options BrowserbaseLaunchOptions) (*Browser, error) {
	return launchBrowserbaseWithDependencies(ctx, options, browserFactoryDependencies{})
}

func launchBrowserbaseWithDependencies(ctx context.Context, options BrowserbaseLaunchOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	lifecycleCtx, cancelLifecycle, err := browserLifecycleContext(ctx)
	if err != nil {
		return nil, err
	}
	defer cancelLifecycle()

	client, err := browserbaseClientForFactory(options.APIKey, options.BaseURL, dependencies)
	if err != nil {
		return nil, err
	}
	source, err := client.createSession(lifecycleCtx, options)
	if err != nil {
		return nil, err
	}
	keepAlive := options.KeepAlive != nil && *options.KeepAlive
	var workerRegion *BrowserbaseRegion
	if options.Region != nil {
		region := *options.Region
		workerRegion = &region
	}
	return connectBrowser(lifecycleCtx, connectBrowserOptions{
		provider: BrowserProviderBrowserbase, origin: BrowserOriginLaunched,
		source:             browserConnectionSource{cdpURL: source.cdpURL, keepAlive: keepAlive, close: source.close},
		preloadedExtension: true, workerAPIKey: &options.APIKey,
		workerBrowser: &BrowserSessionMetadata{SessionID: source.browserbaseSessionID, Region: workerRegion},
	}, dependencies)
}

// ConnectBrowserbase connects an existing Browserbase session.
func ConnectBrowserbase(ctx context.Context, options BrowserbaseConnectOptions) (*Browser, error) {
	return connectBrowserbaseWithDependencies(ctx, options, browserFactoryDependencies{})
}

func connectBrowserbaseWithDependencies(ctx context.Context, options BrowserbaseConnectOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	lifecycleCtx, cancelLifecycle, err := browserLifecycleContext(ctx)
	if err != nil {
		return nil, err
	}
	defer cancelLifecycle()

	client, err := browserbaseClientForFactory(options.APIKey, options.BaseURL, dependencies)
	if err != nil {
		return nil, err
	}
	session, err := client.connectSession(lifecycleCtx, options.SessionID)
	if err != nil {
		return nil, err
	}
	return connectBrowser(lifecycleCtx, connectBrowserOptions{
		provider: BrowserProviderBrowserbase, origin: BrowserOriginConnected,
		source:      browserConnectionSource{cdpURL: session.cdpURL, keepAlive: true, close: session.close},
		extensionID: options.ExtensionID, preloadedExtension: options.ExtensionID == "",
		workerAPIKey:  &options.APIKey,
		workerBrowser: &BrowserSessionMetadata{SessionID: session.sessionID, Region: session.region},
	}, dependencies)
}

func browserbaseClientForFactory(apiKey string, baseURL string, dependencies browserFactoryDependencies) (browserbaseFactoryClient, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("stagehand Browserbase API key is required")
	}
	factory := dependencies.createBrowserbaseClient
	if factory == nil {
		factory = func(apiKey string, baseURL string) (browserbaseFactoryClient, error) {
			return newBrowserbaseSessionClient(apiKey, browserbaseSessionClientOptions{
				http: browserbaseHTTPClientOptions{baseURL: baseURL},
			})
		}
	}
	client, err := factory(apiKey, baseURL)
	if err != nil {
		return nil, fmt.Errorf("create Stagehand Browserbase client: %w", err)
	}
	return client, nil
}

func materializeStagehandExtension(dependencies browserFactoryDependencies) (string, func() error, error) {
	materialize := dependencies.materializeExtension
	if materialize == nil {
		materialize = extensionassets.Materialize
	}
	directory, cleanup, err := materialize()
	if err != nil {
		return "", nil, fmt.Errorf("materialize bundled Stagehand extension: %w", err)
	}
	if strings.TrimSpace(directory) == "" || cleanup == nil {
		if cleanup != nil {
			err = cleanup()
		}
		return "", nil, errors.Join(
			errors.New("materialized Stagehand extension is incomplete"),
			err,
		)
	}
	return directory, cleanup, nil
}

func connectBrowser(ctx context.Context, options connectBrowserOptions, dependencies browserFactoryDependencies) (*Browser, error) {
	if ctx == nil {
		return nil, errors.New("stagehand browser initialization context is required")
	}

	ownsSource := options.origin == BrowserOriginLaunched && !options.source.keepAlive
	connect := dependencies.connectCDP
	if connect == nil {
		connect = connectCDPClient
	}
	cdp, err := connect(ctx, cdpClientOptions{
		cdpURL: options.source.cdpURL, extensionDir: options.extensionDir,
		extensionID: options.extensionID, preloadedExtension: options.preloadedExtension,
		serviceWorkerURLIncludes: "service-worker.js",
	})
	if err == nil && options.afterConnect != nil {
		commandSender := dependencies.commandSender
		if commandSender == nil {
			commandSender = func(cdp *cdpClient) browserCommandSender {
				return cdpBrowserCommandSender{cdp: cdp}
			}
		}
		err = options.afterConnect(ctx, commandSender(cdp))
	}
	if err != nil {
		var cdpErr error
		if cdp != nil {
			cdpErr = cdp.Close()
		}
		var sourceErr error
		if ownsSource && options.source.close != nil {
			closeCtx, cancelClose := context.WithTimeout(
				context.WithoutCancel(ctx),
				stagehandFailureCleanupTimeout,
			)
			sourceErr = options.source.close(closeCtx)
			cancelClose()
		}
		var cleanupErr error
		if options.source.cleanup != nil {
			cleanupErr = options.source.cleanup()
		}
		return nil, errors.Join(err, cdpErr, sourceErr, cleanupErr)
	}
	terminateSource := options.source.close
	if options.provider == BrowserProviderLocal && options.origin == BrowserOriginConnected {
		commandSender := dependencies.commandSender
		if commandSender == nil {
			commandSender = func(cdp *cdpClient) browserCommandSender {
				return cdpBrowserCommandSender{cdp: cdp}
			}
		}
		sender := commandSender(cdp)
		terminateSource = func(ctx context.Context) error {
			if cdp.closedState() {
				return errors.New("cannot terminate local browser: CDP connection is already closed")
			}
			err := sender.sendCommand(ctx, "Browser.close", map[string]any{})
			if errors.Is(err, ErrCDPClientClosed) || errors.Is(err, ErrCDPConnectionClosed) {
				return nil
			}
			return err
		}
	}
	return &Browser{
		provider: options.provider, origin: options.origin, cdp: cdp,
		workerAPIKey:  options.workerAPIKey,
		workerBrowser: options.workerBrowser, extensionDir: options.extensionDir, ownsSource: ownsSource,
		closeSource: options.source.close, terminateSource: terminateSource, cleanup: options.source.cleanup,
	}, nil
}

func browserLifecycleContext(ctx context.Context) (context.Context, context.CancelFunc, error) {
	if ctx == nil {
		return nil, nil, errors.New("stagehand browser initialization context is required")
	}
	lifecycleCtx, cancel := context.WithTimeout(ctx, stagehandInitTimeout)
	return lifecycleCtx, cancel, nil
}
