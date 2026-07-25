package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

type llmMessageContentBlockValue interface {
	isLLMMessageContentBlock()
}

func (LLMTextContent) isLLMMessageContentBlock()       {}
func (LLMImageContent) isLLMMessageContentBlock()      {}
func (LLMToolUseContent) isLLMMessageContentBlock()    {}
func (LLMToolResultContent) isLLMMessageContentBlock() {}

// LLMMessageContentBlock is one text, image, tool-use, or tool-result block.
type LLMMessageContentBlock struct {
	value llmMessageContentBlockValue
}

// TextContentBlock constructs a text content block and sets its discriminator.
func TextContentBlock(value LLMTextContent) LLMMessageContentBlock {
	value.Type = contentTypeText
	return LLMMessageContentBlock{value: value}
}

// ImageContentBlock constructs an image content block and sets its discriminator.
func ImageContentBlock(value LLMImageContent) LLMMessageContentBlock {
	value.Type = contentTypeImage
	return LLMMessageContentBlock{value: value}
}

// ToolUseContentBlock constructs a tool-use block and sets its discriminator.
func ToolUseContentBlock(value LLMToolUseContent) LLMMessageContentBlock {
	value.Type = contentTypeToolUse
	return LLMMessageContentBlock{value: value}
}

// ToolResultContentBlock constructs a tool-result block and sets its discriminator.
func ToolResultContentBlock(value LLMToolResultContent) LLMMessageContentBlock {
	value.Type = contentTypeToolResult
	return LLMMessageContentBlock{value: value}
}

// AsText returns the text variant, if present.
func (value LLMMessageContentBlock) AsText() (LLMTextContent, bool) {
	result, ok := value.value.(LLMTextContent)
	return result, ok
}

// AsImage returns the image variant, if present.
func (value LLMMessageContentBlock) AsImage() (LLMImageContent, bool) {
	result, ok := value.value.(LLMImageContent)
	return result, ok
}

// AsToolUse returns the tool-use variant, if present.
func (value LLMMessageContentBlock) AsToolUse() (LLMToolUseContent, bool) {
	result, ok := value.value.(LLMToolUseContent)
	return result, ok
}

// AsToolResult returns the tool-result variant, if present.
func (value LLMMessageContentBlock) AsToolResult() (LLMToolResultContent, bool) {
	result, ok := value.value.(LLMToolResultContent)
	return result, ok
}

func (value LLMMessageContentBlock) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.LLMMessageContentBlock is unset")
	}
	return json.Marshal(value.value)
}

func (value *LLMMessageContentBlock) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMMessageContentBlock: UnmarshalJSON on nil pointer")
	}
	discriminator, err := requiredStringProperty(data, "type")
	if err != nil {
		return fmt.Errorf("decode LLM message content block: %w", err)
	}
	switch discriminator {
	case contentTypeText:
		var decoded LLMTextContent
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode LLM text block: %w", err)
		}
		*value = TextContentBlock(decoded)
	case contentTypeImage:
		var decoded LLMImageContent
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode LLM image block: %w", err)
		}
		*value = ImageContentBlock(decoded)
	case contentTypeToolUse:
		var decoded LLMToolUseContent
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode LLM tool-use block: %w", err)
		}
		*value = ToolUseContentBlock(decoded)
	case contentTypeToolResult:
		var decoded LLMToolResultContent
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode LLM tool-result block: %w", err)
		}
		*value = ToolResultContentBlock(decoded)
	default:
		return fmt.Errorf("decode LLM message content block: unknown type %q", discriminator)
	}
	return nil
}

// LLMMessageContent accepts a single JSON content block or an array of blocks
// and always marshals as an array.
type LLMMessageContent []LLMMessageContentBlock

func (content LLMMessageContent) MarshalJSON() ([]byte, error) {
	if content == nil {
		content = LLMMessageContent{}
	}
	return json.Marshal([]LLMMessageContentBlock(content))
}

