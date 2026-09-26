package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

type loggingCall struct {
	method string
	params any
}

type loggingProtocolClient struct {
	calls               []loggingCall
	notificationHandler func(StagehandLog)
	removed             bool
	closed              bool
}

func (client *loggingProtocolClient) call(
	_ context.Context,
	method string,
	params any,
	_ any,
) error {
	client.calls = append(client.calls, loggingCall{method: method, params: params})
	return nil
}

func (*loggingProtocolClient) onRequest(string, requestHandler) func() {
	return func() {}
}

func (client *loggingProtocolClient) onNotification(
	_ string,
	handler func(StagehandLog),
) func() {
	client.notificationHandler = handler
	return func() {
		client.notificationHandler = nil
		client.removed = true
	}
}

func (*loggingProtocolClient) onPageEvent(func(PageEventNotification)) func() { return func() {} }

func (*loggingProtocolClient) onPageCDPEvent(func(PageCDPEventNotification)) func() {
	return func() {}
}

func (*loggingProtocolClient) browserWebSocketDebuggerURL() string {
	return "ws://127.0.0.1:9222/devtools/browser/test"
}

func (client *loggingProtocolClient) close() error {
	client.closed = true
	return nil
}

func (client *loggingProtocolClient) emit(log StagehandLog) {
	if client.notificationHandler != nil {
		client.notificationHandler(log)
	}
}

func TestGoLoggingDefaultsToInfoPrettyAndRemovesListener(t *testing.T) {
	t.Parallel()

	rpc := &loggingProtocolClient{}
	var output bytes.Buffer
	client, err := newStagehandWithClient(CreateOptions{}, rpc, &output)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	initParams, ok := rpc.calls[0].params.(StagehandInitParams)
	if !ok {
		t.Fatalf("stagehand.init params = %T", rpc.calls[0].params)
	}
	if initParams.LogLevel != StagehandInitParamsLogLevelInfo {
		t.Fatalf("log level = %q, want info", initParams.LogLevel)
	}

	for _, log := range testStagehandLogs() {
		rpc.emit(log)
	}
	want := strings.Join([]string{
		`[stagehand] INFO Page opened {"pageId":"page-1"}`,
		"[stagehand] WARN Selector fallback",
		`[stagehand] ERROR Action failed {"retryable":false}`,
		"",
	}, "\n")
	if output.String() != want {
		t.Fatalf("terminal output = %q, want %q", output.String(), want)
	}

	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if !rpc.removed || rpc.notificationHandler != nil {
		t.Fatal("Close() did not remove the logging notification listener")
	}
}

func TestGoLoggingRejectsQueuedNotificationsAfterRelease(t *testing.T) {
	t.Parallel()

	var firstSessionLogs []StagehandLog
	rpc := &loggingProtocolClient{}
	var firstSessionOutput bytes.Buffer
	client, err := newStagehandWithClient(CreateOptions{
		Logging: &StagehandClientLoggingConfig{
			OnLog: func(log StagehandLog) {
				firstSessionLogs = append(firstSessionLogs, log)
			},
		},
	}, rpc, &firstSessionOutput)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	queuedHandler := rpc.notificationHandler
	if queuedHandler == nil {
		t.Fatal("first Init() did not register a logging notification listener")
	}
	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	log := testStagehandLogs()[1]
	queuedHandler(log)
	if firstSessionOutput.Len() != 0 || len(firstSessionLogs) != 0 {
		t.Fatalf(
			"released session handled queued log: output = %q, callback logs = %#v",
			firstSessionOutput.String(),
			firstSessionLogs,
		)
	}
}

func TestGoLoggingHonorsEveryThreshold(t *testing.T) {
	t.Parallel()

	tests := []struct {
		level StagehandClientLogLevel
		want  []string
	}{
		{
			level: StagehandClientLogLevelDebug,
			want:  []string{"CDP call", "Page opened", "Selector fallback", "Action failed"},
		},
		{
			level: StagehandClientLogLevelInfo,
			want:  []string{"Page opened", "Selector fallback", "Action failed"},
		},
		{
			level: StagehandClientLogLevelWarn,
			want:  []string{"Selector fallback", "Action failed"},
		},
		{
			level: StagehandClientLogLevelError,
			want:  []string{"Action failed"},
		},
		{level: StagehandClientLogLevelOff, want: nil},
	}
	for _, test := range tests {
		test := test
		t.Run(string(test.level), func(t *testing.T) {
			t.Parallel()

			rpc := &loggingProtocolClient{}
			var output bytes.Buffer
			client, err := newStagehandWithClient(CreateOptions{
				Logging: &StagehandClientLoggingConfig{Level: test.level},
			}, rpc, &output)
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			defer client.Close(context.Background())
			for _, log := range testStagehandLogs() {
				rpc.emit(log)
			}
			for _, log := range testStagehandLogs() {
				got := strings.Contains(output.String(), log.Message)
				want := containsString(test.want, log.Message)
				if got != want {
					t.Errorf(
						"output contains %q = %t, want %t; output: %q",
						log.Message,
						got,
						want,
						output.String(),
					)
				}
			}
		})
	}
}

