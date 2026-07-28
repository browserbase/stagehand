package stagehand

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

// EmptyParams is the request body for methods that take no parameters.
type EmptyParams struct{}

type cachingKind uint8

const (
	cachingUnset cachingKind = iota
	cachingBoolean
	cachingOptions
)

// CacheOptions enables caching with an optional positive hit-count threshold.
type CacheOptions struct {
	Threshold *int `json:"threshold,omitempty"`
}

// Caching is either a boolean cache toggle or a cache options object.
type Caching struct {
	kind    cachingKind
	enabled bool
	options CacheOptions
}

// CacheEnabled constructs a boolean caching configuration.
func CacheEnabled(enabled bool) Caching {
	return Caching{kind: cachingBoolean, enabled: enabled}
}

// CacheWithThreshold enables caching with the given positive hit-count threshold.
func CacheWithThreshold(threshold int) Caching {
	return Caching{kind: cachingOptions, options: CacheOptions{Threshold: &threshold}}
}

// CacheWithOptions constructs an object caching configuration.
func CacheWithOptions(options CacheOptions) Caching {
	return Caching{kind: cachingOptions, options: options}
}

// AsBool returns the boolean variant, if present.
func (value Caching) AsBool() (bool, bool) {
	return value.enabled, value.kind == cachingBoolean
}

// AsOptions returns the options variant, if present.
func (value Caching) AsOptions() (CacheOptions, bool) {
	return value.options, value.kind == cachingOptions
}

func (value Caching) MarshalJSON() ([]byte, error) {
	switch value.kind {
	case cachingBoolean:
		return json.Marshal(value.enabled)
	case cachingOptions:
		if threshold := value.options.Threshold; threshold != nil &&
			(*threshold <= 0 || int64(*threshold) > 9007199254740991) {
			return nil, errors.New("stagehand.Caching threshold must be between 1 and 9007199254740991")
		}
		return json.Marshal(value.options)
	default:
		return nil, errors.New("stagehand.Caching is unset")
	}
}

func (value *Caching) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.Caching: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case 't', 'f':
		var enabled bool
		if err := json.Unmarshal(data, &enabled); err != nil {
			return fmt.Errorf("decode caching boolean: %w", err)
		}
		*value = CacheEnabled(enabled)
		return nil
	case '{':
		var options CacheOptions
		if err := json.Unmarshal(data, &options); err != nil {
			return fmt.Errorf("decode caching options: %w", err)
		}
		if threshold := options.Threshold; threshold != nil &&
			(*threshold <= 0 || int64(*threshold) > 9007199254740991) {
			return errors.New("decode caching options: threshold must be between 1 and 9007199254740991")
		}
		*value = CacheWithOptions(options)
		return nil
	default:
		return errors.New("decode caching: expected boolean or object")
	}
}

// ModelName is a provider-prefixed model name accepted by Stagehand.
//
// The protocol describes these values with provider-specific regular
// expressions rather than a closed enum, so values are validated by the
// server rather than enumerated in Go.
type ModelName string

// LoadState identifies the browser lifecycle event to wait for.
type LoadState string

const (
	LoadStateDOMContentLoaded LoadState = "domcontentloaded"
	LoadStateLoad             LoadState = "load"
	LoadStateNetworkIdle      LoadState = "networkidle"
)

// ContextActivePageResult is either the active page or JSON null.
type ContextActivePageResult = *PageRef

// ContextGetDomainPolicyResult is either the current domain policy or JSON null.
type ContextGetDomainPolicyResult = *DomainPolicy

// StringList accepts either a single JSON string or an array of strings and
// always marshals as an array.
type StringList []string

func (values StringList) MarshalJSON() ([]byte, error) {
	if values == nil {
		values = StringList{}
	}
	return json.Marshal([]string(values))
}

func (values *StringList) UnmarshalJSON(data []byte) error {
	if values == nil {
		return errors.New("stagehand.StringList: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case '"':
		var value string
		if err := json.Unmarshal(data, &value); err != nil {
			return fmt.Errorf("decode string list: %w", err)
		}
		*values = StringList{value}
		return nil
	case '[':
	default:
		return errors.New("decode string list: expected string or array")
	}
	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("decode string list: %w", err)
	}
	*values = StringList(result)
	return nil
}

type variablePrimitiveKind uint8

