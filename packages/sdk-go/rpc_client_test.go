package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"
)

type rpcTransportReceive struct {
	message json.RawMessage
	err     error
}

type rpcTestResult struct {
	OK bool `json:"ok"`
}

type queueRPCTransport struct {
	sent       chan json.RawMessage
	incoming   chan rpcTransportReceive
	closed     chan struct{}
	closeOnce  sync.Once
	closeCalls atomic.Int32
	closeErr   error
	sendHook   func(json.RawMessage)
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
	t.closeCalls.Add(1)
	t.closeOnce.Do(func() { close(t.closed) })
	return t.closeErr
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

func TestRPCResponseTimeoutPolicy(t *testing.T) {
	t.Parallel()

	fastTimeout, ok := rpcResponseTimeout("context.pages", json.RawMessage(`{}`))
	if !ok || fastTimeout != 10*time.Second {
		t.Fatalf("context.pages timeout = %v, %t; want 10s, true", fastTimeout, ok)
	}

	waitTimeout, ok := rpcResponseTimeout(
		"page.wait_for_timeout",
		json.RawMessage(`{"page_id":"page-1","ms":30000}`),
	)
	if !ok || waitTimeout != 40*time.Second {
		t.Fatalf("page.wait_for_timeout timeout = %v, %t; want 40s, true", waitTimeout, ok)
	}

	actTimeout, ok := rpcResponseTimeout(
		"stagehand.act",
		json.RawMessage(`{"page_id":"page-1","input":"click","options":{"timeout":30000}}`),
	)
	if !ok || actTimeout != 40*time.Second {
		t.Fatalf("stagehand.act timeout = %v, %t; want 40s, true", actTimeout, ok)
	}

	batchTimeout, ok := rpcResponseTimeout(
		"stagehand.callback_batch",
		json.RawMessage(`{"options":{"timeout":30000}}`),
	)
	if !ok || batchTimeout != 40*time.Second {
		t.Fatalf("stagehand.callback_batch timeout = %v, %t; want 40s, true", batchTimeout, ok)
	}

	webMCPTimeout, ok := rpcResponseTimeout(
		"page.webmcp_invocation_result",
		json.RawMessage(
			`{"page_id":"page-1","invocation_id":"invocation-1","options":{"timeout":30000}}`,
		),
	)
	if !ok || webMCPTimeout != 40*time.Second {
		t.Fatalf(
			"page.webmcp_invocation_result timeout = %v, %t; want 40s, true",
			webMCPTimeout,
			ok,
		)
	}

	if timeout, ok := rpcResponseTimeout("stagehand.init", json.RawMessage(`{}`)); ok {
		t.Fatalf("stagehand.init timeout = %v, true; want no nested RPC deadline", timeout)
	}

	defaultTimeouts := map[string]time.Duration{
		"page.goto":                25 * time.Second,
		"page.reload":              25 * time.Second,
		"page.go_back":             25 * time.Second,
		"page.go_forward":          25 * time.Second,
		"page.wait_for_load_state": 25 * time.Second,
		"page.wait_for_selector":   40 * time.Second,
		"page.webmcp_tools":        11 * time.Second,
	}
	for method, expected := range defaultTimeouts {
		timeout, ok := rpcResponseTimeout(method, json.RawMessage(`{}`))
		if !ok || timeout != expected {
			t.Errorf("%s timeout = %v, %t; want %v, true", method, timeout, ok, expected)
		}
	}

	unboundedMethods := []string{
		"stagehand.init",
		"stagehand.close",
		"stagehand.act",
		"stagehand.extract",
		"stagehand.observe",
		"context.new_page",
		"context.add_init_script",
		"context.set_extra_http_headers",
		"context.get_domain_policy",
		"context.set_domain_policy",
		"context.cookies",
		"context.add_cookies",
		"context.clear_cookies",
		"context.clipboard_read_text",
		"context.clipboard_write_text",
		"context.clipboard_clear",
		"context.clipboard_paste",
		"context.clipboard_copy",
		"context.clipboard_cut",
		"page.close",
		"page.evaluate",
		"page.screenshot",
		"page.snapshot",
		"page.webmcp_invocation_result",
		"locator.click",
		"locator.fill",
		"locator.hover",
		"locator.count",
		"locator.is_checked",
		"locator.input_value",
		"locator.is_visible",
		"locator.inner_text",
		"locator.inner_html",
		"locator.text_content",
		"locator.scroll_to",
		"locator.centroid",
		"locator.highlight",
		"locator.send_click_event",
		"locator.type",
		"locator.select_option",
		"locator.set_input_files",
	}
	for _, method := range unboundedMethods {
		if timeout, ok := rpcResponseTimeout(method, json.RawMessage(`{}`)); ok {
			t.Errorf("%s timeout = %v, true; want no response deadline", method, timeout)
		}
	}

	hugeTimeout, ok := rpcResponseTimeout(
		"stagehand.callback_batch",
		json.RawMessage(`{"options":{"timeout":1e1000}}`),
	)
	if !ok || hugeTimeout != maxRPCResponseTimeout {
		t.Fatalf(
			"huge stagehand.callback_batch timeout = %v, %t; want %v, true",
			hugeTimeout,
			ok,
			maxRPCResponseTimeout,
		)
	}
}

func TestRPCClientSerializesParamsAndStrictlyDecodesResults(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)

	var result PageNavigationResult
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
			"page": {
				"page_id": "page-2",
				"url": "https://example.com"
			},
			"response": null
		}
	}`)

	if err := receiveCallError(t, callDone); err != nil {
		t.Fatalf("call() error = %v", err)
	}
	if result.Page.PageID != "page-2" || result.Page.URL == nil || *result.Page.URL != "https://example.com" {
		t.Fatalf("call() result = %#v", result)
	}

	var invalid PageNavigationResult
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
			"page": {"page_id": "page-2", "unexpected": true},
			"response": null
		}
	}`)
	if err := receiveCallError(t, invalidDone); err == nil {
		t.Fatal("call() accepted an unknown result field")
	}

	var missing PageNavigationResult
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
		"result": {"page": {}, "response": null}
	}`)
	if err := receiveCallError(t, missingDone); err == nil {
		t.Fatal("call() accepted a result missing page_id")
	} else if !strings.Contains(err.Error(), `page: missing required JSON field "page_id"`) {
		t.Fatalf("call() error = %v, want missing nested page_id error", err)
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
				"result": {"ok": true}
			}`)
		}
	}
	client := newTestRPCClient(t, transport)

	var result rpcTestResult
	if err := client.call(context.Background(), "test.request", EmptyParams{}, &result); err != nil {
		t.Fatalf("call() error = %v", err)
	}
	if !result.OK {
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
		var result rpcTestResult
		callDone <- client.call(context.Background(), "test.request", EmptyParams{}, &result)
	}()
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 1,
		"method": "test.request",
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
		"result": {"ok": true}
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

