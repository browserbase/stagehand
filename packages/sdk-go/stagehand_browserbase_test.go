package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

type browserbaseCreateResult struct {
	client *Stagehand
	err    error
}

func startBrowserbaseCreate(t *testing.T, ctx context.Context, options CreateOptions) (*rpcClient, *queueRPCTransport, <-chan browserbaseCreateResult) {
	t.Helper()
	transport := newQueueRPCTransport()
	rpc, err := newRPCClient(transport, false)
	if err != nil {
		t.Fatal(err)
	}
	rpc.browserWebSocketURL = "ws://browser"
	t.Cleanup(func() { _ = rpc.close() })
	created := make(chan browserbaseCreateResult, 1)
	go func() {
		client, err := createWithAdapters(ctx, options, clientAdapters{
			connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) { return rpc, nil },
		})
		created <- browserbaseCreateResult{client, err}
	}()
	return rpc, transport, created
}

func receiveStagehandRequest(t *testing.T, transport *queueRPCTransport, method string) rpcRequestEnvelope {
	t.Helper()
	var request rpcRequestEnvelope
	if err := json.Unmarshal(receiveSentRPC(t, transport), &request); err != nil {
		t.Fatal(err)
	}
	if request.Method != method {
		t.Fatalf("method = %q, want %q", request.Method, method)
	}
	return request
}

func assertBrowserbaseHandlersRemoved(t *testing.T, rpc *rpcClient) {
	t.Helper()
	rpc.mu.Lock()
	defer rpc.mu.Unlock()
	if _, exists := rpc.requestHandlers["browserbase.request"]; exists {
		t.Fatal("Browserbase request handler remains registered")
	}
}

func TestCreateBrowserbaseRoutingThroughInitBatchAndClose(t *testing.T) {
	for _, factoryKey := range []*string{nil, testPointer("factory-key")} {
		name := "caller-key"
		if factoryKey != nil {
			name = *factoryKey
		}
		t.Run(name, func(t *testing.T) {
			requests := make(chan *http.Request, 10)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				requests <- r
				_, _ = w.Write(body)
			}))
			t.Cleanup(server.Close)
			browser := &Browser{workerAPIKey: factoryKey, workerBrowser: &BrowserSessionMetadata{SessionID: "session"}}
			model := &ModelConfig{ModelName: "openai/gpt-5", APIKey: testPointer("model-key"), Headers: ModelConfigHeaders{"x-model": "value"}}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			rpc, transport, created := startBrowserbaseCreate(t, ctx, CreateOptions{
				Browser: browser, APIKey: testPointer("caller-key"), APIURL: &server.URL, Model: model,
			})
			init := receiveStagehandRequest(t, transport, "stagehand.init")
			var wire map[string]json.RawMessage
			if err := json.Unmarshal(init.Params, &wire); err != nil {
				t.Fatal(err)
			}
			if wire["api_key"] != nil || wire["api_url"] != nil || string(wire["browserbase"]) != `"client"` {
				t.Fatalf("unexpected worker connection fields: %s", init.Params)
			}
			var params StagehandInitParams
			if err := json.Unmarshal(init.Params, &params); err != nil {
				t.Fatal(err)
			}
			if params.Model == nil || !reflect.DeepEqual(*params.Model, ServerModel(*model)) || params.Browser.SessionID != "session" {
				t.Fatalf("model/session changed: %s", init.Params)
			}
			requestHTTP := func(id uint64) {
				t.Helper()
				request := testBrowserbaseHTTPParams()
				browserbaseRPCRequest(t, transport, id, request)
				response, ok := browserbaseRPCResult(t, transport, id).AsResponse()
				if !ok || response.Status != 200 || response.Body != request.Body {
					t.Fatalf("HTTP response = %#v", response)
				}
				httpRequest := awaitBrowserbaseTest(t, requests)
				if httpRequest.Header.Get("X-BB-API-Key") != name || httpRequest.URL.Path != "/v1/llm/responses" {
					t.Fatalf("unexpected HTTP request: %s, %v", httpRequest.URL.Path, httpRequest.Header)
				}
				if httpRequest.Header.Get("X-BB-Session-ID") != "session" {
					t.Fatal("missing Gateway session")
				}
			}
			requestHTTP(100)
			transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{"initialized":true,"pages":[]}}`, init.ID))
			result := awaitBrowserbaseTest(t, created)
			if result.err != nil {
				t.Fatal(result.err)
			}
			cancel() // The completed Create context does not own subsequent requests.
			batchDone := make(chan error, 1)
			go func() {
				var value any
				batchDone <- result.client.ExperimentalBatch(context.Background(), "async () => undefined", nil, &value, ExperimentalBatchOptions{})
			}()
			batch := receiveStagehandRequest(t, transport, "stagehand.callback_batch")
			requestHTTP(101)
			transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{}}`, batch.ID))
			if err := awaitBrowserbaseTest(t, batchDone); err != nil {
				t.Fatal(err)
			}
			closed := make(chan error, 2)
			for range 2 {
				go func() { closed <- result.client.Close(context.Background()) }()
			}
			closeRequest := receiveStagehandRequest(t, transport, "stagehand.close")
			requestHTTP(102)
			transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{"closed":true}}`, closeRequest.ID))
			for range 2 {
				if err := awaitBrowserbaseTest(t, closed); err != nil {
					t.Fatal(err)
				}
			}
			assertBrowserbaseHandlersRemoved(t, rpc)
			if transport.closeCalls.Load() != 0 || browser.Closed() {
				t.Fatal("Stagehand close closed the browser transport")
			}
		})
	}
}

func TestCreateBrowserbaseUnavailable(t *testing.T) {
	for _, test := range []struct {
		name    string
		key     *string
		session *BrowserSessionMetadata
	}{
		{name: "local"},
		{name: "key without session", key: testPointer("key")},
		{name: "session without key", session: &BrowserSessionMetadata{SessionID: "session"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, transport, created := startBrowserbaseCreate(t, context.Background(), CreateOptions{
				Browser: &Browser{workerBrowser: test.session}, APIKey: test.key,
			})
			init := receiveStagehandRequest(t, transport, "stagehand.init")
			var wire map[string]json.RawMessage
			if err := json.Unmarshal(init.Params, &wire); err != nil {
				t.Fatal(err)
			}
			if wire["browserbase"] != nil || wire["api_key"] != nil || wire["api_url"] != nil {
				t.Fatalf("unexpected connection fields: %s", init.Params)
			}
			browserbaseRPCRequest(t, transport, 100, testBrowserbaseHTTPParams())
			testBrowserbaseHTTPFailure(t, browserbaseRPCResult(t, transport, 100), nil, BrowserbaseTransportErrorReasonUnavailable)
			transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"error":{"code":-32603,"message":"init failed"}}`, init.ID))
			if result := awaitBrowserbaseTest(t, created); result.err == nil {
				t.Fatal("expected initialization failure")
			}
		})
	}
}

