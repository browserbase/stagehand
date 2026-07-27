package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"
)

type rpcTransportReceive struct {
	message json.RawMessage
	err     error
}

type queueRPCTransport struct {
	sent      chan json.RawMessage
	incoming  chan rpcTransportReceive
	closed    chan struct{}
	closeOnce sync.Once
	sendHook  func(json.RawMessage)
}

func newQueueRPCTransport() *queueRPCTransport {
	return &queueRPCTransport{
		sent:     make(chan json.RawMessage, 32),
		incoming: make(chan rpcTransportReceive, 32),
		closed:   make(chan struct{}),
	}
}

func (t *queueRPCTransport) Send(
	ctx context.Context,
	message json.RawMessage,
) error {
	copied := append(json.RawMessage(nil), message...)
	select {
	case t.sent <- copied:
		if t.sendHook != nil {
			t.sendHook(copied)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-t.closed:
		return ErrRPCClientClosed
	}
}

func (t *queueRPCTransport) Receive(ctx context.Context) (json.RawMessage, error) {
	select {
	case received := <-t.incoming:
		return received.message, received.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-t.closed:
		return nil, ErrRPCClientClosed
	}
}

func (t *queueRPCTransport) Close() error {
	t.closeOnce.Do(func() { close(t.closed) })
	return nil
}

func (t *queueRPCTransport) receiveJSON(message string) {
	t.incoming <- rpcTransportReceive{message: json.RawMessage(message)}
}

func (t *queueRPCTransport) failReceive(err error) {
	t.incoming <- rpcTransportReceive{err: err}
}

type uppercaseRPCParams struct {
	Value string `json:"value"`
}

type uppercaseRPCResult struct {
	Value string `json:"value"`
}

func TestRPCClientSerializesParamsAndStrictlyDecodesResults(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)

	var result PageRef
	callDone := make(chan error, 1)
	go func() {
		callDone <- client.call(
			context.Background(),
			"page.goto",
			PageGotoParams{PageID: "page-1", URL: "https://example.com"},
			&result,
		)
	}()

	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 1,
		"method": "page.goto",
		"params": {
			"page_id": "page-1",
			"url": "https://example.com"
		}
	}`)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"result": {
			"page_id": "page-2",
			"url": "https://example.com"
		}
	}`)

	if err := receiveCallError(t, callDone); err != nil {
		t.Fatalf("call() error = %v", err)
	}
	if result.PageID != "page-2" || result.URL == nil || *result.URL != "https://example.com" {
		t.Fatalf("call() result = %#v", result)
	}

	var invalid PageRef
	invalidDone := make(chan error, 1)
	go func() {
		invalidDone <- client.call(
			context.Background(),
			"page.goto",
			PageGotoParams{PageID: "page-1", URL: "https://example.com"},
			&invalid,
		)
	}()
	_ = receiveSentRPC(t, transport)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 2,
		"result": {
			"page_id": "page-2",
			"unexpected": true
		}
	}`)
	if err := receiveCallError(t, invalidDone); err == nil {
		t.Fatal("call() accepted an unknown result field")
	}

	var missing PageRef
	missingDone := make(chan error, 1)
	go func() {
		missingDone <- client.call(
			context.Background(),
			"page.goto",
			PageGotoParams{PageID: "page-1", URL: "https://example.com"},
			&missing,
		)
	}()
	_ = receiveSentRPC(t, transport)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 3,
		"result": {"url": "https://example.com"}
	}`)
	if err := receiveCallError(t, missingDone); err == nil {
		t.Fatal("call() accepted a result missing page_id")
	}
}

func TestRPCClientRegistersPendingBeforeTransportCanRespond(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	transport.sendHook = func(message json.RawMessage) {
		var request struct {
			ID uint64 `json:"id"`
		}
		if json.Unmarshal(message, &request) == nil {
			transport.receiveJSON(`{
				"jsonrpc": "2.0",
				"id": ` + jsonNumber(request.ID) + `,
				"result": {"ok": true, "runtime": "service_worker"}
			}`)
		}
	}
	client := newTestRPCClient(t, transport)

	var result StagehandPingResult
	if err := client.call(context.Background(), "ping", EmptyParams{}, &result); err != nil {
		t.Fatalf("call() error = %v", err)
	}
	if !result.Ok || result.Runtime != "service_worker" {
		t.Fatalf("call() result = %#v", result)
	}
}

