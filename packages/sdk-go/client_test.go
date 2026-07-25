package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

type recordedCall struct {
	method string
	params any
}

type recordingProtocolClient struct {
	calls     []recordedCall
	responses map[string]any
	handlers  map[string]requestHandler
	closed    bool
}

func (c *recordingProtocolClient) call(
	_ context.Context,
	method string,
	params any,
	result any,
) error {
	c.calls = append(c.calls, recordedCall{method: method, params: params})
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

func TestDefaultInitStopsAtExplicitBrowserTODO(t *testing.T) {
	t.Parallel()

	client := New(StagehandClientInitParams{Browser: LocalBrowserSource{Headless: true}})
	err := client.Init(context.Background())
	if !errors.Is(err, ErrBrowserSourceNotImplemented) {
		t.Fatalf("Init() error = %v, want ErrBrowserSourceNotImplemented", err)
	}
}

func TestThinClientUsesGeneratedBoundaryTypes(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"runtime.configure":   RuntimeConfigureResult{Configured: true},
		"stagehand.init":      StagehandInitResult{Initialized: true},
		"context.active_page": PageRef{PageID: "page-1"},
		"page.goto":           PageRef{PageID: "page-1"},
		"stagehand.act": ActResult{Result: ActResultData{
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
