package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestPageWrapsCallableWebMCPToolsWithOwnedIdentity(t *testing.T) {
	t.Parallel()

	readOnly := true
	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.webmcp_tools": PageWebMCPToolsResult{Tools: []WebMCPToolDescriptor{{
			Name:        "search",
			Description: "Search this site",
			InputSchema: WebMCPToolDescriptorInputSchema{
				"searchQuery": json.RawMessage(`{"type":"string"}`),
			},
			Annotations:   &WebMCPAnnotation{ReadOnly: &readOnly},
			FrameID:       "frame-1",
			BackendNodeID: intPointer(42),
		}}},
		"page.webmcp_invoke_tool": WebMCPInvocationDescriptor{
			InvocationID: "invocation-1",
			ToolName:     "search",
			FrameID:      "frame-1",
			Input: WebMCPInvocationDescriptorInput{
				"searchQuery":  json.RawMessage(`"Stagehand"`),
				"preserve_Key": json.RawMessage(`{"innerValue":true}`),
			},
		},
		"page.webmcp_invocation_result": WebMCPToolResponse{
			InvocationID: "invocation-1",
			Status:       WebMCPInvocationStatusCompleted,
			Output:       json.RawMessage(`{"resultValue":"done"}`),
		},
		"page.webmcp_cancel_invocation": PageVoidResult{},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	timeout := 250.0

	tools, err := page.Tools(context.Background(), &WebMCPToolsOptions{Timeout: timeout})
	if err != nil {
		t.Fatalf("Tools() error = %v", err)
	}
	if len(tools) != 1 {
		t.Fatalf("Tools() returned %d tools, want 1", len(tools))
	}
	tool := tools[0]
	descriptor := tool.Descriptor()
	if descriptor.Name != "search" ||
		descriptor.FrameID != "frame-1" ||
		descriptor.BackendNodeID == nil ||
		*descriptor.BackendNodeID != 42 {
		t.Fatalf("tool descriptor = %#v", descriptor)
	}

	invocation, err := tool.Invoke(context.Background(), WebMCPInput{
		"searchQuery": "Stagehand",
		"preserve_Key": map[string]any{
			"innerValue": true,
		},
	})
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if got := invocation.Descriptor(); got.InvocationID != "invocation-1" ||
		got.ToolName != "search" ||
		got.FrameID != "frame-1" {
		t.Fatalf("invocation descriptor = %#v", got)
	}

	resultTimeout := 5_000.0
	result, err := invocation.Result(
		context.Background(),
		&WebMCPResultOptions{Timeout: &resultTimeout},
	)
	if err != nil {
		t.Fatalf("Result() error = %v", err)
	}
	type searchOutput struct {
		ResultValue string `json:"resultValue"`
	}
	output, err := WebMCPOutputAs[searchOutput](result)
	if err != nil {
		t.Fatalf("WebMCPOutputAs() error = %v", err)
	}
	if output.ResultValue != "done" {
		t.Fatalf("WebMCPOutputAs() = %#v", output)
	}

	cached, err := invocation.Result(context.Background(), nil)
	if err != nil {
		t.Fatalf("cached Result() error = %v", err)
	}
	if !reflect.DeepEqual(cached, result) {
		t.Fatalf("cached Result() = %#v, want %#v", cached, result)
	}
	if err := invocation.Cancel(context.Background()); err != nil {
		t.Fatalf("Cancel() error = %v", err)
	}

	if len(rpc.calls) != 4 {
		t.Fatalf("RPC calls = %d, want 4: %#v", len(rpc.calls), rpc.calls)
	}
	toolsParams, ok := rpc.calls[0].params.(PageWebMCPToolsParams)
	if !ok || toolsParams.PageID != "page-1" || toolsParams.Options == nil ||
		toolsParams.Options.Timeout != timeout {
		t.Fatalf("Tools() params = %#v", rpc.calls[0].params)
	}
	invokeParams, ok := rpc.calls[1].params.(PageWebMCPInvokeToolParams)
	if !ok ||
		invokeParams.PageID != "page-1" ||
		invokeParams.FrameID != "frame-1" ||
		invokeParams.ToolName != "search" ||
		string(invokeParams.Input["searchQuery"]) != `"Stagehand"` ||
		string(invokeParams.Input["preserve_Key"]) != `{"innerValue":true}` {
		t.Fatalf("Invoke() params = %#v", rpc.calls[1].params)
	}
	resultParams, ok := rpc.calls[2].params.(PageWebMCPInvocationResultParams)
	if !ok ||
		resultParams.PageID != "page-1" ||
		resultParams.InvocationID != "invocation-1" ||
		resultParams.Options == nil ||
		resultParams.Options.Timeout == nil ||
		*resultParams.Options.Timeout != resultTimeout {
		t.Fatalf("Result() params = %#v", rpc.calls[2].params)
	}
	cancelParams, ok := rpc.calls[3].params.(PageWebMCPCancelInvocationParams)
	if !ok ||
		cancelParams.PageID != "page-1" ||
		cancelParams.InvocationID != "invocation-1" {
		t.Fatalf("Cancel() params = %#v", rpc.calls[3].params)
	}
}

