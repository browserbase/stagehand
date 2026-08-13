package stagehand

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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
	page, err := browserContext.NewPage(context.Background(), pageURL)
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

func TestBrowserContextNewPageAcceptsZeroOrOneURL(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.new_page": PageRef{PageID: "page-1"},
	}}
	browserContext := &BrowserContext{rpc: rpc}

	if _, err := browserContext.NewPage(context.Background()); err != nil {
		t.Fatalf("NewPage() error = %v", err)
	}
	if params, ok := rpc.calls[0].params.(ContextNewPageParams); !ok || params.URL != nil {
		t.Fatalf("NewPage() params = %#v", rpc.calls[0].params)
	}
	if _, err := browserContext.NewPage(context.Background(), "first", "second"); err == nil {
		t.Fatal("NewPage() accepted more than one URL")
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

func TestBrowserContextStorageStateRoundTrip(t *testing.T) {
	t.Parallel()

	cookie := Cookie{
		Name: "session", Value: "secret", Domain: "example.com", Path: "/",
		Expires: -1, HTTPOnly: true, Secure: true, SameSite: CookieSameSiteLax,
	}
	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.cookies":       ContextCookiesResult{cookie},
		"context.clear_cookies": ContextVoidResult{Ok: true},
		"context.add_cookies":   ContextVoidResult{Ok: true},
	}}
	browserContext := &BrowserContext{rpc: rpc}
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")

	state, err := browserContext.StorageState(context.Background(), &StorageStateOptions{Path: path})
	if err != nil {
		t.Fatalf("StorageState() error = %v", err)
	}
	if len(state.Cookies) != 1 || state.Cookies[0].Name != "session" || len(state.Origins) != 0 {
		t.Fatalf("StorageState() = %#v", state)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if !containsAll(string(raw), `"httpOnly": true`, `"origins": []`) {
		t.Fatalf("written storage state = %s", raw)
	}

	if err := browserContext.SetStorageStatePath(context.Background(), path); err != nil {
		t.Fatalf("SetStorageStatePath() error = %v", err)
	}
	if got := methods(rpc); len(got) < 3 ||
		got[0] != "context.cookies" ||
		got[1] != "context.clear_cookies" ||
		got[2] != "context.add_cookies" {
		t.Fatalf("rpc methods = %#v", got)
	}
	params, ok := rpc.calls[2].params.(ContextAddCookiesParams)
	if !ok || len(params.Cookies) != 1 || params.Cookies[0].HTTPOnly == nil || !*params.Cookies[0].HTTPOnly {
		t.Fatalf("AddCookies() params = %#v", rpc.calls[2].params)
	}
}

func TestBrowserContextStorageStateNilOptionsSkipsWrite(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.cookies": ContextCookiesResult{},
	}}
	browserContext := &BrowserContext{rpc: rpc}

	state, err := browserContext.StorageState(context.Background(), nil)
	if err != nil {
		t.Fatalf("StorageState() error = %v", err)
	}
	if state.Cookies == nil || len(state.Origins) != 0 {
		t.Fatalf("StorageState() = %#v", state)
	}
	if got := methods(rpc); len(got) != 1 || got[0] != "context.cookies" {
		t.Fatalf("rpc methods = %#v", got)
	}
}

func TestBrowserContextSetStorageStateRejectsNilCookiesWithoutClearing(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.clear_cookies": ContextVoidResult{Ok: true},
	}}
	browserContext := &BrowserContext{rpc: rpc}

	err := browserContext.SetStorageState(context.Background(), StorageState{})
	if err == nil {
		t.Fatal("SetStorageState() accepted nil cookies")
	}
	if len(rpc.calls) != 0 {
		t.Fatalf("SetStorageState() mutated cookies before rejecting: %#v", methods(rpc))
	}
}

func TestBrowserContextSetStorageStateRejectsInvalidSameSiteWithoutClearing(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.clear_cookies": ContextVoidResult{Ok: true},
	}}
	browserContext := &BrowserContext{rpc: rpc}

	err := browserContext.SetStorageState(context.Background(), StorageState{
		Cookies: []Cookie{{
			Name: "session", Value: "secret", Domain: "example.com", Path: "/",
			Expires: -1, HTTPOnly: true, Secure: true, SameSite: CookieSameSite("Invalid"),
		}},
	})
	if err == nil {
		t.Fatal("SetStorageState() accepted invalid sameSite")
	}
	if len(rpc.calls) != 0 {
		t.Fatalf("SetStorageState() mutated cookies before rejecting: %#v", methods(rpc))
	}
}

func TestReadStorageStateFileRejectsMissingCookiesAndFlags(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	missingCookies := filepath.Join(dir, "missing-cookies.json")
	if err := os.WriteFile(missingCookies, []byte(`{"origins":[]}`+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if _, err := readStorageStateFile(missingCookies); err == nil {
		t.Fatal("readStorageStateFile() accepted missing cookies array")
	}

	missingFlags := filepath.Join(dir, "missing-flags.json")
	if err := os.WriteFile(missingFlags, []byte(`{
  "cookies": [
    {
      "name": "session",
      "value": "secret",
      "domain": "example.com",
      "path": "/",
      "expires": -1,
      "sameSite": "Lax"
    }
  ],
  "origins": []
}
`), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if _, err := readStorageStateFile(missingFlags); err == nil {
		t.Fatal("readStorageStateFile() accepted missing httpOnly/secure")
	}

	invalidSameSite := filepath.Join(dir, "invalid-samesite.json")
	if err := os.WriteFile(invalidSameSite, []byte(`{
  "cookies": [
    {
      "name": "session",
      "value": "secret",
      "domain": "example.com",
      "path": "/",
      "expires": -1,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Nope"
    }
  ],
  "origins": []
}
`), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if _, err := readStorageStateFile(invalidSameSite); err == nil {
		t.Fatal("readStorageStateFile() accepted invalid sameSite")
	}
}

func methods(rpc *recordingProtocolClient) []string {
	out := make([]string, len(rpc.calls))
	for index, call := range rpc.calls {
		out[index] = call.method
	}
	return out
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !strings.Contains(value, part) {
			return false
		}
	}
	return true
}
