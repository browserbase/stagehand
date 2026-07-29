package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultChromeWidth  = 1280
	defaultChromeHeight = 800
	chromePollInterval  = 100 * time.Millisecond
)

// Copyright 2017 Google Inc. All Rights Reserved.
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// https://www.apache.org/licenses/LICENSE-2.0.
//
// defaultChromeFlags tracks chrome-launcher 1.2.1's DEFAULT_FLAGS, excluding
// --disable-extensions so Stagehand can load its unpacked extension. The
// TypeScript and Python SDKs use the same list.
var defaultChromeFlags = []string{
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

type launchedChrome struct {
	cdpURL      string
	userDataDir string
	process     *chromeProcess
	removeDir   bool

	closeOnce sync.Once
	closeErr  error
}

type chromeProcess struct {
	command *exec.Cmd
	done    chan struct{}

	mu  sync.Mutex
	err error
}

func launchLocalBrowser(
	ctx context.Context,
	options LocalBrowserSource,
) (resolvedBrowserSource, error) {
	launched, err := launchChrome(ctx, options)
	if err != nil {
		return resolvedBrowserSource{}, err
	}
	return resolvedBrowserSource{
		cdpURL:    launched.cdpURL,
		keepAlive: options.KeepAlive,
		close:     launched.close,
	}, nil
}

func launchChrome(
	ctx context.Context,
	options LocalBrowserSource,
) (*launchedChrome, error) {
	if ctx == nil {
		return nil, errors.New("stagehand Chrome launch context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("launch Chrome: %w", err)
	}
	if err := validateLocalBrowserOptions(options); err != nil {
		return nil, err
	}

	chromePath, err := findChromePath(options.ExecutablePath)
	if err != nil {
		return nil, err
	}
	port := options.Port
	if port == 0 {
		port, err = availablePort()
		if err != nil {
			return nil, err
		}
	}

	userDataDir := options.UserDataDir
	temporaryProfile := userDataDir == ""
	if temporaryProfile {
		userDataDir, err = os.MkdirTemp("", "stagehand-chrome-")
		if err != nil {
			return nil, fmt.Errorf("create Chrome profile: %w", err)
		}
	} else if err := os.MkdirAll(userDataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create Chrome profile %q: %w", userDataDir, err)
	}

	removeDir := temporaryProfile && !options.PreserveUserDataDir
	cleanupProfile := func() error {
		if !removeDir {
			return nil
		}
		if err := os.RemoveAll(userDataDir); err != nil {
			return fmt.Errorf("remove Chrome profile: %w", err)
		}
		return nil
	}

	command := exec.Command(chromePath, buildChromeArgs(options, port, userDataDir)...)
	command.Stdin = nil
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	configureChromeProcess(command)
	if err := ctx.Err(); err != nil {
		return nil, errors.Join(
			fmt.Errorf("launch Chrome: %w", err),
			cleanupProfile(),
		)
	}
	if err := command.Start(); err != nil {
		return nil, errors.Join(
			fmt.Errorf("start Chrome: %w", err),
			cleanupProfile(),
		)
	}

	process := newChromeProcess(command)
	launched := &launchedChrome{
		cdpURL:      fmt.Sprintf("http://127.0.0.1:%d", port),
		userDataDir: userDataDir,
		process:     process,
		removeDir:   removeDir,
	}
	if err := waitForChrome(ctx, launched.cdpURL, process); err != nil {
		return nil, errors.Join(err, launched.close(context.Background()))
	}
	return launched, nil
}

func validateLocalBrowserOptions(options LocalBrowserSource) error {
	if options.Port < 0 || options.Port > 65_535 {
		return errors.New("stagehand Chrome port must be 0 or between 1 and 65535")
	}
	if options.Viewport != nil && (options.Viewport.Width <= 0 || options.Viewport.Height <= 0) {
		return errors.New("stagehand Chrome viewport dimensions must be positive")
	}
	if options.DeviceScaleFactor != nil &&
		(*options.DeviceScaleFactor <= 0 ||
			math.IsNaN(*options.DeviceScaleFactor) ||
			math.IsInf(*options.DeviceScaleFactor, 0)) {
		return errors.New("stagehand Chrome device scale factor must be positive and finite")
	}
	if options.Proxy != nil {
		if options.Proxy.Server == "" {
			return errors.New("stagehand Chrome proxy server is required")
		}
		if options.Proxy.Username != "" || options.Proxy.Password != "" {
			return errors.New("stagehand authenticated local browser proxies are not implemented")
		}
	}
	if options.DownloadsPath != "" || options.AcceptDownloads != nil {
		return errors.New("stagehand local browser download options require post-connect CDP setup")
	}
	return nil
}

func buildChromeArgs(options LocalBrowserSource, port int, userDataDir string) []string {
	args := selectedDefaultChromeFlags(options.IgnoreDefaultArgs)

	width, height := defaultChromeWidth, defaultChromeHeight
	if options.Viewport != nil {
		width, height = options.Viewport.Width, options.Viewport.Height
	}
	args = append(args,
		"--enable-unsafe-extension-debugging",
		"--remote-allow-origins=*",
		fmt.Sprintf("--window-size=%d,%d", width, height),
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--user-data-dir="+userDataDir,
	)
	args = append(args, options.Args...)

	if options.Headless {
		args = append(args, "--headless")
	}
	if options.Devtools {
		args = append(args, "--auto-open-devtools-for-tabs")
	}
	if os.Getenv("CI") != "" ||
		(options.ChromiumSandbox != nil && !*options.ChromiumSandbox) ||
		(runtime.GOOS == "linux" && runningAsRoot()) {
		args = append(args, "--no-sandbox")
	}
	if options.Proxy != nil {
		args = append(args, "--proxy-server="+options.Proxy.Server)
		if options.Proxy.Bypass != "" {
			args = append(args, "--proxy-bypass-list="+options.Proxy.Bypass)
		}
	}
	if options.Locale != "" {
		args = append(args, "--lang="+options.Locale)
	}
	if options.DeviceScaleFactor != nil {
		args = append(
			args,
			"--force-device-scale-factor="+strconv.FormatFloat(
				*options.DeviceScaleFactor,
				'f',
				-1,
				64,
			),
		)
	}
	if options.HasTouch {
		args = append(args, "--touch-events=enabled")
	}
	if options.IgnoreHTTPSErrors {
		args = append(args, "--ignore-certificate-errors")
	}
	return append(args, "about:blank")
}

func selectedDefaultChromeFlags(ignore *IgnoreDefaultArgs) []string {
	if ignore != nil && ignore.All {
		return nil
	}
	if ignore == nil || len(ignore.Args) == 0 {
		return append([]string(nil), defaultChromeFlags...)
	}

	ignored := make(map[string]struct{}, len(ignore.Args))
	for _, arg := range ignore.Args {
		ignored[arg] = struct{}{}
	}
	result := make([]string, 0, len(defaultChromeFlags))
	for _, arg := range defaultChromeFlags {
		if _, skip := ignored[arg]; !skip {
			result = append(result, arg)
		}
	}
	return result
}

func findChromePath(explicitPath string) (string, error) {
	if explicitPath != "" {
		if isFile(explicitPath) {
			return explicitPath, nil
		}
		return "", fmt.Errorf("Chrome executable %q does not exist", explicitPath)
	}
	return findChromePathForOS(runtime.GOOS, os.Getenv, exec.LookPath, isFile)
}

func findChromePathForOS(
	goos string,
	getenv func(string) string,
	lookPath func(string) (string, error),
	fileExists func(string) bool,
) (string, error) {
	if configured := getenv("CHROME_PATH"); configured != "" && fileExists(configured) {
		return configured, nil
	}

	var candidates []string
	switch goos {
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		}
	case "windows":
		roots := []string{
			getenv("LOCALAPPDATA"),
			getenv("PROGRAMFILES"),
			getenv("PROGRAMFILES(X86)"),
		}
		suffixes := [][]string{
			{"Google", "Chrome SxS", "Application", "chrome.exe"},
			{"Google", "Chrome", "Application", "chrome.exe"},
		}
		for _, root := range roots {
			if root == "" {
				continue
			}
			for _, suffix := range suffixes {
				candidates = append(candidates, filepath.Join(append([]string{root}, suffix...)...))
			}
		}
	case "linux":
		for _, name := range []string{
			"google-chrome-stable",
			"google-chrome",
			"chromium-browser",
			"chromium",
		} {
			if path, err := lookPath(name); err == nil {
				candidates = append(candidates, path)
			}
		}
	default:
		return "", fmt.Errorf("Chrome launching is not supported on %s", goos)
	}

	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("Chrome installation not found; set CHROME_PATH")
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func availablePort() (int, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("select Chrome debugging port: %w", err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	return port, nil
}

func waitForChrome(
	ctx context.Context,
	cdpURL string,
	process *chromeProcess,
) error {
	client := &http.Client{Timeout: chromePollInterval}
	ticker := time.NewTicker(chromePollInterval)
	defer ticker.Stop()

	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("wait for Chrome debugging port: %w", err)
		}
		select {
		case <-process.done:
			return chromeExitedBeforeReadyError(process)
		default:
		}

		if chromeDebuggingReady(ctx, client, cdpURL) {
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("wait for Chrome debugging port: %w", err)
			}
			select {
			case <-process.done:
				return chromeExitedBeforeReadyError(process)
			default:
			}
			return nil
		}

		select {
		case <-process.done:
			return chromeExitedBeforeReadyError(process)
		case <-ctx.Done():
			return fmt.Errorf("wait for Chrome debugging port: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func chromeDebuggingReady(ctx context.Context, client *http.Client, cdpURL string) bool {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		strings.TrimRight(cdpURL, "/")+"/json/version",
		nil,
	)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	var version struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	return json.NewDecoder(response.Body).Decode(&version) == nil &&
		strings.TrimSpace(version.WebSocketDebuggerURL) != ""
}

func chromeExitedBeforeReadyError(process *chromeProcess) error {
	if processErr := process.waitError(); processErr != nil {
		return fmt.Errorf("Chrome exited before its debugging port was ready: %w", processErr)
	}
	return errors.New("Chrome exited before its debugging port was ready")
}

func newChromeProcess(command *exec.Cmd) *chromeProcess {
	process := &chromeProcess{command: command, done: make(chan struct{})}
	go func() {
		err := command.Wait()
		process.mu.Lock()
		process.err = err
		process.mu.Unlock()
		close(process.done)
	}()
	return process
}

func (process *chromeProcess) waitError() error {
	process.mu.Lock()
	defer process.mu.Unlock()
	return process.err
}

func (launched *launchedChrome) close(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	launched.closeOnce.Do(func() {
		launched.closeErr = launched.closeProcess(ctx)
		if launched.removeDir {
			launched.closeErr = errors.Join(
				launched.closeErr,
				removeChromeProfile(launched.userDataDir),
			)
		}
	})
	return launched.closeErr
}

func (launched *launchedChrome) closeProcess(ctx context.Context) error {
	select {
	case <-launched.process.done:
		return nil
	default:
	}

	terminateErr := terminateChromeProcess(launched.process.command)
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	select {
	case <-launched.process.done:
		return ignoreFinishedProcessError(terminateErr)
	case <-ctx.Done():
		killErr := killChromeProcess(launched.process.command)
		<-launched.process.done
		return errors.Join(ignoreFinishedProcessError(terminateErr), ignoreFinishedProcessError(killErr))
	case <-timer.C:
		killErr := killChromeProcess(launched.process.command)
		<-launched.process.done
		return errors.Join(ignoreFinishedProcessError(terminateErr), ignoreFinishedProcessError(killErr))
	}
}

func removeChromeProfile(path string) error {
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("remove Chrome profile: %w", err)
	}
	return nil
}

func ignoreFinishedProcessError(err error) error {
	if errors.Is(err, os.ErrProcessDone) || isFinishedChromeProcessError(err) {
		return nil
	}
	return err
}
