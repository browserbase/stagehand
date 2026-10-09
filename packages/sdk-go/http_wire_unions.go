package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

// HTTPModelReference selects one provider or Gateway connection.
type HTTPModelReference struct {
	Provider *HTTPProviderModelReference
	Gateway  *HTTPGatewayModelReference
}

func (value HTTPModelReference) MarshalJSON() ([]byte, error) {
	return marshalHTTPWireVariant(value.Provider, value.Gateway)
}

func (value *HTTPModelReference) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.HTTPModelReference: UnmarshalJSON on nil pointer")
	}
	source, _ := stringProperty(data, "source")
	route, _ := stringProperty(data, "route")
	if source != "http" {
		return fmt.Errorf("decode HTTP model reference: unknown source %q", source)
	}
	switch route {
	case "provider":
		var decoded HTTPProviderModelReference
		if err := decodeStrictVariantJSON(data, &decoded); err != nil {
			return err
		}
		*value = HTTPModelReference{Provider: &decoded}
	case "gateway":
		var decoded HTTPGatewayModelReference
		if err := decodeStrictVariantJSON(data, &decoded); err != nil {
			return err
		}
		*value = HTTPModelReference{Gateway: &decoded}
	default:
		return fmt.Errorf("decode HTTP model reference: unknown route %q", route)
	}
	return nil
}

// HTTPInitModelReference selects HTTP forwarding or the client LLM callback.
type HTTPInitModelReference struct {
	HTTP   *HTTPModelReference
	Client *ClientModelReference
}

func (value HTTPInitModelReference) MarshalJSON() ([]byte, error) {
	return marshalHTTPWireVariant(value.HTTP, value.Client)
}

func (value *HTTPInitModelReference) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.HTTPInitModelReference: UnmarshalJSON on nil pointer")
	}
	source, _ := stringProperty(data, "source")
	switch source {
	case "http":
		var decoded HTTPModelReference
		if err := json.Unmarshal(data, &decoded); err != nil {
			return err
		}
		*value = HTTPInitModelReference{HTTP: &decoded}
	case "client":
		var decoded ClientModelReference
		if err := decodeStrictVariantJSON(data, &decoded); err != nil {
			return err
		}
		*value = HTTPInitModelReference{Client: &decoded}
	default:
		return fmt.Errorf("decode HTTP init model reference: unknown source %q", source)
	}
	return nil
}

// StagehandInitWireParams carries one of the supported request forms.
type StagehandInitWireParams struct {
	Legacy *StagehandInitParams
	HTTP   *StagehandInitHTTPParams
}

func (value StagehandInitWireParams) MarshalJSON() ([]byte, error) {
	return marshalHTTPWireVariant(value.Legacy, value.HTTP)
}

func (value *StagehandInitWireParams) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.StagehandInitWireParams: UnmarshalJSON on nil pointer")
	}
	return unmarshalHTTPWireVariant(data, "connections", &value.Legacy, &value.HTTP)
}

// StagehandActWireParams carries one of the supported request forms.
type StagehandActWireParams struct {
	Legacy *StagehandActParams
	HTTP   *StagehandActHTTPParams
}

func (value StagehandActWireParams) MarshalJSON() ([]byte, error) {
	return marshalHTTPWireVariant(value.Legacy, value.HTTP)
}

func (value *StagehandActWireParams) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.StagehandActWireParams: UnmarshalJSON on nil pointer")
	}
	return unmarshalHTTPWireVariant(data, "scope_id", &value.Legacy, &value.HTTP)
}

// StagehandObserveWireParams carries one of the supported request forms.
type StagehandObserveWireParams struct {
	Legacy *StagehandObserveParams
	HTTP   *StagehandObserveHTTPParams
}

func (value StagehandObserveWireParams) MarshalJSON() ([]byte, error) {
	return marshalHTTPWireVariant(value.Legacy, value.HTTP)
}

func (value *StagehandObserveWireParams) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.StagehandObserveWireParams: UnmarshalJSON on nil pointer")
	}
	return unmarshalHTTPWireVariant(data, "scope_id", &value.Legacy, &value.HTTP)
}

// StagehandExtractWireParams carries one of the supported request forms.
type StagehandExtractWireParams struct {
	Legacy *StagehandExtractParams
	HTTP   *StagehandExtractHTTPParams
}

func (value StagehandExtractWireParams) MarshalJSON() ([]byte, error) {
	return marshalHTTPWireVariant(value.Legacy, value.HTTP)
}

func (value *StagehandExtractWireParams) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.StagehandExtractWireParams: UnmarshalJSON on nil pointer")
	}
	return unmarshalHTTPWireVariant(data, "scope_id", &value.Legacy, &value.HTTP)
}

// CallbackBatchWireParams carries one of the supported request forms.
type CallbackBatchWireParams struct {
	Legacy *CallbackBatchParams
	HTTP   *CallbackBatchHTTPParams
}

func (value CallbackBatchWireParams) MarshalJSON() ([]byte, error) {
	return marshalHTTPWireVariant(value.Legacy, value.HTTP)
}

func (value *CallbackBatchWireParams) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.CallbackBatchWireParams: UnmarshalJSON on nil pointer")
	}
	return unmarshalHTTPWireVariant(data, "scope_id", &value.Legacy, &value.HTTP)
}

// Select exactly one variant without adding a wrapper object to the wire.
func marshalHTTPWireVariant[A, B any](first *A, second *B) ([]byte, error) {
	if (first == nil) == (second == nil) {
		return nil, errors.New("HTTP wire union requires exactly one variant")
	}
	if first != nil {
		return json.Marshal(first)
	}
	return json.Marshal(second)
}

func unmarshalHTTPWireVariant[A, B any](data []byte, marker string, legacy **A, http **B) error {
	var fields map[string]json.RawMessage
	if firstJSONByte(data) != '{' {
		return errors.New("decode HTTP wire params: expected object")
	}
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if _, present := fields[marker]; present {
		var decoded B
		if err := decodeStrictVariantJSON(data, &decoded); err != nil {
			return err
		}
		*legacy, *http = nil, &decoded
	} else {
		var decoded A
		if err := decodeStrictVariantJSON(data, &decoded); err != nil {
			return err
		}
		*legacy, *http = &decoded, nil
	}
	return nil
}
