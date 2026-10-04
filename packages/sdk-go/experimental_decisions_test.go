package stagehand

import (
	"context"
	"encoding/json"
	"reflect"
	"sync"
	"testing"
)

func TestExperimentalDecisionsAccessorReturnsCachedInstance(t *testing.T) {
	t.Parallel()

	client := &Stagehand{initialized: true, rpc: &recordingProtocolClient{}}
	instances := make([]*ExperimentalDecisions, 8)
	var wait sync.WaitGroup
	for index := range instances {
		wait.Go(func() {
			instances[index] = client.ExperimentalDecisions()
		})
	}
	wait.Wait()
	want := client.ExperimentalDecisions()
	if want == nil {
		t.Fatal("ExperimentalDecisions() = nil")
	}
	for index, got := range instances {
		if got != want {
			t.Fatalf("ExperimentalDecisions() call %d = %p, want cached %p", index, got, want)
		}
	}
}

func TestExperimentalDecisionsOperationsMatchStagehandOperations(t *testing.T) {
	t.Parallel()

	type pageInfo struct {
		Heading string `json:"heading"`
	}
	page := &Page{ref: PageRef{PageID: "page-1"}}
	actOptions := func() *StagehandClientActOptions {
		return &StagehandClientActOptions{
			Page:           page,
			Timeout:        testPointer(30000.0),
			Variables:      Variables{"name": PrimitiveVariable(StringVariable("Ada"))},
			Locator:        page.Locator("main"),
			IgnoreLocators: []*PageLocator{mustNth(t, page.Locator("nav"), 1)},
		}
	}
	observeOptions := func() *StagehandClientObserveOptions {
		return &StagehandClientObserveOptions{
			Page:           page,
			Timeout:        testPointer(30000.0),
			Locator:        page.Locator("main"),
			IgnoreLocators: []*PageLocator{mustNth(t, page.Locator("nav"), 1)},
		}
	}
	extractOptions := func() *StagehandClientExtractOptions {
		return &StagehandClientExtractOptions{
			Page:       page,
			Screenshot: testPointer(true),
			Locator:    page.Locator("main"),
		}
	}
	observeInstruction := "find submit"
	actResponse := ActResult{
		Data: ActResultData{
			Success:           true,
			Message:           "clicked",
			ActionDescription: "click submit",
			Actions:           []Action{},
		},
		Metadata: StagehandResultMetadata{
			ActionID: testPointer("action-act"),
			Cache:    CacheMetadata{Status: CacheStatusMISS},
		},
	}
	observeResponse := ObserveResult{
		Data: []Action{{Description: "Submit button", Selector: "#submit"}},
		Metadata: StagehandResultMetadata{
			ActionID: testPointer("action-observe"),
			Cache:    CacheMetadata{Status: CacheStatusHIT},
		},
	}
	extractResponse := ExtractResult{
		Data: json.RawMessage(`{"heading":"Example"}`),
		Metadata: StagehandResultMetadata{
			ActionID: testPointer("action-extract"),
			Cache:    CacheMetadata{Status: CacheStatusHIT},
		},
	}
	tests := []struct {
		name            string
		method          string
		decisionsMethod string
		response        any
		plain           func(*Stagehand) (any, error)
		decisions       func(*Stagehand) (any, error)
	}{
		{
			name:            "act",
			method:          "stagehand.act",
			decisionsMethod: "stagehand.experimental_decisions_act",
			response:        actResponse,
			plain: func(client *Stagehand) (any, error) {
				return client.Act(context.Background(), ActInstruction("click submit"), actOptions())
			},
			decisions: func(client *Stagehand) (any, error) {
				return client.ExperimentalDecisions().Act(
					context.Background(),
					ActInstruction("click submit"),
					actOptions(),
				)
			},
		},
		{
			name:            "act without options",
			method:          "stagehand.act",
			decisionsMethod: "stagehand.experimental_decisions_act",
			response:        actResponse,
			plain: func(client *Stagehand) (any, error) {
				return client.Act(context.Background(), ActInstruction("click submit"), nil)
			},
			decisions: func(client *Stagehand) (any, error) {
				return client.ExperimentalDecisions().Act(
					context.Background(),
					ActInstruction("click submit"),
					nil,
				)
			},
		},
		{
			name:            "observe",
			method:          "stagehand.observe",
			decisionsMethod: "stagehand.experimental_decisions_observe",
			response:        observeResponse,
			plain: func(client *Stagehand) (any, error) {
				return client.Observe(context.Background(), &observeInstruction, observeOptions())
			},
			decisions: func(client *Stagehand) (any, error) {
				return client.ExperimentalDecisions().Observe(
					context.Background(),
					&observeInstruction,
					observeOptions(),
				)
			},
		},
		{
			name:            "observe without instruction or options",
			method:          "stagehand.observe",
			decisionsMethod: "stagehand.experimental_decisions_observe",
			response:        observeResponse,
			plain: func(client *Stagehand) (any, error) {
				return client.Observe(context.Background(), nil, nil)
			},
			decisions: func(client *Stagehand) (any, error) {
				return client.ExperimentalDecisions().Observe(context.Background(), nil, nil)
			},
		},
		{
			name:            "extract",
			method:          "stagehand.extract",
			decisionsMethod: "stagehand.experimental_decisions_extract",
			response:        extractResponse,
			plain: func(client *Stagehand) (any, error) {
				return Extract[pageInfo](
					context.Background(),
					client,
					"extract heading",
					extractOptions(),
				)
			},
			decisions: func(client *Stagehand) (any, error) {
				return ExperimentalDecisionsExtract[pageInfo](
					context.Background(),
					client.ExperimentalDecisions(),
					"extract heading",
					extractOptions(),
				)
			},
		},
		{
			name:            "extract without options",
			method:          "stagehand.extract",
			decisionsMethod: "stagehand.experimental_decisions_extract",
			response:        extractResponse,
			plain: func(client *Stagehand) (any, error) {
				return Extract[pageInfo](context.Background(), client, "extract heading", nil)
			},
			decisions: func(client *Stagehand) (any, error) {
				return ExperimentalDecisionsExtract[pageInfo](
					context.Background(),
					client.ExperimentalDecisions(),
					"extract heading",
					nil,
				)
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rpc := &recordingProtocolClient{responses: map[string]any{
				"stagehand.init":      StagehandInitResult{Initialized: true},
				"context.active_page": PageRef{PageID: "page-1"},
				test.method:           test.response,
				test.decisionsMethod:  test.response,
			}}
			client, err := newStagehandWithClient(CreateOptions{}, rpc)
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			rpc.calls = nil

			want, err := test.plain(client)
			if err != nil {
				t.Fatalf("plain %s error = %v", test.name, err)
			}
			plainCalls := operationCalls(rpc.calls)
			rpc.calls = nil
			got, err := test.decisions(client)
			if err != nil {
				t.Fatalf("decisions %s error = %v", test.name, err)
			}
			decisionsCalls := operationCalls(rpc.calls)

			if !reflect.DeepEqual(got, want) {
				t.Fatalf("decisions %s result = %#v, want %#v", test.name, got, want)
			}
			if len(plainCalls) != 1 || plainCalls[0].method != test.method {
				t.Fatalf("plain %s RPC calls = %#v", test.name, plainCalls)
			}
			if len(decisionsCalls) != 1 || decisionsCalls[0].method != test.decisionsMethod {
				t.Fatalf("decisions %s RPC calls = %#v", test.name, decisionsCalls)
			}
			if !reflect.DeepEqual(decisionsCalls[0].params, plainCalls[0].params) {
				t.Fatalf(
					"decisions %s params = %#v, want plain params %#v",
					test.name,
					decisionsCalls[0].params,
					plainCalls[0].params,
				)
			}
		})
	}
}

