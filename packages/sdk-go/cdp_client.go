package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	stagehandSendToHostBinding       = "__stagehandSendToHost"
	stagehandReceiveFromHostFunction = "__stagehandReceiveFromHost"
	stagehandExtensionName           = "Stagehand Runtime"

	defaultCDPPollInterval    = 100 * time.Millisecond
	defaultCDPResolveInterval = 250 * time.Millisecond
	defaultCDPActivationDelay = time.Second
	wakePageCleanupTimeout    = 5 * time.Second
)

var (
	// ErrCDPClientClosed is returned after the CDP transport is closed.
	ErrCDPClientClosed = errors.New("stagehand CDP client is closed")
	// ErrCDPConnectionClosed is returned when the browser closes the WebSocket.
	ErrCDPConnectionClosed = errors.New("stagehand CDP connection closed")
)

// cdpCommandError is an error response returned by the browser for a CDP
// command. Code and Data preserve the browser's original error object.
type cdpCommandError struct {
	Method  string
	Code    int
	Message string
	Data    json.RawMessage
}

func (e *cdpCommandError) Error() string {
	return fmt.Sprintf("CDP command failed: %s: %s", e.Method, e.Message)
}

type cdpWebSocket interface {
	Read(context.Context) (websocket.MessageType, []byte, error)
	Write(context.Context, websocket.MessageType, []byte) error
	CloseNow() error
}

type cdpClientOptions struct {
	cdpURL                   string
	headers                  http.Header
	extensionDir             string
	extensionID              string
	preloadedExtension       bool
	serviceWorkerURLIncludes string
	pollInterval             time.Duration
	activationDelay          time.Duration
	httpClient               *http.Client
}

type cdpClient struct {
	socket               cdpWebSocket
	webSocketDebuggerURL string

	ctx        context.Context
	cancel     context.CancelFunc
	readerDone chan struct{}

	shutdownOnce sync.Once
	mu           sync.Mutex
	nextID       uint64
	pending      map[uint64]*pendingCDPCommand
	incoming     []json.RawMessage
	incomingWake chan struct{}
	sessionID    string
	service      cdpServiceWorkerInfo
	closed       bool
	closeReason  error
	socketError  error
}

var _ rpcTransport = (*cdpClient)(nil)

type pendingCDPCommand struct {
	method   string
	response chan cdpCommandResponse
}

type cdpCommandResponse struct {
	result json.RawMessage
	err    error
}

type cdpCommandEnvelope struct {
	ID        uint64 `json:"id"`
	Method    string `json:"method"`
	Params    any    `json:"params"`
	SessionID string `json:"sessionId,omitempty"`
}