func TestGoLoggingWritesJSONAndCallsCallback(t *testing.T) {
	t.Parallel()

	var received []StagehandLog
	rpc := &loggingProtocolClient{}
	var output bytes.Buffer
	client, err := newStagehandWithClient(CreateOptions{
		Logging: &StagehandClientLoggingConfig{
			Level:  StagehandClientLogLevelDebug,
			Format: StagehandClientLogFormatJSON,
			OnLog: func(log StagehandLog) {
				received = append(received, log)
			},
		},
	}, rpc, &output)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	defer client.Close(context.Background())
	log := testStagehandLogs()[0]
	rpc.emit(log)

	want := "{\"level\":\"debug\",\"message\":\"CDP call\",\"data\":{\"method\":\"Page.navigate\"}}\n"
	if output.String() != want {
		t.Fatalf("JSON output = %q, want %q", output.String(), want)
	}
	if !reflect.DeepEqual(received, []StagehandLog{log}) {
		t.Fatalf("callback logs = %#v, want %#v", received, []StagehandLog{log})
	}
}

func TestGoLoggingRecoversCallbackPanic(t *testing.T) {
	t.Parallel()
	for _, consoleOutput := range []bool{true, false} {
		t.Run(fmt.Sprint(consoleOutput), func(t *testing.T) {
			rpc := &loggingProtocolClient{}
			var output bytes.Buffer
			var received []StagehandLog
			client, err := newStagehandWithClient(CreateOptions{
				Logging: &StagehandClientLoggingConfig{
					Console: &consoleOutput,
					OnLog: func(log StagehandLog) {
						received = append(received, log)
						if len(received) == 1 {
							panic("callback exploded")
						}
					},
				},
			}, rpc, &output)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close(context.Background())
			logs := testStagehandLogs()[1:3]
			for _, log := range logs {
				rpc.emit(log)
			}
			if !reflect.DeepEqual(received, logs) {
				t.Fatalf("callback logs = %#v, want %#v", received, logs)
			}
			want := "[stagehand] ERROR onLog callback failed: callback exploded\n"
			if consoleOutput {
				want = "[stagehand] INFO Page opened {\"pageId\":\"page-1\"}\n" + want + "[stagehand] WARN Selector fallback\n"
			}
			if output.String() != want {
				t.Fatalf("callback panic output = %q, want %q", output.String(), want)
			}
		})
	}
}

func TestGoLoggingReportsPageEventListenerPanic(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init":      StagehandInitResult{Initialized: true},
		"context.active_page": PageRef{PageID: "page-1"},
		"page.on":             PageVoidResult{Ok: true},
		"page.off":            PageVoidResult{Ok: true},
	}}
	var output bytes.Buffer
	client, err := newStagehandWithClient(CreateOptions{}, rpc, &output)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	defer client.Close(context.Background())
	browserContext, err := client.Browser().Context()
	if err != nil {
		t.Fatalf("Browser.Context() error = %v", err)
	}
	page, err := browserContext.ActivePage(context.Background())
	if err != nil {
		t.Fatalf("ActivePage() error = %v", err)
	}
	if page == nil {
		t.Fatal("ActivePage() = nil")
	}
	subscription, err := page.On(context.Background(), "console", func(PageCDPEvent) {
		panic("listener exploded")
	})
	if err != nil {
		t.Fatalf("Page.On() error = %v", err)
	}
	defer subscription.Close(context.Background())
	onParams := rpc.calls[2].params.(PageOnParams)
	rpc.pageEventHandler(PageCDPEventNotification{
		SubscriptionID: onParams.SubscriptionID,
		Event: PageCDPEvent{
			PageID: "page-1",
			Method: "Runtime.consoleAPICalled",
		},
	})

	if !strings.Contains(
		output.String(),
		"[stagehand] ERROR page event listener callback failed: listener exploded\n",
	) {
		t.Fatalf("page event listener panic output = %q", output.String())
	}
}

