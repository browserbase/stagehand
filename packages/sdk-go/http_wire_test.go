package stagehand

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestHTTPTransportWireFixtures(t *testing.T) {
	data, err := os.ReadFile("../protocol/tests/fixtures/http-transport-wire.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Requests []struct {
			Name string
			Wire struct{ Params json.RawMessage }
		}
		Results []struct {
			Name string
			Wire json.RawMessage
		}
		Cancel struct{ Params json.RawMessage }
		Errors []struct {
			Error struct{ Data json.RawMessage }
		}
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures.Requests {
		t.Run(fixture.Name, func(t *testing.T) {
			assertHTTPWireRoundTrip(t, fixture.Wire.Params, new(HTTPRequestParams))
		})
	}
	for _, fixture := range fixtures.Results {
		t.Run(fixture.Name, func(t *testing.T) {
			assertHTTPWireRoundTrip(t, fixture.Wire, new(HTTPRequestResult))
		})
	}
	assertHTTPWireRoundTrip(t, fixtures.Cancel.Params, new(HTTPCancelParams))
	for _, fixture := range fixtures.Errors {
		assertHTTPWireRoundTrip(t, fixture.Error.Data, new(HTTPRequestErrorData))
	}
}

func TestHTTPWireUnionsRoundTrip(t *testing.T) {
	tests := []struct {
		name, wire string
		value      any
	}{
		{"provider", `{"source":"http","route":"provider","configuration_id":"model-1","model_name":"openai/gpt-5"}`, new(HTTPModelReference)},
		{"automatic gateway", `{"source":"http","route":"gateway","configuration_id":"gateway-1"}`, new(HTTPModelReference)},
		{"explicit gateway", `{"source":"http","route":"gateway","configuration_id":"gateway-1","model_name":"openai/gpt-5"}`, new(HTTPModelReference)},
		{"client callback", `{"source":"client"}`, new(HTTPInitModelReference)},
		{"HTTP init model", `{"source":"http","route":"gateway","configuration_id":"gateway-1"}`, new(HTTPInitModelReference)},
		{"legacy init", `{"protocol_version":"2.1.0","client_info":{"name":"test","version":"1"},"model":{"source":"client"}}`, new(StagehandInitWireParams)},
		{"HTTP init", `{"protocol_version":"2.1.0","client_info":{"name":"test","version":"1"},"connections":{"gateway":{"configuration_id":"g"},"cache":{"configuration_id":"c"}},"model":{"source":"http","route":"gateway","configuration_id":"g"}}`, new(StagehandInitWireParams)},
		{"HTTP init callback", `{"protocol_version":"2.1.0","client_info":{"name":"test","version":"1"},"connections":{},"model":{"source":"client"}}`, new(StagehandInitWireParams)},
		{"legacy act", `{"page_id":"page-1","instruction":"click Continue","options":{"model":{"model_name":"openai/gpt-5","api_key":"test-key"}}}`, new(StagehandActWireParams)},
		{"HTTP act", `{"page_id":"page-1","instruction":"click Continue","scope_id":"call-1","options":{"model":{"source":"http","route":"provider","configuration_id":"m","model_name":"openai/gpt-5"}}}`, new(StagehandActWireParams)},
		{"legacy observe", `{"page_id":"page-1"}`, new(StagehandObserveWireParams)},
		{"HTTP observe", `{"page_id":"page-1","scope_id":"call-1"}`, new(StagehandObserveWireParams)},
		{"legacy extract", `{"page_id":"page-1","instruction":"read title","schema":{"type":"object"}}`, new(StagehandExtractWireParams)},
		{"HTTP extract", `{"page_id":"page-1","instruction":"read title","schema":{"type":"object"},"scope_id":"call-1"}`, new(StagehandExtractWireParams)},
		{"legacy batch", `{"callback_source":"async () => 1","options":{}}`, new(CallbackBatchWireParams)},
		{"HTTP batch", `{"callback_source":"async () => 1","scope_id":"batch-1","options":{"model_overrides":{"act":{"source":"http","route":"gateway","configuration_id":"g"},"observe":{"source":"http","route":"provider","configuration_id":"m","model_name":"openai/gpt-5"},"extract":{"source":"http","route":"gateway","configuration_id":"g"}}}}`, new(CallbackBatchWireParams)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertHTTPWireRoundTrip(t, []byte(test.wire), test.value)
		})
	}
}