type cdpTargetInfo struct {
	TargetID string `json:"targetId"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	URL      string `json:"url"`
}

type cdpInstalledExtension struct {
	ID      string  `json:"id"`
	Name    *string `json:"name"`
	Version *string `json:"version"`
	Path    *string `json:"path"`
	Enabled *bool   `json:"enabled"`
}

type cdpServiceWorkerInfo struct {
	TargetID    string
	URL         string
	Title       string
	ExtensionID string
}

type cdpRuntimeEvaluateResult struct {
	Result           *cdpRuntimeRemoteObject `json:"result,omitempty"`
	ExceptionDetails *cdpExceptionDetails    `json:"exceptionDetails,omitempty"`
}

type cdpRuntimeRemoteObject struct {
	Value json.RawMessage `json:"value,omitempty"`
}

type cdpExceptionDetails struct {
	Text      string                   `json:"text,omitempty"`
	Exception *cdpRuntimeExceptionData `json:"exception,omitempty"`
}

type cdpRuntimeExceptionData struct {
	Description string          `json:"description,omitempty"`
	Value       json.RawMessage `json:"value,omitempty"`
}

type cdpRuntimeReadiness struct {
	Marker      json.RawMessage `json:"marker"`
	HasReceiver bool            `json:"hasReceiver"`
}

func connectCDPClient(ctx context.Context, options cdpClientOptions) (*cdpClient, error) {
	if ctx == nil {
		return nil, errors.New("stagehand CDP context is required")
	}
	options = normalizeCDPClientOptions(options)
	if err := validateCDPClientOptions(options); err != nil {
		return nil, err
	}

	webSocketDebuggerURL, err := resolveBrowserWebSocketURL(
		ctx,
		options.cdpURL,
		options.headers,
		options.httpClient,
	)
	if err != nil {
		return nil, err
	}
	socket, err := dialCDPWebSocket(
		ctx,
		webSocketDebuggerURL,
		options.headers,
		options.httpClient,
	)
	if err != nil {
		return nil, err
	}
	client, err := newCDPClient(socket, webSocketDebuggerURL)
	if err != nil {
		_ = socket.CloseNow()
		return nil, err
	}

	if err := client.initialize(ctx, options); err != nil {
		_ = client.Close()
		return nil, err
	}
	return client, nil
}

func connectRPCClient(
	ctx context.Context,
	options cdpClientOptions,
) (*rpcClient, error) {
	options = normalizeCDPClientOptions(options)
	cdp, err := connectCDPClient(ctx, options)
	if err != nil {
		return nil, err
	}
	rpc, err := newRPCClient(cdp, true)
	if err != nil {
		return nil, errors.Join(err, cdp.Close())
	}
	rpc.browserWebSocketURL = cdp.webSocketDebuggerURL
	return rpc, nil
}

func normalizeCDPClientOptions(options cdpClientOptions) cdpClientOptions {
	if options.pollInterval == 0 {
		options.pollInterval = defaultCDPPollInterval
	}
	if options.activationDelay == 0 {
		options.activationDelay = defaultCDPActivationDelay
	}
	if options.httpClient == nil {
		options.httpClient = http.DefaultClient
	}
	if options.serviceWorkerURLIncludes == "" {
		options.serviceWorkerURLIncludes = "service-worker.js"
	}
	return options
}

func validateCDPClientOptions(options cdpClientOptions) error {
	if options.cdpURL == "" {
		return errors.New("stagehand CDP URL is required")
	}
	if options.pollInterval <= 0 {
		return errors.New("stagehand CDP poll interval must be positive")
	}
	if options.activationDelay < 0 {
		return errors.New("stagehand CDP activation delay cannot be negative")
	}
	if options.preloadedExtension && (options.extensionDir != "" || options.extensionID != "") {
		return errors.New("preloaded Stagehand extension cannot use extensionDir or extensionID")
	}
	if options.extensionDir != "" && options.extensionID != "" {
		return errors.New("stagehand CDP extensionDir and extensionID are mutually exclusive")
	}
	return nil
}

func dialCDPWebSocket(
	ctx context.Context,
	webSocketDebuggerURL string,
	headers http.Header,
	httpClient *http.Client,
) (*websocket.Conn, error) {
	socket, response, err := websocket.Dial(ctx, webSocketDebuggerURL, &websocket.DialOptions{
		HTTPClient: httpClient,
		HTTPHeader: headers.Clone(),
	})
	if err != nil {
		if response != nil {
			return nil, fmt.Errorf(
				"open CDP WebSocket: %s: %w",
				response.Status,
				err,
			)
		}
		return nil, fmt.Errorf("open CDP WebSocket: %w", err)
	}
	// CDP payloads can contain screenshots, DOM snapshots, and other messages
	// larger than coder/websocket's conservative default read limit.
	socket.SetReadLimit(-1)
	return socket, nil
}

func newCDPClient(
	socket cdpWebSocket,
	webSocketDebuggerURL string,
) (*cdpClient, error) {
	if socket == nil {
		return nil, errors.New("stagehand CDP WebSocket is required")
	}
	if webSocketDebuggerURL == "" {
		return nil, errors.New("stagehand CDP WebSocket URL is required")
	}
	ctx, cancel := context.WithCancel(context.Background())
	client := &cdpClient{
		socket:               socket,
		webSocketDebuggerURL: webSocketDebuggerURL,
		ctx:                  ctx,
		cancel:               cancel,
		readerDone:           make(chan struct{}),
		nextID:               1,
		pending:              make(map[uint64]*pendingCDPCommand),
		incomingWake:         make(chan struct{}, 1),
	}
	go client.read()
	return client, nil
}

func (c *cdpClient) initialize(ctx context.Context, options cdpClientOptions) error {
	var (
		serviceWorker cdpTargetInfo
		sessionID     string
		err           error
	)

	extensionID := options.extensionID
	if options.extensionDir != "" {
		extensionID, err = c.loadUnpackedExtension(ctx, options.extensionDir)
		if err != nil {
			return err
		}
	}
	if options.preloadedExtension {
		extensionID, err = c.discoverInstalledStagehandExtensionID(ctx)
		if err != nil {
			return err
		}
	}
	if extensionID == "" {
		return errors.New("Stagehand extension ID was not resolved")
	}
	serviceWorker, err = c.waitForServiceWorker(
		ctx,
		extensionID,
		options.serviceWorkerURLIncludes,
		options.activationDelay,
		options.pollInterval,
	)
	if err != nil {
		return err
	}
	var attached struct {
		SessionID string `json:"sessionId"`
	}
	if err := c.sendCommand(
		ctx,
		"Target.attachToTarget",
		map[string]any{"targetId": serviceWorker.TargetID, "flatten": true},
		"",
		&attached,
	); err != nil {
		return err
	}
	if attached.SessionID == "" {
		return errors.New("Target.attachToTarget did not return sessionId")
	}
	sessionID = attached.SessionID

	c.mu.Lock()
	c.sessionID = sessionID
	c.service = cdpServiceWorkerInfo{
		TargetID:    serviceWorker.TargetID,
		Title:       serviceWorker.Title,
		URL:         serviceWorker.URL,
		ExtensionID: extensionID,
	}
	c.mu.Unlock()

	var ignored map[string]any
	_ = c.sendCommand(
		ctx,
		"Runtime.enable",
		map[string]any{},
		sessionID,
		&ignored,
	)
	if err := c.sendCommand(
		ctx,
		"Runtime.addBinding",
		map[string]any{"name": stagehandSendToHostBinding},
		sessionID,
		&ignored,
	); err != nil {
		return err
	}
	return c.waitForRuntimeReady(
		ctx,
		sessionID,
		options.pollInterval,
	)
}

func (c *cdpClient) Send(ctx context.Context, message json.RawMessage) error {
	if !json.Valid(message) {
		return errors.New("stagehand CDP transport requires a valid JSON message")
	}

	c.mu.Lock()
	sessionID := c.sessionID
	closed := c.closed
	c.mu.Unlock()
	if closed {
		return ErrCDPClientClosed
	}
	if sessionID == "" {
		return errors.New("Stagehand service worker is not attached")
	}

	serialized, err := json.Marshal(string(message))
	if err != nil {
		return fmt.Errorf("encode Stagehand RPC message: %w", err)
	}
	expression := fmt.Sprintf("void globalThis.%s(%s); true", stagehandReceiveFromHostFunction, serialized)
	if source, ok, err := callbackSourceFromMessage(message); err != nil {
		return err
	} else if ok {
		expression = fmt.Sprintf(
			`(() => { const __name = (fn, name) => { try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch {} return fn; }; void globalThis.%s(%s, { callback: (%s) }); return true; })()`,
			stagehandReceiveFromHostFunction,
			serialized,
			source,
		)
	}
	var evaluated cdpRuntimeEvaluateResult
	if err := c.sendCommand(
		ctx,
		"Runtime.evaluate",
		map[string]any{
			"expression":    expression,
			"awaitPromise":  false,
			"returnByValue": true,
		},
		sessionID,
		&evaluated,
	); err != nil {
		return err
	}
	if evaluated.ExceptionDetails != nil {
		return errors.New(runtimeExceptionMessage(
			evaluated.ExceptionDetails,
			"Stagehand service worker rejected an RPC message",
		))
	}
	return nil
}

func callbackSourceFromMessage(message json.RawMessage) (string, bool, error) {
	if !bytes.Contains(message, []byte("stagehand.callback_batch")) {
		return "", false, nil
	}
	var request struct {
		Method string `json:"method"`
		Params struct {
			CallbackSource string `json:"callback_source"`
		} `json:"params"`
	}
	if err := json.Unmarshal(message, &request); err != nil {
		return "", false, fmt.Errorf("decode Stagehand RPC message: %w", err)
	}
	if request.Method != "stagehand.callback_batch" {
		return "", false, nil
	}
	if strings.TrimSpace(request.Params.CallbackSource) == "" {
		return "", false, errors.New("Stagehand callback batch request is missing callback_source")
	}
	return request.Params.CallbackSource, true, nil
}

func (c *cdpClient) Receive(ctx context.Context) (json.RawMessage, error) {
	if ctx == nil {
		return nil, errors.New("stagehand CDP receive context is required")
	}
	for {
		c.mu.Lock()
		if len(c.incoming) != 0 {
			message := c.incoming[0]
			c.incoming[0] = nil
			c.incoming = c.incoming[1:]
			c.mu.Unlock()
			return message, nil
		}
		if c.closed {
			reason := c.closeReason
			c.mu.Unlock()
			if reason == nil {
				reason = ErrCDPClientClosed
			}
			return nil, reason
		}
		c.mu.Unlock()

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-c.incomingWake:
		}
	}
}

func (c *cdpClient) Close() error {
	c.shutdown(ErrCDPClientClosed)
	<-c.readerDone

	c.mu.Lock()
	defer c.mu.Unlock()
	return c.socketError
}

func (c *cdpClient) closedState() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

func (c *cdpClient) sendCommand(
	ctx context.Context,
	method string,
	params any,
	sessionID string,
	result any,
) error {
	if ctx == nil {
		return errors.New("stagehand CDP command context is required")
	}
	if method == "" {
		return errors.New("stagehand CDP command method is required")
	}
	if params == nil {
		params = map[string]any{}
	}

	pending := &pendingCDPCommand{
		method:   method,
		response: make(chan cdpCommandResponse, 1),
	}
	commandID, err := c.registerPending(pending)
	if err != nil {
		return err
	}
	defer c.removePending(commandID, pending)

	encoded, err := json.Marshal(cdpCommandEnvelope{
		ID:        commandID,
		Method:    method,
		Params:    params,
		SessionID: sessionID,
	})
	if err != nil {
		return fmt.Errorf("encode CDP command %s: %w", method, err)
	}
	if err := c.socket.Write(ctx, websocket.MessageText, encoded); err != nil {
		return fmt.Errorf("send CDP command %s: %w", method, err)
	}

	select {
	case response := <-pending.response:
		if response.err != nil {
			return response.err
		}
		if result == nil {
			return nil
		}
		if len(response.result) == 0 || bytes.Equal(bytes.TrimSpace(response.result), []byte("null")) {
			response.result = json.RawMessage(`{}`)
		}
		if err := json.Unmarshal(response.result, result); err != nil {
			return fmt.Errorf("decode CDP command result for %s: %w", method, err)
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("CDP command canceled: %s: %w", method, ctx.Err())
	}
}

func (c *cdpClient) registerPending(pending *pendingCDPCommand) (uint64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		if c.closeReason != nil {
			return 0, c.closeReason
		}
		return 0, ErrCDPClientClosed
	}
	commandID := c.nextID
	c.nextID++
	c.pending[commandID] = pending
	return commandID, nil
}

func (c *cdpClient) removePending(commandID uint64, pending *pendingCDPCommand) {
	c.mu.Lock()
	if c.pending[commandID] == pending {
		delete(c.pending, commandID)
	}
	c.mu.Unlock()
}

func (c *cdpClient) read() {
	defer close(c.readerDone)
	for {
		_, message, err := c.socket.Read(c.ctx)
		if err != nil {
			if c.ctx.Err() == nil {
				c.shutdown(fmt.Errorf("%w: %v", ErrCDPConnectionClosed, err))
			}
			return
		}
		if err := c.handleMessage(message); err != nil {
			c.shutdown(err)
			return
		}
	}
}

func (c *cdpClient) handleMessage(message []byte) error {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(message, &envelope); err != nil || envelope == nil {
		return errors.New("invalid CDP message")
	}

	if rawID, ok := envelope["id"]; ok {
		commandID, ok := parseCDPCommandID(rawID)
		if !ok {
			return errors.New("invalid CDP response")
		}
		return c.receiveResponse(commandID, envelope)
	}

	var method string
	if err := json.Unmarshal(envelope["method"], &method); err != nil || method == "" {
		return errors.New("invalid CDP event")
	}
	if method != "Runtime.bindingCalled" {
		return nil
	}

	var sessionID string
	if err := json.Unmarshal(envelope["sessionId"], &sessionID); err != nil {
		return nil
	}
	c.mu.Lock()
	expectedSessionID := c.sessionID
	c.mu.Unlock()
	if sessionID == "" || sessionID != expectedSessionID {
		return nil
	}

	var params struct {
		Name               string      `json:"name"`
		Payload            string      `json:"payload"`
		ExecutionContextID json.Number `json:"executionContextId"`
	}
	decoder := json.NewDecoder(bytes.NewReader(envelope["params"]))
	decoder.UseNumber()
	if err := decoder.Decode(&params); err != nil ||
		params.Name != stagehandSendToHostBinding ||
		params.Payload == "" {
		return nil
	}
	if _, err := strconv.ParseInt(params.ExecutionContextID.String(), 10, 64); err != nil {
		return nil
	}
	c.enqueueIncoming(json.RawMessage(params.Payload))
	return nil
}

func (c *cdpClient) receiveResponse(
	commandID uint64,
	envelope map[string]json.RawMessage,
) error {
	_, hasResult := envelope["result"]
	rawError, hasError := envelope["error"]
	if hasResult == hasError {
		return errors.New("invalid CDP response")
	}

	response := cdpCommandResponse{result: envelope["result"]}
	if hasError {
		c.mu.Lock()
		pending := c.pending[commandID]
		c.mu.Unlock()
		method := ""
		if pending != nil {
			method = pending.method
		}
		commandError, err := decodeCDPCommandError(method, rawError)
		if err != nil {
			return errors.New("invalid CDP response")
		}
		response.result = nil
		response.err = commandError
	}

	c.mu.Lock()
	pending := c.pending[commandID]
	if pending != nil {
		delete(c.pending, commandID)
	}
	c.mu.Unlock()
	if pending != nil {
		pending.response <- response
	}
	return nil
}

func (c *cdpClient) enqueueIncoming(message json.RawMessage) {
	copied := append(json.RawMessage(nil), message...)
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.incoming = append(c.incoming, copied)
	c.mu.Unlock()
	select {
	case c.incomingWake <- struct{}{}:
	default:
	}
}

func (c *cdpClient) shutdown(reason error) {
	if reason == nil {
		reason = ErrCDPClientClosed
	}
	c.shutdownOnce.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.closeReason = reason
		pending := make([]*pendingCDPCommand, 0, len(c.pending))
		for _, command := range c.pending {
			pending = append(pending, command)
		}
		clear(c.pending)
		c.cancel()
		c.mu.Unlock()

		for _, command := range pending {
			command.response <- cdpCommandResponse{err: reason}
		}
		select {
		case c.incomingWake <- struct{}{}:
		default:
		}
		socketError := c.socket.CloseNow()
		c.mu.Lock()
		c.socketError = socketError
		c.mu.Unlock()
	})
}

func decodeCDPCommandError(method string, raw json.RawMessage) (*cdpCommandError, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	var object struct {
		Code    json.Number     `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data,omitempty"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&object); err != nil {
		return nil, err
	}
	if _, ok := fields["code"]; !ok {
		return nil, errors.New("missing CDP error code")
	}
	if _, ok := fields["message"]; !ok || object.Message == "" {
		return nil, errors.New("missing CDP error message")
	}
	code, err := strconv.ParseInt(object.Code.String(), 10, 64)
	if err != nil {
		return nil, err
	}
	return &cdpCommandError{
		Method:  method,
		Code:    int(code),
		Message: object.Message,
		Data:    object.Data,
	}, nil
}

