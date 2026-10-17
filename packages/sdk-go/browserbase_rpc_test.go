package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func browserbaseRPCRequest(t *testing.T, transport *queueRPCTransport, id uint64, params BrowserbaseRequestParams) {
	t.Helper()
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	message, err := json.Marshal(rpcRequestEnvelope{JSONRPC: "2.0", ID: id, Method: "browserbase.request", Params: raw})
	if err != nil {
		t.Fatal(err)
	}
	transport.incoming <- rpcTransportReceive{message: message}
}

func browserbaseRPCCancel(transport *queueRPCTransport, id uint64, reason string) {
	transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","method":"browserbase.cancel","params":{"request_id":%d,"reason":%q}}`, id, reason))
}

func browserbaseRPCResult(t *testing.T, transport *queueRPCTransport, id uint64) BrowserbaseRequestResult {
	t.Helper()
	raw := receiveSentRPC(t, transport)
	var response rpcSuccessEnvelope
	if err := decodeStrictJSON(raw, &response); err != nil {
		t.Fatalf("response %s: %v", raw, err)
	}
	if response.ID != id {
		t.Fatalf("response ID = %d, want %d", response.ID, id)
	}
	var result BrowserbaseRequestResult
	if err := json.Unmarshal(response.Result, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func awaitBrowserbaseTest[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for Browserbase test work")
		var zero T
		return zero
	}
}

func connectBrowserbaseRPC(t *testing.T, connection *browserbaseConnection) (*rpcClient, *queueRPCTransport, func()) {
	t.Helper()
	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	dispose := registerBrowserbaseTransport(client, connection)
	t.Cleanup(dispose)
	return client, transport, dispose
}

func browserbaseRPCBarrier(t *testing.T, client *rpcClient, transport *queueRPCTransport) {
	t.Helper()
	remove := client.onRequest("test.barrier", newRequestHandler(func(context.Context, EmptyParams) (rpcTestResult, error) {
		return rpcTestResult{OK: true}, nil
	}))
	defer remove()
	transport.receiveJSON(`{"jsonrpc":"2.0","id":999,"method":"test.barrier","params":{}}`)
	assertRPCJSON(t, receiveSentRPC(t, transport), `{"jsonrpc":"2.0","id":999,"result":{"ok":true}}`)
}

func TestBrowserbaseRPCReverseRequestsDuringBatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/llm/responses" || r.Header.Get("X-BB-API-Key") != "bb-test" {
			t.Errorf("unexpected request: %s, headers %v", r.URL.Path, r.Header)
		}
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Retry-After", "2")
		w.WriteHeader(503)
		w.Write(body)
	}))
	t.Cleanup(server.Close)
	client, transport, _ := connectBrowserbaseRPC(t, &browserbaseConnection{apiKey: "bb-test", apiURL: server.URL + "/v1", sessionID: "session"})
	outer := make(chan error, 1)
	go func() {
		var result CallbackBatchResult
		outer <- client.call(context.Background(), "stagehand.callback_batch", CallbackBatchParams{
			CallbackSource: "async ({ stagehand }) => stagehand.act('click the button')",
			Options:        CallbackBatchOptions{Timeout: 30000},
		}, &result)
	}()
	var outbound rpcRequestEnvelope
	if err := json.Unmarshal(receiveSentRPC(t, transport), &outbound); err != nil {
		t.Fatal(err)
	}
	params := testBrowserbaseHTTPParams()
	// Incoming and outgoing IDs belong to independent directions.
	browserbaseRPCRequest(t, transport, outbound.ID, params)
	response, ok := browserbaseRPCResult(t, transport, outbound.ID).AsResponse()
	if !ok || response.Status != 503 || response.Headers["retry-after"] != "2" || response.Body != params.Body {
		t.Fatalf("response = %#v", response)
	}
	select {
	case err := <-outer:
		t.Fatalf("batch completed early: %v", err)
	default:
	}
	transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{"value":{"ok":true}}}`, outbound.ID))
	if err := awaitBrowserbaseTest(t, outer); err != nil {
		t.Fatal(err)
	}
}

func TestBrowserbaseRPCImmediateCancelBypassesLogs(t *testing.T) {
	for _, reason := range []string{"cancelled", "timeout"} {
		t.Run(reason, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1) }))
			t.Cleanup(server.Close)
			client, transport, _ := connectBrowserbaseRPC(t, &browserbaseConnection{apiKey: "key", apiURL: server.URL, sessionID: "session"})
			logEntered, releaseLog := make(chan struct{}), make(chan struct{})
			var first sync.Once
			client.onNotification("stagehand.log", func(StagehandLog) { first.Do(func() { close(logEntered); <-releaseLog }) })
			defer close(releaseLog)
			log := `{"jsonrpc":"2.0","method":"stagehand.log","params":{"level":"info","message":"queued","data":{}}}`
			transport.receiveJSON(log)
			awaitBrowserbaseTest(t, logEntered)
			// Hold execution after admission to make the immediate-cancel ordering deterministic.
			entered, release := make(chan struct{}), make(chan struct{})
			unblock := sync.OnceFunc(func() { close(release) })
			defer unblock()
			client.mu.Lock()
			registration := client.requestHandlers["browserbase.request"]
			original := registration.handler.handle
			registration.handler.handle = func(ctx context.Context, params any) (any, error) {
				close(entered)
				<-release
				return original(ctx, params)
			}
			client.requestHandlers["browserbase.request"] = registration
			client.mu.Unlock()
			browserbaseRPCRequest(t, transport, 1, testBrowserbaseHTTPParams())
			browserbaseRPCCancel(transport, 1, reason)
			browserbaseRPCCancel(transport, 1, "timeout") // First cancellation wins.
			for range maxPendingNotifications * 2 {
				transport.receiveJSON(log)
			}
			browserbaseRPCBarrier(t, client, transport)
			awaitBrowserbaseTest(t, entered)
			unblock()
			result := browserbaseRPCResult(t, transport, 1)
			testBrowserbaseHTTPFailure(t, result, nil, BrowserbaseTransportErrorReason(reason))
			if requests.Load() != 0 {
				t.Fatal("cancelled request reached HTTP server")
			}
		})
	}
}

func TestBrowserbaseRPCConnectionIsolationAndDuplicateIDs(t *testing.T) {
	started := make(chan string, 2)
	disconnected := make(chan string, 2)
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		key := r.Header.Get("X-BB-API-Key")
		started <- key
		select {
		case <-r.Context().Done():
			disconnected <- key
		case <-release:
			io.WriteString(w, key)
		}
	}))
	t.Cleanup(server.Close)
	defer unblock()
	_, a, _ := connectBrowserbaseRPC(t, &browserbaseConnection{apiKey: "first", apiURL: server.URL})
	bClient, b, _ := connectBrowserbaseRPC(t, &browserbaseConnection{apiKey: "second", apiURL: server.URL})
	browserbaseRPCRequest(t, a, 7, testBrowserbaseHTTPParams())
	browserbaseRPCRequest(t, b, 7, testBrowserbaseHTTPParams())
	awaitBrowserbaseTest(t, started)
	awaitBrowserbaseTest(t, started)
	browserbaseRPCRequest(t, a, 7, testBrowserbaseHTTPParams())
	var duplicate rpcErrorEnvelope
	if err := json.Unmarshal(receiveSentRPC(t, a), &duplicate); err != nil || duplicate.Error.Message != "Browserbase request ID is already in use" {
		t.Fatalf("duplicate response: %#v, %v", duplicate, err)
	}
	browserbaseRPCCancel(a, 7, "cancelled")
	testBrowserbaseHTTPFailure(t, browserbaseRPCResult(t, a, 7), nil, BrowserbaseTransportErrorReasonCancelled)
	if key := awaitBrowserbaseTest(t, disconnected); key != "first" {
		t.Fatalf("cancelled %q", key)
	}
	browserbaseRPCCancel(b, 9999, "cancelled")
	browserbaseRPCCancel(b, 7, "invalid")
	b.receiveJSON(`{"jsonrpc":"2.0","method":"browserbase.cancel","params":{"request_id":7,"reason":"cancelled","extra":true}}`)
	browserbaseRPCBarrier(t, bClient, b)
	unblock()
	result, ok := browserbaseRPCResult(t, b, 7).AsResponse()
	if !ok || result.Body != "second" {
		t.Fatalf("second connection changed: %#v", result)
	}
	// A late cancel must not affect the next request with the completed ID.
	browserbaseRPCCancel(b, 7, "cancelled")
	browserbaseRPCRequest(t, b, 7, testBrowserbaseHTTPParams())
	if _, ok := browserbaseRPCResult(t, b, 7).AsResponse(); !ok {
		t.Fatal("completed ID was retained")
	}
}

func TestBrowserbaseRPCDeadlineAndBodyCancellation(t *testing.T) {
	for _, mode := range []string{"budget", "cancelled", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			started, disconnected := make(chan struct{}), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body)
				w.WriteHeader(200)
				w.(http.Flusher).Flush()
				close(started)
				<-r.Context().Done()
				close(disconnected)
			}))
			t.Cleanup(server.Close)
			_, transport, _ := connectBrowserbaseRPC(t, &browserbaseConnection{apiKey: "key", apiURL: server.URL})
			params := testBrowserbaseHTTPParams()
			if mode == "budget" {
				budget := 100.0
				params.RemainingTimeoutMs = &budget
			}
			browserbaseRPCRequest(t, transport, 1, params)
			awaitBrowserbaseTest(t, started)
			reason := BrowserbaseTransportErrorReasonTimeout
			if mode != "budget" {
				browserbaseRPCCancel(transport, 1, mode)
				reason = BrowserbaseTransportErrorReason(mode)
			}
			testBrowserbaseHTTPFailure(t, browserbaseRPCResult(t, transport, 1), nil, reason)
			awaitBrowserbaseTest(t, disconnected)
		})
	}
}

func TestBrowserbaseRPCDisposalAndDisconnectSuppressLateReplies(t *testing.T) {
	for _, mode := range []string{"dispose", "close", "disconnect"} {
		t.Run(mode, func(t *testing.T) {
			started, disconnected := make(chan struct{}), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body)
				close(started)
				<-r.Context().Done()
				close(disconnected)
			}))
			t.Cleanup(server.Close)
			client, transport, dispose := connectBrowserbaseRPC(t, &browserbaseConnection{apiKey: "key", apiURL: server.URL})
			completed, release := make(chan struct{}), make(chan struct{})
			unblock := sync.OnceFunc(func() { close(release) })
			defer unblock()
			client.mu.Lock()
			registration := client.requestHandlers["browserbase.request"]
			original := registration.handler.handle
			registration.handler.handle = func(ctx context.Context, params any) (any, error) {
				result, err := original(ctx, params)
				close(completed)
				<-release
				return result, err
			}
			client.requestHandlers["browserbase.request"] = registration
			client.mu.Unlock()
			browserbaseRPCRequest(t, transport, 1, testBrowserbaseHTTPParams())
			awaitBrowserbaseTest(t, started)
			done := make(chan struct{})
			go func() {
				switch mode {
				case "close":
					client.close()
				case "disconnect":
					transport.failReceive(errors.New("connection lost"))
					<-client.readerDone
				}
				dispose()
				close(done)
			}()
			awaitBrowserbaseTest(t, disconnected)
			awaitBrowserbaseTest(t, completed)
			select {
			case <-done:
				t.Fatal("disposal returned before owned work completed")
			default:
			}
			unblock()
			awaitBrowserbaseTest(t, done)
			// The queued transport can accept a cancelled Send; suppression must happen before Send.
			select {
			case raw := <-transport.sent:
				t.Fatalf("late reply: %s", raw)
			default:
			}
			if mode == "dispose" {
				browserbaseRPCBarrier(t, client, transport)
				browserbaseRPCRequest(t, transport, 2, testBrowserbaseHTTPParams())
				var response rpcErrorEnvelope
				if err := json.Unmarshal(receiveSentRPC(t, transport), &response); err != nil || response.Error.Code != jsonRPCMethodNotFound {
					t.Fatalf("disposed handler: %#v, %v", response, err)
				}
				if transport.closeCalls.Load() != 0 {
					t.Fatal("disposal closed shared transport")
				}
			}
			// Concurrent repeat disposal must be safe, including after automatic teardown.
			var callers sync.WaitGroup
			for range 4 {
				callers.Go(dispose)
			}
			callers.Wait()
		})
	}
}

func TestBrowserbaseRPCInvalidParamsAndUnavailable(t *testing.T) {
	_, transport, _ := connectBrowserbaseRPC(t, nil)
	transport.receiveJSON(`{"jsonrpc":"2.0","id":1,"method":"browserbase.request","params":{"operation":"cache.get","headers":{}}}`)
	var response rpcErrorEnvelope
	if err := json.Unmarshal(receiveSentRPC(t, transport), &response); err != nil || response.Error.Code != jsonRPCInvalidParams {
		t.Fatalf("invalid params: %#v, %v", response, err)
	}
	browserbaseRPCRequest(t, transport, 1, testBrowserbaseHTTPParams())
	testBrowserbaseHTTPFailure(t, browserbaseRPCResult(t, transport, 1), nil, BrowserbaseTransportErrorReasonUnavailable)
}

func TestBrowserbaseRPCInvalidHeaders(t *testing.T) {
	_, transport, _ := connectBrowserbaseRPC(t, &browserbaseConnection{"key", "https://fixture.example/v1", "session"})
	params := testBrowserbaseHTTPParams()
	params.Headers["bad name"] = "value"
	browserbaseRPCRequest(t, transport, 1, params)
	var response rpcErrorEnvelope
	if err := decodeStrictJSON(receiveSentRPC(t, transport), &response); err != nil || response.Error.Code != jsonRPCInternalError {
		t.Fatalf("invalid header reply = %#v, error = %v", response, err)
	}
}

func TestBrowserbaseRPCPreservesCustomGenerate(t *testing.T) {
	client, transport, dispose := connectBrowserbaseRPC(t, nil)
	started, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	client.onRequest("llm.generate", newRequestHandler(func(ctx context.Context, params LLMGenerateParams) (LLMGenerateResult, error) {
		close(started)
		<-release
		if ctx.Err() != nil {
			return LLMGenerateResult{}, ctx.Err()
		}
		return StructuredGenerateResult(LLMStructuredGenerateResult{
			Role: LLMRoleAssistant, Content: LLMMessageContent{TextContentBlock(LLMTextContent{Type: "text", Text: `{}`})}, OutputFormat: "json_schema", StructuredContent: json.RawMessage(`{}`),
		}), nil
	}))
	transport.receiveJSON(`{"jsonrpc":"2.0","id":7,"method":"llm.generate","params":{"messages":[],"response_format":{"name":"test","schema":{"type":"object"},"type":"json_schema"}}}`)
	awaitBrowserbaseTest(t, started)
	browserbaseRPCCancel(transport, 7, "cancelled")
	browserbaseRPCBarrier(t, client, transport)
	dispose()
	unblock()
	var response rpcSuccessEnvelope
	if err := decodeStrictJSON(receiveSentRPC(t, transport), &response); err != nil {
		t.Fatal(err)
	}
	var result LLMGenerateResult
	if err := json.Unmarshal(response.Result, &result); err != nil {
		t.Fatal(err)
	}
	if _, ok := result.AsStructured(); !ok {
		t.Fatal("custom Generate result changed")
	}
}

func TestBrowserbaseRPCDisposalRacesCompletionAndClose(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{}`) }))
	t.Cleanup(server.Close)
	for range 10 {
		client, transport, dispose := connectBrowserbaseRPC(t, &browserbaseConnection{apiKey: "key", apiURL: server.URL})
		completed, release := make(chan struct{}), make(chan struct{})
		unblock := sync.OnceFunc(func() { close(release) })
		client.mu.Lock()
		registration := client.requestHandlers["browserbase.request"]
		original := registration.handler.handle
		registration.handler.handle = func(ctx context.Context, params any) (any, error) {
			result, err := original(ctx, params)
			close(completed)
			<-release
			return result, err
		}
		client.requestHandlers["browserbase.request"] = registration
		client.mu.Unlock()
		browserbaseRPCRequest(t, transport, 1, testBrowserbaseHTTPParams())
		awaitBrowserbaseTest(t, completed)
		var racers sync.WaitGroup
		start := make(chan struct{})
		for _, action := range []func(){dispose, dispose, func() { client.close() }, unblock} {
			racers.Go(func() { <-start; action() })
		}
		close(start)
		done := make(chan struct{})
		go func() { racers.Wait(); close(done) }()
		awaitBrowserbaseTest(t, done)
	}
}

func TestBrowserbaseRPCControlNotificationsAreNotReplayed(t *testing.T) {
	transport := newQueueRPCTransport()
	client := newTestRPCClient(t, transport)
	// Cancellation received without a registration must not apply to later work.
	browserbaseRPCCancel(transport, 1, "cancelled")
	browserbaseRPCBarrier(t, client, transport)
	delivered := make(chan BrowserbaseCancelParams, 1)
	remove := registerControlNotification(client, "browserbase.cancel", func(params BrowserbaseCancelParams) { delivered <- params })
	defer remove()
	browserbaseRPCBarrier(t, client, transport)
	select {
	case <-delivered:
		t.Fatal("stale control notification was replayed")
	default:
	}
	browserbaseRPCCancel(transport, 2, "timeout")
	if params := awaitBrowserbaseTest(t, delivered); params.RequestID != 2 || params.Reason != BrowserbaseCancelParamsReasonTimeout {
		t.Fatalf("live cancellation changed: %#v", params)
	}
}
