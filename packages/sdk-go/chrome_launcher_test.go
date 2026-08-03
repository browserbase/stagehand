package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestDefaultChromeFlagsMatchChromeLauncher(t *testing.T) {
	want := []string{
		"--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider," +
			"CalculateNativeWinOcclusion,InterestFeedContentSuggestions," +
			"CertificateTransparencyComponentUpdater,AutofillServerCommunication," +
			"PrivacySandboxSettings4,RenderDocument",
		"--disable-component-extensions-with-background-pages",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-client-side-phishing-detection",
		"--disable-sync",
		"--metrics-recording-only",
		"--disable-default-apps",
		"--mute-audio",
		"--no-default-browser-check",
		"--no-first-run",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--disable-background-timer-throttling",
		"--disable-ipc-flooding-protection",
		"--password-store=basic",
		"--use-mock-keychain",
		"--force-fieldtrials=*BackgroundTracing/default/",
		"--disable-hang-monitor",
		"--disable-prompt-on-repost",
		"--disable-domain-reliability",
		"--propagate-iph-for-testing",
	}
	if !reflect.DeepEqual(defaultChromeFlags, want) {
		t.Fatalf("defaultChromeFlags = %#v, want %#v", defaultChromeFlags, want)
	}
	if slices.Contains(defaultChromeFlags, "--disable-extensions") {
		t.Fatal("defaultChromeFlags contains --disable-extensions")
	}
}

func TestBuildChromeArgsSupportsLocalBrowserOptions(t *testing.T) {
	t.Setenv("CI", "")
	sandbox := false
	deviceScaleFactor := 2.0
	options := LocalBrowserLaunchOptions{
		Args:              []string{"--custom-flag=value"},
		Headless:          true,
		Devtools:          true,
		ChromiumSandbox:   &sandbox,
		Proxy:             &LocalProxyConfig{Server: "http://proxy.test:8080", Bypass: "localhost"},
		Locale:            "de-CH",
		Viewport:          &LocalViewport{Width: 1440, Height: 900},
		DeviceScaleFactor: &deviceScaleFactor,
		HasTouch:          true,
		IgnoreHTTPSErrors: true,
	}

	got := buildChromeArgs(options, 9_222, "/tmp/stagehand profile")
	for _, want := range []string{
		"--enable-unsafe-extension-debugging",
		"--remote-allow-origins=*",
		"--window-size=1440,900",
		webMCPChromeFlag,
		"--remote-debugging-port=9222",
		"--user-data-dir=/tmp/stagehand profile",
		"--custom-flag=value",
		"--headless",
		"--auto-open-devtools-for-tabs",
		"--no-sandbox",
		"--proxy-server=http://proxy.test:8080",
		"--proxy-bypass-list=localhost",
		"--lang=de-CH",
		"--force-device-scale-factor=2",
		"--touch-events=enabled",
		"--ignore-certificate-errors",
	} {
		if !slices.Contains(got, want) {
			t.Errorf("buildChromeArgs() missing %q in %#v", want, got)
		}
	}
	if got[len(got)-1] != "about:blank" {
		t.Fatalf("buildChromeArgs() last argument = %q, want about:blank", got[len(got)-1])
	}
}

func TestBuildChromeArgsCanIgnoreDefaultArgs(t *testing.T) {
	t.Run("all", func(t *testing.T) {
		got := buildChromeArgs(
			LocalBrowserLaunchOptions{IgnoreDefaultArgs: &IgnoreDefaultArgs{All: true}},
			9_222,
			"/tmp/profile",
		)
		for _, defaultArg := range defaultChromeFlags {
			if slices.Contains(got, defaultArg) {
				t.Fatalf("buildChromeArgs() contains ignored default %q", defaultArg)
			}
		}
		for _, stagehandDefault := range []string{
			"--enable-unsafe-extension-debugging",
			"--remote-allow-origins=*",
			"--window-size=1280,800",
			webMCPChromeFlag,
		} {
			if slices.Contains(got, stagehandDefault) {
				t.Fatalf("buildChromeArgs() contains ignored Stagehand default %q", stagehandDefault)
			}
		}
	})

	t.Run("selected", func(t *testing.T) {
		ignored := defaultChromeFlags[1]
		got := buildChromeArgs(
			LocalBrowserLaunchOptions{
				IgnoreDefaultArgs: &IgnoreDefaultArgs{Args: []string{ignored}},
			},
			9_222,
			"/tmp/profile",
		)
		if slices.Contains(got, ignored) {
			t.Fatalf("buildChromeArgs() contains ignored default %q", ignored)
		}
		if !slices.Contains(got, defaultChromeFlags[0]) {
			t.Fatalf("buildChromeArgs() omitted non-ignored default %q", defaultChromeFlags[0])
		}
	})

	t.Run("WebMCP", func(t *testing.T) {
		got := buildChromeArgs(
			LocalBrowserLaunchOptions{
				IgnoreDefaultArgs: &IgnoreDefaultArgs{Args: []string{webMCPChromeFlag}},
			},
			9_222,
			"/tmp/profile",
		)
		if slices.Contains(got, webMCPChromeFlag) {
			t.Fatalf("buildChromeArgs() contains ignored default %q", webMCPChromeFlag)
		}
		if !slices.Contains(got, "--enable-unsafe-extension-debugging") {
			t.Fatal("buildChromeArgs() omitted non-ignored Stagehand defaults")
		}
	})
}