func parseCDPCommandID(raw json.RawMessage) (uint64, bool) {
	value := strings.TrimSpace(string(raw))
	if value == "" || strings.ContainsAny(value, ".eE+-") {
		return 0, false
	}
	commandID, err := strconv.ParseUint(value, 10, 64)
	return commandID, err == nil
}

func (c *cdpClient) loadUnpackedExtension(
	ctx context.Context,
	extensionDir string,
) (string, error) {
	var loaded struct {
		ID string `json:"id"`
	}
	err := c.sendCommand(
		ctx,
		"Extensions.loadUnpacked",
		map[string]any{"path": extensionDir},
		"",
		&loaded,
	)
	if err != nil {
		var commandError *cdpCommandError
		if errors.As(err, &commandError) &&
			(commandError.Code == -32601 ||
				strings.Contains(strings.ToLower(commandError.Message), "method not found") ||
				strings.Contains(strings.ToLower(commandError.Message), "wasn't found")) {
			return "", fmt.Errorf(
				"this Chrome build does not support Extensions.loadUnpacked; "+
					"launch with --load-extension and connect using extensionID instead: %w",
				err,
			)
		}
		return "", err
	}
	if loaded.ID == "" {
		return "", errors.New("Extensions.loadUnpacked did not return an extension id")
	}
	return loaded.ID, nil
}