func TestRPCClientHandlesNestedInboundRequestWhileCallIsPending(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	client.onRequest(
		"test.uppercase",
		newRequestHandler(func(
			_ context.Context,
			params uppercaseRPCParams,
		) (uppercaseRPCResult, error) {
			return uppercaseRPCResult{Value: stringsToUpper(params.Value)}, nil
		}),
	)

	callDone := make(chan error, 1)
	go func() {
		var result StagehandPingResult
		callDone <- client.call(context.Background(), "ping", EmptyParams{}, &result)
	}()
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 1,
		"method": "ping",
		"params": {}
	}`)

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 42,
		"method": "test.uppercase",
		"params": {"value": "nested request"}
	}`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 42,
		"result": {"value": "NESTED REQUEST"}
	}`)

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"result": {"ok": true, "runtime": "service_worker"}
	}`)
	if err := receiveCallError(t, callDone); err != nil {
		t.Fatalf("call() error = %v", err)
	}
}

func TestRPCClientValidatesInboundRequestsAndHandlerResults(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	calls := 0
	client.onRequest(
		"test.uppercase",
		newRequestHandler(func(
			_ context.Context,
			params uppercaseRPCParams,
		) (uppercaseRPCResult, error) {
			calls++
			return uppercaseRPCResult{Value: stringsToUpper(params.Value)}, nil
		}),
	)

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 2,
		"method": "test.uppercase",
		"params": {"value": 42}
	}`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 2,
		"error": {"code": -32602, "message": "Invalid params"}
	}`)
	if calls != 0 {
		t.Fatalf("handler calls = %d, want 0", calls)
	}

	client.onRequest("test.uppercase", requestHandler{
		decode: func(raw json.RawMessage) (any, error) {
			var params uppercaseRPCParams
			err := decodeStrictJSON(raw, &params)
			return params, err
		},
		handle: func(context.Context, any) (any, error) {
			return uppercaseRPCResult{Value: "INVALID"}, nil
		},
		encode: func(any) (json.RawMessage, error) {
			return nil, errors.New("result failed validation")
		},
	})
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 3,
		"method": "test.uppercase",
		"params": {"value": "valid"}
	}`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 3,
		"error": {"code": -32603, "message": "Internal error"}
	}`)
}

func TestRPCClientReturnsMethodAndHandlerErrors(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 4,
		"method": "test.missing",
		"params": {}
	}`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 4,
		"error": {"code": -32601, "message": "Method not found"}
	}`)

	client.onRequest(
		"test.fail",
		newRequestHandler(func(
			context.Context,
			EmptyParams,
		) (StagehandPingResult, error) {
			return StagehandPingResult{}, errors.New("client handler failed")
		}),
	)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 5,
		"method": "test.fail",
		"params": {}
	}`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 5,
		"error": {
			"code": -32603,
			"message": "client handler failed",
			"data": {"name": "Error"}
		}
	}`)
}

func TestRPCClientPreservesJSONRPCErrorCodeAndData(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	callDone := make(chan error, 1)
	go func() {
		var result StagehandPingResult
		callDone <- client.call(context.Background(), "ping", EmptyParams{}, &result)
	}()
	_ = receiveSentRPC(t, transport)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"error": {
			"code": -32603,
			"message": "Runtime failed",
			"data": {"name": "RuntimeError"}
		}
	}`)

	err := receiveCallError(t, callDone)
	var rpcErr *RPCError
	if !errors.As(err, &rpcErr) {
		t.Fatalf("call() error = %T %v, want *RPCError", err, err)
	}
	if rpcErr.Code != jsonRPCInternalError || rpcErr.Message != "Runtime failed" {
		t.Fatalf("RPCError = %#v", rpcErr)
	}
	assertRPCJSON(t, rpcErr.Data, `{"name":"RuntimeError"}`)
}

func TestRPCClientValidatesAndFlushesBufferedNotifications(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"method": "stagehand.log",
		"params": {"level": "info", "message": "Browser started", "data": {}}
	}`)
	waitForCondition(t, func() bool {
		client.mu.Lock()
		defer client.mu.Unlock()
		return len(client.pendingNotifications) == 1
	})

	received := make(chan string, 3)
	remove := client.onNotification("stagehand.log", func(log StagehandLog) {
		received <- log.Message
	})
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"method": "stagehand.log",
		"params": {"level": "info", "message": "Browser ready", "data": {}}
	}`)
	for _, want := range []string{"Browser started", "Browser ready"} {
		select {
		case message := <-received:
			if message != want {
				t.Fatalf("notification = %q, want %q", message, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for notification %q", want)
		}
	}

	remove()
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"method": "stagehand.log",
		"params": {"level": "info", "message": "Not delivered", "data": {}}
	}`)
	select {
	case message := <-received:
		t.Fatalf("removed listener received %q", message)
	case <-time.After(25 * time.Millisecond):
	}
}