const (
	variablePrimitiveUnset variablePrimitiveKind = iota
	variablePrimitiveString
	variablePrimitiveNumber
	variablePrimitiveBool
)

// VariablePrimitive is a string, number, or boolean variable value.
type VariablePrimitive struct {
	kind        variablePrimitiveKind
	stringValue string
	numberValue float64
	boolValue   bool
}

// StringVariable constructs a string variable primitive.
func StringVariable(value string) VariablePrimitive {
	return VariablePrimitive{kind: variablePrimitiveString, stringValue: value}
}

// NumberVariable constructs a numeric variable primitive.
func NumberVariable(value float64) VariablePrimitive {
	return VariablePrimitive{kind: variablePrimitiveNumber, numberValue: value}
}

// BoolVariable constructs a boolean variable primitive.
func BoolVariable(value bool) VariablePrimitive {
	return VariablePrimitive{kind: variablePrimitiveBool, boolValue: value}
}

// AsString returns the string variant, if present.
func (value VariablePrimitive) AsString() (string, bool) {
	return value.stringValue, value.kind == variablePrimitiveString
}

// AsNumber returns the number variant, if present.
func (value VariablePrimitive) AsNumber() (float64, bool) {
	return value.numberValue, value.kind == variablePrimitiveNumber
}

// AsBool returns the boolean variant, if present.
func (value VariablePrimitive) AsBool() (bool, bool) {
	return value.boolValue, value.kind == variablePrimitiveBool
}

func (value VariablePrimitive) MarshalJSON() ([]byte, error) {
	switch value.kind {
	case variablePrimitiveString:
		return json.Marshal(value.stringValue)
	case variablePrimitiveNumber:
		return json.Marshal(value.numberValue)
	case variablePrimitiveBool:
		return json.Marshal(value.boolValue)
	default:
		return nil, errors.New("stagehand.VariablePrimitive is unset")
	}
}

func (value *VariablePrimitive) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.VariablePrimitive: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case '"':
		var decoded string
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode variable string: %w", err)
		}
		*value = StringVariable(decoded)
	case 't', 'f':
		var decoded bool
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode variable boolean: %w", err)
		}
		*value = BoolVariable(decoded)
	case 'n', 0:
		return errors.New("decode variable primitive: expected string, number, or boolean")
	default:
		var decoded float64
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode variable primitive: %w", err)
		}
		*value = NumberVariable(decoded)
	}
	return nil
}

type scrollPercentKind uint8

const (
	scrollPercentUnset scrollPercentKind = iota
	scrollPercentNumber
	scrollPercentString
)

// ScrollPercent is either a numeric scroll percentage or a server-supported
// string value.
type ScrollPercent struct {
	kind        scrollPercentKind
	numberValue float64
	stringValue string
}

// NumericScrollPercent constructs a numeric scroll percentage.
func NumericScrollPercent(value float64) ScrollPercent {
	return ScrollPercent{kind: scrollPercentNumber, numberValue: value}
}

// NamedScrollPercent constructs a string scroll percentage.
func NamedScrollPercent(value string) ScrollPercent {
	return ScrollPercent{kind: scrollPercentString, stringValue: value}
}

// AsNumber returns the numeric variant, if present.
func (value ScrollPercent) AsNumber() (float64, bool) {
	return value.numberValue, value.kind == scrollPercentNumber
}

// AsString returns the string variant, if present.
func (value ScrollPercent) AsString() (string, bool) {
	return value.stringValue, value.kind == scrollPercentString
}

func (value ScrollPercent) MarshalJSON() ([]byte, error) {
	switch value.kind {
	case scrollPercentNumber:
		return json.Marshal(value.numberValue)
	case scrollPercentString:
		return json.Marshal(value.stringValue)
	default:
		return nil, errors.New("stagehand.ScrollPercent is unset")
	}
}

func (value *ScrollPercent) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.ScrollPercent: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case '"':
		var decoded string
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode scroll percentage: %w", err)
		}
		*value = NamedScrollPercent(decoded)
		return nil
	case 'n', 0:
		return errors.New("decode scroll percentage: expected string or number")
	}
	var decoded float64
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode scroll percentage: %w", err)
	}
	*value = NumericScrollPercent(decoded)
	return nil
}

func firstJSONByte(data []byte) byte {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return 0
	}
	return trimmed[0]
}
