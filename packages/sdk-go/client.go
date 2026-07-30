package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

var (
	// ErrNotInitialized is returned when an operation needs an initialized client.
	ErrNotInitialized = errors.New("stagehand is not initialized; call Init first")
)

type requestHandler struct {
	decode func(json.RawMessage) (any, error)
	handle func(context.Context, any) (any, error)
	encode func(any) (json.RawMessage, error)
}

// protocolClient is deliberately private. The public SDK exposes generated
// protocol values and domain wrappers, not its JSON-RPC transport.
type protocolClient interface {
	call(ctx context.Context, method string, params any, result any) error
	onRequest(method string, handler requestHandler) func()
	onNotification(method string, handler func(StagehandLog)) func()
	close() error
}

type resolvedBrowserSource struct {
	cdpURL               string
	cdpHeaders           http.Header
	browserbaseSessionID string
	extensionDir         string
	preloadedExtension   bool
	connectTimeout       time.Duration
	keepAlive            bool
	close                func(context.Context) error
	cleanup              func() error
}

// ResolvedBrowserSource is a detached snapshot of the browser connection
// selected during Init. It intentionally excludes SDK-owned lifecycle and
// temporary-extension state.
type ResolvedBrowserSource struct {
	CDPURL               string
	CDPHeaders           map[string]string
	BrowserbaseSessionID string
	PreloadedExtension   bool
	ConnectTimeout       time.Duration
	KeepAlive            bool
}

func (browser resolvedBrowserSource) snapshot() ResolvedBrowserSource {
	var headers map[string]string
	if len(browser.cdpHeaders) > 0 {
		headers = make(map[string]string, len(browser.cdpHeaders))
		for name := range browser.cdpHeaders {
			headers[name] = browser.cdpHeaders.Get(name)
		}
	}
	return ResolvedBrowserSource{
		CDPURL:               browser.cdpURL,
		CDPHeaders:           headers,
		BrowserbaseSessionID: browser.browserbaseSessionID,
		PreloadedExtension:   browser.preloadedExtension,
		ConnectTimeout:       browser.connectTimeout,
		KeepAlive:            browser.keepAlive,
	}
}

type clientAdapters struct {
	resolveBrowserSource func(context.Context, StagehandClientInitParams) (resolvedBrowserSource, error)
	connectProtocol      func(
		context.Context,
		resolvedBrowserSource,
		TelemetryConfig,
		RuntimeConfigureParamsLogLevel,
	) (protocolClient, error)
}

func defaultClientAdapters() clientAdapters {
	return clientAdapters{
		resolveBrowserSource: resolveBrowserSource,
		connectProtocol:      connectResolvedBrowser,
	}
}

// configureProtocol is transport setup, matching the TypeScript and Python
// RPC clients rather than the public Stagehand.Init method.
func configureProtocol(
	ctx context.Context,
	rpc protocolClient,
	browser resolvedBrowserSource,
	telemetry TelemetryConfig,
	logLevel RuntimeConfigureParamsLogLevel,
) error {
	params := RuntimeConfigureParams{
		ProtocolVersion: stagehandProtocolVersion,
		ClientInfo: ImplementationInfo{
			Name:    stagehandSDKClientName,
			Version: stagehandSDKVersion,
		},
		CDPURL:    browser.cdpURL,
		LogLevel:  logLevel,
		Telemetry: telemetry,
	}
	var result RuntimeConfigureResult
	return rpc.call(ctx, "runtime.configure", params, &result)
}

type resolvedStagehandClientLoggingConfig struct {
	level  StagehandClientLogLevel
	format StagehandClientLogFormat
	onLog  func(StagehandLog)
	writer io.Writer
}

func resolveLoggingConfig(
	config *StagehandClientLoggingConfig,
	writer io.Writer,
) (resolvedStagehandClientLoggingConfig, error) {
	resolved := resolvedStagehandClientLoggingConfig{
		level:  StagehandClientLogLevelInfo,
		format: StagehandClientLogFormatPretty,
		writer: writer,
	}
	if config != nil {
		if config.Level != "" {
			resolved.level = config.Level
		}
		if config.Format != "" {
			resolved.format = config.Format
		}
		resolved.onLog = config.OnLog
	}
	if !validClientLogLevel(resolved.level) {
		return resolvedStagehandClientLoggingConfig{}, fmt.Errorf(
			"stagehand: invalid logging level %q",
			resolved.level,
		)
	}
	if resolved.format != StagehandClientLogFormatPretty &&
		resolved.format != StagehandClientLogFormatJSON {
		return resolvedStagehandClientLoggingConfig{}, fmt.Errorf(
			"stagehand: invalid logging format %q",
			resolved.format,
		)
	}
	return resolved, nil
}

func validClientLogLevel(level StagehandClientLogLevel) bool {
	switch level {
	case StagehandClientLogLevelOff,
		StagehandClientLogLevelError,
		StagehandClientLogLevelWarn,
		StagehandClientLogLevelInfo,
		StagehandClientLogLevelDebug:
		return true
	default:
		return false
	}
}

func runtimeLogLevel(
	level StagehandClientLogLevel,
) RuntimeConfigureParamsLogLevel {
	return RuntimeConfigureParamsLogLevel(level)
}
