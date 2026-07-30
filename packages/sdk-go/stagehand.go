package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
)

// Stagehand is the root SDK client.
type Stagehand struct {
	mu                        sync.RWMutex
	initParams                StagehandClientInitParams
	adapters                  clientAdapters
	rpc                       protocolClient
	browser                   *resolvedBrowserSource
	context                   *BrowserContext
	logWriter                 io.Writer
	initialized               bool
	removeLLMHandler          func()
	removeNotificationHandler func()
}

// New creates a Stagehand client. Init performs browser and transport setup.
func New(initParams StagehandClientInitParams) *Stagehand {
	return &Stagehand{
		initParams: initParams,
		adapters:   defaultClientAdapters(),
		logWriter:  os.Stderr,
	}
}

// Context returns the initialized browser context.
func (s *Stagehand) Context() (*BrowserContext, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.context == nil {
		return nil, ErrNotInitialized
	}
	return s.context, nil
}

// Browser returns a detached snapshot of the resolved browser connection.
func (s *Stagehand) Browser() (ResolvedBrowserSource, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.browser == nil {
		return ResolvedBrowserSource{}, ErrNotInitialized
	}
	return s.browser.snapshot(), nil
}

// Initialized reports whether Init completed successfully.
func (s *Stagehand) Initialized() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.initialized
}

// Metrics returns aggregate Stagehand operation metrics.
func (s *Stagehand) Metrics(ctx context.Context) (StagehandMetrics, error) {
	rpc, err := s.connectedProtocol()
	if err != nil {
		return StagehandMetrics{}, err
	}
	var result StagehandMetrics
	err = rpc.call(ctx, "stagehand.metrics", EmptyParams{}, &result)
	return result, err
}

// Act performs an AI-guided action on the selected or active page.
func (s *Stagehand) Act(
	ctx context.Context,
	input any,
	options *StagehandClientActOptions,
) (ActResult, error) {
	rpc, err := s.connectedProtocol()
	if err != nil {
		return ActResult{}, err
	}
	page, err := s.targetPage(ctx, pageFromActOptions(options))
	if err != nil {
		return ActResult{}, err
	}
	var actInput ActInput
	switch value := input.(type) {
	case string:
		actInput = ActInstruction(value)
	case Action:
		actInput = ObservedAction(value)
	default:
		return ActResult{}, fmt.Errorf("act input must be a string or stagehand.Action, got %T", input)
	}
	params := StagehandActParams{PageID: page.PageID(), Input: actInput}
	if options != nil {
		params.Options = &options.ActOptions
	}
	var result ActResult
	if err := rpc.call(ctx, "stagehand.act", params, &result); err != nil {
		return ActResult{}, err
	}
	return result, nil
}

// Observe finds actions on the selected or active page.
func (s *Stagehand) Observe(
	ctx context.Context,
	instruction *string,
	options *StagehandClientObserveOptions,
) (ObserveResult, error) {
	rpc, err := s.connectedProtocol()
	if err != nil {
		return ObserveResult{}, err
	}
	page, err := s.targetPage(ctx, pageFromObserveOptions(options))
	if err != nil {
		return ObserveResult{}, err
	}
	params := StagehandObserveParams{PageID: page.PageID(), Instruction: instruction}
	if options != nil {
		params.Options = &options.ObserveOptions
	}
	var result ObserveResult
	if err := rpc.call(ctx, "stagehand.observe", params, &result); err != nil {
		return ObserveResult{}, err
	}
	return result, nil
}

// Extract returns the generated protocol's dynamic JSON result for the
// selected or active page.
func (s *Stagehand) Extract(
	ctx context.Context,
	instruction string,
	schema json.RawMessage,
	options *StagehandClientExtractOptions,
) (ExtractResult, error) {
	rpc, err := s.connectedProtocol()
	if err != nil {
		return ExtractResult{}, err
	}
	page, err := s.targetPage(ctx, pageFromExtractOptions(options))
	if err != nil {
		return ExtractResult{}, err
	}
	params := StagehandExtractParams{
		PageID: page.PageID(), Instruction: instruction, Schema: schema,
	}
	if options != nil {
		params.Options = &options.ExtractOptions
	}
	var result ExtractResult
	if err := rpc.call(ctx, "stagehand.extract", params, &result); err != nil {
		return ExtractResult{}, err
	}
	return result, nil
}

// ExtractAs decodes an Extract result into a caller-selected Go type.
func ExtractAs[T any](
	ctx context.Context,
	client *Stagehand,
	instruction string,
	schema json.RawMessage,
	options *StagehandClientExtractOptions,
) (T, error) {
	var value T
	result, err := client.Extract(ctx, instruction, schema, options)
	if err != nil {
		return value, err
	}
	if err := json.Unmarshal(result.Data, &value); err != nil {
		return value, fmt.Errorf("decode stagehand.extract result: %w", err)
	}
	return value, nil
}

