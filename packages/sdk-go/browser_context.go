package stagehand

import (
	"context"
	"errors"
	"sync"
)

// BrowserContext exposes browser-wide protocol operations.
type BrowserContext struct {
	rpc                          protocolClient
	closeBrowser                 func(context.Context) error
	reportPageEventListenerPanic func(any)
	clipboardOnce                sync.Once
	clipboard                    *BrowserClipboard
}

// Clipboard returns the context clipboard helper.
func (c *BrowserContext) Clipboard() *BrowserClipboard {
	c.clipboardOnce.Do(func() {
		c.clipboard = &BrowserClipboard{rpc: c.rpc}
	})
	return c.clipboard
}

// Pages lists every page in the context.
func (c *BrowserContext) Pages(ctx context.Context) ([]*Page, error) {
	var result ContextPagesResult
	if err := c.rpc.call(ctx, "context.pages", EmptyParams{}, &result); err != nil {
		return nil, err
	}
	pages := make([]*Page, len(result))
	for index := range result {
		pages[index] = c.page(result[index])
	}
	return pages, nil
}

// NewPage creates a page, optionally navigating it to the provided URL.
func (c *BrowserContext) NewPage(ctx context.Context, url ...string) (*Page, error) {
	if len(url) > 1 {
		return nil, errors.New("new page accepts at most one URL")
	}
	params := ContextNewPageParams{}
	if len(url) == 1 {
		params.URL = &url[0]
	}
	var result PageRef
	if err := c.rpc.call(ctx, "context.new_page", params, &result); err != nil {
		return nil, err
	}
	return c.page(result), nil
}

// ActivePage returns the active page, or nil when no page is active.
func (c *BrowserContext) ActivePage(ctx context.Context) (*Page, error) {
	var result ContextActivePageResult
	if err := c.rpc.call(ctx, "context.active_page", EmptyParams{}, &result); err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}
	return c.page(*result), nil
}

func (c *BrowserContext) page(ref PageRef) *Page {
	return &Page{
		rpc:                      c.rpc,
		ref:                      ref,
		reportEventListenerPanic: c.reportPageEventListenerPanic,
	}
}

// SetActivePage makes page the context's active page.
func (c *BrowserContext) SetActivePage(ctx context.Context, page *Page) error {
	params := ContextSetActivePageParams{PageID: page.PageID()}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.set_active_page", params, &result)
}

// Close closes the underlying browser.
func (c *BrowserContext) Close(ctx context.Context) error {
	if c == nil || c.closeBrowser == nil {
		return ErrNotInitialized
	}
	return c.closeBrowser(ctx)
}

// AddInitScript installs JavaScript source in every new page.
func (c *BrowserContext) AddInitScript(ctx context.Context, source string) error {
	params := ContextAddInitScriptParams{Source: source}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.add_init_script", params, &result)
}

// SetExtraHTTPHeaders sets context-wide request headers.
func (c *BrowserContext) SetExtraHTTPHeaders(
	ctx context.Context,
	headers ContextSetExtraHTTPHeadersParamsHeaders,
) error {
	params := ContextSetExtraHTTPHeadersParams{Headers: headers}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.set_extra_http_headers", params, &result)
}

// GetDomainPolicy returns the current domain policy.
func (c *BrowserContext) GetDomainPolicy(ctx context.Context) (*DomainPolicy, error) {
	var result ContextGetDomainPolicyResult
	if err := c.rpc.call(ctx, "context.get_domain_policy", EmptyParams{}, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// SetDomainPolicy changes the current domain policy.
func (c *BrowserContext) SetDomainPolicy(ctx context.Context, policy *DomainPolicy) error {
	params := ContextSetDomainPolicyParams{Policy: policy}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.set_domain_policy", params, &result)
}

// Cookies returns cookies, optionally filtered by URL.
func (c *BrowserContext) Cookies(ctx context.Context, urls *StringList) ([]Cookie, error) {
	params := ContextCookiesParams{Urls: urls}
	var result ContextCookiesResult
	if err := c.rpc.call(ctx, "context.cookies", params, &result); err != nil {
		return nil, err
	}
	return []Cookie(result), nil
}

// AddCookies adds cookies to the context.
func (c *BrowserContext) AddCookies(ctx context.Context, cookies []CookieParam) error {
	params := ContextAddCookiesParams{Cookies: cookies}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.add_cookies", params, &result)
}

// ClearCookies clears cookies matching the generated wire options.
func (c *BrowserContext) ClearCookies(ctx context.Context, options *ClearCookieOptions) error {
	params := ContextClearCookiesParams{Options: options}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.clear_cookies", params, &result)
}
