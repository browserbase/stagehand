package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
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
	client := newStagehandWithClient(StagehandClientInitParams{}, rpc)
	var output bytes.Buffer
	client.logWriter = &output

	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("Init() error = %v", err)
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
	client := newStagehandWithClient(StagehandClientInitParams{
		Logging: &StagehandClientLoggingConfig{
			OnLog: func(log StagehandLog) {
				firstSessionLogs = append(firstSessionLogs, log)
			},
		},
	}, rpc)
	var firstSessionOutput bytes.Buffer
	client.logWriter = &firstSessionOutput

	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("first Init() error = %v", err)
	}
	queuedHandler := rpc.notificationHandler
	if queuedHandler == nil {
		t.Fatal("first Init() did not register a logging notification listener")
	}
	if err := client.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	var secondSessionLogs []StagehandLog
	client.initParams.Logging = &StagehandClientLoggingConfig{
		OnLog: func(log StagehandLog) {
			secondSessionLogs = append(secondSessionLogs, log)
		},
	}
	var secondSessionOutput bytes.Buffer
	client.logWriter = &secondSessionOutput
	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("second Init() error = %v", err)
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
	if secondSessionOutput.Len() != 0 || len(secondSessionLogs) != 0 {
		t.Fatalf(
			"queued log leaked into new session: output = %q, callback logs = %#v",
			secondSessionOutput.String(),
			secondSessionLogs,
		)
	}

	rpc.emit(log)
	if !strings.Contains(secondSessionOutput.String(), log.Message) {
		t.Fatalf(
			"active session output = %q, want message %q",
			secondSessionOutput.String(),
			log.Message,
		)
	}
	if !reflect.DeepEqual(secondSessionLogs, []StagehandLog{log}) {
		t.Fatalf(
			"active session callback logs = %#v, want %#v",
			secondSessionLogs,
			[]StagehandLog{log},
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
			client := newStagehandWithClient(StagehandClientInitParams{
				Logging: &StagehandClientLoggingConfig{Level: test.level},
			}, rpc)
			var output bytes.Buffer
			client.logWriter = &output
			if err := client.Init(context.Background()); err != nil {
				t.Fatalf("Init() error = %v", err)
			}
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
	client := newStagehandWithClient(StagehandClientInitParams{
		Logging: &StagehandClientLoggingConfig{
			Level:  StagehandClientLogLevelDebug,
			Format: StagehandClientLogFormatJSON,
			OnLog: func(log StagehandLog) {
				received = append(received, log)
			},
		},
	}, rpc)
	var output bytes.Buffer
	client.logWriter = &output
	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
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

	rpc := &loggingProtocolClient{}
	client := newStagehandWithClient(StagehandClientInitParams{
		Logging: &StagehandClientLoggingConfig{
			OnLog: func(StagehandLog) { panic("callback exploded") },
		},
	}, rpc)
	var output bytes.Buffer
	client.logWriter = &output
	if err := client.Init(context.Background()); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	rpc.emit(testStagehandLogs()[1])
	if !strings.Contains(
		output.String(),
		"[stagehand] ERROR onLog callback failed: callback exploded\n",
	) {
		t.Fatalf("callback panic output = %q", output.String())
	}
}

func TestGoLoggingRejectsInvalidConfiguration(t *testing.T) {
	t.Parallel()

	tests := []StagehandClientLoggingConfig{
		{Level: "trace"},
		{Format: "xml"},
	}
	for _, logging := range tests {
		client := newStagehandWithClient(
			StagehandClientInitParams{Logging: &logging},
			&loggingProtocolClient{},
		)
		err := client.Init(context.Background())
		if err == nil || !strings.Contains(err.Error(), "invalid logging") {
			t.Fatalf("Init() error = %v, want invalid logging error", err)
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