func (content *LLMMessageContent) UnmarshalJSON(data []byte) error {
	if content == nil {
		return errors.New("stagehand.LLMMessageContent: UnmarshalJSON on nil pointer")
	}
	if firstJSONByte(data) == '[' {
		var decoded []LLMMessageContentBlock
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode LLM message content: %w", err)
		}
		*content = LLMMessageContent(decoded)
		return nil
	}
	var decoded LLMMessageContentBlock
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode LLM message content: %w", err)
	}
	*content = LLMMessageContent{decoded}
	return nil
}

type llmToolResultContentBlockValue interface {
	isLLMToolResultContentBlock()
}

func (LLMTextContent) isLLMToolResultContentBlock()  {}
func (LLMImageContent) isLLMToolResultContentBlock() {}

// LLMToolResultContentBlock is a text or image tool-result block.
type LLMToolResultContentBlock struct {
	value llmToolResultContentBlockValue
}

// ToolResultTextBlock constructs a text tool-result block.
func ToolResultTextBlock(value LLMTextContent) LLMToolResultContentBlock {
	value.Type = contentTypeText
	return LLMToolResultContentBlock{value: value}
}

// ToolResultImageBlock constructs an image tool-result block.
func ToolResultImageBlock(value LLMImageContent) LLMToolResultContentBlock {
	value.Type = contentTypeImage
	return LLMToolResultContentBlock{value: value}
}

// AsText returns the text variant, if present.
func (value LLMToolResultContentBlock) AsText() (LLMTextContent, bool) {
	result, ok := value.value.(LLMTextContent)
	return result, ok
}

// AsImage returns the image variant, if present.
func (value LLMToolResultContentBlock) AsImage() (LLMImageContent, bool) {
	result, ok := value.value.(LLMImageContent)
	return result, ok
}

func (value LLMToolResultContentBlock) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.LLMToolResultContentBlock is unset")
	}
	return json.Marshal(value.value)
}

func (value *LLMToolResultContentBlock) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMToolResultContentBlock: UnmarshalJSON on nil pointer")
	}
	discriminator, err := requiredStringProperty(data, "type")
	if err != nil {
		return fmt.Errorf("decode LLM tool-result content block: %w", err)
	}
	switch discriminator {
	case contentTypeText:
		var decoded LLMTextContent
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode LLM tool-result text block: %w", err)
		}
		*value = ToolResultTextBlock(decoded)
	case contentTypeImage:
		var decoded LLMImageContent
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode LLM tool-result image block: %w", err)
		}
		*value = ToolResultImageBlock(decoded)
	default:
		return fmt.Errorf("decode LLM tool-result content block: unknown type %q", discriminator)
	}
	return nil
}

type llmGenerateParamsValue interface {
	isLLMGenerateParams()
}

func (LLMStructuredGenerateParams) isLLMGenerateParams() {}
func (LLMMessageGenerateParams) isLLMGenerateParams()    {}

// LLMGenerateParams is either a structured-output or message-output request.
type LLMGenerateParams struct {
	value llmGenerateParamsValue
}

// StructuredGenerateParams constructs a structured-output request and sets
// the response-format discriminator.
func StructuredGenerateParams(value LLMStructuredGenerateParams) LLMGenerateParams {
	value.ResponseFormat.Type = outputFormatJSONSchema
	return LLMGenerateParams{value: value}
}

// MessageGenerateParams constructs a message-output request and sets the
// optional response-format discriminator when present.
func MessageGenerateParams(value LLMMessageGenerateParams) LLMGenerateParams {
	if value.ResponseFormat != nil {
		value.ResponseFormat.Type = outputFormatText
	}
	return LLMGenerateParams{value: value}
}

// AsStructured returns the structured-output variant, if present.
func (value LLMGenerateParams) AsStructured() (LLMStructuredGenerateParams, bool) {
	result, ok := value.value.(LLMStructuredGenerateParams)
	return result, ok
}