// Init resolves the browser, connects the protocol transport, and initializes
// the worker. Browser resolution is intentionally stubbed in this first client PR.
func (s *Stagehand) Init(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.initialized {
		return nil
	}
	if s.initParams.Model != nil && s.initParams.Generate != nil {
		return errors.New("stagehand: Model and Generate are mutually exclusive")
	}
	logging, err := resolveLoggingConfig(s.initParams.Logging, s.logWriter)
	if err != nil {
		return err
	}

	browser, err := s.adapters.resolveBrowserSource(ctx, s.initParams)
	if err != nil {
		return fmt.Errorf("resolve browser source: %w", err)
	}
	s.browser = &browser

	rpc, err := s.adapters.connectProtocol(
		ctx,
		browser,
		s.initParams.Telemetry,
		runtimeLogLevel(logging.level),
	)
	if err != nil {
		return errors.Join(
			fmt.Errorf("connect protocol: %w", err),
			s.releaseBrowser(ctx, false),
		)
	}
	s.rpc = rpc
	notificationContext, cancelNotificationHandler := context.WithCancel(context.Background())
	removeNotificationHandler := rpc.onNotification(
		"stagehand.log",
		func(log StagehandLog) {
			if notificationContext.Err() != nil {
				return
			}
			handleStagehandLog(log, logging)
		},
	)
	s.removeNotificationHandler = func() {
		cancelNotificationHandler()
		removeNotificationHandler()
	}
	if generate := s.initParams.Generate; generate != nil {
		s.removeLLMHandler = rpc.onRequest("llm.generate", newRequestHandler(generate))
	}

	initParams := s.workerInitParams(browser)
	var initResult StagehandInitResult
	if err := rpc.call(ctx, "stagehand.init", initParams, &initResult); err != nil {
		return s.initFailure(ctx, err)
	}

	s.context = &BrowserContext{rpc: rpc}
	s.initialized = true
	return nil
}

// Close releases the remote Stagehand context and all local resources.
func (s *Stagehand) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var closeErr error
	if s.context != nil && s.rpc != nil {
		var result StagehandCloseResult
		closeErr = s.rpc.call(ctx, "stagehand.close", EmptyParams{}, &result)
		if errors.Is(closeErr, ErrCDPConnectionClosed) {
			closeErr = nil
		}
	}
	cleanupErr := s.release(ctx, true)
	return errors.Join(closeErr, cleanupErr)
}

func (s *Stagehand) connectedProtocol() (protocolClient, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.initialized || s.rpc == nil {
		return nil, ErrNotInitialized
	}
	return s.rpc, nil
}

func (s *Stagehand) workerInitParams(browser resolvedBrowserSource) StagehandInitParams {
	params := StagehandInitParams{
		APIKey:             s.initParams.APIKey,
		Cache:              s.initParams.Cache,
		DOMSettleTimeoutMs: s.initParams.DOMSettleTimeoutMs,
		SelfHeal:           s.initParams.SelfHeal,
		SystemPrompt:       s.initParams.SystemPrompt,
		Telemetry:          s.initParams.Telemetry,
	}
	if s.initParams.Generate != nil {
		model := ClientModel()
		params.Model = &model
	} else if s.initParams.Model != nil {
		model := ServerModel(*s.initParams.Model)
		params.Model = &model
	}
	var source *BrowserbaseClientBrowserSource
	switch browser := s.initParams.Browser.(type) {
	case BrowserbaseClientBrowserSource:
		source = &browser
	case *BrowserbaseClientBrowserSource:
		source = browser
	case nil:
		source = &BrowserbaseClientBrowserSource{}
	}
	if source != nil {
		params.Browser = &BrowserbaseBrowserSource{
			BrowserSettings: source.BrowserSettings,
			ExtensionID:     source.ExtensionID,
			KeepAlive:       source.KeepAlive,
			Proxies:         source.Proxies,
			Region:          source.Region,
			SessionID:       browser.browserbaseSessionID,
			Timeout:         source.Timeout,
			Type:            "browserbase",
			UserMetadata:    source.UserMetadata,
		}
	}
	return params
}

func (s *Stagehand) targetPage(ctx context.Context, page *Page) (*Page, error) {
	if page != nil {
		return page, nil
	}
	browserContext, err := s.Context()
	if err != nil {
		return nil, err
	}
	page, err = browserContext.ActivePage(ctx)
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, errors.New("stagehand: no active page")
	}
	return page, nil
}

func pageFromActOptions(options *StagehandClientActOptions) *Page {
	if options == nil {
		return nil
	}
	return options.Page
}

