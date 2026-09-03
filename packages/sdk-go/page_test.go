package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPageCoordinateInteractionsReturnOnlyErrors(t *testing.T) {
	t.Parallel()

	clickCount := 2
	button := MouseButtonRight
	steps := 5
	delay := 10.0
	route := []PageDragAndDropRoutePoint{
		{X: 1, Y: 2},
		{X: 2, Y: 5},
		{X: 3, Y: 4},
	}
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
		Route:  route,
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
					Route:  route,
				},
			},
		},
	}
	if !reflect.DeepEqual(rpc.calls, want) {
		t.Fatalf("RPC calls = %#v, want %#v", rpc.calls, want)
	}
}

func TestPageOnDeliversCanonicalConsoleEventsAndUnsubscribes(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.on":  PageVoidResult{Ok: true},
		"page.off": PageVoidResult{Ok: true},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	events := make(chan PageCDPEvent, 1)

	subscription, err := page.On(context.Background(), "console", func(event PageCDPEvent) {
		events <- event
	})
	if err != nil {
		t.Fatalf("On() error = %v", err)
	}
	onParams, ok := rpc.calls[0].params.(PageOnParams)
	if !ok || onParams.PageID != "page-1" || onParams.Event != PageEventNameConsole {
		t.Fatalf("page.on params = %#v", rpc.calls[0].params)
	}
	rpc.pageEventHandler(PageCDPEventNotification{
		SubscriptionID: onParams.SubscriptionID,
		Event: PageCDPEvent{
			PageID:    "page-1",
			Method:    "Runtime.consoleAPICalled",
			Params:    PageCDPEventParams{"type": json.RawMessage(`"log"`)},
			SessionID: "session-1",
			TargetID:  "target-1",
		},
	})
	select {
	case event := <-events:
		if event.Method != "Runtime.consoleAPICalled" || event.SessionID != "session-1" {
			t.Fatalf("page event = %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for page event")
	}

	if err := subscription.Close(context.Background()); err != nil {
		t.Fatalf("subscription.Close() error = %v", err)
	}
	if rpc.pageEventHandler != nil {
		t.Fatal("page event handler remained registered")
	}
	offParams, ok := rpc.calls[1].params.(PageOffParams)
	if !ok || offParams.SubscriptionID != onParams.SubscriptionID {
		t.Fatalf("page.off params = %#v", rpc.calls[1].params)
	}
}

func TestPageOnInvokesEventsInDeliveryOrder(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.on":  PageVoidResult{Ok: true},
		"page.off": PageVoidResult{Ok: true},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	sequences := make([]string, 0, 2)

	subscription, err := page.On(context.Background(), "console", func(event PageCDPEvent) {
		sequences = append(sequences, string(event.Params["sequence"]))
	})
	if err != nil {
		t.Fatalf("On() error = %v", err)
	}
	onParams := rpc.calls[0].params.(PageOnParams)
	for _, sequence := range []string{"1", "2"} {
		rpc.pageEventHandler(PageCDPEventNotification{
			SubscriptionID: onParams.SubscriptionID,
			Event: PageCDPEvent{
				PageID: "page-1",
				Method: "Runtime.consoleAPICalled",
				Params: PageCDPEventParams{
					"sequence": json.RawMessage(sequence),
				},
			},
		})
	}
	if !reflect.DeepEqual(sequences, []string{"1", "2"}) {
		t.Fatalf("listener delivery order = %v, want [1 2]", sequences)
	}
	if err := subscription.Close(context.Background()); err != nil {
		t.Fatalf("subscription.Close() error = %v", err)
	}
}

func TestPageEventSubscriptionCanRetryFailedClose(t *testing.T) {
	t.Parallel()

	closeErr := errors.New("page.off failed")
	rpc := &recordingProtocolClient{
		responses: map[string]any{
			"page.on":  PageVoidResult{Ok: true},
			"page.off": PageVoidResult{Ok: true},
		},
		callErrors: map[string]error{"page.off": closeErr},
	}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	subscription, err := page.On(context.Background(), "console", func(PageCDPEvent) {})
	if err != nil {
		t.Fatalf("On() error = %v", err)
	}

	if err := subscription.Close(context.Background()); !errors.Is(err, closeErr) {
		t.Fatalf("first subscription.Close() error = %v, want %v", err, closeErr)
	}
	if rpc.pageEventHandler == nil {
		t.Fatal("failed page.off removed the local event handler")
	}
	page.mu.RLock()
	_, retained := page.subscriptions[subscription]
	page.mu.RUnlock()
	if !retained {
		t.Fatal("failed page.off removed the subscription from its page")
	}

	delete(rpc.callErrors, "page.off")
	if err := subscription.Close(context.Background()); err != nil {
		t.Fatalf("retried subscription.Close() error = %v", err)
	}
	if rpc.pageEventHandler != nil {
		t.Fatal("successful page.off retained the local event handler")
	}
	if got := []string{rpc.calls[1].method, rpc.calls[2].method}; !reflect.DeepEqual(got, []string{"page.off", "page.off"}) {
		t.Fatalf("unsubscribe RPC calls = %v, want [page.off page.off]", got)
	}
}

func TestPageCloseCleansUpLiveEventSubscriptions(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.on":    PageVoidResult{Ok: true},
		"page.off":   PageVoidResult{Ok: true},
		"page.close": PageCloseResult{Closed: true},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	if _, err := page.On(context.Background(), "console", func(PageCDPEvent) {}); err != nil {
		t.Fatalf("On() error = %v", err)
	}

	if err := page.Close(context.Background()); err != nil {
		t.Fatalf("Page.Close() error = %v", err)
	}
	if rpc.pageEventHandler != nil {
		t.Fatal("page event handler remained registered after Page.Close()")
	}
	if got := []string{rpc.calls[0].method, rpc.calls[1].method, rpc.calls[2].method}; !reflect.DeepEqual(got, []string{"page.on", "page.off", "page.close"}) {
		t.Fatalf("page lifecycle RPC calls = %v, want [page.on page.off page.close]", got)
	}
}

func TestPageRefreshesReferenceAndDecodesScreenshot(t *testing.T) {
	t.Parallel()

	title := "After navigation"
	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.goto": PageNavigationResult{
			Page: PageRef{PageID: "page-2", Title: &title},
			Response: &NavigationResponseDescriptor{
				ResponseID:        "response-1",
				URL:               "https://example.com",
				Status:            200,
				StatusText:        "OK",
				Headers:           map[string]string{"content-type": "text/html"},
				FromServiceWorker: false,
			},
		},
		"page.screenshot": PageScreenshotResult{
			Data: "cG5nLWJ5dGVz",
		},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	response, err := page.Goto(context.Background(), "https://example.com", nil)
	if err != nil {
		t.Fatalf("Goto() error = %v", err)
	}
	if response == nil || response.URL() != "https://example.com" {
		t.Fatalf("Goto() response = %#v", response)
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

func TestPageScreenshotSerializesOptionsAndMaskLocators(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.screenshot": PageScreenshotResult{
			Data: "cG5nLWJ5dGVz",
		},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	fullPage := true
	maskColor := "#ff00ff"
	quality := 80
	timeout := 2500.0
	screenshotType := PageScreenshotOptionsTypeJPEG
	scale := PageScreenshotOptionsScaleCSS
	animations := PageScreenshotOptionsAnimationsDisabled
	caret := PageScreenshotOptionsCaretHide
	omitBackground := true
	style := "body { color: red; }"
	maskIndex := 2
	mask := mustNth(t, page.Locator(".secret"), 2)

	_, err := page.Screenshot(context.Background(), &ScreenshotOptions{
		Animations:     &animations,
		Caret:          &caret,
		Clip:           &PageScreenshotClip{X: 1, Y: 2, Width: 300, Height: 200},
		FullPage:       &fullPage,
		Mask:           []*PageLocator{mask},
		MaskColor:      &maskColor,
		OmitBackground: &omitBackground,
		Quality:        &quality,
		Scale:          &scale,
		Style:          &style,
		Timeout:        &timeout,
		Type:           &screenshotType,
	})
	if err != nil {
		t.Fatalf("Screenshot() error = %v", err)
	}

	params, ok := rpc.calls[0].params.(PageScreenshotParams)
	if !ok || params.PageID != "page-1" || params.Options == nil {
		t.Fatalf("Screenshot() params = %#v", rpc.calls[0].params)
	}
	options := params.Options
	if options.Animations != &animations ||
		options.Caret != &caret ||
		options.Clip == nil ||
		options.Clip.X != 1 ||
		options.Clip.Y != 2 ||
		options.Clip.Width != 300 ||
		options.Clip.Height != 200 ||
		options.FullPage != &fullPage ||
		options.MaskColor != &maskColor ||
		options.OmitBackground != &omitBackground ||
		options.Quality != &quality ||
		options.Scale != &scale ||
		options.Style != &style ||
		options.Timeout != &timeout ||
		options.Type != &screenshotType {
		t.Fatalf("Screenshot() options = %#v", options)
	}
	wantMask := []LocatorDescriptor{{PageID: "page-1", Selector: ".secret", Nth: &maskIndex}}
	if !reflect.DeepEqual(options.Mask, wantMask) {
		t.Fatalf("Screenshot() mask = %#v, want %#v", options.Mask, wantMask)
	}
}

func TestPageScreenshotRejectsCrossPageMaskLocators(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.screenshot": PageScreenshotResult{Data: "cG5nLWJ5dGVz"},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	otherPage := &Page{rpc: rpc, ref: PageRef{PageID: "page-2"}}

	_, err := page.Screenshot(context.Background(), &ScreenshotOptions{
		Mask: []*PageLocator{otherPage.Locator(".secret")},
	})
	if err == nil || !strings.Contains(err.Error(), "mask locator must belong to the target page") {
		t.Fatalf("Screenshot() error = %v", err)
	}
	if len(rpc.calls) != 0 {
		t.Fatalf("Screenshot() RPC calls = %#v", rpc.calls)
	}
}

func TestPageScreenshotRejectsNilMaskLocators(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.screenshot": PageScreenshotResult{Data: "cG5nLWJ5dGVz"},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}

	_, err := page.Screenshot(context.Background(), &ScreenshotOptions{
		Mask: []*PageLocator{nil},
	})
	if err == nil || !strings.Contains(err.Error(), "page.Screenshot: mask locator at index 0 is nil") {
		t.Fatalf("Screenshot() error = %v", err)
	}
	if len(rpc.calls) != 0 {
		t.Fatalf("Screenshot() RPC calls = %#v", rpc.calls)
	}
}

func TestPageNavigationMethodsReturnNilWithoutNetworkResponse(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.goto":       PageNavigationResult{Page: PageRef{PageID: "page-2"}},
		"page.reload":     PageNavigationResult{Page: PageRef{PageID: "page-3"}},
		"page.go_back":    PageNavigationResult{Page: PageRef{PageID: "page-4"}},
		"page.go_forward": PageNavigationResult{Page: PageRef{PageID: "page-5"}},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	ctx := context.Background()

	response, err := page.Goto(ctx, "data:text/html,inline", nil)
	if err != nil || response != nil || page.PageID() != "page-2" {
		t.Fatalf("Goto() = (%#v, %v), page ID = %q", response, err, page.PageID())
	}
	response, err = page.Reload(ctx, nil)
	if err != nil || response != nil || page.PageID() != "page-3" {
		t.Fatalf("Reload() = (%#v, %v), page ID = %q", response, err, page.PageID())
	}
	response, err = page.GoBack(ctx, nil)
	if err != nil || response != nil || page.PageID() != "page-4" {
		t.Fatalf("GoBack() = (%#v, %v), page ID = %q", response, err, page.PageID())
	}
	response, err = page.GoForward(ctx, nil)
	if err != nil || response != nil || page.PageID() != "page-5" {
		t.Fatalf("GoForward() = (%#v, %v), page ID = %q", response, err, page.PageID())
	}
}

func TestPageScreenshotRejectsMalformedBase64(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"page.screenshot": PageScreenshotResult{Data: "%%%"},
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
