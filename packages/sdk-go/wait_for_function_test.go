package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"testing"
	"time"
)

func TestWaitForFunctionPreservesJSON(t *testing.T) {
	t.Parallel()
	for _, value := range []string{
		`true`, `"ready"`, `42`, `9007199254740993`, `{"camelCase":{"snake_case":[true,null,3]}}`, `[1,"ready"]`, `null`,
	} {
		t.Run(value, func(t *testing.T) {
			rpc := &recordingProtocolClient{responses: map[string]any{
				"page.wait_for_function": PageWaitForFunctionResult{Value: json.RawMessage(value)},
			}}
			page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
			result, err := page.WaitForFunction(context.Background(), "window.app", nil)
			if err != nil {
				t.Fatal(err)
			}
			if string(result) != value {
				t.Fatalf("result = %s, want %s", result, value)
			}
			if len(rpc.calls) != 1 || rpc.calls[0].method != "page.wait_for_function" {
				t.Fatalf("RPC calls = %#v", rpc.calls)
			}
			encoded, err := json.Marshal(rpc.calls[0].params)
			if err != nil {
				t.Fatal(err)
			}
			assertRPCJSON(t, encoded, `{"page_id":"page-1","expression":"window.app"}`)
		})
	}
}

func TestWaitForFunctionOptions(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		options *PageWaitForFunctionOptions
		want    string
	}{
		{"omitted", nil, `{"page_id":"page-1","expression":"true"}`},
		{"empty", &PageWaitForFunctionOptions{}, `{"page_id":"page-1","expression":"true","options":{}}`},
		{"animation frames", &PageWaitForFunctionOptions{Polling: new(AnimationFramePolling())}, `{"page_id":"page-1","expression":"true","options":{"polling":"raf"}}`},
		{"interval and unlimited", &PageWaitForFunctionOptions{Polling: new(IntervalPolling(12.5)), Timeout: new(0)}, `{"page_id":"page-1","expression":"true","options":{"polling":12.5,"timeout":0}}`},
		{"timeout", &PageWaitForFunctionOptions{Timeout: new(45_000)}, `{"page_id":"page-1","expression":"true","options":{"timeout":45000}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			rpc := &recordingProtocolClient{responses: map[string]any{
				"page.wait_for_function": PageWaitForFunctionResult{Value: json.RawMessage(`true`)},
			}}
			page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
			if _, err := page.WaitForFunction(context.Background(), "true", test.options); err != nil {
				t.Fatal(err)
			}
			encoded, err := marshalValidatedJSON(rpc.calls[0].params)
			if err != nil {
				t.Fatal(err)
			}
			assertRPCJSON(t, encoded, test.want)
		})
	}
}

func TestWaitForFunctionPreservesErrors(t *testing.T) {
	t.Parallel()
	want := errors.New("predicate failed")
	rpc := &recordingProtocolClient{callErrors: map[string]error{"page.wait_for_function": want}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	result, err := page.WaitForFunction(context.Background(), "predicate()", nil)
	if !errors.Is(err, want) || result != nil {
		t.Fatalf("WaitForFunction = %s, %v; want nil, %v", result, err, want)
	}
}

func TestWaitForFunctionResponseDeadline(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		params  string
		want    time.Duration
		bounded bool
	}{
		{`{}`, 40 * time.Second, true},
		{`{"options":{}}`, 40 * time.Second, true},
		{`{"options":{"timeout":250}}`, 10*time.Second + 250*time.Millisecond, true},
		{`{"options":{"timeout":45000}}`, 55 * time.Second, true},
		{`{"options":{"timeout":0}}`, 0, false},
	} {
		got, bounded := rpcResponseTimeout("page.wait_for_function", json.RawMessage(test.params))
		if got != test.want || bounded != test.bounded {
			t.Errorf("%s: got %v, %t; want %v, %t", test.params, got, bounded, test.want, test.bounded)
		}
	}
}

func TestFunctionPolling(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		value    FunctionPolling
		wire     string
		interval float64
	}{
		{AnimationFramePolling(), `"raf"`, 0},
		{IntervalPolling(12.5), `12.5`, 12.5},
		{IntervalPolling(2_147_483_647), `2147483647`, 2_147_483_647},
	} {
		encoded, err := json.Marshal(test.value)
		if err != nil || string(encoded) != test.wire {
			t.Fatalf("MarshalJSON = %s, %v; want %s", encoded, err, test.wire)
		}
		var decoded FunctionPolling
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded != test.value {
			t.Fatalf("round trip = %#v, want %#v", decoded, test.value)
		}
		if decoded.IsAnimationFrame() != (test.interval == 0) {
			t.Fatal("wrong animation-frame variant")
		}
		if interval, ok := decoded.AsInterval(); interval != test.interval || ok != (test.interval > 0) {
			t.Fatalf("interval = %v, %t; want %v, %t", interval, ok, test.interval, test.interval > 0)
		}
	}
}

func TestFunctionPollingRejectsInvalidValues(t *testing.T) {
	t.Parallel()
	for _, interval := range []float64{0, -1, math.NaN(), math.Inf(1), math.Inf(-1), 2_147_483_648} {
		if _, err := json.Marshal(IntervalPolling(interval)); err == nil {
			t.Errorf("accepted interval %v", interval)
		}
	}
	if _, err := json.Marshal(FunctionPolling{}); err == nil {
		t.Error("accepted unset polling")
	}
	for _, wire := range []string{`null`, `true`, `[]`, `{}`, `"timer"`, `0`, `-1`, `2147483648`, `1e100`} {
		value := AnimationFramePolling()
		if err := json.Unmarshal([]byte(wire), &value); err == nil {
			t.Errorf("accepted %s", wire)
		}
		if !value.IsAnimationFrame() {
			t.Errorf("invalid %s changed existing value", wire)
		}
	}
	var value *FunctionPolling
	if err := value.UnmarshalJSON([]byte(`"raf"`)); err == nil {
		t.Error("accepted nil receiver")
	}
}
