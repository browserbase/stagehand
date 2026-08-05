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

func (client *recordingBatchProtocolClient) experimentalBatch(
	_ context.Context,
	source string,
	input any,
	pageID string,
	timeout time.Duration,
	result any,
) error {
	client.calls++
	client.source = source
	client.input = input
	client.pageID = pageID
	client.timeout = timeout
	encoded, err := json.Marshal(map[string]any{"title": "Example"})
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, result)
}

func TestExperimentalBatchDelegatesToCallbackTransport(t *testing.T) {
	rpc := &recordingBatchProtocolClient{recordingProtocolClient: &recordingProtocolClient{}}
	client := &Stagehand{rpc: rpc, initialized: true}
	page := &Page{ref: PageRef{PageID: "page-1"}}
	var result struct {
		Title string `json:"title"`
	}

	err := client.ExperimentalBatch(
		context.Background(),
		`async ({ page }) => ({ title: await page.title() })`,
		map[string]any{"value": 1},
		&result,
		ExperimentalBatchOptions{Timeout: 2 * time.Second, Page: page},
	)
	if err != nil {
		t.Fatalf("ExperimentalBatch() error = %v", err)
	}
	if result.Title != "Example" || rpc.pageID != "page-1" || rpc.timeout != 2*time.Second {
		t.Fatalf("unexpected batch result or options: result=%+v page=%q timeout=%s", result, rpc.pageID, rpc.timeout)
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
