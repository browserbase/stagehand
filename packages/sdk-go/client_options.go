package stagehand

import (
	"context"
	"encoding/json"
)

// BrowserSource is an SDK-owned browser configuration. It is resolved before
// the generated StagehandInitParams value crosses the protocol boundary.
type BrowserSource interface {
	isBrowserSource()
}

// LocalBrowserSource configures a Chromium process launched by the SDK.
type LocalBrowserSource struct {
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
	KeepAlive           bool
}

func (LocalBrowserSource) isBrowserSource() {}

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

// CDPBrowserSource attaches to an existing Chrome DevTools Protocol endpoint.
type CDPBrowserSource struct {
	CDPURL  string
	Headers map[string]string
}

func (CDPBrowserSource) isBrowserSource() {}

// BrowserbaseClientBrowserSource contains the session creation fields accepted
// by SDK clients. The resolver supplies the session ID required by the wire type.
type BrowserbaseClientBrowserSource struct {
	BrowserSettings *BrowserbaseBrowserSettings
	ExtensionID     *string
	KeepAlive       *bool
	Proxies         *BrowserbaseProxies
	Region          *BrowserbaseRegion
	Timeout         *float64
	UserMetadata    map[string]json.RawMessage
}

func (BrowserbaseClientBrowserSource) isBrowserSource() {}

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

// StagehandClientInitParams extends the generated worker init shape with the
// two client-only unions: browser setup and an optional local LLM callback.
type StagehandClientInitParams struct {
	APIKey             *string
	Browser            BrowserSource
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