func TestRPCClientBoundsQueuedLogDeliveries(t *testing.T) {
	t.Parallel()

	client := &rpcClient{}
	client.mu.Lock()
	for index := range maxPendingNotifications + 50 {
		client.enqueueNotificationLocked(rpcNotificationDelivery{
			notification: StagehandLog{Message: strconv.Itoa(index)},
		})
	}
	if len(client.notificationQueue) != maxPendingNotifications {
		t.Fatalf(
			"queued notifications = %d, want %d",
			len(client.notificationQueue),
			maxPendingNotifications,
		)
	}
	first := client.notificationQueue[0].notification.Message
	last := client.notificationQueue[len(client.notificationQueue)-1].notification.Message
	client.mu.Unlock()

	if first != "50" || last != "149" {
		t.Fatalf("retained notification range = %s..%s, want 50..149", first, last)
	}
}

func TestRPCClientLogCallbackCanMakeReentrantCall(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	callbackDone := make(chan error, 1)
	client.onNotification("stagehand.log", func(StagehandLog) {
		var result StagehandPingResult
		callbackDone <- client.call(context.Background(), "ping", EmptyParams{}, &result)
	})

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"method": "stagehand.log",
		"params": {"level": "info", "message": "reentrant", "data": {}}
	}`)
	request := receiveSentRPC(t, transport)
	var envelope rpcRequestEnvelope
	if err := json.Unmarshal(request, &envelope); err != nil {
		t.Fatalf("decode reentrant request: %v", err)
	}
	if envelope.Method != "ping" {
		t.Fatalf("reentrant method = %q, want ping", envelope.Method)
	}
	response, _ := json.Marshal(rpcSuccessEnvelope{
		JSONRPC: jsonRPCVersion,
		ID:      envelope.ID,
		Result:  json.RawMessage(`{"ok":true,"runtime":"service_worker"}`),
	})
	transport.incoming <- rpcTransportReceive{message: response}
	if err := receiveCallError(t, callbackDone); err != nil {
		t.Fatalf("reentrant call error = %v", err)
	}
}

func TestRPCClientSendsParseAndInvalidRequestErrors(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	_ = newTestRPCClient(t, transport)

	transport.receiveJSON(`{`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": null,
		"error": {"code": -32700, "message": "Parse error"}
	}`)

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 4,
		"method": 1,
		"params": {}
	}`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 4,
		"error": {"code": -32600, "message": "Invalid request"}
	}`)
}

func TestRPCClientWaitsForResponseAndRejectsCanceledOrFailedCalls(t *testing.T) {
	t.Parallel()

	delayedTransport := newQueueRPCTransport()
	delayedClient := newTestRPCClient(t, delayedTransport)
	delayedDone := make(chan error, 1)
	go func() {
		var result StagehandPingResult
		delayedDone <- delayedClient.call(context.Background(), "ping", EmptyParams{}, &result)
	}()
	_ = receiveSentRPC(t, delayedTransport)
	select {
	case err := <-delayedDone:
		t.Fatalf("call returned before transport response: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	delayedTransport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"result": {"ok": true, "runtime": "service_worker"}
	}`)
	if err := receiveCallError(t, delayedDone); err != nil {
		t.Fatalf("delayed call error = %v", err)
	}

	cancelTransport := newQueueRPCTransport()
	cancelClient := newTestRPCClient(t, cancelTransport)
	ctx, cancel := context.WithCancel(context.Background())
	cancelDone := make(chan error, 1)
	go func() {
		var result StagehandPingResult
		cancelDone <- cancelClient.call(ctx, "ping", EmptyParams{}, &result)
	}()
	_ = receiveSentRPC(t, cancelTransport)
	cancel()
	if err := receiveCallError(t, cancelDone); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled call error = %v", err)
	}

	failingTransport := newQueueRPCTransport()
	failingClient := newTestRPCClient(t, failingTransport)
	failingDone := make(chan error, 1)
	go func() {
		var result StagehandPingResult
		failingDone <- failingClient.call(context.Background(), "ping", EmptyParams{}, &result)
	}()
	_ = receiveSentRPC(t, failingTransport)
	failingTransport.failReceive(errors.New("transport reader failed"))
	if err := receiveCallError(t, failingDone); err == nil || err.Error() != "transport reader failed" {
		t.Fatalf("transport failure error = %v", err)
	}
	select {
	case <-failingTransport.closed:
	case <-time.After(time.Second):
		t.Fatal("transport was not closed after receive failure")
	}
}

func TestRPCClientInvalidResponseClosesClientAndRejectsPendingCall(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client, err := newRPCClient(transport)
	if err != nil {
		t.Fatalf("newRPCClient() error = %v", err)
	}
	callDone := make(chan error, 1)
	go func() {
		var result StagehandPingResult
		callDone <- client.call(context.Background(), "ping", EmptyParams{}, &result)
	}()
	_ = receiveSentRPC(t, transport)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"result": {"ok": true, "runtime": "service_worker"},
		"unexpected": true
	}`)

	if err := receiveCallError(t, callDone); err == nil || err.Error() != "invalid JSON-RPC response" {
		t.Fatalf("invalid response error = %v", err)
	}
	select {
	case <-transport.closed:
	case <-time.After(time.Second):
		t.Fatal("transport was not closed after invalid response")
	}
	if err := client.close(); err != nil {
		t.Fatalf("close() error = %v", err)
	}
}