func (c *cdpClient) discoverInstalledStagehandExtensionID(
	ctx context.Context,
) (string, error) {
	var response struct {
		Extensions *[]cdpInstalledExtension `json:"extensions"`
	}
	if err := c.sendCommand(
		ctx,
		"Extensions.getExtensions",
		map[string]any{},
		"",
		&response,
	); err != nil {
		return "", err
	}
	if response.Extensions == nil {
		return "", errors.New("Extensions.getExtensions did not return extensions")
	}

	installed := false
	enabledIDs := make([]string, 0, 1)
	for _, extension := range *response.Extensions {
		if extension.ID == "" ||
			extension.Name == nil ||
			extension.Version == nil ||
			extension.Path == nil ||
			extension.Enabled == nil {
			return "", errors.New(
				"Extensions.getExtensions returned an invalid extension entry",
			)
		}
		if *extension.Name != stagehandExtensionName {
			continue
		}
		installed = true
		if *extension.Enabled {
			enabledIDs = append(enabledIDs, extension.ID)
		}
	}

	switch len(enabledIDs) {
	case 1:
		return enabledIDs[0], nil
	case 0:
		if installed {
			return "", errors.New(
				"Stagehand extension is installed in the connected browser but is disabled.",
			)
		}
		return "", errors.New(
			"Stagehand extension is not installed in the connected browser. " +
				"The extension must be included when the Browserbase session is created.",
		)
	default:
		slices.Sort(enabledIDs)
		return "", fmt.Errorf(
			"Multiple enabled Stagehand extensions are installed: %s",
			strings.Join(enabledIDs, ", "),
		)
	}
}