func TestGoLoggingRejectsInvalidConfiguration(t *testing.T) {
	t.Parallel()

	tests := []StagehandClientLoggingConfig{
		{Level: "trace"},
		{Format: "xml"},
	}
	for _, logging := range tests {
		_, err := newStagehandWithClient(
			CreateOptions{Logging: &logging},
			&loggingProtocolClient{},
		)
		if err == nil || !strings.Contains(err.Error(), "invalid logging") {
			t.Fatalf("Create() error = %v, want invalid logging error", err)
		}
	}
}

func testStagehandLogs() []StagehandLog {
	return []StagehandLog{
		{
			Level:   StagehandLogLevelDebug,
			Message: "CDP call",
			Data: StagehandLogData{
				"method": json.RawMessage(`"Page.navigate"`),
			},
		},
		{
			Level:   StagehandLogLevelInfo,
			Message: "Page opened",
			Data: StagehandLogData{
				"pageId": json.RawMessage(`"page-1"`),
			},
		},
		{
			Level:   StagehandLogLevelWarn,
			Message: "Selector fallback",
			Data:    StagehandLogData{},
		},
		{
			Level:   StagehandLogLevelError,
			Message: "Action failed",
			Data: StagehandLogData{
				"retryable": json.RawMessage("false"),
			},
		},
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestGoLoggingCallbackOnlyReproduction(t *testing.T) {
	consoleOutput := false
	rpc := &loggingProtocolClient{}
	var output bytes.Buffer
	var received []StagehandLog
	client, err := newStagehandWithClient(CreateOptions{Logging: &StagehandClientLoggingConfig{
		Console: &consoleOutput,
		OnLog:   func(log StagehandLog) { received = append(received, log) },
	}}, rpc, &output)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close(context.Background())
	log := testStagehandLogs()[1]
	rpc.emit(log)
	if !reflect.DeepEqual(received, []StagehandLog{log}) {
		t.Fatalf("callback = %#v", received)
	}
	if output.Len() != 0 {
		t.Fatalf("unwanted routine output = %q", output.String())
	}
}

func TestGoLoggingConsoleDefaultsAndCopiedValue(t *testing.T) {
	t.Parallel()
	enabled, disabled := true, false
	for _, test := range []struct {
		name   string
		config *StagehandClientLoggingConfig
		prints bool
	}{
		{"nil", nil, true},
		{"zero", &StagehandClientLoggingConfig{}, true},
		{"nil_console", &StagehandClientLoggingConfig{Console: nil}, true},
		{"true", &StagehandClientLoggingConfig{Console: &enabled}, true},
		{"false", &StagehandClientLoggingConfig{Console: &disabled}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			rpc := &loggingProtocolClient{}
			var output bytes.Buffer
			client, err := newStagehandWithClient(CreateOptions{Logging: test.config}, rpc, &output)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close(context.Background())
			if test.config != nil && test.config.Console != nil {
				*test.config.Console = !*test.config.Console
			}
			rpc.emit(testStagehandLogs()[1])
			want := ""
			if test.prints {
				want = "[stagehand] INFO Page opened {\"pageId\":\"page-1\"}\n"
			}
			if output.String() != want {
				t.Fatalf("output = %q, want %q", output.String(), want)
			}
		})
	}
}

func TestGoLoggingConsoleDestinations(t *testing.T) {
	t.Parallel()
	enabled, disabled := true, false
	pretty := []string{
		`[stagehand] DEBUG CDP call {"method":"Page.navigate"}`,
		`[stagehand] INFO Page opened {"pageId":"page-1"}`,
		`[stagehand] WARN Selector fallback`,
		`[stagehand] ERROR Action failed {"retryable":false}`,
	}
	jsonLines := []string{
		`{"level":"debug","message":"CDP call","data":{"method":"Page.navigate"}}`,
		`{"level":"info","message":"Page opened","data":{"pageId":"page-1"}}`,
		`{"level":"warn","message":"Selector fallback","data":{}}`,
		`{"level":"error","message":"Action failed","data":{"retryable":false}}`,
	}
	for _, consoleCase := range []struct {
		name  string
		value *bool
	}{
		{"omitted", nil}, {"true", &enabled}, {"false", &disabled},
	} {
		for _, format := range []StagehandClientLogFormat{StagehandClientLogFormatPretty, StagehandClientLogFormatJSON} {
			for first, level := range []StagehandClientLogLevel{
				StagehandClientLogLevelDebug, StagehandClientLogLevelInfo, StagehandClientLogLevelWarn,
				StagehandClientLogLevelError, StagehandClientLogLevelOff,
			} {
				for _, callback := range []bool{true, false} {
					t.Run(fmt.Sprintf("%s/%s/%s/callback=%t", consoleCase.name, format, level, callback), func(t *testing.T) {
						rpc := &loggingProtocolClient{}
						var output bytes.Buffer
						var received []StagehandLog
						config := &StagehandClientLoggingConfig{Console: consoleCase.value, Format: format, Level: level}
						if callback {
							config.OnLog = func(log StagehandLog) { received = append(received, log) }
						}
						client, err := newStagehandWithClient(CreateOptions{Logging: config}, rpc, &output)
						if err != nil {
							t.Fatal(err)
						}
						defer client.Close(context.Background())
						logs := testStagehandLogs()
						before, err := json.Marshal(logs)
						if err != nil {
							t.Fatal(err)
						}
						for _, log := range logs {
							rpc.emit(log)
						}
						var wantReceived []StagehandLog
						if callback {
							wantReceived = append(wantReceived, testStagehandLogs()[first:]...)
						}
						if !reflect.DeepEqual(received, wantReceived) {
							t.Fatalf("callback = %#v, want %#v", received, wantReceived)
						}
						after, err := json.Marshal(logs)
						if err != nil {
							t.Fatal(err)
						}
						if !bytes.Equal(before, after) {
							t.Fatal("notification data mutated")
						}
						lines := pretty[first:]
						if format == StagehandClientLogFormatJSON {
							lines = jsonLines[first:]
						}
						want := ""
						if consoleCase.name != "false" && len(lines) > 0 {
							want = strings.Join(lines, "\n") + "\n"
						}
						if output.String() != want {
							t.Fatalf("output = %q, want %q", output.String(), want)
						}
					})
				}
			}
		}
	}
}

func TestGoLoggingConsoleStaysLocalOnSerializedTransport(t *testing.T) {
	t.Parallel()
	enabled, disabled := true, false
	for _, consoleOutput := range []*bool{nil, &enabled, &disabled} {
		t.Run(fmt.Sprint(consoleOutput), func(t *testing.T) {
			transport := newQueueRPCTransport()
			transport.sendHook = func(message json.RawMessage) {
				var request struct {
					ID     uint64
					Method string
				}
				if err := json.Unmarshal(message, &request); err != nil {
					t.Fatal(err)
				}
				result := `{"closed":true}`
				if request.Method == "stagehand.init" {
					result = `{"initialized":true,"pages":[]}`
				}
				transport.receiveJSON(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":%s}`, request.ID, result))
			}
			rpc := newTestRPCClient(t, transport)
			rpc.browserWebSocketURL = "ws://127.0.0.1:9222/devtools/browser/test"
			var output bytes.Buffer
			received := make(chan StagehandLog, 1)
			client, err := newStagehandWithClient(CreateOptions{Logging: &StagehandClientLoggingConfig{
				Console: consoleOutput, Level: StagehandClientLogLevelWarn, Format: StagehandClientLogFormatJSON,
				OnLog: func(log StagehandLog) { received <- log },
			}}, rpc, &output)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close(context.Background())
			var init struct {
				Method string
				Params map[string]json.RawMessage
			}
			if err := json.Unmarshal(receiveSentRPC(t, transport), &init); err != nil {
				t.Fatal(err)
			}
			if init.Method != "stagehand.init" || string(init.Params["log_level"]) != `"warn"` {
				t.Fatalf("init = %#v", init)
			}
			for _, key := range []string{"logging", "console", "format", "onLog", "on_log"} {
				if _, ok := init.Params[key]; ok {
					t.Fatalf("SDK-only %s leaked into init", key)
				}
			}
			transport.receiveJSON(`{"jsonrpc":"2.0","method":"stagehand.log","params":{"level":"warn","message":"Selector fallback","data":{}}}`)
			select {
			case log := <-received:
				if !reflect.DeepEqual(log, testStagehandLogs()[2]) {
					t.Fatalf("callback = %#v", log)
				}
			case <-time.After(time.Second):
				t.Fatal("timed out waiting for logging notification")
			}
			want := ""
			if consoleOutput == nil || *consoleOutput {
				want = "{\"level\":\"warn\",\"message\":\"Selector fallback\",\"data\":{}}\n"
			}
			if output.String() != want {
				t.Fatalf("output = %q, want %q", output.String(), want)
			}
		})
	}
}
