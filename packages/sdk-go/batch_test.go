package stagehand

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
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

func TestExperimentalBatchSerializesPageSelectionOnWire(t *testing.T) {
	fixtures := loadCallbackBatchWireFixtures(t)
	tests := []struct {
		name    string
		page    *Page
		fixture string
	}{
		{
			name:    "active page",
			fixture: "pageOmitted",
		},
		{
			name:    "explicit page",
			page:    &Page{ref: PageRef{PageID: "page-1"}},
			fixture: "pageProvided",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transport := newQueueRPCTransport()
			rpc := newTestRPCClient(t, transport)
			client := &Stagehand{rpc: rpc, initialized: true}
			var result any
			callDone := make(chan error, 1)
			go func() {
				callDone <- client.ExperimentalBatch(
					context.Background(),
					"async () => undefined",
					nil,
					&result,
					ExperimentalBatchOptions{Page: test.page},
				)
			}()

			actual := receiveSentRPC(t, transport)
			expected, ok := fixtures[test.fixture]
			if !ok {
				t.Fatalf("missing callback batch wire fixture %q", test.fixture)
			}
			assertJSONEqual(t, actual, string(expected))
			transport.receiveJSON(`{"jsonrpc":"2.0","id":1,"result":{}}`)
			if err := receiveCallError(t, callDone); err != nil {
				t.Fatalf("ExperimentalBatch() error = %v", err)
			}
		})
	}
}

func loadCallbackBatchWireFixtures(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate callback batch test source")
	}
	fixturePath := filepath.Join(
		filepath.Dir(sourceFile),
		"..",
		"protocol",
		"tests",
		"fixtures",
		"callback-batch-wire.json",
	)
	encoded, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read callback batch wire fixtures: %v", err)
	}
	var fixtures map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fixtures); err != nil {
		t.Fatalf("decode callback batch wire fixtures: %v", err)
	}
	return fixtures
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

func TestExperimentalBatchBoundsTimeoutBelowChromiumTimerLimit(t *testing.T) {
	rpc := &recordingBatchProtocolClient{recordingProtocolClient: &recordingProtocolClient{
		responses: map[string]any{"stagehand.callback_batch": map[string]any{}},
	}}
	client := &Stagehand{rpc: rpc, initialized: true}
	var result any
	maximum := time.Duration(maxExperimentalBatchTimeoutMilliseconds) * time.Millisecond

	if err := client.ExperimentalBatch(
		context.Background(),
		`() => undefined`,
		nil,
		&result,
		ExperimentalBatchOptions{Timeout: maximum},
	); err != nil {
		t.Fatalf("ExperimentalBatch() at maximum timeout error = %v", err)
	}
	if rpc.timeout != maximum {
		t.Fatalf("callback timeout = %s, want %s", rpc.timeout, maximum)
	}

	err := client.ExperimentalBatch(
		context.Background(),
		`() => undefined`,
		nil,
		&result,
		ExperimentalBatchOptions{Timeout: maximum + time.Millisecond},
	)
	if err == nil || err.Error() != "stagehand callback batch timeout exceeds the maximum supported timeout" {
		t.Fatalf("ExperimentalBatch() oversized timeout error = %v", err)
	}
	if rpc.calls != 1 {
		t.Fatalf("callback transport called %d times, want 1", rpc.calls)
	}
}
