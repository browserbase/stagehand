package stagehand

import (
	"bytes"
	"context"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestPageCoordinateInteractionsReturnOnlyErrors(t *testing.T) {
	t.Parallel()

	clickCount := 2
	button := MouseButtonRight
	steps := 5
	delay := 10.0
	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.click":         PageVoidResult{Ok: true},
		"page.hover":         PageVoidResult{Ok: true},
		"page.scroll":        PageVoidResult{Ok: true},
		"page.drag_and_drop": PageVoidResult{Ok: true},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	ctx := context.Background()

	if err := page.Click(ctx, 10, 20, &PageClickOptions{
		Button:     &button,
		ClickCount: &clickCount,
	}); err != nil {
		t.Fatalf("Click() error = %v", err)
	}
	if err := page.Hover(ctx, 30, 40); err != nil {
		t.Fatalf("Hover() error = %v", err)
	}
	if err := page.Scroll(ctx, 50, 60, -25, 400); err != nil {
		t.Fatalf("Scroll() error = %v", err)
	}
	if err := page.DragAndDrop(ctx, 1, 2, 3, 4, &PageDragAndDropOptions{
		Button: &button,
		Steps:  &steps,
		Delay:  &delay,
	}); err != nil {
		t.Fatalf("DragAndDrop() error = %v", err)
	}

	want := []recordedCall{
		{
			method: "page.click",
			params: PageClickParams{
				PageID: "page-1",
				X:      10,
				Y:      20,
				Options: &PageClickOptions{
					Button:     &button,
					ClickCount: &clickCount,
				},
			},
		},
		{
			method: "page.hover",
			params: PageHoverParams{PageID: "page-1", X: 30, Y: 40},
		},
		{
			method: "page.scroll",
			params: PageScrollParams{
				PageID: "page-1",
				X:      50,
				Y:      60,
				DeltaX: -25,
				DeltaY: 400,
			},
		},
		{
			method: "page.drag_and_drop",
			params: PageDragAndDropParams{
				PageID: "page-1",
				FromX:  1,
				FromY:  2,
				ToX:    3,
				ToY:    4,
				Options: &PageDragAndDropOptions{
					Button: &button,
					Steps:  &steps,
					Delay:  &delay,
				},
			},
		},
	}
	if !reflect.DeepEqual(rpc.calls, want) {
		t.Fatalf("RPC calls = %#v, want %#v", rpc.calls, want)
	}
}

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