func (c *cdpClient) waitForServiceWorker(
	ctx context.Context,
	extensionID string,
	urlIncludes string,
	activationDelay time.Duration,
	pollInterval time.Duration,
) (cdpTargetInfo, error) {
	startedAt := time.Now()
	var (
		lastTargets        []cdpTargetInfo
		activationTargetID string
	)
	defer func() {
		if activationTargetID == "" {
			return
		}
		// Cleanup must not inherit an already-canceled init context, delay its
		// error, or wait forever for a CDP acknowledgement.
		go c.closeWakeTarget(ctx, activationTargetID)
	}()

	for {
		if err := ctx.Err(); err != nil {
			return cdpTargetInfo{}, fmt.Errorf(
				"discover Stagehand service worker target: %w; observed targets: %s",
				err,
				formatCDPTargets(lastTargets),
			)
		}
		targets, err := c.getTargets(ctx)
		if err != nil {
			return cdpTargetInfo{}, err
		}
		lastTargets = targets
		for _, target := range targets {
			if isStagehandServiceWorker(target, extensionID, urlIncludes) {
				return target, nil
			}
		}

		if activationTargetID == "" &&
			time.Since(startedAt) >= activationDelay {
			var activation struct {
				TargetID string `json:"targetId"`
			}
			if c.sendCommand(
				ctx,
				"Target.createTarget",
				map[string]any{
					"url": fmt.Sprintf(
						"chrome-extension://%s/wake-service-worker.html",
						extensionID,
					),
				},
				"",
				&activation,
			) == nil {
				activationTargetID = activation.TargetID
			}
		}
		if err := waitForCDPPoll(ctx, pollInterval); err != nil {
			continue
		}
	}
}