func pageFromObserveOptions(options *StagehandClientObserveOptions) *Page {
	if options == nil {
		return nil
	}
	return options.Page
}

func pageFromExtractOptions(options *StagehandClientExtractOptions) *Page {
	if options == nil {
		return nil
	}
	return options.Page
}

func (s *Stagehand) initFailure(ctx context.Context, cause error) error {
	cleanupErr := s.release(ctx, false)
	if cleanupErr != nil {
		return errors.Join(cause, cleanupErr)
	}
	return cause
}

func (s *Stagehand) release(ctx context.Context, preserveKeepAlive bool) error {
	if s.removeLLMHandler != nil {
		s.removeLLMHandler()
		s.removeLLMHandler = nil
	}
	if s.removeNotificationHandler != nil {
		s.removeNotificationHandler()
		s.removeNotificationHandler = nil
	}
	var rpcErr error
	if s.rpc != nil {
		rpcErr = s.rpc.close()
		s.rpc = nil
	}
	browserErr := s.releaseBrowser(ctx, preserveKeepAlive)
	s.context = nil
	s.initialized = false
	return errors.Join(rpcErr, browserErr)
}

func (s *Stagehand) releaseBrowser(ctx context.Context, preserveKeepAlive bool) error {
	if s.browser == nil {
		return nil
	}
	browser := s.browser
	s.browser = nil

	if preserveKeepAlive && browser.keepAlive {
		return nil
	}
	var browserErr error
	if browser.close != nil {
		browserErr = browser.close(ctx)
	}
	var cleanupErr error
	if browser.cleanup != nil {
		cleanupErr = browser.cleanup()
	}
	return errors.Join(browserErr, cleanupErr)
}

func handleStagehandLog(log StagehandLog, logging resolvedStagehandClientLoggingConfig) {
	if !isClientLogLevelEnabled(log.Level, logging.level) {
		return
	}
	rendered, err := renderStagehandLog(log, logging.format)
	if err != nil {
		fmt.Fprintf(logging.writer, "[stagehand] ERROR render log failed: %v\n", err)
		return
	}
	fmt.Fprintln(logging.writer, rendered)
	if logging.onLog == nil {
		return
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintf(
				logging.writer,
				"[stagehand] ERROR onLog callback failed: %v\n",
				recovered,
			)
		}
	}()
	logging.onLog(log)
}

func isClientLogLevelEnabled(
	level StagehandLogLevel,
	threshold StagehandClientLogLevel,
) bool {
	logPriority, ok := clientLogLevelPriority(string(level))
	if !ok {
		return false
	}
	thresholdPriority, ok := clientLogLevelPriority(string(threshold))
	if !ok {
		return false
	}
	return logPriority >= thresholdPriority
}

func clientLogLevelPriority(level string) (int, bool) {
	switch level {
	case string(StagehandClientLogLevelDebug):
		return 10, true
	case string(StagehandClientLogLevelInfo):
		return 20, true
	case string(StagehandClientLogLevelWarn):
		return 30, true
	case string(StagehandClientLogLevelError):
		return 40, true
	case string(StagehandClientLogLevelOff):
		return int(^uint(0) >> 1), true
	default:
		return 0, false
	}
}

func renderStagehandLog(
	log StagehandLog,
	format StagehandClientLogFormat,
) (string, error) {
	if format == StagehandClientLogFormatJSON {
		record := struct {
			Level   StagehandLogLevel `json:"level"`
			Message string            `json:"message"`
			Data    StagehandLogData  `json:"data"`
		}{Level: log.Level, Message: log.Message, Data: log.Data}
		encoded, err := json.Marshal(record)
		return string(encoded), err
	}
	data, err := json.Marshal(log.Data)
	if err != nil {
		return "", err
	}
	suffix := ""
	if len(log.Data) != 0 {
		suffix = " " + string(data)
	}
	return fmt.Sprintf(
		"[stagehand] %s %s%s",
		strings.ToUpper(string(log.Level)),
		log.Message,
		suffix,
	), nil
}

func newStagehandWithClient(initParams StagehandClientInitParams, rpc protocolClient) *Stagehand {
	client := New(initParams)
	client.adapters = clientAdapters{
		resolveBrowserSource: func(context.Context, StagehandClientInitParams) (resolvedBrowserSource, error) {
			return resolvedBrowserSource{cdpURL: "test://stagehand", keepAlive: true}, nil
		},
		connectProtocol: func(
			ctx context.Context,
			browser resolvedBrowserSource,
			telemetry TelemetryConfig,
			logLevel RuntimeConfigureParamsLogLevel,
		) (protocolClient, error) {
			if err := configureProtocol(
				ctx,
				rpc,
				browser,
				telemetry,
				logLevel,
			); err != nil {
				return nil, err
			}
			return rpc, nil
		},
	}
	return client
}
