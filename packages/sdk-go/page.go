package stagehand

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// Page is a thin wrapper around a generated PageRef.
type Page struct {
	rpc protocolClient
	ref PageRef
}

// PageID returns the stable protocol page identifier.
func (p *Page) PageID() string {
	return p.ref.PageID
}

// Ref returns the page's latest generated protocol reference.
func (p *Page) Ref() PageRef {
	return p.ref
}

// Goto navigates the page and refreshes its protocol reference.
func (p *Page) Goto(ctx context.Context, url string, options *PageNavigationOptions) error {
	params := PageGotoParams{PageID: p.PageID(), URL: url, Options: options}
	var result PageRef
	if err := p.rpc.call(ctx, "page.goto", params, &result); err != nil {
		return err
	}
	p.ref = result
	return nil
}

// Reload reloads the page and refreshes its protocol reference.
func (p *Page) Reload(ctx context.Context, options *PageReloadOptions) error {
	params := PageReloadParams{PageID: p.PageID(), Options: options}
	var result PageRef
	if err := p.rpc.call(ctx, "page.reload", params, &result); err != nil {
		return err
	}
	p.ref = result
	return nil
}

// GoBack navigates backward and refreshes the page reference.
func (p *Page) GoBack(ctx context.Context, options *PageNavigationOptions) error {
	params := PageGoBackParams{PageID: p.PageID(), Options: options}
	var result PageRef
	if err := p.rpc.call(ctx, "page.go_back", params, &result); err != nil {
		return err
	}
	p.ref = result
	return nil
}

// GoForward navigates forward and refreshes the page reference.
func (p *Page) GoForward(ctx context.Context, options *PageNavigationOptions) error {
	params := PageGoForwardParams{PageID: p.PageID(), Options: options}
	var result PageRef
	if err := p.rpc.call(ctx, "page.go_forward", params, &result); err != nil {
		return err
	}
	p.ref = result
	return nil
}

// Click clicks browser coordinates and returns the matching XPath.
func (p *Page) Click(
	ctx context.Context,
	x float64,
	y float64,
	options *PageClickOptions,
) (string, error) {
	params := PageClickParams{PageID: p.PageID(), X: x, Y: y, Options: options}
	var result PageCoordinateResult
	if err := p.rpc.call(ctx, "page.click", params, &result); err != nil {
		return "", err
	}
	return result.XPath, nil
}

// Hover hovers browser coordinates and returns the matching XPath.
func (p *Page) Hover(
	ctx context.Context,
	x float64,
	y float64,
	options *PageHoverOptions,
) (string, error) {
	params := PageHoverParams{PageID: p.PageID(), X: x, Y: y, Options: options}
	var result PageCoordinateResult
	if err := p.rpc.call(ctx, "page.hover", params, &result); err != nil {
		return "", err
	}
	return result.XPath, nil
}

// Scroll scrolls at browser coordinates and returns the matching XPath.
func (p *Page) Scroll(
	ctx context.Context,
	x float64,
	y float64,
	deltaX float64,
	deltaY float64,
	options *PageScrollOptions,
) (string, error) {
	params := PageScrollParams{
		PageID: p.PageID(), X: x, Y: y, DeltaX: deltaX, DeltaY: deltaY, Options: options,
	}
	var result PageCoordinateResult
	if err := p.rpc.call(ctx, "page.scroll", params, &result); err != nil {
		return "", err
	}
	return result.XPath, nil
}

// DragAndDrop drags between browser coordinates and returns both XPaths.
func (p *Page) DragAndDrop(
	ctx context.Context,
	fromX float64,
	fromY float64,
	toX float64,
	toY float64,
	options *PageDragAndDropOptions,
) ([2]string, error) {
	params := PageDragAndDropParams{
		PageID: p.PageID(), FromX: fromX, FromY: fromY, ToX: toX, ToY: toY, Options: options,
	}
	var result PageDragAndDropResult
	if err := p.rpc.call(ctx, "page.drag_and_drop", params, &result); err != nil {
		return [2]string{}, err
	}
	return [2]string{result.FromXPath, result.ToXPath}, nil
}

// Type enters text at the current focus.
func (p *Page) Type(ctx context.Context, value string, options *PageTypeOptions) error {
	params := PageTypeParams{PageID: p.PageID(), Text: value, Options: options}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.type", params, &result)
}

// KeyPress presses a keyboard key at the current focus.
func (p *Page) KeyPress(ctx context.Context, key string, options *PageKeyPressOptions) error {
	params := PageKeyPressParams{PageID: p.PageID(), Key: key, Options: options}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.key_press", params, &result)
}

