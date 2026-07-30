package stagehand

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestGeneratedCatalogMatchesReachableProtocolDefinitions(t *testing.T) {
	t.Parallel()

	data, err := os.ReadFile("../protocol/stagehand.v4.json")
	if err != nil {
		t.Fatal(err)
	}
	var protocol map[string]any
	if err := json.Unmarshal(data, &protocol); err != nil {
		t.Fatal(err)
	}
	definitions := protocol["$defs"].(map[string]any)
	properties := protocol["properties"].(map[string]any)

	reachable := make(map[string]struct{})
	var visit func(any)
	visit = func(value any) {
		switch value := value.(type) {
		case []any:
			for _, entry := range value {
				visit(entry)
			}
		case map[string]any:
			if ref, ok := value["$ref"].(string); ok && strings.HasPrefix(ref, "#/$defs/") {
				name := strings.TrimPrefix(ref, "#/$defs/")
				if _, seen := reachable[name]; !seen {
					reachable[name] = struct{}{}
					visit(definitions[name])
				}
			}
			for key, entry := range value {
				if key != "$ref" {
					visit(entry)
				}
			}
		}
	}
	visit(properties["methods"])
	visit(properties["notifications"])

	catalog := reflect.TypeOf(generatedModelCatalog{})
	generated := make(map[string]struct{}, catalog.NumField())
	for index := range catalog.NumField() {
		name := strings.Split(catalog.Field(index).Tag.Get("json"), ",")[0]
		generated[name] = struct{}{}
	}

	for name := range reachable {
		if _, ok := generated[name]; !ok {
			t.Errorf("reachable protocol definition %q has no Go type", name)
		}
	}
	for name := range generated {
		if _, ok := reachable[name]; !ok {
			t.Errorf("generated catalog contains unreachable definition %q", name)
		}
	}
}

func TestGeneratedModelsContainNoEmptyInterfaceFallbacks(t *testing.T) {
	t.Parallel()

	data, err := os.ReadFile("models.gen.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, unsupported := range []string{"interface{}", "map[string]interface{}"} {
		if bytes.Contains(data, []byte(unsupported)) {
			t.Errorf("generated models contain unsupported fallback %q", unsupported)
		}
	}
}