func (c *cdpClient) getTargets(ctx context.Context) ([]cdpTargetInfo, error) {
	var response struct {
		TargetInfos []cdpTargetInfo `json:"targetInfos"`
	}
	if err := c.sendCommand(
		ctx,
		"Target.getTargets",
		map[string]any{},
		"",
		&response,
	); err != nil {
		return nil, err
	}
	return response.TargetInfos, nil
}

func (c *cdpClient) waitForRuntimeReady(
	ctx context.Context,
	sessionID string,
	pollInterval time.Duration,
) error {
	lastError := ""
	for {
		if err := ctx.Err(); err != nil {
			if lastError != "" {
				return fmt.Errorf(
					"wait for the Stagehand extension runtime to become ready: %w (%s)",
					err,
					lastError,
				)
			}
			return fmt.Errorf(
				"wait for the Stagehand extension runtime to become ready: %w",
				err,
			)
		}
		ready, detail := c.evaluateRuntimeReadiness(ctx, sessionID)
		if ready {
			return nil
		}
		lastError = detail
		if err := waitForCDPPoll(ctx, pollInterval); err != nil {
			continue
		}
	}
}

func (c *cdpClient) evaluateRuntimeReadiness(
	ctx context.Context,
	sessionID string,
) (bool, string) {
	var evaluated cdpRuntimeEvaluateResult
	err := c.sendCommand(
		ctx,
		"Runtime.evaluate",
		map[string]any{
			"expression":    cdpRuntimeReadinessExpression(),
			"returnByValue": true,
		},
		sessionID,
		&evaluated,
	)
	if err != nil {
		return false, err.Error()
	}
	if evaluated.ExceptionDetails != nil {
		return false, runtimeExceptionMessage(
			evaluated.ExceptionDetails,
			"readiness evaluation threw",
		)
	}
	if evaluated.Result == nil || len(evaluated.Result.Value) == 0 {
		return false, "readiness evaluation returned no value"
	}
	var readiness cdpRuntimeReadiness
	if err := json.Unmarshal(evaluated.Result.Value, &readiness); err != nil {
		return false, "readiness evaluation returned an invalid value"
	}
	compatible, detail := negotiateRuntimeCompatibility(readiness.Marker)
	if compatible && readiness.HasReceiver {
		return true, ""
	}
	return false, fmt.Sprintf(
		"runtime %s, __stagehandReceiveFromHost=%t",
		detail,
		readiness.HasReceiver,
	)
}

