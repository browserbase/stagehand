package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

// LLMMessageGenerateResult is a text-format result. Unknown provider-specific
// fields are preserved in AdditionalProperties.
type LLMMessageGenerateResult struct {
	Role                 LLMRole                    `json:"role"`
	Content              LLMMessageContent          `json:"content"`
	StopReason           *string                    `json:"stop_reason,omitempty"`
	Usage                *LLMUsage                  `json:"usage,omitempty"`
	OutputFormat         string                     `json:"output_format"`
	AdditionalProperties map[string]json.RawMessage `json:"-"`
}

var llmMessageResultPropertyNames = propertySet(
	"role", "content", "stop_reason", "usage", "output_format",
)

func (value LLMMessageGenerateResult) MarshalJSON() ([]byte, error) {
	if value.OutputFormat != outputFormatText {
		return nil, fmt.Errorf(
			"stagehand.LLMMessageGenerateResult output_format must be %q",
			outputFormatText,
		)
	}
	type plain LLMMessageGenerateResult
	return marshalObjectWithAdditionalProperties(
		plain(value),
		value.AdditionalProperties,
		llmMessageResultPropertyNames,
	)
}

func (value *LLMMessageGenerateResult) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMMessageGenerateResult: UnmarshalJSON on nil pointer")
	}
	type plain LLMMessageGenerateResult
	var decoded plain
	extras, err := unmarshalObjectWithAdditionalProperties(data, &decoded, llmMessageResultPropertyNames)
	if err != nil {
		return fmt.Errorf("decode message LLM result: %w", err)
	}
	if decoded.OutputFormat != outputFormatText {
		return fmt.Errorf("decode message LLM result: output_format must be %q", outputFormatText)
	}
	*value = LLMMessageGenerateResult(decoded)
	value.AdditionalProperties = extras
	return nil
}

// LLMStructuredGenerateResult is a JSON-schema-format result. Unknown
// provider-specific fields are preserved in AdditionalProperties.
type LLMStructuredGenerateResult struct {
	Role                 LLMRole                    `json:"role"`
	Content              LLMMessageContent          `json:"content"`
	StopReason           *string                    `json:"stop_reason,omitempty"`
	Usage                *LLMUsage                  `json:"usage,omitempty"`
	OutputFormat         string                     `json:"output_format"`
	StructuredContent    json.RawMessage            `json:"structured_content"`
	AdditionalProperties map[string]json.RawMessage `json:"-"`
}

var llmStructuredResultPropertyNames = propertySet(
	"role", "content", "stop_reason", "usage", "output_format", "structured_content",
)

func (value LLMStructuredGenerateResult) MarshalJSON() ([]byte, error) {
	if value.OutputFormat != outputFormatJSONSchema {
		return nil, fmt.Errorf(
			"stagehand.LLMStructuredGenerateResult output_format must be %q",
			outputFormatJSONSchema,
		)
	}
	type plain LLMStructuredGenerateResult
	return marshalObjectWithAdditionalProperties(
		plain(value),
		value.AdditionalProperties,
		llmStructuredResultPropertyNames,
	)
}

func (value *LLMStructuredGenerateResult) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMStructuredGenerateResult: UnmarshalJSON on nil pointer")
	}
	type plain LLMStructuredGenerateResult
	var decoded plain
	extras, err := unmarshalObjectWithAdditionalProperties(data, &decoded, llmStructuredResultPropertyNames)
	if err != nil {
		return fmt.Errorf("decode structured LLM result: %w", err)
	}
	if decoded.OutputFormat != outputFormatJSONSchema {
		return fmt.Errorf(
			"decode structured LLM result: output_format must be %q",
			outputFormatJSONSchema,
		)
	}
	*value = LLMStructuredGenerateResult(decoded)
	value.AdditionalProperties = extras
	return nil
}

func marshalObjectWithAdditionalProperties(
	known any,
	extras map[string]json.RawMessage,
	reserved map[string]struct{},
) ([]byte, error) {
	data, err := json.Marshal(known)
	if err != nil {
		return nil, err
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, err
	}
	for key, raw := range extras {
		if _, knownName := reserved[key]; knownName {
			continue
		}
		object[key] = append(json.RawMessage(nil), raw...)
	}
	return json.Marshal(object)
}

func unmarshalObjectWithAdditionalProperties(
	data []byte,
	target any,
	known map[string]struct{},
) (map[string]json.RawMessage, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, err
	}
	if object == nil {
		return nil, errors.New("expected JSON object")
	}
	if err := json.Unmarshal(data, target); err != nil {
		return nil, err
	}
	extras := make(map[string]json.RawMessage)
	for key, raw := range object {
		if _, isKnown := known[key]; isKnown {
			continue
		}
		extras[key] = append(json.RawMessage(nil), raw...)
	}
	if len(extras) == 0 {
		return nil, nil
	}
	return extras, nil
}

func propertySet(names ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(names))
	for _, name := range names {
		result[name] = struct{}{}
	}
	return result
}