func TestTelemetryOmitZeroAndExplicitDefault(t *testing.T) {
	t.Parallel()

	defaultTelemetry := TelemetryConfig{
		Traces: TelemetryTraces{
			Endpoint: "https://example.com/v1/traces",
			Headers:  TelemetryTracesHeaders{},
		},
	}
	for _, test := range []struct {
		name  string
		value any
		want  string
	}{
		{
			name:  "stagehand init omitted",
			value: StagehandInitParams{},
			want:  `{}`,
		},
		{
			name:  "stagehand init explicit default",
			value: StagehandInitParams{Telemetry: defaultTelemetry},
			want:  `{"telemetry":{"traces":{"endpoint":"https://example.com/v1/traces"}}}`,
		},
		{
			name: "runtime configure required identity",
			value: RuntimeConfigureParams{
				CDPURL:          "ws://runtime.test",
				ClientInfo:      ImplementationInfo{Name: "stagehand-sdk-go", Version: "4.0.0"},
				ProtocolVersion: 1,
			},
			want: `{
				"cdp_url":"ws://runtime.test",
				"client_info":{"name":"stagehand-sdk-go","version":"4.0.0"},
				"protocol_version":1
			}`,
		},
		{
			name: "runtime configure explicit default",
			value: RuntimeConfigureParams{
				CDPURL:          "ws://runtime.test",
				ClientInfo:      ImplementationInfo{Name: "stagehand-sdk-go", Version: "4.0.0"},
				ProtocolVersion: 1,
				Telemetry:       defaultTelemetry,
			},
			want: `{
				"cdp_url":"ws://runtime.test",
				"client_info":{"name":"stagehand-sdk-go","version":"4.0.0"},
				"protocol_version":1,
				"telemetry":{"traces":{"endpoint":"https://example.com/v1/traces"}}
			}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, err := json.Marshal(test.value)
			if err != nil {
				t.Fatal(err)
			}
			if !jsonEqual([]byte(test.want), data) {
				t.Fatalf("telemetry JSON mismatch:\nwant %s\n got %s", test.want, data)
			}
		})
	}
}

func TestObjectUnionsRoundTrip(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value any
		new   func() any
		check func(*testing.T, any)
	}{
		{
			name:  "act instruction",
			value: ActInstruction("click the link"),
			new:   func() any { return new(ActInput) },
			check: func(t *testing.T, value any) {
				if instruction, ok := value.(*ActInput).AsInstruction(); !ok || instruction != "click the link" {
					t.Fatal("decoded the wrong act input variant")
				}
			},
		},
		{
			name: "observed action",
			value: ObservedAction(Action{
				Selector:    "xpath=/html/body/button",
				Description: "Submit button",
			}),
			new: func() any { return new(ActInput) },
			check: func(t *testing.T, value any) {
				if action, ok := value.(*ActInput).AsAction(); !ok || action.Description != "Submit button" {
					t.Fatal("decoded the wrong act input variant")
				}
			},
		},
		{
			name:  "known model",
			value: KnownModel(KnownModelConfig{ModelName: ModelName("openai/gpt-5.6")}),
			new:   func() any { return new(ModelConfig) },
			check: func(t *testing.T, value any) {
				if _, ok := value.(*ModelConfig).AsKnown(); !ok {
					t.Fatal("decoded the wrong model config variant")
				}
			},
		},
		{
			name:  "custom model",
			value: CustomModel(CustomModelConfig{BaseURL: "https://models.test/v1", ModelName: "custom"}),
			new:   func() any { return new(ModelConfig) },
			check: func(t *testing.T, value any) {
				if _, ok := value.(*ModelConfig).AsCustom(); !ok {
					t.Fatal("decoded the wrong model config variant")
				}
			},
		},
		{
			name:  "client init model",
			value: ClientModel(),
			new:   func() any { return new(StagehandInitModel) },
			check: func(t *testing.T, value any) {
				if _, ok := value.(*StagehandInitModel).AsClientModel(); !ok {
					t.Fatal("decoded the wrong init model variant")
				}
			},
		},
		{
			name:  "external proxy",
			value: ExternalProxy(ExternalProxyConfig{Server: "http://proxy.test"}),
			new:   func() any { return new(ProxyConfig) },
			check: func(t *testing.T, value any) {
				if _, ok := value.(*ProxyConfig).AsExternal(); !ok {
					t.Fatal("decoded the wrong proxy variant")
				}
			},
		},
		{
			name:  "described variable",
			value: DescribedVariable(DescribedVariableValue{Value: BoolVariable(true)}),
			new:   func() any { return new(VariableValue) },
			check: func(t *testing.T, value any) {
				if _, ok := value.(*VariableValue).AsDescribed(); !ok {
					t.Fatal("decoded the wrong variable variant")
				}
			},
		},
		{
			name:  "regex cookie",
			value: RegexCookie(CookieRegex{Source: "^session"}),
			new:   func() any { return new(CookieFilter) },
			check: func(t *testing.T, value any) {
				if _, ok := value.(*CookieFilter).AsRegex(); !ok {
					t.Fatal("decoded the wrong cookie filter variant")
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data, err := json.Marshal(test.value)
			if err != nil {
				t.Fatal(err)
			}
			decoded := test.new()
			if err := json.Unmarshal(data, decoded); err != nil {
				t.Fatal(err)
			}
			test.check(t, decoded)
		})
	}
}

func TestClosedObjectUnionVariantsRejectUnknownFields(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		new   func() any
	}{
		{
			name:  "action",
			input: `{"selector":"button","description":"Submit","unexpected":true}`,
			new:   func() any { return new(ActInput) },
		},
		{
			name:  "known model",
			input: `{"model_name":"openai/gpt-5.6","unexpected":true}`,
			new:   func() any { return new(ModelConfig) },
		},
		{
			name:  "custom model",
			input: `{"model_name":"private/model","base_url":"https://models.test/v1","unexpected":true}`,
			new:   func() any { return new(ModelConfig) },
		},
		{
			name:  "client init model",
			input: `{"source":"client","unexpected":true}`,
			new:   func() any { return new(StagehandInitModel) },
		},
		{
			name:  "browserbase proxy",
			input: `{"type":"browserbase","unexpected":true}`,
			new:   func() any { return new(ProxyConfig) },
		},
		{
			name:  "external proxy",
			input: `{"type":"external","server":"http://proxy.test","unexpected":true}`,
			new:   func() any { return new(ProxyConfig) },
		},
		{
			name:  "described variable",
			input: `{"value":true,"unexpected":true}`,
			new:   func() any { return new(VariableValue) },
		},
		{
			name:  "cookie regex",
			input: `{"source":"^session","unexpected":true}`,
			new:   func() any { return new(CookieFilter) },
		},
		{
			name:  "caching options",
			input: `{"threshold":1,"unexpected":true}`,
			new:   func() any { return new(Caching) },
		},
		{
			name:  "LLM text content",
			input: `{"type":"text","text":"done","unexpected":true}`,
			new:   func() any { return new(LLMMessageContentBlock) },
		},
		{
			name:  "LLM image content",
			input: `{"type":"image","data":"aW1hZ2U=","mime_type":"image/png","unexpected":true}`,
			new:   func() any { return new(LLMMessageContentBlock) },
		},
		{
			name:  "LLM tool use content",
			input: `{"type":"tool_use","id":"tool-1","name":"search","input":{},"unexpected":true}`,
			new:   func() any { return new(LLMMessageContentBlock) },
		},
		{
			name:  "LLM tool result content",
			input: `{"type":"tool_result","tool_use_id":"tool-1","content":[],"unexpected":true}`,
			new:   func() any { return new(LLMMessageContentBlock) },
		},
		{
			name:  "LLM tool result text block",
			input: `{"type":"text","text":"done","unexpected":true}`,
			new:   func() any { return new(LLMToolResultContentBlock) },
		},
		{
			name:  "LLM message generate params",
			input: `{"messages":[],"unexpected":true}`,
			new:   func() any { return new(LLMGenerateParams) },
		},
		{
			name: "LLM structured generate params",
			input: `{
				"messages":[],
				"response_format":{"type":"json_schema","name":"answer","schema":{"type":"object"}},
				"unexpected":true
			}`,
			new: func() any { return new(LLMGenerateParams) },
		},
		{
			name: "LLM message generate result",
			input: `{
				"role":"assistant",
				"content":{"type":"text","text":"done"},
				"output_format":"text",
				"unexpected":true
			}`,
			new: func() any { return new(LLMGenerateResult) },
		},
		{
			name: "LLM structured generate result",
			input: `{
				"role":"assistant",
				"content":{"type":"text","text":"done"},
				"output_format":"json_schema",
				"structured_content":{"ok":true},
				"unexpected":true
			}`,
			new: func() any { return new(LLMGenerateResult) },
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := json.Unmarshal([]byte(test.input), test.new())
			if err == nil || !strings.Contains(err.Error(), `unknown field "unexpected"`) {
				t.Fatalf("Unmarshal() error = %v, want unknown-field error", err)
			}
		})
	}
}

func TestBrowserbaseProxiesSupportsBooleanAndList(t *testing.T) {
	t.Parallel()

	for _, input := range []string{
		`true`,
		`[{"type":"browserbase"},{"type":"external","server":"http://proxy.test"}]`,
	} {
		var value BrowserbaseProxies
		if err := json.Unmarshal([]byte(input), &value); err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if !jsonEqual([]byte(input), data) {
			t.Fatalf("round trip mismatch:\nwant %s\n got %s", input, data)
		}
	}
}

func TestStringOrArrayFieldsNormalizeToArrays(t *testing.T) {
	t.Parallel()

	for _, input := range []string{`"one"`, `["one","two"]`} {
		var values StringList
		if err := json.Unmarshal([]byte(input), &values); err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		if firstJSONByte(data) != '[' {
			t.Fatalf("StringList did not normalize to an array: %s", data)
		}
	}
}

func TestLLMContentAndGenerateUnions(t *testing.T) {
	t.Parallel()

	contentJSON := []byte(`{"type":"text","text":"hello"}`)
	var content LLMMessageContent
	if err := json.Unmarshal(contentJSON, &content); err != nil {
		t.Fatal(err)
	}
	if len(content) != 1 {
		t.Fatalf("expected one content block, got %d", len(content))
	}
	if text, ok := content[0].AsText(); !ok || text.Text != "hello" {
		t.Fatal("single content block decoded to the wrong variant")
	}

	params := StructuredGenerateParams(LLMStructuredGenerateParams{
		Messages: []LLMMessage{{Role: LLMRoleUser, Content: content}},
		ResponseFormat: LLMJSONSchemaResponseFormat{
			Name:   "answer",
			Schema: json.RawMessage(`{"type":"object"}`),
		},
	})
	data, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	var decoded LLMGenerateParams
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if _, ok := decoded.AsStructured(); !ok {
		t.Fatal("decoded the wrong LLM params variant")
	}

	resultJSON := []byte(`{
		"role":"assistant",
		"content":{"type":"text","text":"done"},
		"output_format":"json_schema",
		"structured_content":{"ok":true}
	}`)
	var result LLMGenerateResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatal(err)
	}
	structured, ok := result.AsStructured()
	if !ok {
		t.Fatal("decoded the wrong LLM result variant")
	}
	if string(structured.StructuredContent) != `{"ok":true}` {
		t.Fatal("did not retain structured content")
	}
	roundTrip, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	canonicalResult := []byte(`{
		"role":"assistant",
		"content":[{"type":"text","text":"done"}],
		"output_format":"json_schema",
		"structured_content":{"ok":true}
	}`)
	if !jsonEqual(canonicalResult, roundTrip) {
		t.Fatalf("LLM result round trip mismatch:\nwant %s\n got %s", canonicalResult, roundTrip)
	}

	unknownProviderField := []byte(`{
		"role":"assistant",
		"content":{"type":"text","text":"done"},
		"output_format":"json_schema",
		"structured_content":{"ok":true},
		"provider_request_id":"req_123"
	}`)
	if err := json.Unmarshal(unknownProviderField, &result); err == nil {
		t.Fatal("expected unknown provider field to fail")
	}
}

func TestCachingVariantsAndBounds(t *testing.T) {
	t.Parallel()

	for _, input := range []string{
		`true`,
		`false`,
		`{}`,
		`{"threshold":1}`,
		`{"threshold":9007199254740991}`,
	} {
		var value Caching
		if err := json.Unmarshal([]byte(input), &value); err != nil {
			t.Fatalf("Unmarshal(%s) error = %v", input, err)
		}
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("Marshal(%s) error = %v", input, err)
		}
		if !jsonEqual([]byte(input), data) {
			t.Fatalf("caching round trip mismatch:\nwant %s\n got %s", input, data)
		}
	}

	for _, input := range []string{
		`null`,
		`{"threshold":0}`,
		`{"threshold":-1}`,
		`{"threshold":9007199254740992}`,
	} {
		var value Caching
		if err := json.Unmarshal([]byte(input), &value); err == nil {
			t.Fatalf("expected %s to fail", input)
		}
	}

	for _, threshold := range []int{0, -1, 9007199254740992} {
		if _, err := json.Marshal(CacheWithThreshold(threshold)); err == nil {
			t.Fatalf("expected threshold %d to fail marshaling", threshold)
		}
	}
}

func TestUnknownDiscriminatorFails(t *testing.T) {
	t.Parallel()

	var proxy ProxyConfig
	if err := json.Unmarshal([]byte(`{"type":"unknown"}`), &proxy); err == nil {
		t.Fatal("expected unknown proxy discriminator to fail")
	}
	var block LLMMessageContentBlock
	if err := json.Unmarshal([]byte(`{"type":"audio"}`), &block); err == nil {
		t.Fatal("expected unknown content discriminator to fail")
	}
}

func TestUnionNullFails(t *testing.T) {
	t.Parallel()

	for name, value := range map[string]any{
		"browserbase proxies": new(BrowserbaseProxies),
		"caching":             new(Caching),
		"cookie filter":       new(CookieFilter),
		"generate params":     new(LLMGenerateParams),
		"scroll percent":      new(ScrollPercent),
		"string list":         new(StringList),
		"variable primitive":  new(VariablePrimitive),
	} {
		t.Run(name, func(t *testing.T) {
			if err := json.Unmarshal([]byte("null"), value); err == nil {
				t.Fatal("expected JSON null to fail")
			}
		})
	}
}

func TestUnsetUnionFailsToMarshal(t *testing.T) {
	t.Parallel()

	for _, value := range []any{
		Caching{},
		ModelConfig{},
		ProxyConfig{},
		VariableValue{},
		LLMGenerateParams{},
		LLMGenerateResult{},
	} {
		if _, err := json.Marshal(value); err == nil {
			t.Fatalf("expected unset %T to fail", value)
		}
	}
}

func jsonEqual(left, right []byte) bool {
	var leftValue any
	var rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}
