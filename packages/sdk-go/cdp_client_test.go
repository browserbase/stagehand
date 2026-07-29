package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type fakeCDPRead struct {
	message []byte
	err     error
}

type fakeCDPWebSocket struct {
	writes    chan []byte
	reads     chan fakeCDPRead
	closed    chan struct{}
	closeOnce sync.Once
	writeHook func([]byte)
}

type gatedCDPWebSocket struct {
	*fakeCDPWebSocket
	firstWrite sync.Once
	started    chan struct{}
	release    chan struct{}
}

func (s *gatedCDPWebSocket) Write(
	ctx context.Context,
	messageType websocket.MessageType,
	message []byte,
) error {
	wait := false
	s.firstWrite.Do(func() {
		wait = true
		close(s.started)
	})
	if wait {
		select {
		case <-s.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return s.fakeCDPWebSocket.Write(ctx, messageType, message)
}

func newFakeCDPWebSocket() *fakeCDPWebSocket {
	return &fakeCDPWebSocket{
		writes: make(chan []byte, 64),
		reads:  make(chan fakeCDPRead, 64),
		closed: make(chan struct{}),
	}
}

func (s *fakeCDPWebSocket) Read(
	ctx context.Context,
) (websocket.MessageType, []byte, error) {
	select {
	case read := <-s.reads:
		return websocket.MessageText, read.message, read.err
	case <-ctx.Done():
		return 0, nil, ctx.Err()
	case <-s.closed:
		return 0, nil, ErrCDPClientClosed
	}
}

func (s *fakeCDPWebSocket) Write(
	ctx context.Context,
	_ websocket.MessageType,
	message []byte,
) error {
	copied := append([]byte(nil), message...)
	select {
	case s.writes <- copied:
		if s.writeHook != nil {
			s.writeHook(copied)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-s.closed:
		return ErrCDPClientClosed
	}
}

func (s *fakeCDPWebSocket) CloseNow() error {
	s.closeOnce.Do(func() { close(s.closed) })
	return nil
}

func (s *fakeCDPWebSocket) receiveJSON(message string) {
	s.reads <- fakeCDPRead{message: []byte(message)}
}

func TestResolveBrowserWebSocketURLUsesDirectWebSocketURL(t *testing.T) {
	t.Parallel()

	const directURL = "wss://connect.example.test/devtools/browser/1"
	resolved, err := resolveBrowserWebSocketURL(
		context.Background(),
		directURL,
		nil,
		nil,
		time.Second,
	)
	if err != nil {
		t.Fatalf("resolveBrowserWebSocketURL() error = %v", err)
	}
	if resolved != directURL {
		t.Fatalf("resolveBrowserWebSocketURL() = %q, want %q", resolved, directURL)
	}
}

func TestResolveBrowserWebSocketURLPollsVersionEndpointWithHeaders(t *testing.T) {
	t.Parallel()

	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/json/version" {
			t.Errorf("request path = %q, want /json/version", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Stagehand-Test") != "cdp-header" {
			t.Errorf("request header = %q", r.Header.Get("X-Stagehand-Test"))
		}
		if calls.Add(1) == 1 {
			http.Error(w, "starting", http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"webSocketDebuggerUrl": "ws://127.0.0.1/devtools/browser/test",
		})
	}))
	defer server.Close()

	resolved, err := resolveBrowserWebSocketURL(
		context.Background(),
		server.URL,
		http.Header{"X-Stagehand-Test": []string{"cdp-header"}},
		server.Client(),
		time.Second,
	)
	if err != nil {
		t.Fatalf("resolveBrowserWebSocketURL() error = %v", err)
	}
	if resolved != "ws://127.0.0.1/devtools/browser/test" {
		t.Fatalf("resolved URL = %q", resolved)
	}
	if calls.Load() != 2 {
		t.Fatalf("version endpoint calls = %d, want 2", calls.Load())
	}
}

