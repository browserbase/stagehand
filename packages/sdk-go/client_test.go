package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"
)

func newStagehandWithClient(options CreateOptions, rpc protocolClient, writers ...io.Writer) (*Stagehand, error) {
	browser := options.Browser
	if browser == nil {
		browser = &Browser{}
		options.Browser = browser
	}
	writer := io.Writer(os.Stderr)
	if len(writers) > 0 {
		writer = writers[0]
	}
	return createWithAdapters(context.Background(), options, clientAdapters{
		connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) { return rpc, nil },
	}, writer)
}

type recordedCall struct {
	method string
	params any
}

type recordingProtocolClient struct {
	calls            []recordedCall
	responses        map[string]any
	callErrors       map[string]error
	callHook         func(context.Context, string) error
	handlers         map[string]requestHandler
	pageEventHandler func(PageCDPEventNotification)
	closed           bool
}

func (c *recordingProtocolClient) call(
	ctx context.Context,
	method string,
	params any,
	result any,
) error {
	c.calls = append(c.calls, recordedCall{method: method, params: params})
	if c.callHook != nil {
		if err := c.callHook(ctx, method); err != nil {
			return err
		}
	}
	if err := c.callErrors[method]; err != nil {
		return err
	}
	response, ok := c.responses[method]
	if !ok {
		return nil
	}
	data, err := json.Marshal(response)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, result)
}

func (c *recordingProtocolClient) onRequest(method string, handler requestHandler) func() {
	if c.handlers == nil {
		c.handlers = make(map[string]requestHandler)
	}
	c.handlers[method] = handler
	return func() { delete(c.handlers, method) }
}

func (*recordingProtocolClient) onNotification(string, func(StagehandLog)) func() {
	return func() {}
}

func (c *recordingProtocolClient) onPageCDPEvent(
	handler func(PageCDPEventNotification),
) func() {
	c.pageEventHandler = handler
	return func() { c.pageEventHandler = nil }
}

func (*recordingProtocolClient) browserWebSocketDebuggerURL() string {
	return "ws://127.0.0.1:9222/devtools/browser/test"
}

func (c *recordingProtocolClient) close() error {
	c.closed = true
	return nil
}

func TestStagehandDoesNotExposeContext(t *testing.T) {
	t.Parallel()
	if _, ok := reflect.TypeOf((*Stagehand)(nil)).MethodByName("Context"); ok {
		t.Fatal("Stagehand.Context() remains in the public API")
	}
}

func TestThinClientUsesGeneratedBoundaryTypes(t *testing.T) {
	t.Parallel()
	apiURL := "https://api.stagehand.dev.browserbase.com"

	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init":      StagehandInitResult{Initialized: true},
		"context.active_page": PageRef{PageID: "page-1"},
		"page.goto":           PageNavigationResult{Page: PageRef{PageID: "page-1"}},
		"stagehand.act": ActResult{Data: ActResultData{
			Success: true, Message: "clicked", ActionDescription: "click", Actions: []Action{},
		}},
		"stagehand.close": StagehandCloseResult{Closed: true},
	}}
	client, err := newStagehandWithClient(CreateOptions{APIURL: &apiURL}, rpc)
	ctx := context.Background()
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	browserContext, err := client.Browser().Context()
	if err != nil {
		t.Fatalf("Context() error = %v", err)
	}
	page, err := browserContext.ActivePage(ctx)
	if err != nil {
		t.Fatalf("ActivePage() error = %v", err)
	}
	if page == nil {
		t.Fatal("ActivePage() = nil")
	}
	if _, err := page.Goto(ctx, "https://example.com", nil); err != nil {
		t.Fatalf("Goto() error = %v", err)
	}
	if _, err := client.Act(ctx, ActInstruction("click the link"), nil); err != nil {
		t.Fatalf("Act() error = %v", err)
	}
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	wantMethods := []string{
		"stagehand.init",
		"context.active_page",
		"page.goto",
		"context.active_page",
		"stagehand.act",
		"stagehand.close",
	}
	gotMethods := make([]string, len(rpc.calls))
	for index, call := range rpc.calls {
		gotMethods[index] = call.method
	}
	if !reflect.DeepEqual(gotMethods, wantMethods) {
		t.Fatalf("RPC methods = %#v, want %#v", gotMethods, wantMethods)
	}

	wantParamTypes := []any{
		StagehandInitParams{},
		EmptyParams{},
		PageGotoParams{},
		EmptyParams{},
		StagehandActParams{},
		EmptyParams{},
	}
	for index, want := range wantParamTypes {
		if reflect.TypeOf(rpc.calls[index].params) != reflect.TypeOf(want) {
			t.Errorf(
				"call %s params type = %T, want %T",
				rpc.calls[index].method,
				rpc.calls[index].params,
				want,
			)
		}
	}
	initParams, ok := rpc.calls[0].params.(StagehandInitParams)
	if !ok {
		t.Fatalf("stagehand.init params = %T", rpc.calls[0].params)
	}
	if initParams.ProtocolVersion != stagehandProtocolVersion {
		t.Fatalf("protocol version = %#v", initParams.ProtocolVersion)
	}
	if initParams.ClientInfo != (ImplementationInfo{
		Name:    stagehandSDKClientName,
		Version: stagehandSDKVersion,
	}) {
		t.Fatalf("client info = %#v", initParams.ClientInfo)
	}
	if initParams.APIURL == nil || *initParams.APIURL != apiURL {
		t.Fatalf("API URL = %#v, want %q", initParams.APIURL, apiURL)
	}
	if !rpc.closed {
		t.Error("protocol client was not closed")
	}
}

