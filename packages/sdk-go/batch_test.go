package stagehand

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

type recordingBatchProtocolClient struct {
	*recordingProtocolClient
	source  string
	input   any
	pageID  string
	timeout time.Duration
	calls   int
}

func (client *recordingBatchProtocolClient) call(
	ctx context.Context,
	method string,
	params any,
	result any,
) error {
	client.calls++
	if batchParams, ok := params.(CallbackBatchParams); ok {
		client.source = batchParams.CallbackSource
		_ = json.Unmarshal(batchParams.Input, &client.input)
		if batchParams.Options.PageID != nil {
			client.pageID = *batchParams.Options.PageID
		}
		client.timeout = time.Duration(batchParams.Options.Timeout) * time.Millisecond
	}
	return client.recordingProtocolClient.call(ctx, method, params, result)
}

func TestExperimentalBatchUsesRegisteredRPCMethod(t *testing.T) {
	rpc := &recordingBatchProtocolClient{recordingProtocolClient: &recordingProtocolClient{
		responses: map[string]any{
			"stagehand.callback_batch": map[string]any{
				"value": map[string]any{"title": "Example"},
			},
		},
	}}
	client := &Stagehand{rpc: rpc, initialized: true}
	page := &Page{ref: PageRef{PageID: "page-1"}}
	var result struct {
		Title string `json:"title"`
	}
	const source = `async ({ page }) => ({ title: await page.title() })`
	input := map[string]any{"value": 1}

	err := client.ExperimentalBatch(
		context.Background(),
		source,
		input,
		&result,
		ExperimentalBatchOptions{Timeout: 2 * time.Second, Page: page},
	)
	if err != nil {
		t.Fatalf("ExperimentalBatch() error = %v", err)
	}
	if result.Title != "Example" || rpc.pageID != "page-1" || rpc.timeout != 2*time.Second {
		t.Fatalf("unexpected batch result or options: result=%+v page=%q timeout=%s", result, rpc.pageID, rpc.timeout)
	}
	if rpc.source != source {
		t.Fatalf("callback source = %q, want %q", rpc.source, source)
	}
	encodedInput, err := json.Marshal(rpc.input)
	if err != nil {
		t.Fatalf("encode callback input: %v", err)
	}
	assertJSONEqual(t, encodedInput, `{"value":1}`)
}

func TestExperimentalBatchMapsAnOmittedValueToNil(t *testing.T) {
	rpc := &recordingBatchProtocolClient{recordingProtocolClient: &recordingProtocolClient{
		responses: map[string]any{
			"stagehand.callback_batch": map[string]any{},
		},
	}}
	client := &Stagehand{rpc: rpc, initialized: true}
	var result any

	if err := client.ExperimentalBatch(
		context.Background(),
		`async () => undefined`,
		nil,
		&result,
		ExperimentalBatchOptions{},
	); err != nil {
		t.Fatalf("ExperimentalBatch() error = %v", err)
	}
	if result != nil {
		t.Fatalf("ExperimentalBatch() result = %#v, want nil", result)
	}
}

func TestExperimentalBatchAllowsNativeCodeTextInSource(t *testing.T) {
	rpc := &recordingBatchProtocolClient{recordingProtocolClient: &recordingProtocolClient{
		responses: map[string]any{
			"stagehand.callback_batch": map[string]any{"value": nil},
		},
	}}
	client := &Stagehand{rpc: rpc, initialized: true}
	const source = `async () => "[native code]"`
	var result struct {
		Title string `json:"title"`
	}

	err := client.ExperimentalBatch(
		context.Background(),
		source,
		nil,
		&result,
		ExperimentalBatchOptions{},
	)
	if err != nil {
		t.Fatalf("ExperimentalBatch() error = %v", err)
	}
	if rpc.source != source {
		t.Fatalf("callback source = %q, want %q", rpc.source, source)
	}
}

func TestExperimentalBatchRejectsNonPointerResultBeforeTransport(t *testing.T) {
	rpc := &recordingBatchProtocolClient{recordingProtocolClient: &recordingProtocolClient{}}
	client := &Stagehand{rpc: rpc, initialized: true}

	err := client.ExperimentalBatch(
		context.Background(),
		`() => 1`,
		nil,
		struct{}{},
		ExperimentalBatchOptions{},
	)
	if err == nil {
		t.Fatal("ExperimentalBatch() unexpectedly accepted a non-pointer result")
	}
	if rpc.calls != 0 {
		t.Fatalf("callback transport called %d times", rpc.calls)
	}
}

func TestExperimentalBatchRejectsPageWithoutIDBeforeTransport(t *testing.T) {
	rpc := &recordingBatchProtocolClient{recordingProtocolClient: &recordingProtocolClient{}}
	client := &Stagehand{rpc: rpc, initialized: true}
	var result any

	err := client.ExperimentalBatch(
		context.Background(),
		`() => null`,
		nil,
		&result,
		ExperimentalBatchOptions{Page: &Page{}},
	)
	if err == nil || err.Error() != "stagehand callback batch page must have a non-empty page ID" {
		t.Fatalf("ExperimentalBatch() error = %v", err)
	}
	if rpc.calls != 0 {
		t.Fatalf("callback transport called %d times", rpc.calls)
	}
}
