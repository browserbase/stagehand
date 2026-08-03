package stagehand

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/browserbase/stagehand/packages/sdk-go/internal/extensionassets"
)

type browserbaseSessionCreator interface {
	createSession(
		context.Context,
		BrowserbaseClientBrowserSource,
	) (resolvedBrowserSource, error)
}

type browserSourceResolverDependencies struct {
	browserbase             browserbaseSessionCreator
	createBrowserbaseClient func(string) (browserbaseSessionCreator, error)
	launchLocal             func(context.Context, LocalBrowserLaunchOptions) (resolvedBrowserSource, error)
	materializeExtension    func() (string, func() error, error)
}

func resolveBrowserSource(
	ctx context.Context,
	params StagehandClientInitParams,
) (resolvedBrowserSource, error) {
	return resolveBrowserSourceWithDependencies(ctx, params, browserSourceResolverDependencies{})
}

func resolveBrowserSourceWithDependencies(
	ctx context.Context,
	params StagehandClientInitParams,
	dependencies browserSourceResolverDependencies,
) (resolvedBrowserSource, error) {
	if ctx == nil {
		return resolvedBrowserSource{}, errors.New(
			"stagehand browser source context is required",
		)
	}

	source := params.Browser
	if source == nil {
		source = BrowserbaseClientBrowserSource{}
	}
	switch browser := source.(type) {
	case BrowserbaseClientBrowserSource:
		return resolveBrowserbaseSource(ctx, params.APIKey, browser, dependencies)
	case *BrowserbaseClientBrowserSource:
		if browser == nil {
			return resolvedBrowserSource{}, errors.New(
				"stagehand Browserbase browser source is nil",
			)
		}
		return resolveBrowserbaseSource(ctx, params.APIKey, *browser, dependencies)
	case LocalBrowserSource:
		return resolveLocalSource(ctx, browser, dependencies)
	case *LocalBrowserSource:
		if browser == nil {
			return resolvedBrowserSource{}, errors.New(
				"stagehand local browser source is nil",
			)
		}
		return resolveLocalSource(ctx, *browser, dependencies)
	case CDPBrowserSource:
		return resolveCDPSource(browser, dependencies)
	case *CDPBrowserSource:
		if browser == nil {
			return resolvedBrowserSource{}, errors.New(
				"stagehand CDP browser source is nil",
			)
		}
		return resolveCDPSource(*browser, dependencies)
	default:
		return resolvedBrowserSource{}, fmt.Errorf(
			"stagehand unsupported browser source %T",
			source,
		)
	}
}

func resolveBrowserbaseSource(
	ctx context.Context,
	apiKey *string,
	source BrowserbaseClientBrowserSource,
	dependencies browserSourceResolverDependencies,
) (resolvedBrowserSource, error) {
	if apiKey == nil || strings.TrimSpace(*apiKey) == "" {
		return resolvedBrowserSource{}, errors.New(
			"stagehand Browserbase API key is required for the Browserbase browser source",
		)
	}

	client := dependencies.browserbase
	if client == nil {
		factory := dependencies.createBrowserbaseClient
		if factory == nil {
			factory = func(apiKey string) (browserbaseSessionCreator, error) {
				return newBrowserbaseSessionClient(apiKey, browserbaseSessionClientOptions{})
			}
		}
		var err error
		client, err = factory(*apiKey)
		if err != nil {
			return resolvedBrowserSource{}, fmt.Errorf(
				"create Stagehand Browserbase client: %w",
				err,
			)
		}
	}

	resolved, err := client.createSession(ctx, source)
	if err != nil {
		return resolvedBrowserSource{}, err
	}
	resolved.preloadedExtension = true
	return resolved, nil
}

func resolveLocalSource(
	ctx context.Context,
	source LocalBrowserSource,
	dependencies browserSourceResolverDependencies,
) (resolvedBrowserSource, error) {
	if source.DownloadsPath != "" || source.AcceptDownloads != nil {
		return resolvedBrowserSource{}, errors.New(
			"stagehand local browser download options require post-connect CDP setup",
		)
	}
	extensionDir, cleanup, err := materializeStagehandExtension(dependencies)
	if err != nil {
		return resolvedBrowserSource{}, err
	}

	launch := dependencies.launchLocal
	if launch == nil {
		launch = launchLocalBrowser
	}
	resolved, err := launch(ctx, localBrowserLaunchOptions(source))
	if err != nil {
		return resolvedBrowserSource{}, errors.Join(err, cleanup())
	}
	resolved.extensionDir = extensionDir
	resolved.cleanup = cleanup
	if source.ConnectTimeoutMs > 0 {
		resolved.connectTimeout = time.Duration(source.ConnectTimeoutMs) * time.Millisecond
	}
	return resolved, nil
}

func localBrowserLaunchOptions(source LocalBrowserSource) LocalBrowserLaunchOptions {
	return LocalBrowserLaunchOptions{
		Args: source.Args, ExecutablePath: source.ExecutablePath, Port: source.Port,
		UserDataDir: source.UserDataDir, PreserveUserDataDir: source.PreserveUserDataDir,
		Headless: source.Headless, Devtools: source.Devtools, ChromiumSandbox: source.ChromiumSandbox,
		IgnoreDefaultArgs: source.IgnoreDefaultArgs, Proxy: source.Proxy, Locale: source.Locale,
		Viewport: source.Viewport, DeviceScaleFactor: source.DeviceScaleFactor, HasTouch: source.HasTouch,
		IgnoreHTTPSErrors: source.IgnoreHTTPSErrors, ConnectTimeoutMs: source.ConnectTimeoutMs,
		DownloadsPath: source.DownloadsPath, AcceptDownloads: source.AcceptDownloads, KeepAlive: source.KeepAlive,
	}
}

func resolveCDPSource(
	source CDPBrowserSource,
	dependencies browserSourceResolverDependencies,
) (resolvedBrowserSource, error) {
	cdpURL := strings.TrimSpace(source.CDPURL)
	if cdpURL == "" {
		return resolvedBrowserSource{}, errors.New("stagehand CDP URL is required")
	}
	extensionDir, cleanup, err := materializeStagehandExtension(dependencies)
	if err != nil {
		return resolvedBrowserSource{}, err
	}

	headers := make(http.Header, len(source.Headers))
	for name, value := range source.Headers {
		if strings.TrimSpace(name) == "" {
			return resolvedBrowserSource{}, errors.Join(
				errors.New("stagehand CDP header name cannot be empty"),
				cleanup(),
			)
		}
		headers.Set(name, value)
	}
	return resolvedBrowserSource{
		cdpURL:       cdpURL,
		cdpHeaders:   headers,
		extensionDir: extensionDir,
		keepAlive:    true,
		cleanup:      cleanup,
	}, nil
}

func materializeStagehandExtension(
	dependencies browserSourceResolverDependencies,
) (string, func() error, error) {
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

func connectResolvedBrowser(
	ctx context.Context,
	browser resolvedBrowserSource,
) (protocolClient, error) {
	return connectRPCClient(ctx, cdpClientOptions{
		cdpURL:                   browser.cdpURL,
		headers:                  browser.cdpHeaders,
		extensionDir:             browser.extensionDir,
		preloadedExtension:       browser.preloadedExtension,
		serviceWorkerURLIncludes: "service-worker.js",
		connectTimeout:           browser.connectTimeout,
	})
}
