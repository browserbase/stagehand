package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

type browserbaseRequestResultValue interface {
	isBrowserbaseRequestResult()
}

func (BrowserbaseHTTPResponse) isBrowserbaseRequestResult()   {}
func (BrowserbaseTransportError) isBrowserbaseRequestResult() {}

// BrowserbaseRequestResult is an HTTP response or a transport failure.
type BrowserbaseRequestResult struct {
	value browserbaseRequestResultValue
}

// NewBrowserbaseHTTPResponse constructs a result with the response discriminator.
func NewBrowserbaseHTTPResponse(value BrowserbaseHTTPResponse) BrowserbaseRequestResult {
	value.Type = "response"
	return BrowserbaseRequestResult{value: value}
}

// NewBrowserbaseTransportError constructs a result with the error discriminator.
func NewBrowserbaseTransportError(value BrowserbaseTransportError) BrowserbaseRequestResult {
	value.Type = "error"
	return BrowserbaseRequestResult{value: value}
}

// AsResponse returns the HTTP response variant, if present.
func (value BrowserbaseRequestResult) AsResponse() (BrowserbaseHTTPResponse, bool) {
	result, ok := value.value.(BrowserbaseHTTPResponse)
	return result, ok
}

// AsError returns the transport error variant, if present.
func (value BrowserbaseRequestResult) AsError() (BrowserbaseTransportError, bool) {
	result, ok := value.value.(BrowserbaseTransportError)
	return result, ok
}

func (value BrowserbaseRequestResult) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.BrowserbaseRequestResult is unset")
	}
	return json.Marshal(value.value)
}

func (value *BrowserbaseRequestResult) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.BrowserbaseRequestResult: UnmarshalJSON on nil pointer")
	}
	discriminator, err := requiredStringProperty(data, "type")
	if err != nil {
		return fmt.Errorf("decode Browserbase result: %w", err)
	}
	switch discriminator {
	case "response":
		var response BrowserbaseHTTPResponse
		if err := decodeStrictJSON(data, &response); err != nil {
			return fmt.Errorf("decode Browserbase HTTP response: %w", err)
		}
		*value = NewBrowserbaseHTTPResponse(response)
	case "error":
		var transportError BrowserbaseTransportError
		if err := decodeStrictJSON(data, &transportError); err != nil {
			return fmt.Errorf("decode Browserbase transport error: %w", err)
		}
		*value = NewBrowserbaseTransportError(transportError)
	default:
		return fmt.Errorf("decode Browserbase result: unknown type %q", discriminator)
	}
	return nil
}
