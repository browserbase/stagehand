package stagehand

import (
	"context"
)

// IgnoreDefaultArgs selects which of Stagehand's default Chrome arguments to
// omit. All takes precedence over Args.
type IgnoreDefaultArgs struct {
	All  bool
	Args []string
}

// LocalProxyConfig configures an upstream proxy for a local browser.
type LocalProxyConfig struct {
	Server   string
	Bypass   string
	Username string
	Password string
}

// LocalViewport configures the initial local browser viewport.
type LocalViewport struct {
	Width  int
	Height int
}

// LLMGenerateFunc lets the service worker delegate generation to caller code.
type LLMGenerateFunc func(context.Context, LLMGenerateParams) (LLMGenerateResult, error)

// StagehandClientLoggingConfig controls client-side handling of runtime log notifications.
type StagehandClientLoggingConfig struct {
	Level  StagehandClientLogLevel
	Format StagehandClientLogFormat
	OnLog  func(StagehandLog)
}

// StagehandClientLogLevel controls which runtime log notifications the SDK emits.
type StagehandClientLogLevel string

const (
	StagehandClientLogLevelOff   StagehandClientLogLevel = "off"
	StagehandClientLogLevelError StagehandClientLogLevel = "error"
	StagehandClientLogLevelWarn  StagehandClientLogLevel = "warn"
	StagehandClientLogLevelInfo  StagehandClientLogLevel = "info"
	StagehandClientLogLevelDebug StagehandClientLogLevel = "debug"
)

// StagehandClientLogFormat controls terminal rendering of runtime logs.
type StagehandClientLogFormat string

const (
	StagehandClientLogFormatPretty StagehandClientLogFormat = "pretty"
	StagehandClientLogFormatJSON   StagehandClientLogFormat = "json"
)

// CreateOptions configures Stagehand over a factory-created Browser handle.
type CreateOptions struct {
	Browser            *Browser
	APIKey             *string
	Cache              *Caching
	DOMSettleTimeoutMs *int
	Model              *ModelConfig
	Generate           LLMGenerateFunc
	Logging            *StagehandClientLoggingConfig
	SelfHeal           *bool
	SystemPrompt       *string
	Telemetry          TelemetryConfig
}

// StagehandClientActOptions adds an optional SDK Page to the generated
// protocol options. Page never crosses the JSON-RPC boundary.
type StagehandClientActOptions struct {
	ActOptions
	Page *Page
}

// StagehandClientObserveOptions adds an optional SDK Page to the generated
// protocol options. Page never crosses the JSON-RPC boundary.
type StagehandClientObserveOptions struct {
	ObserveOptions
	Page *Page
}

// StagehandClientExtractOptions adds an optional SDK Page to the generated
// protocol options. Page never crosses the JSON-RPC boundary.
type StagehandClientExtractOptions struct {
	ExtractOptions
	Page *Page
}