func TestFindChromePathForSupportedPlatforms(t *testing.T) {
	t.Run("configured path takes precedence", func(t *testing.T) {
		const configured = "/custom/chrome"
		got, err := findChromePathForOS(
			"darwin",
			func(name string) string {
				if name == "CHROME_PATH" {
					return configured
				}
				return ""
			},
			exec.LookPath,
			func(path string) bool { return path == configured },
		)
		if err != nil {
			t.Fatalf("findChromePathForOS() error = %v", err)
		}
		if got != configured {
			t.Fatalf("findChromePathForOS() = %q, want %q", got, configured)
		}
	})

	t.Run("macOS", func(t *testing.T) {
		const stable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
		got, err := findChromePathForOS(
			"darwin",
			func(string) string { return "" },
			exec.LookPath,
			func(path string) bool { return path == stable },
		)
		if err != nil {
			t.Fatalf("findChromePathForOS() error = %v", err)
		}
		if got != stable {
			t.Fatalf("findChromePathForOS() = %q, want %q", got, stable)
		}
	})

	t.Run("Windows", func(t *testing.T) {
		root := filepath.Join("C:", "Users", "stagehand", "AppData", "Local")
		stable := filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe")
		got, err := findChromePathForOS(
			"windows",
			func(name string) string {
				if name == "LOCALAPPDATA" {
					return root
				}
				return ""
			},
			exec.LookPath,
			func(path string) bool { return path == stable },
		)
		if err != nil {
			t.Fatalf("findChromePathForOS() error = %v", err)
		}
		if got != stable {
			t.Fatalf("findChromePathForOS() = %q, want %q", got, stable)
		}
	})

	t.Run("Linux", func(t *testing.T) {
		const stable = "/usr/bin/google-chrome-stable"
		got, err := findChromePathForOS(
			"linux",
			func(string) string { return "" },
			func(name string) (string, error) {
				if name == "google-chrome-stable" {
					return stable, nil
				}
				return "", errors.New("not found")
			},
			func(path string) bool { return path == stable },
		)
		if err != nil {
			t.Fatalf("findChromePathForOS() error = %v", err)
		}
		if got != stable {
			t.Fatalf("findChromePathForOS() = %q, want %q", got, stable)
		}
	})
}

func TestValidateLocalBrowserOptions(t *testing.T) {
	tests := []struct {
		name    string
		options LocalBrowserLaunchOptions
	}{
		{name: "negative port", options: LocalBrowserLaunchOptions{Port: -1}},
		{name: "large port", options: LocalBrowserLaunchOptions{Port: 65_536}},
		{name: "negative timeout", options: LocalBrowserLaunchOptions{ConnectTimeoutMs: -1}},
		{name: "empty viewport", options: LocalBrowserLaunchOptions{Viewport: &LocalViewport{}}},
		{
			name: "negative scale",
			options: func() LocalBrowserLaunchOptions {
				scale := -1.0
				return LocalBrowserLaunchOptions{DeviceScaleFactor: &scale}
			}(),
		},
		{
			name: "NaN scale",
			options: func() LocalBrowserLaunchOptions {
				scale := math.NaN()
				return LocalBrowserLaunchOptions{DeviceScaleFactor: &scale}
			}(),
		},
		{
			name: "positive infinite scale",
			options: func() LocalBrowserLaunchOptions {
				scale := math.Inf(1)
				return LocalBrowserLaunchOptions{DeviceScaleFactor: &scale}
			}(),
		},
		{
			name: "negative infinite scale",
			options: func() LocalBrowserLaunchOptions {
				scale := math.Inf(-1)
				return LocalBrowserLaunchOptions{DeviceScaleFactor: &scale}
			}(),
		},
		{name: "empty proxy", options: LocalBrowserLaunchOptions{Proxy: &LocalProxyConfig{}}},
		{
			name: "authenticated proxy",
			options: LocalBrowserLaunchOptions{
				Proxy: &LocalProxyConfig{Server: "http://proxy.test", Username: "user"},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateLocalBrowserOptions(test.options); err == nil {
				t.Fatal("validateLocalBrowserOptions() error = nil")
			}
		})
	}
}