func TestHTTPWireUnionsRejectMixedForms(t *testing.T) {
	tests := []struct {
		wire  string
		value any
	}{
		{`{"source":"http","route":"provider","configuration_id":"m","model_name":"openai/gpt-5","api_key":"test-key"}`, new(HTTPModelReference)},
		{`{"source":"other","route":"gateway","configuration_id":"g"}`, new(HTTPModelReference)},
		{`{"source":"http","route":"other","configuration_id":"g"}`, new(HTTPModelReference)},
		{`{"source":"client","configuration_id":"g"}`, new(HTTPInitModelReference)},
		{`{"source":"other"}`, new(HTTPInitModelReference)},
		{`{"connections":{},"api_key":"test-key"}`, new(StagehandInitWireParams)},
		{`{"scope_id":"s","options":{"model":{"model_name":"openai/gpt-5","api_key":"test-key"}}}`, new(StagehandActWireParams)},
		{`null`, new(StagehandObserveWireParams)},
		{`[]`, new(StagehandExtractWireParams)},
		{`{"scope_id":"s","options":{"model_overrides":[]}}`, new(CallbackBatchWireParams)},
	}
	for _, test := range tests {
		if err := json.Unmarshal([]byte(test.wire), test.value); err == nil {
			t.Errorf("%T accepted %s", test.value, test.wire)
		}
	}
}

func TestHTTPWireUnionsRequireOneVariant(t *testing.T) {
	for _, value := range []any{
		HTTPModelReference{},
		HTTPModelReference{Provider: &HTTPProviderModelReference{}, Gateway: &HTTPGatewayModelReference{}},
		HTTPInitModelReference{},
		HTTPInitModelReference{HTTP: &HTTPModelReference{}, Client: &ClientModelReference{}},
		StagehandInitWireParams{},
		StagehandInitWireParams{Legacy: &StagehandInitParams{}, HTTP: &StagehandInitHTTPParams{}},
		StagehandActWireParams{},
		StagehandActWireParams{Legacy: &StagehandActParams{}, HTTP: &StagehandActHTTPParams{}},
		StagehandObserveWireParams{},
		StagehandObserveWireParams{Legacy: &StagehandObserveParams{}, HTTP: &StagehandObserveHTTPParams{}},
		StagehandExtractWireParams{},
		StagehandExtractWireParams{Legacy: &StagehandExtractParams{}, HTTP: &StagehandExtractHTTPParams{}},
		CallbackBatchWireParams{},
		CallbackBatchWireParams{Legacy: &CallbackBatchParams{}, HTTP: &CallbackBatchHTTPParams{}},
	} {
		if _, err := json.Marshal(value); err == nil {
			t.Errorf("%T accepted zero or two variants", value)
		}
	}
}

func TestHTTPWireUnionReplacesPreviousVariant(t *testing.T) {
	var params StagehandActWireParams
	assertHTTPWireRoundTrip(t, []byte(`{"page_id":"p","instruction":"click","scope_id":"s"}`), &params)
	if params.HTTP == nil || params.Legacy != nil {
		t.Fatal("expected HTTP variant")
	}
	assertHTTPWireRoundTrip(t, []byte(`{"page_id":"p","instruction":"click"}`), &params)
	if params.HTTP != nil || params.Legacy == nil {
		t.Fatal("expected legacy variant")
	}
}

func assertHTTPWireRoundTrip(t *testing.T, wire []byte, value any) {
	t.Helper()
	if err := json.Unmarshal(wire, value); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(wire, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("%T round trip = %s, want %s", value, encoded, wire)
	}
}

func TestHTTPModelRegistrationWireFixtures(t *testing.T) {
	data, err := os.ReadFile("../protocol/tests/fixtures/http-model-registration-wire.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name   string
		Params json.RawMessage
		Result json.RawMessage
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			assertHTTPWireRoundTrip(t, fixture.Params, new(HTTPRegisterModelParams))
			assertHTTPWireRoundTrip(t, fixture.Result, new(HTTPModelReference))
		})
	}
}