// Evaluate evaluates JavaScript source and returns its JSON value.
func (p *Page) Evaluate(ctx context.Context, expression string) (json.RawMessage, error) {
	params := PageEvaluateParams{PageID: p.PageID(), Expression: expression}
	var result PageEvaluateResult
	if err := p.rpc.call(ctx, "page.evaluate", params, &result); err != nil {
		return nil, err
	}
	return result.Value, nil
}

// EvaluateAs decodes an Evaluate result into a caller-selected Go type.
func EvaluateAs[T any](ctx context.Context, page *Page, expression string) (T, error) {
	var value T
	raw, err := page.Evaluate(ctx, expression)
	if err != nil {
		return value, err
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return value, fmt.Errorf("decode page.evaluate result: %w", err)
	}
	return value, nil
}

// AddInitScript installs JavaScript source in the page.
func (p *Page) AddInitScript(ctx context.Context, source string) error {
	params := PageAddInitScriptParams{PageID: p.PageID(), Source: source}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.add_init_script", params, &result)
}

// SetExtraHTTPHeaders sets page-specific request headers.
func (p *Page) SetExtraHTTPHeaders(
	ctx context.Context,
	headers PageSetExtraHTTPHeadersParamsHeaders,
) error {
	params := PageSetExtraHTTPHeadersParams{PageID: p.PageID(), Headers: headers}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.set_extra_http_headers", params, &result)
}

// SetViewportSize changes the page viewport.
func (p *Page) SetViewportSize(
	ctx context.Context,
	width int,
	height int,
	options *PageSetViewportSizeOptions,
) error {
	params := PageSetViewportSizeParams{
		PageID: p.PageID(), Width: width, Height: height, Options: options,
	}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.set_viewport_size", params, &result)
}

// WaitForLoadState waits for a generated LoadState value.
func (p *Page) WaitForLoadState(
	ctx context.Context,
	state LoadState,
	timeoutMs *int,
) error {
	params := PageWaitForLoadStateParams{PageID: p.PageID(), State: state, Timeout: timeoutMs}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.wait_for_load_state", params, &result)
}

// WaitForTimeout waits for the requested number of milliseconds.
func (p *Page) WaitForTimeout(ctx context.Context, ms int) error {
	params := PageWaitForTimeoutParams{PageID: p.PageID(), Ms: ms}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.wait_for_timeout", params, &result)
}

// WaitForSelector waits for a selector and reports whether it matched.
func (p *Page) WaitForSelector(
	ctx context.Context,
	selector string,
	options *PageWaitForSelectorOptions,
) (bool, error) {
	params := PageWaitForSelectorParams{PageID: p.PageID(), Selector: selector, Options: options}
	var result PageWaitForSelectorResult
	if err := p.rpc.call(ctx, "page.wait_for_selector", params, &result); err != nil {
		return false, err
	}
	return result.Matched, nil
}

// Screenshot captures the page and decodes the protocol's base64 payload.
func (p *Page) Screenshot(ctx context.Context, options *PageScreenshotOptions) ([]byte, error) {
	params := PageScreenshotParams{PageID: p.PageID(), Options: options}
	var result PageScreenshotResult
	if err := p.rpc.call(ctx, "page.screenshot", params, &result); err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(result.Data)
	if err != nil {
		return nil, fmt.Errorf("decode page.screenshot result: %w", err)
	}
	return data, nil
}

// Snapshot returns the generated accessibility snapshot result.
func (p *Page) Snapshot(ctx context.Context, options *PageSnapshotOptions) (SnapshotResult, error) {
	params := PageSnapshotParams{PageID: p.PageID(), Options: options}
	var result SnapshotResult
	err := p.rpc.call(ctx, "page.snapshot", params, &result)
	return result, err
}

// URL returns the page URL.
func (p *Page) URL(ctx context.Context) (string, error) {
	params := PageIDParams{PageID: p.PageID()}
	var result PageURLResult
	if err := p.rpc.call(ctx, "page.url", params, &result); err != nil {
		return "", err
	}
	return result.URL, nil
}

// Title returns the page title.
func (p *Page) Title(ctx context.Context) (string, error) {
	params := PageIDParams{PageID: p.PageID()}
	var result PageTitleResult
	if err := p.rpc.call(ctx, "page.title", params, &result); err != nil {
		return "", err
	}
	return result.Title, nil
}

// Close closes the page.
func (p *Page) Close(ctx context.Context) error {
	params := PageIDParams{PageID: p.PageID()}
	var result PageCloseResult
	return p.rpc.call(ctx, "page.close", params, &result)
}

// Locator creates a page-scoped selector wrapper.
func (p *Page) Locator(selector string) *PageLocator {
	return &PageLocator{
		rpc:        p.rpc,
		descriptor: LocatorDescriptor{PageID: p.PageID(), Selector: selector},
	}
}