func TestClientLLMHandlerUsesGeneratedUnions(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init": StagehandInitResult{Initialized: true},
	}}
	called := false
	client, err := newStagehandWithClient(CreateOptions{
		Generate: func(_ context.Context, params LLMGenerateParams) (LLMGenerateResult, error) {
			called = true
			if _, ok := params.AsStructured(); !ok {
				t.Fatal("LLM params did not decode as the structured variant")
			}
			return StructuredGenerateResult(LLMStructuredGenerateResult{
				Role:              LLMRoleAssistant,
				Content:           LLMMessageContent{TextContentBlock(LLMTextContent{Type: "text", Text: `{}`})},
				OutputFormat:      "json_schema",
				StructuredContent: json.RawMessage(`{}`),
			}), nil
		},
	}, rpc)
	ctx := context.Background()
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	params := StructuredGenerateParams(LLMStructuredGenerateParams{
		Messages: []LLMMessage{},
		ResponseFormat: LLMJSONSchemaResponseFormat{
			Name: "test", Schema: json.RawMessage(`{"type":"object"}`), Type: "json_schema",
		},
	})
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	result, err := rpc.handlers["llm.generate"].invoke(ctx, raw)
	if err != nil {
		t.Fatalf("llm.generate handler error = %v", err)
	}
	if !called {
		t.Fatal("client LLM callback was not called")
	}
	if _, ok := result.(LLMGenerateResult); !ok {
		t.Fatalf("handler result type = %T, want LLMGenerateResult", result)
	}
	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if _, ok := rpc.handlers["llm.generate"]; ok {
		t.Fatal("Close() did not remove the client LLM handler")
	}
}

func TestClientSerializesConcurrentClose(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init":  StagehandInitResult{Initialized: true},
		"stagehand.close": StagehandCloseResult{Closed: true},
	}}
	client, err := newStagehandWithClient(CreateOptions{}, rpc)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	var closeGroup sync.WaitGroup
	closeErrors := make(chan error, 8)
	for range 8 {
		closeGroup.Add(1)
		go func() {
			defer closeGroup.Done()
			closeErrors <- client.Close(context.Background())
		}()
	}
	closeGroup.Wait()
	close(closeErrors)
	for err := range closeErrors {
		if err != nil {
			t.Fatalf("concurrent Close() error = %v", err)
		}
	}

	var initCalls, closeCalls int
	for _, call := range rpc.calls {
		switch call.method {
		case "stagehand.init":
			initCalls++
		case "stagehand.close":
			closeCalls++
		}
	}
	if initCalls != 1 || closeCalls != 1 {
		t.Fatalf("lifecycle calls: init = %d, close = %d; want 1 each", initCalls, closeCalls)
	}
	if client.Initialized() {
		t.Fatal("client remained initialized after Close")
	}
}