// AsMessage returns the message-output variant, if present.
func (value LLMGenerateParams) AsMessage() (LLMMessageGenerateParams, bool) {
	result, ok := value.value.(LLMMessageGenerateParams)
	return result, ok
}

func (value LLMGenerateParams) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.LLMGenerateParams is unset")
	}
	return json.Marshal(value.value)
}

func (value *LLMGenerateParams) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMGenerateParams: UnmarshalJSON on nil pointer")
	}
	if firstJSONByte(data) != '{' {
		return errors.New("decode LLM generate params: expected object")
	}
	format, present, err := nestedStringProperty(data, "response_format", "type")
	if err != nil {
		return fmt.Errorf("decode LLM generate params: %w", err)
	}
	if present && format == outputFormatJSONSchema {
		var decoded LLMStructuredGenerateParams
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode structured LLM generate params: %w", err)
		}
		*value = StructuredGenerateParams(decoded)
		return nil
	}
	if present && format != outputFormatText {
		return fmt.Errorf("decode LLM generate params: unknown response format %q", format)
	}
	var decoded LLMMessageGenerateParams
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode message LLM generate params: %w", err)
	}
	*value = MessageGenerateParams(decoded)
	return nil
}

type llmGenerateResultValue interface {
	isLLMGenerateResult()
}

func (LLMMessageGenerateResult) isLLMGenerateResult()    {}
func (LLMStructuredGenerateResult) isLLMGenerateResult() {}

// LLMGenerateResult is either a message or structured-output result.
type LLMGenerateResult struct {
	value llmGenerateResultValue
}

// MessageGenerateResult constructs a message result and sets its discriminator.
func MessageGenerateResult(value LLMMessageGenerateResult) LLMGenerateResult {
	value.OutputFormat = outputFormatText
	return LLMGenerateResult{value: value}
}

// StructuredGenerateResult constructs a structured result and sets its discriminator.
func StructuredGenerateResult(value LLMStructuredGenerateResult) LLMGenerateResult {
	value.OutputFormat = outputFormatJSONSchema
	return LLMGenerateResult{value: value}
}

// AsMessage returns the message variant, if present.
func (value LLMGenerateResult) AsMessage() (LLMMessageGenerateResult, bool) {
	result, ok := value.value.(LLMMessageGenerateResult)
	return result, ok
}

// AsStructured returns the structured variant, if present.
func (value LLMGenerateResult) AsStructured() (LLMStructuredGenerateResult, bool) {
	result, ok := value.value.(LLMStructuredGenerateResult)
	return result, ok
}

func (value LLMGenerateResult) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.LLMGenerateResult is unset")
	}
	return json.Marshal(value.value)
}

func (value *LLMGenerateResult) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.LLMGenerateResult: UnmarshalJSON on nil pointer")
	}
	format, err := requiredStringProperty(data, "output_format")
	if err != nil {
		return fmt.Errorf("decode LLM generate result: %w", err)
	}
	switch format {
	case outputFormatText:
		var decoded LLMMessageGenerateResult
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode message LLM generate result: %w", err)
		}
		*value = MessageGenerateResult(decoded)
	case outputFormatJSONSchema:
		var decoded LLMStructuredGenerateResult
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode structured LLM generate result: %w", err)
		}
		*value = StructuredGenerateResult(decoded)
	default:
		return fmt.Errorf("decode LLM generate result: unknown output format %q", format)
	}
	return nil
}

func nestedStringProperty(data []byte, objectName, propertyName string) (string, bool, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return "", false, err
	}
	raw, ok := object[objectName]
	if !ok || string(raw) == "null" {
		return "", false, nil
	}
	value, ok := stringProperty(raw, propertyName)
	if !ok {
		return "", false, fmt.Errorf("missing or invalid %q.%q discriminator", objectName, propertyName)
	}
	return value, true, nil
}
