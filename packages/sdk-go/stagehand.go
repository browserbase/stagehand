package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"strings"
	"sync"
	"time"
)

const (
	stagehandInitTimeout           = 60 * time.Second
	stagehandFailureCleanupTimeout = 5 * time.Second
)

// Stagehand is the root SDK client.
type Stagehand struct {
	mu                        sync.RWMutex
	rpc                       protocolClient
	browser                   *Browser
	initialized               bool
	closed                    bool
	closeResult               error
	removeLLMHandler          func()
	removeNotificationHandler func()
}

// Create attaches Stagehand to a factory-created Browser handle.
func Create(ctx context.Context, options CreateOptions) (*Stagehand, error) {
	return createWithAdapters(ctx, options, defaultClientAdapters(), os.Stderr)
}

func createWithAdapters(ctx context.Context, options CreateOptions, adapters clientAdapters, writers ...io.Writer) (*Stagehand, error) {
	if ctx == nil {
		return nil, errors.New("stagehand initialization context is required")
	}
	initCtx, cancelInit := context.WithTimeout(ctx, stagehandInitTimeout)
	defer cancelInit()
	if options.Browser == nil {
		return nil, errors.New("stagehand: browser is required")
	}
	if options.Model != nil && options.Generate != nil {
		return nil, errors.New("stagehand: Model and Generate are mutually exclusive")
	}
	logWriter := io.Writer(os.Stderr)
	if len(writers) > 0 {
		logWriter = writers[0]
	}
	logging, err := resolveLoggingConfig(options.Logging, logWriter)
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
	client := &Stagehand{rpc: rpc, browser: options.Browser}
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
		apiKey: apiKey, apiURL: options.APIURL, browser: claimed.workerBrowser, cache: options.Cache,
		domSettleTimeoutMs: options.DOMSettleTimeoutMs, model: options.Model,
		generate: options.Generate, logLevel: logging.level,
		selfHeal: options.SelfHeal, systemPrompt: options.SystemPrompt,
		telemetry: options.Telemetry, browserCDPURL: rpc.browserWebSocketDebuggerURL(),
	})
	var initResult StagehandInitResult
	if err := rpc.call(initCtx, "stagehand.init", initParams, &initResult); err != nil {
		if client.removeLLMHandler != nil {
			client.removeLLMHandler()
		}
		client.removeNotificationHandler()
		closeErr := rpc.close()
		var rpcError *RPCError
		if errors.As(err, &rpcError) {
			// A JSON-RPC error proves the worker settled stagehand.init, so the
			// Browser can safely be claimed by a later Create call.
			releaseBrowserClaim(options.Browser)
			return nil, errors.Join(err, closeErr)
		}
		// Cancellation and transport/decode failures do not prove whether the
		// worker completed initialization. Invalidate the Browser and transport
		// so the same handle cannot be retried against uncertain server state.
		cleanupCtx, cancelCleanup := context.WithTimeout(
			context.WithoutCancel(ctx),
			stagehandFailureCleanupTimeout,
		)
		browserErr := options.Browser.invalidate(cleanupCtx)
		cancelCleanup()
		return nil, errors.Join(err, closeErr, browserErr)
	}
	browserContext := &BrowserContext{
		rpc:          rpc,
		closeBrowser: client.browser.Close,
		reportPageEventListenerPanic: func(recovered any) {
			reportClientCallbackPanic(logging, "page event listener", recovered)
		},
	}
	if err := attachBrowserContext(client.browser, browserContext); err != nil {
		if client.removeLLMHandler != nil {
			client.removeLLMHandler()
		}
		client.removeNotificationHandler()
		rpcErr := rpc.close()
		releaseBrowserClaim(options.Browser)
		return nil, errors.Join(err, rpcErr)
	}
	client.initialized = true
	return client, nil
}

// Browser returns the factory-created browser handle attached to Stagehand.
func (s *Stagehand) Browser() *Browser {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.browser
}

// Initialized reports whether Create completed successfully and the client remains open.
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