func TestMarshalValidatedJSONHonorsCustomUnionUnmarshalers(t *testing.T) {
	t.Parallel()

	encoded, err := marshalValidatedJSON(StagehandActParams{
		Instruction: ActInstruction("click the link"),
		PageID:      "page-1",
	})
	if err != nil {
		t.Fatalf("marshalValidatedJSON() error = %v", err)
	}
	assertRPCJSON(t, encoded, `{
		"instruction": "click the link",
		"page_id": "page-1"
	}`)
}

func TestMarshalValidatedJSONPreservesEmptyIgnoreLocators(t *testing.T) {
	t.Parallel()

	stringPtr := func(value string) *string {
		return &value
	}
	tests := []struct {
		name   string
		params any
		want   string
	}{
		{
			name: "act",
			params: StagehandActParams{
				Instruction: ActInstruction("click the link"),
				PageID:      "page-1",
				Options:     &ActOptions{IgnoreLocators: []Locator{}},
			},
			want: `{
				"instruction": "click the link",
				"page_id": "page-1",
				"options": {"ignore_locators": []}
			}`,
		},
		{
			name: "observe",
			params: StagehandObserveParams{
				Instruction: stringPtr("find the link"),
				PageID:      "page-1",
				Options:     &ObserveOptions{IgnoreLocators: []Locator{}},
			},
			want: `{
				"instruction": "find the link",
				"page_id": "page-1",
				"options": {"ignore_locators": []}
			}`,
		},
		{
			name: "extract",
			params: StagehandExtractParams{
				Instruction: "extract the heading",
				PageID:      "page-1",
				Schema:      json.RawMessage(`{"type":"object"}`),
				Options:     &ExtractOptions{IgnoreLocators: []Locator{}},
			},
			want: `{
				"instruction": "extract the heading",
				"page_id": "page-1",
				"schema": {"type":"object"},
				"options": {"ignore_locators": []}
			}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			encoded, err := marshalValidatedJSON(test.params)
			if err != nil {
				t.Fatalf("marshalValidatedJSON() error = %v", err)
			}
			assertRPCJSON(t, encoded, test.want)
		})
	}
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
		) (rpcTestResult, error) {
			return rpcTestResult{}, errors.New("client handler failed")
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
		var result rpcTestResult
		callDone <- client.call(context.Background(), "test.request", EmptyParams{}, &result)
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

func TestRPCClientValidatesPageCDPEventNotificationsWithoutRenamingRawParams(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	received := make(chan PageCDPEventNotification, 1)
	client.onPageCDPEvent(func(notification PageCDPEventNotification) {
		received <- notification
	})

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"method": "page.cdp_event",
		"params": {
			"subscription_id": "subscription-1",
			"event": {
				"page_id": "page-1",
				"method": "Runtime.consoleAPICalled",
				"params": {"executionContextId": 7},
				"session_id": "session-1",
				"target_id": "target-1"
			}
		}
	}`)

	select {
	case notification := <-received:
		if notification.SubscriptionID != "subscription-1" {
			t.Fatalf("subscription ID = %q", notification.SubscriptionID)
		}
		if string(notification.Event.Params["executionContextId"]) != "7" {
			t.Fatalf("raw params = %#v", notification.Event.Params)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for page CDP event")
	}
}

func TestRPCClientDeliversNotificationToHandlersInRegistrationOrder(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	received := make(chan string, 2)
	client.onNotification("stagehand.log", func(log StagehandLog) {
		received <- "first:" + log.Message
	})
	client.onNotification("stagehand.log", func(log StagehandLog) {
		received <- "second:" + log.Message
	})

	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"method": "stagehand.log",
		"params": {"level": "info", "message": "one notification", "data": {}}
	}`)

	for _, want := range []string{"first:one notification", "second:one notification"} {
		select {
		case got := <-received:
			if got != want {
				t.Fatalf("handler delivery = %q, want %q", got, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for %q", want)
		}
	}
	select {
	case got := <-received:
		t.Fatalf("unexpected extra handler delivery %q", got)
	default:
	}
}

func TestRPCClientDecodesNotificationsOutsideMutex(t *testing.T) {
	t.Parallel()

	decodeStarted := make(chan struct{})
	releaseDecode := make(chan struct{})
	receiveDone := make(chan struct{})
	client := &rpcClient{
		notificationHandlers: map[string][]registeredNotificationHandler{
			"test.notification": {{
				decode: func(json.RawMessage) (any, error) {
					close(decodeStarted)
					<-releaseDecode
					return "decoded", nil
				},
				handler: func(any) {},
			}},
		},
		notificationWake: make(chan struct{}, 1),
	}
	go func() {
		defer close(receiveDone)
		client.receiveNotification("test.notification", json.RawMessage(`{}`))
	}()
	select {
	case <-decodeStarted:
	case <-time.After(time.Second):
		close(releaseDecode)
		t.Fatal("timed out waiting for notification decode")
	}

	mutexAvailableDuringDecode := client.mu.TryLock()
	if mutexAvailableDuringDecode {
		client.mu.Unlock()
	}
	close(releaseDecode)
	select {
	case <-receiveDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for notification receive")
	}
	if !mutexAvailableDuringDecode {
		t.Fatal("RPC mutex remained locked during notification decode")
	}
}

func TestRPCClientBoundsQueuedNotificationsWithoutSplittingHandlerGroups(t *testing.T) {
	t.Parallel()

	client := &rpcClient{}
	client.mu.Lock()
	for index := range maxPendingNotifications + 50 {
		deliveries := make([]rpcNotificationDelivery, 3)
		for handlerIndex := range deliveries {
			deliveries[handlerIndex] = rpcNotificationDelivery{
				notification: StagehandLog{Message: strconv.Itoa(index)},
			}
		}
		client.enqueueNotificationLocked(rpcNotificationDeliveryGroup{
			deliveries: deliveries,
		})
	}
	if len(client.notificationQueue) != maxPendingNotifications {
		t.Fatalf(
			"queued notifications = %d, want %d",
			len(client.notificationQueue),
			maxPendingNotifications,
		)
	}
	firstGroup := client.notificationQueue[0]
	lastGroup := client.notificationQueue[len(client.notificationQueue)-1]
	client.mu.Unlock()

	if len(firstGroup.deliveries) != 3 || len(lastGroup.deliveries) != 3 {
		t.Fatalf(
			"retained handler group sizes = %d, %d; want 3, 3",
			len(firstGroup.deliveries),
			len(lastGroup.deliveries),
		)
	}
	first := firstGroup.deliveries[0].notification.(StagehandLog).Message
	last := lastGroup.deliveries[0].notification.(StagehandLog).Message
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
		var result rpcTestResult
		callbackDone <- client.call(context.Background(), "test.request", EmptyParams{}, &result)
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
	if envelope.Method != "test.request" {
		t.Fatalf("reentrant method = %q, want test.request", envelope.Method)
	}
	response, _ := json.Marshal(rpcSuccessEnvelope{
		JSONRPC: jsonRPCVersion,
		ID:      envelope.ID,
		Result:  json.RawMessage(`{"ok":true}`),
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
		var result rpcTestResult
		delayedDone <- delayedClient.call(context.Background(), "test.request", EmptyParams{}, &result)
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
		"result": {"ok": true}
	}`)
	if err := receiveCallError(t, delayedDone); err != nil {
		t.Fatalf("delayed call error = %v", err)
	}

	cancelTransport := newQueueRPCTransport()
	cancelClient := newTestRPCClient(t, cancelTransport)
	ctx, cancel := context.WithCancel(context.Background())
	cancelDone := make(chan error, 1)
	go func() {
		var result rpcTestResult
		cancelDone <- cancelClient.call(ctx, "test.request", EmptyParams{}, &result)
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
		var result rpcTestResult
		failingDone <- failingClient.call(context.Background(), "test.request", EmptyParams{}, &result)
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
	client, err := newRPCClient(transport, true)
	if err != nil {
		t.Fatalf("newRPCClient() error = %v", err)
	}
	callDone := make(chan error, 1)
	go func() {
		var result rpcTestResult
		callDone <- client.call(context.Background(), "test.request", EmptyParams{}, &result)
	}()
	_ = receiveSentRPC(t, transport)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"result": {"ok": true},
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

func TestRPCClientTransportOwnership(t *testing.T) {
	tests := []struct {
		name           string
		ownsTransport  bool
		wantCloseCalls int32
		wantCloseErr   bool
	}{
		{
			name:           "borrowed transport",
			ownsTransport:  false,
			wantCloseCalls: 0,
		},
		{
			name:           "owned transport",
			ownsTransport:  true,
			wantCloseCalls: 1,
			wantCloseErr:   true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transportCloseErr := errors.New("transport close failed")
			transport := newQueueRPCTransport()
			transport.closeErr = transportCloseErr
			client, err := newRPCClient(transport, test.ownsTransport)
			if err != nil {
				t.Fatalf("newRPCClient() error = %v", err)
			}

			callDone := make([]chan error, 2)
			for index := range callDone {
				callDone[index] = make(chan error, 1)
				go func(done chan<- error) {
					var result rpcTestResult
					done <- client.call(
						context.Background(),
						"test.request",
						EmptyParams{},
						&result,
					)
				}(callDone[index])
			}
			for range callDone {
				_ = receiveSentRPC(t, transport)
			}

			closeReason := errors.New("RPC scope ended")
			client.shutdown(closeReason)
			for _, done := range callDone {
				if err := receiveCallError(t, done); !errors.Is(err, closeReason) {
					t.Fatalf("pending call error = %v, want close reason", err)
				}
			}
			closeErr := client.close()
			if test.wantCloseErr {
				if !errors.Is(closeErr, transportCloseErr) {
					t.Fatalf("close() error = %v, want transport close error", closeErr)
				}
			} else if closeErr != nil {
				t.Fatalf("close() error = %v, want nil", closeErr)
			}
			if got := transport.closeCalls.Load(); got != test.wantCloseCalls {
				t.Fatalf("transport Close calls = %d, want %d", got, test.wantCloseCalls)
			}
		})
	}
}

func TestRPCClientCloseDropsLivePageEventListeners(t *testing.T) {
	t.Parallel()

	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	remove := client.onPageCDPEvent(func(PageCDPEventNotification) {})

	if err := client.close(); err != nil {
		t.Fatalf("close() error = %v", err)
	}
	client.mu.Lock()
	handlerCount := len(client.notificationHandlers["page.cdp_event"])
	client.mu.Unlock()
	if handlerCount != 0 {
		t.Fatalf("page event handlers after close = %d, want 0", handlerCount)
	}

	remove()
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
		) (rpcTestResult, error) {
			inboundTrace <- trace.SpanContextFromContext(ctx)
			return rpcTestResult{OK: true}, nil
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
		var result rpcTestResult
		callDone <- client.call(outboundContext, "test.request", EmptyParams{}, &result)
	}()
	assertRPCJSON(t, receiveSentRPC(t, transport), `{
		"jsonrpc": "2.0",
		"id": 1,
		"method": "test.request",
		"params": {},
		"traceparent": "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
		"tracestate": "stagehand=test"
	}`)
	transport.receiveJSON(`{
		"jsonrpc": "2.0",
		"id": 1,
		"result": {"ok": true}
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
	client, err := newRPCClient(transport, true)
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
