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
	APIURL             *string
	Cache              *Caching
	DOMSettleTimeoutMs *int
	Model              *ModelConfig
	Generate           LLMGenerateFunc
	Logging            *StagehandClientLoggingConfig
	SelfHeal           *bool
	SystemPrompt       *string
	Telemetry          TelemetryConfig
}

// StagehandClientActOptions configures act calls. Page and PageLocator
// wrappers never cross the JSON-RPC boundary.
type StagehandClientActOptions struct {
	Page           *Page
	Cache          *Caching
	Model          *ModelConfig
	Timeout        *float64
	Variables      Variables
	Locator        *PageLocator
	IgnoreLocators []*PageLocator
}

// StagehandClientObserveOptions configures observe calls. Page and PageLocator
// wrappers never cross the JSON-RPC boundary.
type StagehandClientObserveOptions struct {
	Page           *Page
	Cache          *Caching
	Model          *ModelConfig
	Timeout        *float64
	Variables      Variables
	Locator        *PageLocator
	IgnoreLocators []*PageLocator
}

// StagehandClientExtractOptions configures extract calls. Page and PageLocator
// wrappers never cross the JSON-RPC boundary.
type StagehandClientExtractOptions struct {
	Page           *Page
	Cache          *Caching
	Model          *ModelConfig
	Screenshot     *bool
	Timeout        *float64
	Locator        *PageLocator
	IgnoreLocators []*PageLocator
}