func TestCreateFailureCancelsBrowserbaseHTTP(t *testing.T) {
	for _, failure := range []string{"init error", "cancel", "disconnect"} {
		t.Run(failure, func(t *testing.T) {
			started, disconnected, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				close(started)
				select {
				case <-r.Context().Done():
					close(disconnected)
				case <-release:
				}
			}))
			t.Cleanup(func() { close(release); server.Close() })
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			browser := &Browser{workerAPIKey: testPointer("key"), workerBrowser: &BrowserSessionMetadata{SessionID: "session"}}
			rpc, transport, created := startBrowserbaseCreate(t, ctx, CreateOptions{Browser: browser, APIURL: &server.URL})
			init := receiveStagehandRequest(t, transport, "stagehand.init")
			browserbaseRPCRequest(t, transport, 100, testBrowserbaseHTTPParams())
			awaitBrowserbaseTest(t, started)
			switch failure {
			case "init error":
				transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"error":{"code":-32603,"message":"init failed"}}`, init.ID))
			case "cancel":
				cancel()
			case "disconnect":
				transport.failReceive(ErrCDPConnectionClosed)
			}
			result := awaitBrowserbaseTest(t, created)
			if result.err == nil {
				t.Fatal("expected initialization failure")
			}
			if failure == "cancel" && !errors.Is(result.err, context.Canceled) {
				t.Fatalf("error = %v, want cancellation", result.err)
			}
			awaitBrowserbaseTest(t, disconnected)
			assertBrowserbaseHandlersRemoved(t, rpc)
			if browser.Closed() != (failure != "init error") {
				t.Fatalf("unexpected browser closed state after %s", failure)
			}
		})
	}
}

func TestCreateValidatesBrowserbaseOptionsBeforeConnecting(t *testing.T) {
	for _, options := range []CreateOptions{
		{APIKey: testPointer("")},
		{APIURL: testPointer("")},
		{APIURL: testPointer("not a URL")},
		{APIURL: testPointer("https://example.com?")},
		{APIURL: testPointer("https://example.com/#fragment")},
		{APIURL: testPointer("https://example.com/v1///")},
	} {
		options.Browser = &Browser{}
		rpc := &recordingProtocolClient{}
		if _, err := newStagehandWithClient(options, rpc); err == nil {
			t.Fatal("invalid Browserbase options accepted")
		}
		if len(rpc.calls) != 0 || rpc.browserbaseRegistered {
			t.Fatal("invalid Browserbase options reached RPC")
		}
		if _, err := claimBrowser(options.Browser); err != nil {
			t.Fatal("invalid Browserbase options retained browser claim")
		}
		releaseBrowserClaim(options.Browser)
	}
}