func TestCoderWebSocketDialCarriesHeadersAndCDPCommands(t *testing.T) {
	t.Parallel()

	requestHeader := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestHeader <- r.Header.Get("X-CDP-Authorization")
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()

		_, message, err := socket.Read(r.Context())
		if err != nil {
			return
		}
		var command struct {
			ID     uint64 `json:"id"`
			Method string `json:"method"`
		}
		if json.Unmarshal(message, &command) != nil {
			return
		}
		response, _ := json.Marshal(map[string]any{
			"id": command.ID,
			"result": map[string]any{
				"product":         "Chrome/140.0.0.0",
				"protocolVersion": "1.3",
			},
		})
		_ = socket.Write(context.Background(), websocket.MessageText, response)
	}))
	defer server.Close()

	webSocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	socket, err := dialCDPWebSocket(
		context.Background(),
		webSocketURL,
		http.Header{"X-CDP-Authorization": []string{"test-token"}},
		server.Client(),
		time.Second,
	)
	if err != nil {
		t.Fatalf("dialCDPWebSocket() error = %v", err)
	}
	client := newTestCDPClient(t, socket, webSocketURL, time.Second)

	var version struct {
		Product         string `json:"product"`
		ProtocolVersion string `json:"protocolVersion"`
	}
	if err := client.sendCommand(
		context.Background(),
		"Browser.getVersion",
		map[string]any{},
		"",
		time.Second,
		&version,
	); err != nil {
		t.Fatalf("sendCommand() error = %v", err)
	}
	if version.Product != "Chrome/140.0.0.0" || version.ProtocolVersion != "1.3" {
		t.Fatalf("Browser.getVersion result = %#v", version)
	}
	select {
	case header := <-requestHeader:
		if header != "test-token" {
			t.Fatalf("WebSocket request header = %q", header)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for WebSocket handshake")
	}
}

func TestCDPClientInitializesLoadedExtension(t *testing.T) {
	t.Parallel()

	socket := newFakeCDPWebSocket()
	methods := make(chan string, 16)
	socket.writeHook = responseHook(t, socket, methods, func(
		method string,
		_ map[string]json.RawMessage,
	) map[string]any {
		switch method {
		case "Extensions.loadUnpacked":
			return map[string]any{"result": map[string]any{"id": "stagehand-extension"}}
		case "Target.getTargets":
			return map[string]any{"result": map[string]any{
				"targetInfos": []map[string]any{{
					"targetId": "worker-target",
					"type":     "service_worker",
					"title":    "Stagehand",
					"url":      "chrome-extension://stagehand-extension/service-worker.js",
				}},
			}}
		case "Target.attachToTarget":
			return map[string]any{"result": map[string]any{"sessionId": "worker-session"}}
		case "Runtime.evaluate":
			return readyRuntimeResponse()
		default:
			return map[string]any{"result": map[string]any{}}
		}
	})

	client := newTestCDPClient(
		t,
		socket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)
	options := normalizeCDPClientOptions(cdpClientOptions{
		extensionDir:     "/tmp/stagehand-extension",
		discoveryTimeout: time.Second,
		commandTimeout:   time.Second,
		pollInterval:     time.Millisecond,
	})
	if err := client.initialize(context.Background(), options); err != nil {
		t.Fatalf("initialize() error = %v", err)
	}

	client.mu.Lock()
	service := client.service
	sessionID := client.sessionID
	client.mu.Unlock()
	if sessionID != "worker-session" {
		t.Fatalf("session ID = %q", sessionID)
	}
	if service != (cdpServiceWorkerInfo{
		TargetID:    "worker-target",
		Title:       "Stagehand",
		URL:         "chrome-extension://stagehand-extension/service-worker.js",
		ExtensionID: "stagehand-extension",
	}) {
		t.Fatalf("service worker = %#v", service)
	}

	actualMethods := drainMethods(methods)
	expectedMethods := []string{
		"Extensions.loadUnpacked",
		"Target.getTargets",
		"Target.attachToTarget",
		"Runtime.enable",
		"Runtime.addBinding",
		"Runtime.evaluate",
	}
	if !reflect.DeepEqual(actualMethods, expectedMethods) {
		t.Fatalf("CDP methods = %#v, want %#v", actualMethods, expectedMethods)
	}
}

