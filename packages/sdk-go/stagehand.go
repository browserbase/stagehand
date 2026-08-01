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
	attachedBrowser           *Browser
}

// New creates a Stagehand client. Init performs browser and transport setup.
func New(initParams StagehandClientInitParams) *Stagehand {
	return &Stagehand{
		initParams: initParams,
		adapters:   defaultClientAdapters(),
		logWriter:  os.Stderr,
	}
}

// Create attaches Stagehand to a factory-created Browser handle.
func Create(ctx context.Context, options CreateOptions) (*Stagehand, error) {
	return createWithAdapters(ctx, options, defaultClientAdapters())
}

func createWithAdapters(ctx context.Context, options CreateOptions, adapters clientAdapters) (*Stagehand, error) {
	if options.Browser == nil {
		return nil, errors.New("stagehand: browser is required")
	}
	if options.Model != nil && options.Generate != nil {
		return nil, errors.New("stagehand: Model and Generate are mutually exclusive")
	}
	logging, err := resolveLoggingConfig(options.Logging, os.Stderr)
	if err != nil {
		return nil, err
	}
	claimed, err := claimBrowser(options.Browser)
	if err != nil {
		return nil, err
	}
	rpc, err := adapters.connectClaimedBrowser(claimed)
	if err != nil {
		releaseBrowserClaim(options.Browser)
		return nil, fmt.Errorf("connect claimed browser: %w", err)
	}
	client := &Stagehand{
		adapters: adapters, rpc: rpc, logWriter: os.Stderr,
	}
	notificationContext, cancelNotificationHandler := context.WithCancel(context.Background())
	removeNotificationHandler := rpc.onNotification("stagehand.log", func(log StagehandLog) {
		if notificationContext.Err() == nil {
			handleStagehandLog(log, logging)
		}
	})
	client.removeNotificationHandler = func() {
		cancelNotificationHandler()
		removeNotificationHandler()
	}
	if options.Generate != nil {
		client.removeLLMHandler = rpc.onRequest("llm.generate", newRequestHandler(options.Generate))
	}

	apiKey := options.APIKey
	if claimed.workerAPIKey != nil {
		apiKey = claimed.workerAPIKey
	}
	initParams := workerInitParams(workerInitOptions{
		apiKey: apiKey, browser: claimed.workerBrowser, cache: options.Cache,
		domSettleTimeoutMs: options.DOMSettleTimeoutMs, model: options.Model,
		generate: options.Generate, logLevel: logging.level,
		selfHeal: options.SelfHeal, systemPrompt: options.SystemPrompt,
		telemetry: options.Telemetry, browserCDPURL: rpc.browserWebSocketDebuggerURL(),
	})
	var initResult StagehandInitResult
	if err := rpc.call(ctx, "stagehand.init", initParams, &initResult); err != nil {
		if client.removeLLMHandler != nil {
			client.removeLLMHandler()
		}
		client.removeNotificationHandler()
		closeErr := rpc.close()
		releaseBrowserClaim(options.Browser)
		return nil, errors.Join(err, closeErr)
	}
	client.context = &BrowserContext{rpc: rpc}
	client.initialized = true
	client.attachedBrowser = options.Browser
	return client, nil
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
	instruction any,
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
	var actInstruction ActInstructionValue
	switch value := instruction.(type) {
	case string:
		actInstruction = ActInstruction(value)
	case Action:
		actInstruction = ObservedAction(value)
	default:
		return ActResult{}, fmt.Errorf(
			"act instruction must be a string or stagehand.Action, got %T",
			instruction,
		)
	}
	params := StagehandActParams{PageID: page.PageID(), Instruction: actInstruction}
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

	var browserMeta *BrowserSessionMetadata
	var source *BrowserbaseClientBrowserSource
	switch configured := s.initParams.Browser.(type) {
	case BrowserbaseClientBrowserSource:
		source = &configured
	case *BrowserbaseClientBrowserSource:
		source = configured
	case nil:
		source = &BrowserbaseClientBrowserSource{}
	}
	if source != nil {
		browserMeta = &BrowserSessionMetadata{Region: source.Region, SessionID: browser.browserbaseSessionID}
	}
	initParams := workerInitParams(workerInitOptions{
		apiKey: s.initParams.APIKey, browser: browserMeta, cache: s.initParams.Cache,
		domSettleTimeoutMs: s.initParams.DOMSettleTimeoutMs, model: s.initParams.Model,
		generate: s.initParams.Generate, logLevel: logging.level,
		selfHeal: s.initParams.SelfHeal, systemPrompt: s.initParams.SystemPrompt,
		telemetry: s.initParams.Telemetry, browserCDPURL: rpc.browserWebSocketDebuggerURL(),
	})
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

type workerInitOptions struct {
	apiKey             *string
	browser            *BrowserSessionMetadata
	cache              *Caching
	domSettleTimeoutMs *int
	model              *ModelConfig
	generate           LLMGenerateFunc
	logLevel           StagehandClientLogLevel
	selfHeal           *bool
	systemPrompt       *string
	telemetry          TelemetryConfig
	browserCDPURL      string
}

func workerInitParams(options workerInitOptions) StagehandInitParams {
	params := StagehandInitParams{
		APIKey:        options.apiKey,
		Browser:       options.browser,
		BrowserCDPURL: &options.browserCDPURL,
		Cache:         options.cache,
		ClientInfo: ImplementationInfo{
			Name:    stagehandSDKClientName,
			Version: stagehandSDKVersion,
		},
		DOMSettleTimeoutMs: options.domSettleTimeoutMs,
		LogLevel:           StagehandInitParamsLogLevel(options.logLevel),
		ProtocolVersion:    stagehandProtocolVersion,
		SelfHeal:           options.selfHeal,
		SystemPrompt:       options.systemPrompt,
		Telemetry:          options.telemetry,
	}
	if options.generate != nil {
		model := ClientModel()
		params.Model = &model
	} else if options.model != nil {
		model := ServerModel(*options.model)
		params.Model = &model
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
			_ context.Context,
			_ resolvedBrowserSource,
		) (protocolClient, error) {
			return rpc, nil
		},
		connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) {
			return rpc, nil
		},
	}
	return client
}