// ExperimentalBatch runs trusted JavaScript against the worker-local public Stagehand object model.
func (s *Stagehand) ExperimentalBatch(
	ctx context.Context,
	source string,
	input any,
	result any,
	options ExperimentalBatchOptions,
) error {
	if ctx == nil {
		return errors.New("stagehand callback batch context is required")
	}
	if strings.TrimSpace(source) == "" {
		return errors.New("stagehand callback batch source must be JavaScript")
	}
	resultValue := reflect.ValueOf(result)
	if result == nil || resultValue.Kind() != reflect.Pointer || resultValue.IsNil() {
		return errors.New("stagehand callback batch result must be a non-nil pointer")
	}
	timeout := options.Timeout
	if timeout == 0 {
		timeout = defaultExperimentalBatchTimeout
	}
	if timeout < time.Millisecond {
		return errors.New("stagehand callback batch timeout must be at least one millisecond")
	}
	timeoutMilliseconds := timeout.Milliseconds()
	if timeoutMilliseconds > maxExperimentalBatchTimeoutMilliseconds {
		return errors.New("stagehand callback batch timeout exceeds the maximum supported timeout")
	}
	rpc, err := s.connectedProtocol()
	if err != nil {
		return err
	}
	pageID := ""
	if options.Page != nil {
		pageID = options.Page.PageID()
		if pageID == "" {
			return errors.New("stagehand callback batch page must have a non-empty page ID")
		}
	}
	var inputJSON json.RawMessage
	if input != nil {
		inputJSON, err = json.Marshal(input)
		if err != nil {
			return fmt.Errorf("stagehand callback batch input must be JSON-serializable: %w", err)
		}
	}
	params := CallbackBatchParams{
		CallbackSource: source,
		Input:          inputJSON,
		Options: CallbackBatchOptions{
			Timeout: int(timeoutMilliseconds),
		},
	}
	if pageID != "" {
		params.Options.PageID = &pageID
	}
	var batchResult CallbackBatchResult
	if err := rpc.call(
		ctx,
		"stagehand.callback_batch",
		params,
		&batchResult,
	); err != nil {
		return err
	}
	if len(batchResult.Value) == 0 {
		batchResult.Value = json.RawMessage("null")
	}
	if err := json.Unmarshal(batchResult.Value, result); err != nil {
		return fmt.Errorf("decode stagehand callback batch result: %w", err)
	}
	return nil
}

// Act performs an AI-guided action on the selected or active page.
func (s *Stagehand) Act(
	ctx context.Context,
	instruction ActInstructionValue,
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
	params := StagehandActParams{PageID: page.PageID(), Instruction: instruction}
	if options != nil {
		protocolOptions, err := actProtocolOptions(options, page.PageID())
		if err != nil {
			return ActResult{}, err
		}
		params.Options = protocolOptions
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
		protocolOptions, err := observeProtocolOptions(options, page.PageID())
		if err != nil {
			return ObserveResult{}, err
		}
		params.Options = protocolOptions
	}
	var result ObserveResult
	if err := rpc.call(ctx, "stagehand.observe", params, &result); err != nil {
		return ObserveResult{}, err
	}
	return result, nil
}

// Close releases the remote Stagehand context without touching the Browser handle.
func (s *Stagehand) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return s.closeResult
	}

	var closeErr error
	shouldReleaseBrowserClaim := !s.initialized
	if s.initialized && s.rpc != nil {
		var result StagehandCloseResult
		closeErr = s.rpc.call(ctx, "stagehand.close", EmptyParams{}, &result)
		if errors.Is(closeErr, ErrCDPConnectionClosed) {
			closeErr = nil
			shouldReleaseBrowserClaim = true
		} else if closeErr == nil {
			shouldReleaseBrowserClaim = true
		}
	}
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
	detachBrowserContext(s.browser)
	if shouldReleaseBrowserClaim {
		releaseBrowserClaim(s.browser)
	}
	s.initialized = false
	s.closed = true
	s.closeResult = errors.Join(closeErr, rpcErr)
	return s.closeResult
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
	apiURL             *string
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
		APIURL:        options.apiURL,
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
	browserContext, err := s.browser.Context()
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