func TestClientCloseMemoizesFirstFailure(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{
		responses: map[string]any{
			"stagehand.init": StagehandInitResult{Initialized: true},
		},
		callErrors: map[string]error{
			"stagehand.close": errors.New("stagehand close failed"),
		},
	}
	client, err := newStagehandWithClient(CreateOptions{}, rpc)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	firstErr := client.Close(context.Background())
	if firstErr == nil {
		t.Fatal("first Close() error = nil")
	}
	secondResult := make(chan error, 1)
	go func() {
		secondResult <- client.Close(context.Background())
	}()
	secondErr := <-secondResult
	if secondErr == nil {
		t.Fatal("second Close() error = nil")
	}
	if secondErr.Error() != firstErr.Error() {
		t.Fatalf("second Close() error = %q, want %q", secondErr, firstErr)
	}

	closeCalls := 0
	for _, call := range rpc.calls {
		if call.method == "stagehand.close" {
			closeCalls++
		}
	}
	if closeCalls != 1 {
		t.Fatalf("stagehand.close calls = %d, want 1", closeCalls)
	}
	if client.Initialized() {
		t.Fatal("client remained initialized after Close")
	}
	if _, err := claimBrowser(client.browser); err == nil {
		releaseBrowserClaim(client.browser)
		t.Fatal("failed Close released the browser claim")
	}
}

func TestActAcceptsObservedAction(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init":      StagehandInitResult{Initialized: true},
		"context.active_page": PageRef{PageID: "page-1"},
		"stagehand.act": ActResult{Data: ActResultData{
			Success: true, Message: "clicked", ActionDescription: "Submit button", Actions: []Action{},
		}},
	}}
	client, err := newStagehandWithClient(CreateOptions{}, rpc)
	action := Action{
		Selector:    "xpath=/html/body/button",
		Description: "Submit button",
	}

	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := client.Act(context.Background(), ObservedAction(action), nil); err != nil {
		t.Fatalf("Act() error = %v", err)
	}
	params, ok := rpc.calls[2].params.(StagehandActParams)
	if !ok {
		t.Fatalf("stagehand.act params = %T", rpc.calls[2].params)
	}
	got, ok := params.Instruction.AsAction()
	if !ok || !reflect.DeepEqual(got, action) {
		t.Fatalf("Act() instruction = %#v, want %#v", got, action)
	}
}

func TestClientCloseIgnoresDisconnectedTransport(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{
		responses: map[string]any{
			"stagehand.init": StagehandInitResult{Initialized: true},
		},
		callErrors: map[string]error{
			"stagehand.close": fmt.Errorf("close RPC: %w", ErrCDPConnectionClosed),
		},
	}
	client, err := newStagehandWithClient(CreateOptions{}, rpc)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v, want nil", err)
	}
	if !rpc.closed {
		t.Fatal("protocol client was not closed")
	}
	if _, err := claimBrowser(client.browser); err != nil {
		t.Fatalf("disconnected Close retained the browser claim: %v", err)
	}
	releaseBrowserClaim(client.browser)
}

func TestCreateUsesClaimedBrowserWorkerMetadata(t *testing.T) {
	region := BrowserbaseRegion("us-west-2")
	handleAPIKey := "handle-key"
	optionAPIKey := "option-key"
	browser := &Browser{
		workerAPIKey: &handleAPIKey,
		workerBrowser: &BrowserSessionMetadata{
			SessionID: "session-1",
			Region:    &region,
		},
	}
	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init": StagehandInitResult{Initialized: true},
	}}
	client, err := createWithAdapters(context.Background(), CreateOptions{
		Browser: browser,
		APIKey:  &optionAPIKey,
	}, clientAdapters{
		connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) { return rpc, nil },
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if client.Browser() != browser || !client.Initialized() {
		t.Fatalf("created client = %#v", client)
	}
	params, ok := rpc.calls[0].params.(StagehandInitParams)
	if !ok {
		t.Fatalf("stagehand.init params = %T", rpc.calls[0].params)
	}
	if params.APIKey == nil || *params.APIKey != handleAPIKey {
		t.Fatalf("APIKey = %#v", params.APIKey)
	}
	if params.Browser == nil || params.Browser.SessionID != "session-1" || params.Browser.Region == nil || *params.Browser.Region != region {
		t.Fatalf("Browser = %#v", params.Browser)
	}
	if params.BrowserCDPURL == nil || *params.BrowserCDPURL != rpc.browserWebSocketDebuggerURL() {
		t.Fatalf("BrowserCDPURL = %#v", params.BrowserCDPURL)
	}
	if params.ProtocolVersion != stagehandProtocolVersion || params.ClientInfo.Name != stagehandSDKClientName || params.ClientInfo.Version != stagehandSDKVersion {
		t.Fatalf("protocol identity = %#v %#v", params.ProtocolVersion, params.ClientInfo)
	}
}

