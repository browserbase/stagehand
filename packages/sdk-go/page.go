package stagehand

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// Page is a thin wrapper around a generated PageRef.
type Page struct {
	rpc                      protocolClient
	mu                       sync.RWMutex
	ref                      PageRef
	subscriptions            map[*CDPSubscription]struct{}
	reportEventListenerPanic func(any)
}

// CDPSubscription is a page-scoped console event listener registration.
type CDPSubscription struct {
	rpc                 protocolClient
	page                *Page
	subscriptionID      string
	removeLocalListener func()
	mu                  sync.Mutex
	unsubscribeAttempt  *cdpUnsubscribeAttempt
	unsubscribed        bool
}

type cdpUnsubscribeAttempt struct {
	done chan struct{}
	err  error
}

// Close removes the listener locally and from the Stagehand runtime.
func (s *CDPSubscription) Close(ctx context.Context) error {
	s.mu.Lock()
	if s.unsubscribed {
		s.mu.Unlock()
		return nil
	}
	if attempt := s.unsubscribeAttempt; attempt != nil {
		s.mu.Unlock()
		select {
		case <-attempt.done:
			return attempt.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	attempt := &cdpUnsubscribeAttempt{done: make(chan struct{})}
	s.unsubscribeAttempt = attempt
	s.mu.Unlock()

	params := PageOffParams{SubscriptionID: s.subscriptionID}
	var result PageVoidResult
	err := s.rpc.call(ctx, "page.off", params, &result)
	if err == nil {
		s.removeLocalListener()
		s.page.removeSubscription(s)
	}

	s.mu.Lock()
	attempt.err = err
	s.unsubscribeAttempt = nil
	s.unsubscribed = err == nil
	close(attempt.done)
	s.mu.Unlock()
	return err
}

// PageID returns the stable protocol page identifier.
func (p *Page) PageID() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.ref.PageID
}

// Ref returns the page's latest generated protocol reference.
func (p *Page) Ref() PageRef {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.ref
}

// Goto navigates the page, refreshes its protocol reference, and returns its network response.
func (p *Page) Goto(
	ctx context.Context,
	url string,
	options *PageNavigationOptions,
) (*Response, error) {
	params := PageGotoParams{PageID: p.PageID(), URL: url, Options: options}
	var result PageNavigationResult
	if err := p.rpc.call(ctx, "page.goto", params, &result); err != nil {
		return nil, err
	}
	p.setRef(result.Page)
	return responseFromNavigationResult(p.rpc, result), nil
}

// Reload reloads the page, refreshes its protocol reference, and returns its network response.
func (p *Page) Reload(ctx context.Context, options *PageReloadOptions) (*Response, error) {
	params := PageReloadParams{PageID: p.PageID(), Options: options}
	var result PageNavigationResult
	if err := p.rpc.call(ctx, "page.reload", params, &result); err != nil {
		return nil, err
	}
	p.setRef(result.Page)
	return responseFromNavigationResult(p.rpc, result), nil
}

// GoBack navigates backward, refreshes the page reference, and returns its network response.
func (p *Page) GoBack(ctx context.Context, options *PageNavigationOptions) (*Response, error) {
	params := PageGoBackParams{PageID: p.PageID(), Options: options}
	var result PageNavigationResult
	if err := p.rpc.call(ctx, "page.go_back", params, &result); err != nil {
		return nil, err
	}
	p.setRef(result.Page)
	return responseFromNavigationResult(p.rpc, result), nil
}

// GoForward navigates forward, refreshes the page reference, and returns its network response.
func (p *Page) GoForward(
	ctx context.Context,
	options *PageNavigationOptions,
) (*Response, error) {
	params := PageGoForwardParams{PageID: p.PageID(), Options: options}
	var result PageNavigationResult
	if err := p.rpc.call(ctx, "page.go_forward", params, &result); err != nil {
		return nil, err
	}
	p.setRef(result.Page)
	return responseFromNavigationResult(p.rpc, result), nil
}

func responseFromNavigationResult(rpc protocolClient, result PageNavigationResult) *Response {
	if result.Response == nil {
		return nil
	}
	return newResponse(rpc, *result.Response)
}

// Click clicks browser coordinates.
func (p *Page) Click(
	ctx context.Context,
	x float64,
	y float64,
	options *PageClickOptions,
) error {
	params := PageClickParams{PageID: p.PageID(), X: x, Y: y, Options: options}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.click", params, &result)
}

// Hover hovers browser coordinates.
func (p *Page) Hover(
	ctx context.Context,
	x float64,
	y float64,
) error {
	params := PageHoverParams{PageID: p.PageID(), X: x, Y: y}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.hover", params, &result)
}

// Scroll scrolls at browser coordinates.
func (p *Page) Scroll(
	ctx context.Context,
	x float64,
	y float64,
	deltaX float64,
	deltaY float64,
) error {
	params := PageScrollParams{
		PageID: p.PageID(), X: x, Y: y, DeltaX: deltaX, DeltaY: deltaY,
	}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.scroll", params, &result)
}

// DragAndDrop drags between browser coordinates.
func (p *Page) DragAndDrop(
	ctx context.Context,
	fromX float64,
	fromY float64,
	toX float64,
	toY float64,
	options *PageDragAndDropOptions,
) error {
	params := PageDragAndDropParams{
		PageID: p.PageID(), FromX: fromX, FromY: fromY, ToX: toX, ToY: toY, Options: options,
	}
	var result PageVoidResult
	return p.rpc.call(ctx, "page.drag_and_drop", params, &result)
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

// On subscribes to console events for this page and its OOPIF sessions.
func (p *Page) On(
	ctx context.Context,
	event PageEventName,
	listener func(PageCDPEvent),
) (*CDPSubscription, error) {
	if listener == nil {
		return nil, errors.New("stagehand page event listener is required")
	}
	subscriptionID, err := newSubscriptionID()
	if err != nil {
		return nil, err
	}
	removeLocalListener := p.rpc.onPageCDPEvent(func(notification PageCDPEventNotification) {
		if notification.SubscriptionID != subscriptionID {
			return
		}
		invokePageEventListener(listener, notification.Event, p.reportEventListenerPanic)
	})
	subscription := &CDPSubscription{
		rpc:                 p.rpc,
		page:                p,
		subscriptionID:      subscriptionID,
		removeLocalListener: removeLocalListener,
	}
	p.addSubscription(subscription)

	params := PageOnParams{PageID: p.PageID(), SubscriptionID: subscriptionID, Event: event}
	var result PageVoidResult
	if err := p.rpc.call(ctx, "page.on", params, &result); err != nil {
		removeLocalListener()
		p.removeSubscription(subscription)
		return nil, err
	}
	return subscription, nil
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
func (p *Page) Screenshot(ctx context.Context, options *ScreenshotOptions) ([]byte, error) {
	pageID := p.PageID()
	protocolOptions, err := screenshotProtocolOptions(options, pageID)
	if err != nil {
		return nil, err
	}
	params := PageScreenshotParams{PageID: pageID, Options: protocolOptions}
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

func screenshotProtocolOptions(options *ScreenshotOptions, pageID string) (*PageScreenshotOptions, error) {
	if options == nil {
		return nil, nil
	}
	protocolOptions := PageScreenshotOptions{
		Animations:     options.Animations,
		Caret:          options.Caret,
		Clip:           options.Clip,
		FullPage:       options.FullPage,
		MaskColor:      options.MaskColor,
		OmitBackground: options.OmitBackground,
		Quality:        options.Quality,
		Scale:          options.Scale,
		Style:          options.Style,
		Timeout:        options.Timeout,
		Type:           options.Type,
	}
	if options.Mask != nil {
		mask, err := locatorDescriptorsForScreenshot(options.Mask, pageID)
		if err != nil {
			return nil, err
		}
		protocolOptions.Mask = mask
	}
	return &protocolOptions, nil
}

func locatorDescriptorsForScreenshot(locators []*PageLocator, pageID string) ([]LocatorDescriptor, error) {
	descriptors := make([]LocatorDescriptor, 0, len(locators))
	for index, locator := range locators {
		if locator == nil {
			return nil, fmt.Errorf("page.Screenshot: mask locator at index %d is nil", index)
		}
		descriptor := locator.Descriptor()
		if descriptor.PageID != pageID {
			return nil, errors.New("page.Screenshot: mask locator must belong to the target page")
		}
		descriptors = append(descriptors, descriptor)
	}
	return descriptors, nil
}

// Snapshot returns the generated accessibility snapshot result.
func (p *Page) Snapshot(ctx context.Context, options *PageSnapshotOptions) (SnapshotResult, error) {
	params := PageSnapshotParams{PageID: p.PageID(), Options: options}
	var result SnapshotResult
	err := p.rpc.call(ctx, "page.snapshot", params, &result)
	return result, err
}

// Tools returns a fresh snapshot of the WebMCP tools registered by the page.
func (p *Page) Tools(
	ctx context.Context,
	options *WebMCPToolsOptions,
) ([]*WebMCPTool, error) {
	pageID := p.PageID()
	params := PageWebMCPToolsParams{PageID: pageID, Options: options}
	var result PageWebMCPToolsResult
	if err := p.rpc.call(ctx, "page.webmcp_tools", params, &result); err != nil {
		return nil, err
	}

	tools := make([]*WebMCPTool, len(result.Tools))
	for index, descriptor := range result.Tools {
		tools[index] = &WebMCPTool{
			rpc:        p.rpc,
			pageID:     pageID,
			descriptor: descriptor,
		}
	}
	return tools, nil
}

// URL returns the page URL.
func (p *Page) URL(ctx context.Context) (string, error) {
	params := PageIDParams{PageID: p.PageID()}
	var result PageURLResult
	if err := p.rpc.call(ctx, "page.url", params, &result); err != nil {
		return "", err
	}
	return string(result), nil
}

// Title returns the page title.
func (p *Page) Title(ctx context.Context) (string, error) {
	params := PageIDParams{PageID: p.PageID()}
	var result PageTitleResult
	if err := p.rpc.call(ctx, "page.title", params, &result); err != nil {
		return "", err
	}
	return string(result), nil
}

// Close closes the page.
func (p *Page) Close(ctx context.Context) error {
	p.mu.RLock()
	subscriptions := make([]*CDPSubscription, 0, len(p.subscriptions))
	for subscription := range p.subscriptions {
		subscriptions = append(subscriptions, subscription)
	}
	p.mu.RUnlock()
	for _, subscription := range subscriptions {
		_ = subscription.Close(ctx)
	}
	params := PageIDParams{PageID: p.PageID()}
	var result PageCloseResult
	return p.rpc.call(ctx, "page.close", params, &result)
}

func (p *Page) addSubscription(subscription *CDPSubscription) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.subscriptions == nil {
		p.subscriptions = make(map[*CDPSubscription]struct{})
	}
	p.subscriptions[subscription] = struct{}{}
}

func (p *Page) removeSubscription(subscription *CDPSubscription) {
	p.mu.Lock()
	delete(p.subscriptions, subscription)
	p.mu.Unlock()
}

func newSubscriptionID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("create page event subscription ID: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

func invokePageEventListener(
	listener func(PageCDPEvent),
	event PageCDPEvent,
	reportPanic func(any),
) {
	defer func() {
		if recovered := recover(); recovered != nil && reportPanic != nil {
			reportPanic(recovered)
		}
	}()
	listener(event)
}

// Locator creates a page-scoped selector wrapper.
func (p *Page) Locator(selector string) *PageLocator {
	return &PageLocator{
		rpc:        p.rpc,
		descriptor: LocatorDescriptor{PageID: p.PageID(), Selector: selector},
	}
}

func (p *Page) setRef(ref PageRef) {
	p.mu.Lock()
	p.ref = ref
	p.mu.Unlock()
}