func TestCDPClientDiscoversPreloadedExtension(t *testing.T) {
	t.Parallel()

	socket := newFakeCDPWebSocket()
	methods := make(chan string, 16)
	socket.writeHook = responseHook(t, socket, methods, func(
		method string,
		_ map[string]json.RawMessage,
	) map[string]any {
		switch method {
		case "Target.getTargets":
			return map[string]any{"result": map[string]any{
				"targetInfos": []map[string]any{{
					"targetId": "worker-target",
					"type":     "service_worker",
					"title":    "Stagehand",
					"url":      "chrome-extension://preloaded-extension/service-worker.js",
				}},
			}}
		case "Target.attachToTarget":
			return map[string]any{"result": map[string]any{"sessionId": "worker-session"}}
		case "Runtime.evaluate":
			return readyRuntimeResponse()
		default:
			return map[string]any{"result": map[string]any{}}
		}
	})

	client := newTestCDPClient(
		t,
		socket,
		"wss://connect.browserbase.example/devtools/browser/test",
		time.Second,
	)
	options := normalizeCDPClientOptions(cdpClientOptions{
		preloadedExtension: true,
		discoveryTimeout:   time.Second,
		commandTimeout:     time.Second,
		pollInterval:       time.Millisecond,
	})
	if err := client.initialize(context.Background(), options); err != nil {
		t.Fatalf("initialize() error = %v", err)
	}

	client.mu.Lock()
	service := client.service
	client.mu.Unlock()
	if service.ExtensionID != "preloaded-extension" {
		t.Fatalf("extension ID = %q", service.ExtensionID)
	}
	actualMethods := drainMethods(methods)
	if len(actualMethods) == 0 || actualMethods[0] != "Target.getTargets" {
		t.Fatalf("CDP methods = %#v", actualMethods)
	}
	for _, method := range actualMethods {
		if method == "Extensions.loadUnpacked" {
			t.Fatalf("preloaded extension unexpectedly called %s", method)
		}
	}
}

func TestCDPClientBridgesJSONRPCThroughRuntimeBinding(t *testing.T) {
	t.Parallel()

	socket := newFakeCDPWebSocket()
	socket.writeHook = responseHook(t, socket, nil, func(
		method string,
		_ map[string]json.RawMessage,
	) map[string]any {
		if method != "Runtime.evaluate" {
			t.Errorf("CDP method = %q, want Runtime.evaluate", method)
		}
		return map[string]any{"result": map[string]any{}}
	})
	client := newTestCDPClient(
		t,
		socket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)
	client.mu.Lock()
	client.sessionID = "worker-session"
	client.mu.Unlock()

	outgoing := json.RawMessage(`{"jsonrpc":"2.0","id":1,"method":"test.request","params":{}}`)
	if err := client.Send(context.Background(), outgoing); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	written := receiveCDPWrite(t, socket)
	var command struct {
		Method    string `json:"method"`
		SessionID string `json:"sessionId"`
		Params    struct {
			Expression string `json:"expression"`
		} `json:"params"`
	}
	if err := json.Unmarshal(written, &command); err != nil {
		t.Fatalf("decode Runtime.evaluate command: %v", err)
	}
	if command.Method != "Runtime.evaluate" || command.SessionID != "worker-session" {
		t.Fatalf("Runtime.evaluate command = %#v", command)
	}
	if !strings.Contains(command.Params.Expression, stagehandReceiveFromHostFunction) ||
		!strings.Contains(command.Params.Expression, `\"method\":\"test.request\"`) {
		t.Fatalf("Runtime.evaluate expression = %q", command.Params.Expression)
	}

	incoming := `{"jsonrpc":"2.0","id":1,"result":{"ok":true}}`
	event, _ := json.Marshal(map[string]any{
		"method":    "Runtime.bindingCalled",
		"sessionId": "worker-session",
		"params": map[string]any{
			"name":               stagehandSendToHostBinding,
			"payload":            incoming,
			"executionContextId": 7,
		},
	})
	socket.reads <- fakeCDPRead{message: event}
	received, err := client.Receive(context.Background())
	if err != nil {
		t.Fatalf("Receive() error = %v", err)
	}
	assertJSONEqual(t, received, incoming)
}