func TestCreateRejectsBrowserNotCreatedByFactoryAndReleasesClaim(t *testing.T) {
	browser := &Browser{}
	_, err := Create(context.Background(), CreateOptions{Browser: browser})
	if err == nil || err.Error() != "connect claimed browser: stagehand browser must be created by a stagehand browser factory" {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := claimBrowser(browser); err != nil {
		t.Fatalf("claimBrowser() after Create error = %v", err)
	}
	releaseBrowserClaim(browser)
}

func TestCreateLocalBrowserOmitsBrowserMetadata(t *testing.T) {
	apiKey := "option-key"
	browser := &Browser{}
	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init": StagehandInitResult{Initialized: true},
	}}
	_, err := createWithAdapters(context.Background(), CreateOptions{
		Browser: browser,
		APIKey:  &apiKey,
	}, clientAdapters{
		connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) { return rpc, nil },
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	params := rpc.calls[0].params.(StagehandInitParams)
	if params.Browser != nil || params.APIKey == nil || *params.APIKey != apiKey {
		t.Fatalf("worker metadata = %#v %#v", params.Browser, params.APIKey)
	}
}

func TestCreateFailureAndSuccessfulCloseReleaseClaim(t *testing.T) {
	browser := &Browser{}
	initErr := &RPCError{Code: -32_000, Message: "init failed"}
	failedRPC := &recordingProtocolClient{callErrors: map[string]error{"stagehand.init": initErr}}
	successRPC := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init":  StagehandInitResult{Initialized: true},
		"stagehand.close": StagehandCloseResult{Closed: true},
	}}
	reattachRPC := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init":  StagehandInitResult{Initialized: true},
		"stagehand.close": StagehandCloseResult{Closed: true},
	}}
	connections := 0
	adapters := clientAdapters{
		connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) {
			connections++
			if connections == 1 {
				return failedRPC, nil
			}
			if connections == 2 {
				return successRPC, nil
			}
			return reattachRPC, nil
		},
	}
	if _, err := createWithAdapters(context.Background(), CreateOptions{Browser: browser}, adapters); !errors.Is(err, initErr) {
		t.Fatalf("first Create() error = %v", err)
	}
	if !failedRPC.closed {
		t.Fatal("failed Create did not close its RPC client")
	}
	client, err := createWithAdapters(context.Background(), CreateOptions{Browser: browser}, adapters)
	if err != nil {
		t.Fatalf("retry Create() error = %v", err)
	}
	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if browser.Closed() {
		t.Fatal("Stagehand.Close closed the Browser handle")
	}
	reattached, err := createWithAdapters(context.Background(), CreateOptions{Browser: browser}, adapters)
	if err != nil {
		t.Fatalf("Create() after successful Close error = %v", err)
	}
	if err := reattached.Close(context.Background()); err != nil {
		t.Fatalf("reattached Close() error = %v", err)
	}
}

func TestBrowserContextCloseAliasesBrowserClose(t *testing.T) {
	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init": StagehandInitResult{Initialized: true},
	}}
	terminationCalls := 0
	browser := &Browser{
		terminateSource: func(context.Context) error {
			terminationCalls++
			return nil
		},
	}
	client, err := createWithAdapters(
		context.Background(),
		CreateOptions{Browser: browser},
		clientAdapters{connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) {
			return rpc, nil
		}},
	)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	browserContext, err := browser.Context()
	if err != nil {
		t.Fatalf("Browser.Context() error = %v", err)
	}

	results := make(chan error, 3)
	go func() { results <- browserContext.Close(context.Background()) }()
	go func() { results <- browser.Close(context.Background()) }()
	go func() { results <- browserContext.Close(context.Background()) }()
	for range 3 {
		if err := <-results; err != nil {
			t.Fatalf("close error = %v", err)
		}
	}

	if !browser.Closed() || terminationCalls != 1 {
		t.Fatalf("browser closed = %t, termination calls = %d", browser.Closed(), terminationCalls)
	}
	for _, call := range rpc.calls {
		if call.method == "context.close" {
			t.Fatal("BrowserContext.Close() sent context.close RPC")
		}
	}
	if client.Browser() != browser {
		t.Fatal("Stagehand browser changed after context close")
	}
}

