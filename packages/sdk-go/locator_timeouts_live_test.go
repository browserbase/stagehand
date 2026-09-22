package stagehand

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Run with STAGEHAND_BROWSER_TESTS=1 after building and packaging the extension.
func TestLocatorTimeoutsLive(t *testing.T) {
	if os.Getenv("STAGEHAND_BROWSER_TESTS") != "1" {
		t.Skip("requires a fresh extension build and Chrome")
	}
	var clicks atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		if r.URL.Path == "/clicked" {
			clicks.Add(1)
			fmt.Fprint(w, "ok")
			return
		}
		depth, _ := strconv.Atoi(r.URL.Query().Get("depth"))
		delay, _ := strconv.Atoi(r.URL.Query().Get("delay"))
		if depth > 0 {
			select {
			case <-time.After(time.Duration(delay) * time.Millisecond):
			case <-r.Context().Done():
				return
			}
			if depth > 1 {
				fmt.Fprintf(w, `<iframe src="/child?depth=%d&delay=%d"></iframe>`, depth-1, delay)
			} else {
				fmt.Fprint(w, `<button onclick="fetch('/clicked')">click</button>`)
			}
			return
		}
		fmt.Fprint(w, `<button>ready</button><input><div hidden id="hidden"></div>`)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	browser, err := LaunchLocalBrowser(ctx, &LocalBrowserLaunchOptions{Headless: true})
	if err != nil {
		t.Fatal(err)
	}
	client, err := Create(ctx, CreateOptions{Browser: browser, Generate: func(context.Context, LLMGenerateParams) (LLMGenerateResult, error) {
		return LLMGenerateResult{}, fmt.Errorf("deterministic act must not invoke the model")
	}})
	if err != nil {
		_ = browser.Close(ctx)
		t.Fatal(err)
	}
	closeStagehandAfterTest(t, client, browser)
	browserContext, err := browser.Context()
	if err != nil {
		t.Fatal(err)
	}
	page, err := browserContext.NewPage(ctx, "about:blank")
	if err != nil {
		t.Fatal(err)
	}
	prepare := func(t *testing.T, delay, depth int) string {
		t.Helper()
		clicks.Store(0)
		if _, err := page.Goto(ctx, server.URL, nil); err != nil {
			t.Fatal(err)
		}
		expression := fmt.Sprintf(`document.body.insertAdjacentHTML('beforeend', '<iframe src="/child?depth=%d&delay=%d"></iframe>')`, depth, delay)
		if _, err := page.Evaluate(ctx, expression); err != nil {
			t.Fatal(err)
		}
		return strings.Repeat("iframe >> ", depth) + "button"
	}
	assertTimeout := func(t *testing.T, err error, ms int) {
		t.Helper()
		if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("%dms", ms)) {
			t.Fatalf("expected %dms timeout, got %v", ms, err)
		}
	}
	for _, tc := range []struct {
		name         string
		delay, depth int
		timeout      *int
		succeeds     bool
	}{
		{"override", 1800, 1, locatorTestPtr(4000), true},
		{"default succeeds", 1800, 1, nil, true},
		{"disabled", 5500, 1, locatorTestPtr(0), true},
		{"short", 900, 1, locatorTestPtr(250), false},
		{"default expires", 6000, 1, nil, false},
		{"nested shared budget", 1800, 2, locatorTestPtr(2800), false},
		{"nested default budget", 2800, 2, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			selector := prepare(t, tc.delay, tc.depth)
			var options *LocatorClickOptions
			if tc.timeout != nil {
				options = &LocatorClickOptions{Timeout: tc.timeout}
			}
			start := time.Now()
			err := page.Locator(selector).Click(ctx, options)
			if tc.succeeds {
				if err != nil {
					t.Fatal(err)
				}
				for i := 0; i < 100 && clicks.Load() == 0; i++ {
					time.Sleep(20 * time.Millisecond)
				}
				if clicks.Load() != 1 {
					t.Fatalf("clicks = %d", clicks.Load())
				}
			} else {
				timeout := 5000
				if tc.timeout != nil {
					timeout = *tc.timeout
				}
				assertTimeout(t, err, timeout)
				if time.Since(start) > time.Duration(timeout+1200)*time.Millisecond {
					t.Fatal("timeout exceeded overall budget")
				}
				if _, err := page.WaitForSelector(ctx, selector, &PageWaitForSelectorOptions{Timeout: locatorTestPtr(8000)}); err != nil {
					t.Fatal(err)
				}
				time.Sleep(250 * time.Millisecond)
				if clicks.Load() != 0 {
					t.Fatal("expired action clicked after readiness")
				}
			}
		})
	}
	t.Run("act and selector deadlines", func(t *testing.T) {
		selector := prepare(t, 1800, 1)
		_, err := page.WaitForSelector(ctx, selector, &PageWaitForSelectorOptions{Timeout: locatorTestPtr(250)})
		assertTimeout(t, err, 250)
		_, err = client.Act(ctx, ObservedAction(Action{Selector: selector, Method: locatorTestPtr("click"), Description: "click child"}), &StagehandClientActOptions{Page: page, Timeout: locatorTestPtr(float64(250))})
		assertTimeout(t, err, 250)
		if _, err := page.WaitForSelector(ctx, selector, &PageWaitForSelectorOptions{Timeout: locatorTestPtr(4000)}); err != nil {
			t.Fatal(err)
		}
		time.Sleep(250 * time.Millisecond)
		if clicks.Load() != 0 {
			t.Fatal("expired act clicked after readiness")
		}
	})
	t.Run("ready queries and execution delays", func(t *testing.T) {
		if _, err := page.Goto(ctx, server.URL, nil); err != nil {
			t.Fatal(err)
		}
		start := time.Now()
		if err := page.Locator("button").Click(ctx, nil); err != nil {
			t.Fatal(err)
		}
		options := &LocatorOptions{Timeout: locatorTestPtr(4000)}
		if count, err := page.Locator("#missing").Count(ctx, options); err != nil || count != 0 {
			t.Fatalf("count = %d, %v", count, err)
		}
		if visible, err := page.Locator("#hidden").IsVisible(ctx, options); err != nil || visible {
			t.Fatalf("visible = %v, %v", visible, err)
		}
		if _, err := page.Locator("#missing").IsVisible(ctx, options); err == nil {
			t.Fatal("expected existing missing-element error")
		}
		if time.Since(start) > 2*time.Second {
			t.Fatal("current-state queries waited")
		}
		input := page.Locator("input")
		assertTimeout(t, input.Type(ctx, "abcd", &LocatorTypeOptions{Delay: locatorTestPtr(float64(300)), Timeout: locatorTestPtr(250)}), 250)
		value, err := input.InputValue(ctx)
		if err != nil {
			t.Fatal(err)
		}
		time.Sleep(1200 * time.Millisecond)
		later, err := input.InputValue(ctx)
		if err != nil || later != value {
			t.Fatalf("typing continued after expiry: %q -> %q, %v", value, later, err)
		}
		if err := input.Fill(ctx, ""); err != nil {
			t.Fatal(err)
		}
		if err := input.Type(ctx, "ab", &LocatorTypeOptions{Delay: locatorTestPtr(float64(150)), Timeout: locatorTestPtr(2000)}); err != nil {
			t.Fatal(err)
		}
		if value, err := input.InputValue(ctx); err != nil || value != "ab" {
			t.Fatalf("input = %q, %v", value, err)
		}
		assertTimeout(t, page.Locator("button").Highlight(ctx, &LocatorHighlightOptions{DurationMs: locatorTestPtr(800), Timeout: locatorTestPtr(250)}), 250)
		if err := page.Locator("button").Highlight(ctx, &LocatorHighlightOptions{DurationMs: locatorTestPtr(300), Timeout: locatorTestPtr(2000)}); err != nil {
			t.Fatal(err)
		}
	})
}
