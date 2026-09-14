package stagehand

import (
	"context"
	"testing"
)

func TestBrowserReturnsExactFactoryHandle(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init": StagehandInitResult{Initialized: true},
	}}
	browser := &Browser{}
	client, err := newStagehandWithClient(CreateOptions{Browser: browser}, rpc)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if client.Browser() != browser {
		t.Fatalf("Browser() = %p, want %p", client.Browser(), browser)
	}
	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if client.Browser() != browser {
		t.Fatal("Close() changed the attached Browser handle")
	}
}
