package stagehand

import (
	"context"
	"errors"
	"sync"
)

// BrowserProvider identifies the service providing a browser.
type BrowserProvider string

const (
	// BrowserProviderLocal identifies a locally running browser.
	BrowserProviderLocal BrowserProvider = "local"
	// BrowserProviderBrowserbase identifies a Browserbase browser.
	BrowserProviderBrowserbase BrowserProvider = "browserbase"
)

// BrowserOrigin identifies whether a browser was launched or connected.
type BrowserOrigin string

const (
	// BrowserOriginLaunched identifies a browser launched by this SDK.
	BrowserOriginLaunched BrowserOrigin = "launched"
	// BrowserOriginConnected identifies an existing browser connection.
	BrowserOriginConnected BrowserOrigin = "connected"
)

// Browser is a factory-created browser whose Stagehand extension is ready.
type Browser struct {
	mu              browserMutex
	provider        BrowserProvider
	origin          BrowserOrigin
	claimed         bool
	browserContext  *BrowserContext
	closeRequested  bool
	closeResult     error
	cdp             *cdpClient
	workerAPIKey    *string
	workerBrowser   *BrowserSessionMetadata
	extensionDir    string
	ownsSource      bool
	closeSource     func(context.Context) error
	terminateSource func(context.Context) error
	cleanup         func() error
}

type browserMutex struct {
	sync.Mutex
	closeDone chan struct{}
}

// Provider returns the browser provider.
func (browser *Browser) Provider() BrowserProvider {
	if browser == nil {
		return ""
	}
	return browser.provider
}

// Origin returns whether the browser was launched or connected.
func (browser *Browser) Origin() BrowserOrigin {
	if browser == nil {
		return ""
	}
	return browser.origin
}

// SessionID returns the Browserbase session id backing this browser, or an
// empty string for local browsers.
func (browser *Browser) SessionID() string {
	if browser == nil || browser.workerBrowser == nil {
		return ""
	}
	return browser.workerBrowser.SessionID
}

// Closed reports whether browser teardown has been requested.
func (browser *Browser) Closed() bool {
	if browser == nil {
		return true
	}
	browser.mu.Lock()
	defer browser.mu.Unlock()
	return browser.closeRequested
}

// Context returns the Stagehand context attached to this browser.
func (browser *Browser) Context() (*BrowserContext, error) {
	if browser == nil {
		return nil, ErrNotInitialized
	}
	browser.mu.Lock()
	defer browser.mu.Unlock()
	if browser.browserContext == nil {
		return nil, ErrNotInitialized
	}
	return browser.browserContext, nil
}

// Close tears down the browser-owned resources once and memoizes the result.
// A nil context is treated as context.Background.
func (browser *Browser) Close(ctx context.Context) error {
	return browser.runTerminalOperation(ctx, browser.terminateResources)
}

func (browser *Browser) invalidate(ctx context.Context) error {
	return browser.runTerminalOperation(ctx, browser.invalidateResources)
}

func (browser *Browser) runTerminalOperation(
	ctx context.Context,
	operation func(context.Context) error,
) error {
	if browser == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	browser.mu.Lock()
	if browser.closeRequested {
		done := browser.mu.closeDone
		if done == nil {
			result := browser.closeResult
			browser.mu.Unlock()
			return result
		}
		browser.mu.Unlock()
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		}
		browser.mu.Lock()
		result := browser.closeResult
		browser.mu.Unlock()
		return result
	}
	browser.closeRequested = true
	browser.mu.closeDone = make(chan struct{})
	done := browser.mu.closeDone
	browser.mu.Unlock()

	result := operation(ctx)
	browser.mu.Lock()
	browser.closeResult = result
	close(done)
	browser.mu.Unlock()
	return result
}

func (browser *Browser) invalidateResources(ctx context.Context) error {
	var cdpErr error
	if browser.cdp != nil {
		cdpErr = browser.cdp.Close()
	}
	var sourceErr error
	if browser.ownsSource && browser.closeSource != nil {
		sourceErr = browser.closeSource(ctx)
	}
	var cleanupErr error
	if browser.cleanup != nil {
		cleanupErr = browser.cleanup()
	}
	return errors.Join(cdpErr, sourceErr, cleanupErr)
}

func (browser *Browser) terminateResources(ctx context.Context) error {
	var terminationErr error
	if browser.terminateSource != nil {
		terminationErr = browser.terminateSource(ctx)
	}
	var cdpErr error
	if browser.cdp != nil {
		cdpErr = browser.cdp.Close()
	}
	var cleanupErr error
	if browser.cleanup != nil {
		cleanupErr = browser.cleanup()
	}
	return errors.Join(terminationErr, cdpErr, cleanupErr)
}

type claimedBrowser struct {
	cdp           *cdpClient
	workerAPIKey  *string
	workerBrowser *BrowserSessionMetadata
}

func claimBrowser(browser *Browser) (claimedBrowser, error) {
	if browser == nil {
		return claimedBrowser{}, errors.New("browser is required")
	}
	browser.mu.Lock()
	defer browser.mu.Unlock()
	if browser.closeRequested {
		return claimedBrowser{}, errors.New("cannot attach Stagehand to a closed browser")
	}
	if browser.claimed {
		return claimedBrowser{}, errors.New("this browser is already attached to a Stagehand instance")
	}
	browser.claimed = true
	return claimedBrowser{
		cdp:           browser.cdp,
		workerAPIKey:  browser.workerAPIKey,
		workerBrowser: browser.workerBrowser,
	}, nil
}

func releaseBrowserClaim(browser *Browser) {
	if browser == nil {
		return
	}
	browser.mu.Lock()
	browser.claimed = false
	browser.mu.Unlock()
}

func attachBrowserContext(browser *Browser, browserContext *BrowserContext) error {
	if browser == nil {
		return errors.New("browser is required")
	}
	if browserContext == nil {
		return errors.New("browser context is required")
	}
	browser.mu.Lock()
	defer browser.mu.Unlock()
	if !browser.claimed {
		return errors.New("cannot attach a browser context before Stagehand claims the browser")
	}
	if browser.browserContext != nil {
		return errors.New("this browser already has a Stagehand context")
	}
	browser.browserContext = browserContext
	return nil
}

func detachBrowserContext(browser *Browser) {
	if browser == nil {
		return
	}
	browser.mu.Lock()
	browser.browserContext = nil
	browser.mu.Unlock()
}
