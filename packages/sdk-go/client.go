package stagehand

import (
	"context"
	"encoding/json"
	"errors"
)

var (
	// ErrNotInitialized is returned when an operation needs an initialized client.
	ErrNotInitialized = errors.New("stagehand is not initialized; call Init first")
	// ErrBrowserSourceNotImplemented marks the intentionally deferred browser bootstrap.
	ErrBrowserSourceNotImplemented = errors.New("stagehand Go browser source setup is not implemented")
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
	browserbaseSessionID string
	keepAlive            bool
	close                func(context.Context) error
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
		resolveBrowserSource: func(context.Context, StagehandClientInitParams) (resolvedBrowserSource, error) {
			// TODO(go-client): launch/connect local, CDP, and Browserbase sources.
			return resolvedBrowserSource{}, ErrBrowserSourceNotImplemented
		},
		connectProtocol: func(
			context.Context,
			resolvedBrowserSource,
			TelemetryConfig,
		) (protocolClient, error) {
			// Browser setup will also construct the CDP-backed JSON-RPC transport.
			return nil, ErrBrowserSourceNotImplemented
		},
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
	protocolVersion := stagehandProtocolVersion
	params := RuntimeConfigureParams{
		ProtocolVersion: &protocolVersion,
		ClientInfo: &ImplementationInfo{
			Name:    stagehandSDKClientName,
			Version: stagehandSDKVersion,
		},
		CDPURL:    browser.cdpURL,
		Telemetry: telemetry,
	}
	var result RuntimeConfigureResult
	return rpc.call(ctx, "runtime.configure", params, &result)
}