func TestCreateBoundsInitializationAndFailsClosedOnCancellation(t *testing.T) {
	t.Run("internal deadline", func(t *testing.T) {
		browser := &Browser{}
		settledErr := &RPCError{Code: -32_000, Message: "worker rejected initialization"}
		rpc := &recordingProtocolClient{callHook: func(ctx context.Context, method string) error {
			if method != "stagehand.init" {
				return nil
			}
			deadline, ok := ctx.Deadline()
			if !ok {
				t.Fatal("stagehand.init context has no deadline")
			}
			remaining := time.Until(deadline)
			if remaining < stagehandInitTimeout-time.Second || remaining > stagehandInitTimeout {
				t.Fatalf("stagehand.init deadline remaining = %s", remaining)
			}
			return settledErr
		}}

		_, err := createWithAdapters(
			context.Background(),
			CreateOptions{Browser: browser},
			clientAdapters{connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) {
				return rpc, nil
			}},
		)
		if !errors.Is(err, settledErr) {
			t.Fatalf("Create() error = %v, want %v", err, settledErr)
		}
		if browser.Closed() {
			t.Fatal("settled initialization failure closed the Browser")
		}
		if _, err := claimBrowser(browser); err != nil {
			t.Fatalf("settled initialization failure retained claim: %v", err)
		}
		releaseBrowserClaim(browser)
	})

	for _, test := range []struct {
		name    string
		context func() (context.Context, context.CancelFunc)
	}{
		{
			name: "caller deadline",
			context: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 20*time.Millisecond)
			},
		},
		{
			name: "caller cancellation",
			context: func() (context.Context, context.CancelFunc) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx, func() {}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			browser := &Browser{}
			rpc := &recordingProtocolClient{callHook: func(ctx context.Context, method string) error {
				if method != "stagehand.init" {
					return nil
				}
				<-ctx.Done()
				return ctx.Err()
			}}
			ctx, cancel := test.context()
			defer cancel()

			_, err := createWithAdapters(
				ctx,
				CreateOptions{Browser: browser},
				clientAdapters{connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) {
					return rpc, nil
				}},
			)
			if err == nil || (!errors.Is(err, context.Canceled) &&
				!errors.Is(err, context.DeadlineExceeded)) {
				t.Fatalf("Create() error = %v, want context cancellation", err)
			}
			if !browser.Closed() {
				t.Fatal("ambiguous initialization failure left Browser reusable")
			}
			if !rpc.closed {
				t.Fatal("ambiguous initialization failure left RPC open")
			}
			if _, retryErr := createWithAdapters(
				context.Background(),
				CreateOptions{Browser: browser},
				clientAdapters{},
			); retryErr == nil || retryErr.Error() != "cannot attach Stagehand to a closed browser" {
				t.Fatalf("retry Create() error = %v", retryErr)
			}
		})
	}

	t.Run("ambiguous transport failure", func(t *testing.T) {
		browser := &Browser{}
		transportErr := errors.New("transport closed after request dispatch")
		rpc := &recordingProtocolClient{callErrors: map[string]error{
			"stagehand.init": transportErr,
		}}

		_, err := createWithAdapters(
			context.Background(),
			CreateOptions{Browser: browser},
			clientAdapters{connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) {
				return rpc, nil
			}},
		)
		if !errors.Is(err, transportErr) {
			t.Fatalf("Create() error = %v, want %v", err, transportErr)
		}
		if !browser.Closed() {
			t.Fatal("ambiguous transport failure left Browser reusable")
		}
		if _, retryErr := createWithAdapters(
			context.Background(),
			CreateOptions{Browser: browser},
			clientAdapters{},
		); retryErr == nil || retryErr.Error() != "cannot attach Stagehand to a closed browser" {
			t.Fatalf("retry Create() error = %v", retryErr)
		}
	})

	t.Run("malformed success response", func(t *testing.T) {
		browser := &Browser{}
		rpc := &recordingProtocolClient{responses: map[string]any{
			"stagehand.init": map[string]any{"initialized": "not-a-boolean"},
		}}

		_, err := createWithAdapters(
			context.Background(),
			CreateOptions{Browser: browser},
			clientAdapters{connectClaimedBrowser: func(claimedBrowser) (protocolClient, error) {
				return rpc, nil
			}},
		)
		if err == nil {
			t.Fatal("Create() error = nil")
		}
		if !browser.Closed() {
			t.Fatal("malformed success response left Browser reusable")
		}
	})
}
