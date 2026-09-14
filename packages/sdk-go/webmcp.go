package stagehand

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// WebMCPInput is JSON input passed to a page-provided WebMCP tool.
type WebMCPInput map[string]any

// WebMCPTool is a page-bound wrapper around a discovered WebMCP tool.
type WebMCPTool struct {
	rpc        protocolClient
	pageID     string
	descriptor WebMCPToolDescriptor
}

// Descriptor returns the generated wire descriptor for the tool.
func (t *WebMCPTool) Descriptor() WebMCPToolDescriptor {
	return t.descriptor
}

// Invoke invokes the tool using the page, frame, and name it already owns.
// A nil input is sent as an empty JSON object.
func (t *WebMCPTool) Invoke(
	ctx context.Context,
	input WebMCPInput,
) (*WebMCPInvocation, error) {
	wireInput, err := encodeWebMCPInput(input)
	if err != nil {
		return nil, err
	}

	params := PageWebMCPInvokeToolParams{
		PageID:   t.pageID,
		FrameID:  t.descriptor.FrameID,
		ToolName: t.descriptor.Name,
		Input:    wireInput,
	}
	var descriptor WebMCPInvocationDescriptor
	if err := t.rpc.call(ctx, "page.webmcp_invoke_tool", params, &descriptor); err != nil {
		return nil, err
	}
	return &WebMCPInvocation{
		rpc:        t.rpc,
		pageID:     t.pageID,
		descriptor: descriptor,
	}, nil
}

// WebMCPInvocation is a page-bound handle for an invocation accepted by Chrome.
type WebMCPInvocation struct {
	rpc        protocolClient
	pageID     string
	descriptor WebMCPInvocationDescriptor

	mu             sync.RWMutex
	terminalResult *WebMCPToolResponse
}

// Descriptor returns the generated wire descriptor for the invocation.
func (i *WebMCPInvocation) Descriptor() WebMCPInvocationDescriptor {
	return i.descriptor
}

// Result waits for Chrome's authoritative terminal invocation response.
// Successful waits are cached; context and RPC failures can be retried.
func (i *WebMCPInvocation) Result(
	ctx context.Context,
	options *WebMCPResultOptions,
) (WebMCPToolResponse, error) {
	i.mu.RLock()
	cached := i.terminalResult
	i.mu.RUnlock()
	if cached != nil {
		return *cached, nil
	}

	params := PageWebMCPInvocationResultParams{
		PageID:       i.pageID,
		InvocationID: i.descriptor.InvocationID,
		Options:      options,
	}
	var result WebMCPToolResponse
	if err := i.rpc.call(ctx, "page.webmcp_invocation_result", params, &result); err != nil {
		return WebMCPToolResponse{}, err
	}

	i.mu.Lock()
	if i.terminalResult == nil {
		i.terminalResult = &result
	}
	cached = i.terminalResult
	i.mu.Unlock()
	return *cached, nil
}

// Cancel requests cancellation without changing the invocation's terminal result locally.
func (i *WebMCPInvocation) Cancel(ctx context.Context) error {
	params := PageWebMCPCancelInvocationParams{
		PageID:       i.pageID,
		InvocationID: i.descriptor.InvocationID,
	}
	var result PageVoidResult
	return i.rpc.call(ctx, "page.webmcp_cancel_invocation", params, &result)
}

// WebMCPOutputAs decodes a terminal response's JSON output into a caller-selected Go type.
func WebMCPOutputAs[T any](response WebMCPToolResponse) (T, error) {
	var output T
	if len(response.Output) == 0 {
		return output, fmt.Errorf("WebMCP response %q has no output", response.InvocationID)
	}
	if err := json.Unmarshal(response.Output, &output); err != nil {
		return output, fmt.Errorf("decode WebMCP response %q output: %w", response.InvocationID, err)
	}
	return output, nil
}

func encodeWebMCPInput(input WebMCPInput) (PageWebMCPInvokeToolParamsInput, error) {
	encoded := make(PageWebMCPInvokeToolParamsInput, len(input))
	for key, value := range input {
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, fmt.Errorf("encode WebMCP input %q: %w", key, err)
		}
		encoded[key] = raw
	}
	return encoded, nil
}