func TestWebMCPInvocationResultCanRetryAfterFailure(t *testing.T) {
	t.Parallel()

	timeoutError := errors.New("RPC request timed out: page.webmcp_invocation_result")
	rpc := &recordingProtocolClient{
		responses: map[string]any{},
		callErrors: map[string]error{
			"page.webmcp_invocation_result": timeoutError,
		},
	}
	invocation := &WebMCPInvocation{
		rpc:    rpc,
		pageID: "page-1",
		descriptor: WebMCPInvocationDescriptor{
			InvocationID: "invocation-1",
			ToolName:     "search",
			FrameID:      "frame-1",
			Input:        WebMCPInvocationDescriptorInput{},
		},
	}

	if _, err := invocation.Result(context.Background(), nil); !errors.Is(err, timeoutError) {
		t.Fatalf("first Result() error = %v, want %v", err, timeoutError)
	}
	delete(rpc.callErrors, "page.webmcp_invocation_result")
	rpc.responses["page.webmcp_invocation_result"] = WebMCPToolResponse{
		InvocationID: "invocation-1",
		Status:       WebMCPInvocationStatusCanceled,
	}

	result, err := invocation.Result(context.Background(), nil)
	if err != nil {
		t.Fatalf("retry Result() error = %v", err)
	}
	if result.Status != WebMCPInvocationStatusCanceled {
		t.Fatalf("retry Result() status = %q", result.Status)
	}
	if _, err := invocation.Result(context.Background(), nil); err != nil {
		t.Fatalf("cached Result() error = %v", err)
	}

	if got := countRPCMethod(rpc.calls, "page.webmcp_invocation_result"); got != 2 {
		t.Fatalf("result RPC calls = %d, want 2", got)
	}
}

func TestWebMCPToolInvokeNilInputUsesEmptyObject(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.webmcp_invoke_tool": WebMCPInvocationDescriptor{
			InvocationID: "invocation-1",
			ToolName:     "argumentless",
			FrameID:      "frame-1",
			Input:        WebMCPInvocationDescriptorInput{},
		},
	}}
	tool := &WebMCPTool{
		rpc:    rpc,
		pageID: "page-1",
		descriptor: WebMCPToolDescriptor{
			Name:        "argumentless",
			Description: "No input",
			FrameID:     "frame-1",
		},
	}

	if _, err := tool.Invoke(context.Background(), nil); err != nil {
		t.Fatalf("Invoke(nil) error = %v", err)
	}
	params, ok := rpc.calls[0].params.(PageWebMCPInvokeToolParams)
	if !ok || params.Input == nil || len(params.Input) != 0 {
		t.Fatalf("Invoke(nil) input = %#v, want non-nil empty object", params.Input)
	}
}

func intPointer(value int) *int {
	return &value
}

func countRPCMethod(calls []recordedCall, method string) int {
	count := 0
	for _, call := range calls {
		if call.method == method {
			count++
		}
	}
	return count
}
