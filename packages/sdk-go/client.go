package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

var (
	// ErrNotInitialized is returned when an operation needs an initialized client.
	ErrNotInitialized = errors.New("stagehand is unavailable; create a new instance with stagehand.Create")
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
	onPageCDPEvent(handler func(PageCDPEventNotification)) func()
	browserWebSocketDebuggerURL() string
	close() error
}

type resolvedBrowserSource struct {
	cdpURL               string
	browserbaseSessionID string
	close                func(context.Context) error
}

type clientAdapters struct {
	connectClaimedBrowser func(claimedBrowser) (protocolClient, error)
}

func defaultClientAdapters() clientAdapters {
	return clientAdapters{
		connectClaimedBrowser: func(claimed claimedBrowser) (protocolClient, error) {
			if claimed.cdp == nil {
				return nil, errors.New("stagehand browser must be created by a stagehand browser factory")
			}
			rpc, err := newRPCClient(claimed.cdp, false)
			if err != nil {
				return nil, err
			}
			rpc.browserWebSocketURL = claimed.cdp.webSocketDebuggerURL
			return rpc, nil
		},
	}
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