func operationCalls(calls []recordedCall) []recordedCall {
	var operations []recordedCall
	for _, call := range calls {
		if call.method != "context.active_page" {
			operations = append(operations, call)
		}
	}
	return operations
}

func TestExperimentalDecisionsOperationsRequireInitializedClient(t *testing.T) {
	t.Parallel()

	client := &Stagehand{}
	if _, err := client.ExperimentalDecisions().Act(
		context.Background(),
		ActInstruction("click submit"),
		nil,
	); err != ErrNotInitialized {
		t.Fatalf("Act() error = %v, want %v", err, ErrNotInitialized)
	}
	if _, err := client.ExperimentalDecisions().Observe(context.Background(), nil, nil); err != ErrNotInitialized {
		t.Fatalf("Observe() error = %v, want %v", err, ErrNotInitialized)
	}
	if _, err := ExperimentalDecisionsExtract[map[string]any](
		context.Background(),
		client.ExperimentalDecisions(),
		"extract heading",
		nil,
	); err != ErrNotInitialized {
		t.Fatalf("ExperimentalDecisionsExtract() error = %v, want %v", err, ErrNotInitialized)
	}
	if _, err := ExperimentalDecisionsExtract[map[string]any](
		context.Background(),
		nil,
		"extract heading",
		nil,
	); err == nil || err.Error() != "stagehand: client is required" {
		t.Fatalf("ExperimentalDecisionsExtract(nil) error = %v", err)
	}
}

func TestCreatePassesExperimentalDecisionsToInitParams(t *testing.T) {
	t.Parallel()

	provider := ExperimentalDecisionsConfigProviderCloudflare
	decisions := &ExperimentalDecisionsConfig{
		Provider:  &provider,
		APIKey:    "decisions-key",
		Model:     testPointer("decisions-model"),
		APIURL:    testPointer("https://decisions.example"),
		AccountID: testPointer("account-1"),
	}
	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init": StagehandInitResult{Initialized: true},
	}}
	if _, err := newStagehandWithClient(CreateOptions{ExperimentalDecisions: decisions}, rpc); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	initParams, ok := rpc.calls[0].params.(StagehandInitParams)
	if !ok {
		t.Fatalf("stagehand.init params = %T", rpc.calls[0].params)
	}
	if !reflect.DeepEqual(initParams.ExperimentalDecisions, decisions) {
		t.Fatalf(
			"experimental decisions = %#v, want %#v",
			initParams.ExperimentalDecisions,
			decisions,
		)
	}
	encoded, err := json.Marshal(initParams)
	if err != nil {
		t.Fatalf("encode stagehand.init params: %v", err)
	}
	var wire struct {
		ExperimentalDecisions map[string]any `json:"experimental_decisions"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatalf("decode stagehand.init params: %v", err)
	}
	wantWire := map[string]any{
		"provider":   "cloudflare",
		"api_key":    "decisions-key",
		"model":      "decisions-model",
		"api_url":    "https://decisions.example",
		"account_id": "account-1",
	}
	if !reflect.DeepEqual(wire.ExperimentalDecisions, wantWire) {
		t.Fatalf("experimental_decisions wire = %#v, want %#v", wire.ExperimentalDecisions, wantWire)
	}

	omittedRPC := &recordingProtocolClient{responses: map[string]any{
		"stagehand.init": StagehandInitResult{Initialized: true},
	}}
	if _, err := newStagehandWithClient(CreateOptions{}, omittedRPC); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	omitted, ok := omittedRPC.calls[0].params.(StagehandInitParams)
	if !ok || omitted.ExperimentalDecisions != nil {
		t.Fatalf("stagehand.init params without decisions = %#v", omittedRPC.calls[0].params)
	}
}