func (c *cdpClient) bestEffortCommand(ctx context.Context, method string, params any) {
	var ignored map[string]any
	_ = c.sendCommand(ctx, method, params, "", &ignored)
}

func (c *cdpClient) closeWakeTarget(parent context.Context, targetID string) {
	base := context.Background()
	if parent != nil {
		base = context.WithoutCancel(parent)
	}
	cleanupCtx, cancel := context.WithTimeout(base, wakePageCleanupTimeout)
	defer cancel()
	c.bestEffortCommand(
		cleanupCtx,
		"Target.closeTarget",
		map[string]any{"targetId": targetID},
	)
}

func resolveBrowserWebSocketURL(
	ctx context.Context,
	cdpURL string,
	headers http.Header,
	httpClient *http.Client,
) (string, error) {
	if ctx == nil {
		return "", errors.New("stagehand CDP context is required")
	}
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("resolve CDP WebSocket URL: %w", err)
	}
	parsed, err := url.Parse(cdpURL)
	if err != nil {
		return "", fmt.Errorf("parse CDP URL: %w", err)
	}
	if parsed.Scheme == "ws" || parsed.Scheme == "wss" {
		return cdpURL, nil
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported CDP URL scheme %q", parsed.Scheme)
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	baseURL := strings.TrimRight(cdpURL, "/")
	versionURL := baseURL + "/json/version"
	lastError := ""
	for {
		request, err := http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			versionURL,
			nil,
		)
		if err != nil {
			return "", fmt.Errorf("create CDP version request: %w", err)
		}
		request.Header = headers.Clone()
		response, err := httpClient.Do(request)
		if err != nil {
			lastError = err.Error()
		} else {
			webSocketURL, readErr := readCDPVersionResponse(response)
			if readErr == nil {
				return webSocketURL, nil
			}
			lastError = readErr.Error()
		}

		if err := waitForCDPPoll(ctx, defaultCDPResolveInterval); err != nil {
			if lastError != "" {
				return "", fmt.Errorf(
					"resolve CDP WebSocket URL from %s: %w (last error: %s)",
					baseURL,
					err,
					lastError,
				)
			}
			return "", fmt.Errorf("resolve CDP WebSocket URL from %s: %w", baseURL, err)
		}
	}
}