func TestRPCClientCarriesTraceContextIntoBidirectionalRequests(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	inboundTrace := make(chan trace.SpanContext, 1)
	client.onRequest(
		"test.trace",
		newRequestHandler(func(
			ctx context.Context,
			_ EmptyParams,
		) (StagehandPingResult, error) {
			inboundTrace <- trace.SpanContextFromContext(ctx)
			return StagehandPingResult{Ok: true, Runtime: "service_worker"}, nil
		}),
	)

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 17,
		"method": "test.trace",
		"params": {},
		"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"tracestate": "vendor=value"
	}`)
	_ = receiveSentRPC(t, transport)
	select {
	case spanContext := <-inboundTrace:
		if !spanContext.IsValid() ||
			!spanContext.IsRemote() ||
			spanContext.TraceID().String() != "4bf92f3577b34da6a3ce929d0e0e4736" ||
			spanContext.SpanID().String() != "00f067aa0ba902b7" ||
			spanContext.TraceState().String() != "vendor=value" {
			t.Fatalf("trace context = %#v", spanContext)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for traced handler")
	}

	outboundContext := contextWithTestSpan(
		t,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"bbbbbbbbbbbbbbbb",
		"stagehand=test",
	)
	callDone := make(chan error, 1)
	go func() {
		var result StagehandPingResult
		callDone <- client.call(outboundContext, "ping", EmptyParams{}, &result)
	}()
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 1,
		"method": "ping",
		"params": {},
		"traceparent": "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
		"tracestate": "stagehand=test"
	}`)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"result": {"ok": true, "runtime": "service_worker"}
	}`)
	if err := receiveCallError(t, callDone); err != nil {
		t.Fatalf("call() error = %v", err)
	}
}

func newTestRPCClient(
	t *testing.T,
	transport rpcTransport,
) *rpcClient {
	t.Helper()
	client, err := newRPCClient(transport)
	if err != nil {
		t.Fatalf("newRPCClient() error = %v", err)
	}
	t.Cleanup(func() {
		if err := client.close(); err != nil {
			t.Errorf("close() error = %v", err)
		}
	})
	return client
}

func receiveSentRPC(t *testing.T, transport *queueRPCTransport) json.RawMessage {
	t.Helper()
	select {
	case message := <-transport.sent:
		return message
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for outgoing RPC message")
		return nil
	}
}

func receiveCallError(t *testing.T, callDone <-chan error) error {
	t.Helper()
	select {
	case err := <-callDone:
		return err
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for RPC call")
		return nil
	}
}

func assertRPCJSON(t *testing.T, actual json.RawMessage, expected string) {
	t.Helper()
	var actualValue any
	if err := json.Unmarshal(actual, &actualValue); err != nil {
		t.Fatalf("decode actual JSON: %v\n%s", err, actual)
	}
	var expectedValue any
	if err := json.Unmarshal([]byte(expected), &expectedValue); err != nil {
		t.Fatalf("decode expected JSON: %v\n%s", err, expected)
	}
	if !reflect.DeepEqual(actualValue, expectedValue) {
		t.Fatalf("JSON mismatch\nactual:   %s\nexpected: %s", actual, expected)
	}
}

func waitForCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for condition")
		}
		time.Sleep(time.Millisecond)
	}
}

func jsonNumber(value uint64) string {
	return strconv.FormatUint(value, 10)
}

func stringsToUpper(value string) string {
	return strings.ToUpper(value)
}

func contextWithTestSpan(
	t *testing.T,
	traceIDValue string,
	spanIDValue string,
	traceStateValue string,
) context.Context {
	t.Helper()
	traceID, err := trace.TraceIDFromHex(traceIDValue)
	if err != nil {
		t.Fatalf("parse trace ID: %v", err)
	}
	spanID, err := trace.SpanIDFromHex(spanIDValue)
	if err != nil {
		t.Fatalf("parse span ID: %v", err)
	}
	traceState, err := trace.ParseTraceState(traceStateValue)
	if err != nil {
		t.Fatalf("parse trace state: %v", err)
	}
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
		TraceState: traceState,
	})
	return trace.ContextWithSpanContext(context.Background(), spanContext)
}
