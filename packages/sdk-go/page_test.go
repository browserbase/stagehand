package stagehand

import (
	"bytes"
	"context"
	"strings"
	"sync"
	"testing"
)

func TestPageRefreshesReferenceAndDecodesScreenshot(t *testing.T) {
	t.Parallel()

	title := "After navigation"
	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.goto": PageRef{PageID: "page-2", Title: &title},
		"page.screenshot": PageScreenshotResult{
			Data: "cG5nLWJ5dGVz",
			Type: PageScreenshotResultTypePNG,
		},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	if err := page.Goto(context.Background(), "https://example.com", nil); err != nil {
		t.Fatalf("Goto() error = %v", err)
	}
	if ref := page.Ref(); ref.PageID != "page-2" || ref.Title == nil || *ref.Title != title {
		t.Fatalf("Ref() = %#v", ref)
	}
	if params, ok := rpc.calls[0].params.(PageGotoParams); !ok || params.PageID != "page-1" {
		t.Fatalf("Goto() params = %#v", rpc.calls[0].params)
	}

	screenshot, err := page.Screenshot(context.Background(), nil)
	if err != nil {
		t.Fatalf("Screenshot() error = %v", err)
	}
	if !bytes.Equal(screenshot, []byte("png-bytes")) {
		t.Fatalf("Screenshot() = %q", screenshot)
	}
	if params, ok := rpc.calls[1].params.(PageScreenshotParams); !ok || params.PageID != "page-2" {
		t.Fatalf("Screenshot() params = %#v", rpc.calls[1].params)
	}
}

func TestPageScreenshotRejectsMalformedBase64(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.screenshot": PageScreenshotResult{Data: "%%%", Type: PageScreenshotResultTypePNG},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	if _, err := page.Screenshot(context.Background(), nil); err == nil ||
		!strings.Contains(err.Error(), "decode page.screenshot result") {
		t.Fatalf("Screenshot() error = %v", err)
	}
}

func TestPageReferenceSupportsConcurrentReadersAndWriters(t *testing.T) {
	t.Parallel()

	page := &Page{ref: PageRef{PageID: "page-1"}}
	var group sync.WaitGroup
	for range 32 {
		group.Add(2)
		go func() {
			defer group.Done()
			_ = page.Ref()
			_ = page.PageID()
		}()
		go func() {
			defer group.Done()
			page.setRef(PageRef{PageID: "page-2"})
		}()
	}
	group.Wait()
}