func TestCDPClientCommandTimeoutAndErrors(t *testing.T) {
	t.Parallel()

	timeoutSocket := newFakeCDPWebSocket()
	timeoutClient := newTestCDPClient(
		t,
		timeoutSocket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)
	var ignored map[string]any
	err := timeoutClient.sendCommand(
		context.Background(),
		"Target.getTargets",
		map[string]any{},
		"",
		10*time.Millisecond,
		&ignored,
	)
	if err == nil || err.Error() != "CDP command timed out: Target.getTargets" {
		t.Fatalf("timeout error = %v", err)
	}
	timeoutClient.mu.Lock()
	pendingCount := len(timeoutClient.pending)
	timeoutClient.mu.Unlock()
	if pendingCount != 0 {
		t.Fatalf("pending commands = %d, want 0", pendingCount)
	}

	errorSocket := newFakeCDPWebSocket()
	errorSocket.writeHook = responseHook(t, errorSocket, nil, func(
		string,
		map[string]json.RawMessage,
	) map[string]any {
		return map[string]any{"error": map[string]any{
			"code":    -32601,
			"message": "Method not found",
			"data":    map[string]any{"detail": "missing"},
		}}
	})
	errorClient := newTestCDPClient(
		t,
		errorSocket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)
	err = errorClient.sendCommand(
		context.Background(),
		"Extensions.loadUnpacked",
		map[string]any{},
		"",
		time.Second,
		&ignored,
	)
	var commandError *cdpCommandError
	if !errors.As(err, &commandError) {
		t.Fatalf("command error = %T %v, want *cdpCommandError", err, err)
	}
	if commandError.Method != "Extensions.loadUnpacked" ||
		commandError.Code != -32601 ||
		commandError.Message != "Method not found" {
		t.Fatalf("cdpCommandError = %#v", commandError)
	}
	assertJSONEqual(t, commandError.Data, `{"detail":"missing"}`)
}

func TestCDPClientRequestCancellationDoesNotCancelSharedSocketWrite(t *testing.T) {
	t.Parallel()

	socket := &gatedCDPWebSocket{
		fakeCDPWebSocket: newFakeCDPWebSocket(),
		started:          make(chan struct{}),
		release:          make(chan struct{}),
	}
	socket.writeHook = func(message []byte) {
		var command struct {
			ID     uint64 `json:"id"`
			Method string `json:"method"`
		}
		if err := json.Unmarshal(message, &command); err != nil {
			t.Errorf("decode CDP command: %v", err)
			return
		}
		if command.Method != "Browser.getVersion" {
			return
		}
		response, _ := json.Marshal(map[string]any{
			"id":     command.ID,
			"result": map[string]any{"product": "Chrome/test"},
		})
		socket.reads <- fakeCDPRead{message: response}
	}
	client := newTestCDPClient(
		t,
		socket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)

	ctx, cancel := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		var ignored map[string]any
		firstDone <- client.sendCommand(
			ctx,
			"Target.getTargets",
			map[string]any{},
			"",
			time.Second,
			&ignored,
		)
	}()
	<-socket.started
	cancel()
	select {
	case err := <-firstDone:
		t.Fatalf("command returned while shared socket write was blocked: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	close(socket.release)
	if err := <-firstDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled command error = %v", err)
	}

	var version struct {
		Product string `json:"product"`
	}
	if err := client.sendCommand(
		context.Background(),
		"Browser.getVersion",
		map[string]any{},
		"",
		time.Second,
		&version,
	); err != nil {
		t.Fatalf("later command on shared socket error = %v", err)
	}
	if version.Product != "Chrome/test" {
		t.Fatalf("later command result = %#v", version)
	}
}

