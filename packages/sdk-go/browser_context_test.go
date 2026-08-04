package stagehand

import (
	"context"
	"sync"
	"testing"
)

func TestBrowserContextMapsPagesAndCookies(t *testing.T) {
	t.Parallel()

	pageURL := "https://example.com"
	urls := StringList{pageURL}
	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.pages":    ContextPagesResult{{PageID: "page-1"}},
		"context.new_page": PageRef{PageID: "page-2", URL: &pageURL},
		"context.cookies": ContextCookiesResult{{
			Name: "session", Value: "value", Domain: "example.com", Path: "/",
			SameSite: CookieSameSiteLax,
		}},
	}}
	browserContext := &BrowserContext{rpc: rpc}

	pages, err := browserContext.Pages(context.Background())
	if err != nil {
		t.Fatalf("Pages() error = %v", err)
	}
	if len(pages) != 1 || pages[0].PageID() != "page-1" {
		t.Fatalf("Pages() = %#v", pages)
	}
	page, err := browserContext.NewPage(
		context.Background(),
		&ContextNewPageParams{URL: &pageURL},
	)
	if err != nil {
		t.Fatalf("NewPage() error = %v", err)
	}
	if page.PageID() != "page-2" {
		t.Fatalf("NewPage().PageID() = %q", page.PageID())
	}
	cookies, err := browserContext.Cookies(context.Background(), &urls)
	if err != nil {
		t.Fatalf("Cookies() error = %v", err)
	}
	if len(cookies) != 1 || cookies[0].Name != "session" {
		t.Fatalf("Cookies() = %#v", cookies)
	}

	if params, ok := rpc.calls[1].params.(ContextNewPageParams); !ok ||
		params.URL == nil ||
		*params.URL != pageURL {
		t.Fatalf("NewPage() params = %#v", rpc.calls[1].params)
	}
	if params, ok := rpc.calls[2].params.(ContextCookiesParams); !ok ||
		params.Urls == nil ||
		len(*params.Urls) != 1 ||
		(*params.Urls)[0] != pageURL {
		t.Fatalf("Cookies() params = %#v", rpc.calls[2].params)
	}
}

func TestBrowserContextActivePageCanBeNil(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.active_page": nil,
	}}
	page, err := (&BrowserContext{rpc: rpc}).ActivePage(context.Background())
	if err != nil {
		t.Fatalf("ActivePage() error = %v", err)
	}
	if page != nil {
		t.Fatalf("ActivePage() = %#v, want nil", page)
	}
}

func TestBrowserContextClipboardInitializesOnceConcurrently(t *testing.T) {
	t.Parallel()

	browserContext := &BrowserContext{rpc: &recordingProtocolClient{}}
	clipboards := make(chan *BrowserClipboard, 32)
	var group sync.WaitGroup
	for range 32 {
		group.Add(1)
		go func() {
			defer group.Done()
			clipboards <- browserContext.Clipboard()
		}()
	}
	group.Wait()
	close(clipboards)

	first := browserContext.Clipboard()
	for clipboard := range clipboards {
		if clipboard != first {
			t.Fatalf("Clipboard() returned distinct helpers: %p and %p", first, clipboard)
		}
	}
}
