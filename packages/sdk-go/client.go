package stagehand

import (
	"context"
	"encoding/json"
	"errors"
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

type clientAdapters struct {
	resolveBrowserSource func(context.Context, StagehandClientInitParams) (resolvedBrowserSource, error)
	connectProtocol      func(
		context.Context,
		resolvedBrowserSource,
		TelemetryConfig,
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
) error {
	params := RuntimeConfigureParams{
		ProtocolVersion: stagehandProtocolVersion,
		ClientInfo: ImplementationInfo{
			Name:    stagehandSDKClientName,
			Version: stagehandSDKVersion,
		},
		CDPURL:    browser.cdpURL,
		Telemetry: telemetry,
	}
	var result RuntimeConfigureResult
	return rpc.call(ctx, "runtime.configure", params, &result)
}