func TestCDPClientCloseRejectsPendingAndReceive(t *testing.T) {
	t.Parallel()

	socket := newFakeCDPWebSocket()
	client, err := newCDPClient(
		socket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)
	if err != nil {
		t.Fatalf("newCDPClient() error = %v", err)
	}

	commandDone := make(chan error, 1)
	go func() {
		var ignored map[string]any
		commandDone <- client.sendCommand(
			context.Background(),
			"Target.getTargets",
			map[string]any{},
			"",
			time.Second,
			&ignored,
		)
	}()
	_ = receiveCDPWrite(t, socket)
	if err := client.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	select {
	case err := <-commandDone:
		if !errors.Is(err, ErrCDPClientClosed) {
			t.Fatalf("pending command error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for pending command rejection")
	}
	if _, err := client.Receive(context.Background()); !errors.Is(err, ErrCDPClientClosed) {
		t.Fatalf("Receive() error = %v", err)
	}
}

func TestCDPClientInvalidMessageClosesConnection(t *testing.T) {
	t.Parallel()

	socket := newFakeCDPWebSocket()
	client, err := newCDPClient(
		socket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)
	if err != nil {
		t.Fatalf("newCDPClient() error = %v", err)
	}
	socket.receiveJSON(`{"not":"a CDP message"}`)
	select {
	case <-socket.closed:
	case <-time.After(time.Second):
		t.Fatal("invalid CDP message did not close the WebSocket")
	}
	if _, err := client.Receive(context.Background()); err == nil ||
		err.Error() != "invalid CDP event" {
		t.Fatalf("Receive() error = %v", err)
	}
	if err := client.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestCDPClientExplainsUnavailableExtensionLoading(t *testing.T) {
	t.Parallel()

	socket := newFakeCDPWebSocket()
	socket.writeHook = responseHook(t, socket, nil, func(
		string,
		map[string]json.RawMessage,
	) map[string]any {
		return map[string]any{"error": map[string]any{
			"code":    -32601,
			"message": "Method not found",
		}}
	})
	client := newTestCDPClient(
		t,
		socket,
		"ws://127.0.0.1/devtools/browser/test",
		time.Second,
	)
	_, err := client.loadUnpackedExtension(context.Background(), "/tmp/stagehand-extension")
	if err == nil || !strings.Contains(err.Error(), "launch with --load-extension") {
		t.Fatalf("loadUnpackedExtension() error = %v", err)
	}
}

func TestCDPClientBrowserIntegration(t *testing.T) {
	cdpURL := os.Getenv("STAGEHAND_GO_CDP_URL")
	if cdpURL == "" {
		t.Skip("set STAGEHAND_GO_CDP_URL to run against a real browser")
	}

	webSocketURL, err := resolveBrowserWebSocketURL(
		context.Background(),
		cdpURL,
		nil,
		http.DefaultClient,
		5*time.Second,
	)
	if err != nil {
		t.Fatalf("resolve browser WebSocket URL: %v", err)
	}
	socket, err := dialCDPWebSocket(
		context.Background(),
		webSocketURL,
		nil,
		http.DefaultClient,
		5*time.Second,
	)
	if err != nil {
		t.Fatalf("dial browser WebSocket: %v", err)
	}
	client := newTestCDPClient(t, socket, webSocketURL, 5*time.Second)

	var version struct {
		Product         string `json:"product"`
		ProtocolVersion string `json:"protocolVersion"`
	}
	if err := client.sendCommand(
		context.Background(),
		"Browser.getVersion",
		map[string]any{},
		"",
		5*time.Second,
		&version,
	); err != nil {
		t.Fatalf("Browser.getVersion: %v", err)
	}
	if version.Product == "" || version.ProtocolVersion == "" {
		t.Fatalf("Browser.getVersion result = %#v", version)
	}
	t.Logf("connected to %s using CDP %s", version.Product, version.ProtocolVersion)
}

func TestCDPClientStagehandExtensionIntegration(t *testing.T) {
	cdpURL := os.Getenv("STAGEHAND_GO_CDP_URL")
	if cdpURL == "" || os.Getenv("STAGEHAND_GO_TEST_EXTENSION") == "" {
		t.Skip("set STAGEHAND_GO_CDP_URL and STAGEHAND_GO_TEST_EXTENSION for extension integration")
	}

	options := cdpClientOptions{
		cdpURL:           cdpURL,
		connectTimeout:   5 * time.Second,
		commandTimeout:   5 * time.Second,
		discoveryTimeout: 10 * time.Second,
		extensionDir:     os.Getenv("STAGEHAND_GO_EXTENSION_DIR"),
		extensionID:      os.Getenv("STAGEHAND_GO_EXTENSION_ID"),
	}
	rpc, err := connectRPCClient(
		context.Background(),
		options,
		TelemetryConfig{Traces: TelemetryTraces{
			Endpoint: "https://example.com/v1/traces",
			Headers:  TelemetryTracesHeaders{},
		}},
	)
	if err != nil {
		t.Fatalf("connectRPCClient() error = %v", err)
	}
	t.Cleanup(func() {
		if err := rpc.close(); err != nil {
			t.Errorf("RPC close() error = %v", err)
		}
	})

	client, ok := rpc.transport.(*cdpClient)
	if !ok {
		t.Fatalf("RPC transport = %T, want *cdpClient", rpc.transport)
	}
	client.mu.Lock()
	service := client.service
	client.mu.Unlock()
	if service.TargetID == "" || service.URL == "" || service.ExtensionID == "" {
		t.Fatalf("service worker = %#v", service)
	}
	var pages ContextPagesResult
	if err := rpc.call(context.Background(), "context.pages", EmptyParams{}, &pages); err != nil {
		t.Fatalf("Stagehand context.pages over CDP: %v", err)
	}
	if len(pages) == 0 || pages[0].PageID == "" {
		t.Fatalf("Stagehand context.pages = %#v", pages)
	}
	t.Logf("attached to Stagehand extension %s at %s", service.ExtensionID, service.URL)
}

func newTestCDPClient(
	t *testing.T,
	socket cdpWebSocket,
	webSocketURL string,
	timeout time.Duration,
) *cdpClient {
	t.Helper()
	client, err := newCDPClient(socket, webSocketURL, timeout)
	if err != nil {
		t.Fatalf("newCDPClient() error = %v", err)
	}
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	return client
}

func responseHook(
	t *testing.T,
	socket *fakeCDPWebSocket,
	methods chan<- string,
	response func(string, map[string]json.RawMessage) map[string]any,
) func([]byte) {
	t.Helper()
	return func(message []byte) {
		var command map[string]json.RawMessage
		if err := json.Unmarshal(message, &command); err != nil {
			t.Errorf("decode CDP command: %v", err)
			return
		}
		var (
			commandID uint64
			method    string
		)
		if err := json.Unmarshal(command["id"], &commandID); err != nil {
			t.Errorf("decode CDP command ID: %v", err)
			return
		}
		if err := json.Unmarshal(command["method"], &method); err != nil {
			t.Errorf("decode CDP method: %v", err)
			return
		}
		if methods != nil {
			methods <- method
		}
		body := response(method, command)
		body["id"] = commandID
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Errorf("encode CDP response: %v", err)
			return
		}
		socket.reads <- fakeCDPRead{message: encoded}
	}
}

func readyRuntimeResponse() map[string]any {
	return map[string]any{"result": map[string]any{
		"result": map[string]any{
			"value": map[string]any{
				"marker": map[string]any{
					"protocolVersion": stagehandProtocolVersion,
					"serverInfo": map[string]any{
						"name":    stagehandRuntimeName,
						"version": stagehandSDKVersion,
					},
				},
				"hasReceiver": true,
			},
		},
	}}
}

func receiveCDPWrite(t *testing.T, socket *fakeCDPWebSocket) []byte {
	t.Helper()
	select {
	case message := <-socket.writes:
		return message
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for CDP command")
		return nil
	}
}

func drainMethods(methods <-chan string) []string {
	var result []string
	for {
		select {
		case method := <-methods:
			result = append(result, method)
		default:
			return result
		}
	}
}

func assertJSONEqual(t *testing.T, actual json.RawMessage, expected string) {
	t.Helper()
	var actualValue any
	if err := json.Unmarshal(actual, &actualValue); err != nil {
		t.Fatalf("decode actual JSON: %v", err)
	}
	var expectedValue any
	if err := json.Unmarshal([]byte(expected), &expectedValue); err != nil {
		t.Fatalf("decode expected JSON: %v", err)
	}
	if !reflect.DeepEqual(actualValue, expectedValue) {
		t.Fatalf("JSON mismatch\nactual:   %s\nexpected: %s", actual, expected)
	}
}