func locatorDescriptorForPage(locator *PageLocator, pageID string, method string) (Locator, error) {
	if locator == nil {
		return Locator{}, nil
	}
	descriptor := locator.Descriptor()
	if descriptor.PageID != pageID {
		return Locator{}, fmt.Errorf("%s: locator must belong to the target page", method)
	}
	return Locator{Selector: descriptor.Selector, Nth: descriptor.Nth}, nil
}

func locatorDescriptorsForPage(locators []*PageLocator, pageID string, method string) ([]Locator, error) {
	if locators == nil {
		return nil, nil
	}
	descriptors := make([]Locator, 0, len(locators))
	for index, locator := range locators {
		if locator == nil {
			return nil, fmt.Errorf("%s: ignore locator at index %d is nil", method, index)
		}
		descriptor, err := locatorDescriptorForPage(locator, pageID, method)
		if err != nil {
			return nil, err
		}
		descriptors = append(descriptors, descriptor)
	}
	return descriptors, nil
}

func protocolLocatorsForPage(
	locator *PageLocator,
	ignoreLocators []*PageLocator,
	pageID string,
	method string,
) (*Locator, []Locator, error) {
	var protocolLocator *Locator
	if locator != nil {
		descriptor, err := locatorDescriptorForPage(locator, pageID, method)
		if err != nil {
			return nil, nil, err
		}
		protocolLocator = &descriptor
	}
	protocolIgnoreLocators, err := locatorDescriptorsForPage(ignoreLocators, pageID, method)
	if err != nil {
		return nil, nil, err
	}
	return protocolLocator, protocolIgnoreLocators, nil
}

func actProtocolOptions(options *StagehandClientActOptions, pageID string) (*ActOptions, error) {
	if options == nil {
		return nil, nil
	}
	locator, ignoreLocators, err := protocolLocatorsForPage(
		options.Locator,
		options.IgnoreLocators,
		pageID,
		"stagehand.Act",
	)
	if err != nil {
		return nil, err
	}
	protocolOptions := ActOptions{
		Cache:          options.Cache,
		IgnoreLocators: ignoreLocators,
		Locator:        locator,
		Model:          options.Model,
		Timeout:        options.Timeout,
		Variables:      options.Variables,
	}
	return &protocolOptions, nil
}

func observeProtocolOptions(options *StagehandClientObserveOptions, pageID string) (*ObserveOptions, error) {
	if options == nil {
		return nil, nil
	}
	locator, ignoreLocators, err := protocolLocatorsForPage(
		options.Locator,
		options.IgnoreLocators,
		pageID,
		"stagehand.Observe",
	)
	if err != nil {
		return nil, err
	}
	protocolOptions := ObserveOptions{
		Cache:          options.Cache,
		IgnoreLocators: ignoreLocators,
		Locator:        locator,
		Model:          options.Model,
		Timeout:        options.Timeout,
		Variables:      options.Variables,
	}
	return &protocolOptions, nil
}

func extractProtocolOptions(options *StagehandClientExtractOptions, pageID string) (*ExtractOptions, error) {
	if options == nil {
		return nil, nil
	}
	locator, ignoreLocators, err := protocolLocatorsForPage(
		options.Locator,
		options.IgnoreLocators,
		pageID,
		"stagehand.Extract",
	)
	if err != nil {
		return nil, err
	}
	protocolOptions := ExtractOptions{
		Cache:          options.Cache,
		IgnoreLocators: ignoreLocators,
		Locator:        locator,
		Model:          options.Model,
		Screenshot:     options.Screenshot,
		Timeout:        options.Timeout,
	}
	return &protocolOptions, nil
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
			reportClientCallbackPanic(logging, "onLog", recovered)
		}
	}()
	logging.onLog(log)
}

func reportClientCallbackPanic(
	logging resolvedStagehandClientLoggingConfig,
	callback string,
	recovered any,
) {
	if !isClientLogLevelEnabled(StagehandLogLevelError, logging.level) {
		return
	}
	fmt.Fprintf(
		logging.writer,
		"[stagehand] ERROR %s callback failed: %v\n",
		callback,
		recovered,
	)
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