func TestLaunchChromeRejectsCanceledContextBeforeStarting(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := launchChrome(ctx, LocalBrowserLaunchOptions{ExecutablePath: os.Args[0]})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("launchChrome() error = %v, want context.Canceled", err)
	}
}

func TestWaitForChromeRequiresCDPVersionEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		_ *http.Request,
	) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{}`))
	}))
	defer server.Close()

	process := &chromeProcess{done: make(chan struct{})}
	err := waitForChrome(context.Background(), server.URL, process, 250*time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waitForChrome() error = %v, want context deadline exceeded", err)
	}
}

func TestWaitForChromeAcceptsValidCDPVersionEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		if request.URL.Path != "/json/version" {
			t.Errorf("request path = %q, want /json/version", request.URL.Path)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(
			`{"webSocketDebuggerUrl":"ws://127.0.0.1/devtools/browser/test"}`,
		))
	}))
	defer server.Close()

	process := &chromeProcess{done: make(chan struct{})}
	if err := waitForChrome(context.Background(), server.URL, process, time.Second); err != nil {
		t.Fatalf("waitForChrome() error = %v", err)
	}
}

func TestWaitForChromePrioritizesCancellationAndProcessExit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		_ *http.Request,
	) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(
			`{"webSocketDebuggerUrl":"ws://127.0.0.1/devtools/browser/test"}`,
		))
	}))
	defer server.Close()

	t.Run("canceled context", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		process := &chromeProcess{done: make(chan struct{})}
		err := waitForChrome(ctx, server.URL, process, time.Second)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("waitForChrome() error = %v, want context.Canceled", err)
		}
	})

	t.Run("exited process", func(t *testing.T) {
		process := &chromeProcess{done: make(chan struct{}), err: errors.New("exit status 1")}
		close(process.done)
		err := waitForChrome(context.Background(), server.URL, process, time.Second)
		if err == nil || !strings.Contains(err.Error(), "exited before") {
			t.Fatalf("waitForChrome() error = %v, want exited-before-ready error", err)
		}
	})
}

func TestLaunchLocalBrowserAgainstInstalledChrome(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	launched, err := launchChrome(ctx, LocalBrowserLaunchOptions{
		ExecutablePath:   chromePath,
		Headless:         true,
		ConnectTimeoutMs: 15_000,
	})
	if err != nil {
		t.Fatalf("launchLocalBrowser() error = %v", err)
	}
	t.Cleanup(func() {
		closeContext, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		if err := launched.close(closeContext); err != nil {
			t.Errorf("close launched Chrome: %v", err)
		}
	})

	response, err := http.Get(launched.cdpURL + "/json/version")
	if err != nil {
		t.Fatalf("GET /json/version: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET /json/version status = %d, want 200", response.StatusCode)
	}
	var version struct {
		Browser              string `json:"Browser"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(response.Body).Decode(&version); err != nil {
		t.Fatalf("decode /json/version: %v", err)
	}
	if version.Browser == "" || version.WebSocketDebuggerURL == "" {
		t.Fatalf("GET /json/version = %#v, want browser and WebSocket URL", version)
	}
	if err := launched.close(context.Background()); err != nil {
		t.Fatalf("close launched Chrome: %v", err)
	}
	if _, err := os.Stat(launched.userDataDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary Chrome profile still exists after close: %v", err)
	}
}

func TestFindChromePathRejectsMissingExplicitPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-chrome")
	if _, err := findChromePath(path); err == nil {
		t.Fatal("findChromePath() error = nil")
	}
}

func TestAvailablePort(t *testing.T) {
	port, err := availablePort()
	if err != nil {
		t.Fatalf("availablePort() error = %v", err)
	}
	if port < 1 || port > 65_535 {
		t.Fatalf("availablePort() = %d, want valid TCP port", port)
	}
}
