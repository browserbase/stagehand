package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

// LLMMessageGenerateResult is a strict text-format result.
type LLMMessageGenerateResult struct {
	Role         LLMRole           `json:"role"`
	Content      LLMMessageContent `json:"content"`
	StopReason   *string           `json:"stop_reason,omitempty"`
	Usage        *LLMUsage         `json:"usage,omitempty"`
	OutputFormat string            `json:"output_format"`
}

func (value LLMMessageGenerateResult) MarshalJSON() ([]byte, error) {
	if value.OutputFormat != outputFormatText {
		return nil, fmt.Errorf(
			"stagehand.LLMMessageGenerateResult output_format must be %q",
			outputFormatText,
		)
	}
	type plain LLMMessageGenerateResult
	return json.Marshal(plain(value))
}

func (value *LLMMessageGenerateResult) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMMessageGenerateResult: UnmarshalJSON on nil pointer")
	}
	type plain LLMMessageGenerateResult
	var decoded plain
	if err := decodeStrictVariantJSON(data, &decoded); err != nil {
		return fmt.Errorf("decode message LLM result: %w", err)
	}
	if decoded.OutputFormat != outputFormatText {
		return fmt.Errorf("decode message LLM result: output_format must be %q", outputFormatText)
	}
	*value = LLMMessageGenerateResult(decoded)
	return nil
}

// LLMStructuredGenerateResult is a strict JSON-schema-format result.
type LLMStructuredGenerateResult struct {
	Role              LLMRole           `json:"role"`
	Content           LLMMessageContent `json:"content"`
	StopReason        *string           `json:"stop_reason,omitempty"`
	Usage             *LLMUsage         `json:"usage,omitempty"`
	OutputFormat      string            `json:"output_format"`
	StructuredContent json.RawMessage   `json:"structured_content"`
}

func (value LLMStructuredGenerateResult) MarshalJSON() ([]byte, error) {
	if value.OutputFormat != outputFormatJSONSchema {
		return nil, fmt.Errorf(
			"stagehand.LLMStructuredGenerateResult output_format must be %q",
			outputFormatJSONSchema,
		)
	}
	type plain LLMStructuredGenerateResult
	return json.Marshal(plain(value))
}

func (value *LLMStructuredGenerateResult) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMStructuredGenerateResult: UnmarshalJSON on nil pointer")
	}
	type plain LLMStructuredGenerateResult
	var decoded plain
	if err := decodeStrictVariantJSON(data, &decoded); err != nil {
		return fmt.Errorf("decode structured LLM result: %w", err)
	}
	if decoded.OutputFormat != outputFormatJSONSchema {
		return fmt.Errorf(
			"decode structured LLM result: output_format must be %q",
			outputFormatJSONSchema,
		)
	}
	*value = LLMStructuredGenerateResult(decoded)
	return nil
}
