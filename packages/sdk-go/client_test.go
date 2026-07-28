package stagehand

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type recordedCall struct {
	method string
	params any
}

type recordingProtocolClient struct {
	calls      []recordedCall
	responses  map[string]any
	callErrors map[string]error
	handlers   map[string]requestHandler
	closed     bool
}

func (c *recordingProtocolClient) call(
	_ context.Context,
	method string,
	params any,
	result any,
) error {
	c.calls = append(c.calls, recordedCall{method: method, params: params})
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

func (c *recordingProtocolClient) close() error {
	c.closed = true
	return nil
}

func TestDefaultInitRequiresBrowserbaseAPIKey(t *testing.T) {
	t.Parallel()

	client := New(StagehandClientInitParams{})
	err := client.Init(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Browserbase API key is required") {
		t.Fatalf("Init() error = %v, want Browserbase API key error", err)
	}
}

func TestThinClientUsesGeneratedBoundaryTypes(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"runtime.configure":   RuntimeConfigureResult{Configured: true},
		"stagehand.init":      StagehandInitResult{Initialized: true},
		"context.active_page": PageRef{PageID: "page-1"},
		"page.goto":           PageRef{PageID: "page-1"},
		"stagehand.act": ActResult{Data: ActResultData{
			Success: true, Message: "clicked", ActionDescription: "click", Actions: []Action{},
		}},
		"stagehand.close": StagehandCloseResult{Closed: true},
	}}
	client := newStagehandWithClient(StagehandClientInitParams{}, rpc)
	ctx := context.Background()

	if err := client.Init(ctx); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	browserContext, err := client.Context()
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
	if err := page.Goto(ctx, "https://example.com", nil); err != nil {
		t.Fatalf("Goto() error = %v", err)
	}
	if _, err := client.Act(ctx, "click the link", nil); err != nil {
		t.Fatalf("Act() error = %v", err)
	}
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	wantMethods := []string{
		"runtime.configure",
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
		RuntimeConfigureParams{},
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
	configure, ok := rpc.calls[0].params.(RuntimeConfigureParams)
	if !ok {
		t.Fatalf("runtime.configure params = %T", rpc.calls[0].params)
	}
	if configure.ProtocolVersion == nil ||
		*configure.ProtocolVersion != stagehandProtocolVersion {
		t.Fatalf("protocol version = %#v", configure.ProtocolVersion)
	}
	if configure.ClientInfo == nil ||
		*configure.ClientInfo != (ImplementationInfo{
			Name:    stagehandSDKClientName,
			Version: stagehandSDKVersion,
		}) {
		t.Fatalf("client info = %#v", configure.ClientInfo)
	}
	if !rpc.closed {
		t.Error("protocol client was not closed")
	}
}

func TestClientLLMHandlerUsesGeneratedUnions(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"runtime.configure": RuntimeConfigureResult{Configured: true},
		"stagehand.init":    StagehandInitResult{Initialized: true},
	}}
	called := false
	client := newStagehandWithClient(StagehandClientInitParams{
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
	if err := client.Init(ctx); err != nil {
		t.Fatalf("Init() error = %v", err)
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
}

func TestClientSerializesConcurrentInitAndClose(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"runtime.configure": RuntimeConfigureResult{Configured: true},
		"stagehand.init":    StagehandInitResult{Initialized: true},
		"stagehand.close":   StagehandCloseResult{Closed: true},
	}}
	client := newStagehandWithClient(StagehandClientInitParams{}, rpc)
	var resolves atomic.Int32
	client.adapters.resolveBrowserSource = func(
		context.Context,
		StagehandClientInitParams,
	) (resolvedBrowserSource, error) {
		resolves.Add(1)
		return resolvedBrowserSource{cdpURL: "test://stagehand", keepAlive: true}, nil
	}

	var initGroup sync.WaitGroup
	initErrors := make(chan error, 8)
	for range 8 {
		initGroup.Add(1)
		go func() {
			defer initGroup.Done()
			initErrors <- client.Init(context.Background())
		}()
	}
	initGroup.Wait()
	close(initErrors)
	for err := range initErrors {
		if err != nil {
			t.Fatalf("concurrent Init() error = %v", err)
		}
	}
	if resolves.Load() != 1 {
		t.Fatalf("browser resolutions = %d, want 1", resolves.Load())
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

func TestActAcceptsObservedAction(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"runtime.configure":   RuntimeConfigureResult{Configured: true},
		"stagehand.init":      StagehandInitResult{Initialized: true},
		"context.active_page": PageRef{PageID: "page-1"},
		"stagehand.act": ActResult{Data: ActResultData{
			Success: true, Message: "clicked", ActionDescription: "Submit button", Actions: []Action{},
		}},
	}}
	client := newStagehandWithClient(StagehandClientInitParams{}, rpc)
	action := Action{
		Selector:    "xpath=/html/body/button",
		Description: "Submit button",
	}

	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	if _, err := client.Act(context.Background(), action, nil); err != nil {
		t.Fatalf("Act() error = %v", err)
	}
	params, ok := rpc.calls[3].params.(StagehandActParams)
	if !ok {
		t.Fatalf("stagehand.act params = %T", rpc.calls[3].params)
	}
	got, ok := params.Input.AsAction()
	if !ok || !reflect.DeepEqual(got, action) {
		t.Fatalf("Act() input = %#v, want %#v", got, action)
	}
}

func TestClientCloseWaitsForInFlightInit(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"runtime.configure": RuntimeConfigureResult{Configured: true},
		"stagehand.init":    StagehandInitResult{Initialized: true},
		"stagehand.close":   StagehandCloseResult{Closed: true},
	}}
	client := newStagehandWithClient(StagehandClientInitParams{}, rpc)
	resolveStarted := make(chan struct{})
	continueResolve := make(chan struct{})
	client.adapters.resolveBrowserSource = func(
		context.Context,
		StagehandClientInitParams,
	) (resolvedBrowserSource, error) {
		close(resolveStarted)
		<-continueResolve
		return resolvedBrowserSource{cdpURL: "test://stagehand", keepAlive: true}, nil
	}

	initDone := make(chan error, 1)
	go func() { initDone <- client.Init(context.Background()) }()
	<-resolveStarted
	closeDone := make(chan error, 1)
	go func() { closeDone <- client.Close(context.Background()) }()
	select {
	case err := <-closeDone:
		t.Fatalf("Close() returned before Init() completed: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	close(continueResolve)
	if err := <-initDone; err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	if err := <-closeDone; err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestClientCloseIgnoresDisconnectedTransport(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{
		responses: map[string]any{
			"runtime.configure": RuntimeConfigureResult{Configured: true},
			"stagehand.init":    StagehandInitResult{Initialized: true},
		},
		callErrors: map[string]error{
			"stagehand.close": fmt.Errorf("close RPC: %w", ErrCDPConnectionClosed),
		},
	}
	client := newStagehandWithClient(StagehandClientInitParams{}, rpc)
	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v, want nil", err)
	}
	if !rpc.closed {
		t.Fatal("protocol client was not closed")
	}
}