func readCDPVersionResponse(response *http.Response) (string, error) {
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		return "", errors.New(response.Status)
	}
	var version struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	if err := decoder.Decode(&version); err != nil {
		return "", fmt.Errorf("decode CDP version response: %w", err)
	}
	if version.WebSocketDebuggerURL == "" {
		return "", errors.New("CDP version endpoint did not include webSocketDebuggerUrl")
	}
	parsed, err := url.Parse(version.WebSocketDebuggerURL)
	if err != nil || (parsed.Scheme != "ws" && parsed.Scheme != "wss") {
		return "", errors.New("CDP version endpoint returned an invalid WebSocket URL")
	}
	return version.WebSocketDebuggerURL, nil
}

func waitForCDPPoll(
	ctx context.Context,
	interval time.Duration,
) error {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func isStagehandServiceWorker(
	target cdpTargetInfo,
	extensionID string,
	urlIncludes string,
) bool {
	if target.TargetID == "" ||
		target.Type != "service_worker" ||
		!strings.HasPrefix(target.URL, "chrome-extension://") ||
		!strings.Contains(target.URL, urlIncludes) {
		return false
	}
	return strings.HasPrefix(target.URL, "chrome-extension://"+extensionID+"/")
}

func formatCDPTargets(targets []cdpTargetInfo) string {
	observed := make([]string, 0, len(targets))
	for _, target := range targets {
		observed = append(observed, target.Type+":"+target.URL)
	}
	return strings.Join(observed, ", ")
}

func runtimeExceptionMessage(details *cdpExceptionDetails, fallback string) string {
	if details.Exception != nil && details.Exception.Description != "" {
		return details.Exception.Description
	}
	if details.Text != "" {
		return details.Text
	}
	return fallback
}

func rawJSONDescription(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "<nil>"
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return string(raw)
	}
	return fmt.Sprint(value)
}

func cdpRuntimeReadinessExpression() string {
	return fmt.Sprintf(`(() => ({
  marker: globalThis.__stagehand_runtime ?? null,
  hasReceiver: typeof globalThis.%s === "function",
}))()`, stagehandReceiveFromHostFunction)
}
