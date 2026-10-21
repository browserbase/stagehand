package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

type functionPollingKind uint8

const (
	functionPollingUnset functionPollingKind = iota
	functionPollingAnimationFrame
	functionPollingInterval
)

// FunctionPolling selects animation frames or a positive interval in milliseconds.
type FunctionPolling struct {
	kind         functionPollingKind
	milliseconds float64
}

// AnimationFramePolling evaluates the predicate on browser animation frames.
func AnimationFramePolling() FunctionPolling {
	return FunctionPolling{kind: functionPollingAnimationFrame}
}

// IntervalPolling evaluates the predicate at a positive interval of at most 2147483647ms.
func IntervalPolling(milliseconds float64) FunctionPolling {
	return FunctionPolling{kind: functionPollingInterval, milliseconds: milliseconds}
}

// IsAnimationFrame reports whether animation-frame polling was selected.
func (value FunctionPolling) IsAnimationFrame() bool {
	return value.kind == functionPollingAnimationFrame
}

// AsInterval returns the interval in milliseconds, if selected.
func (value FunctionPolling) AsInterval() (float64, bool) {
	return value.milliseconds, value.kind == functionPollingInterval
}

func (value FunctionPolling) MarshalJSON() ([]byte, error) {
	switch value.kind {
	case functionPollingAnimationFrame:
		return json.Marshal("raf")
	case functionPollingInterval:
		if err := validateFunctionPollingInterval(value.milliseconds); err != nil {
			return nil, err
		}
		return json.Marshal(value.milliseconds)
	default:
		return nil, errors.New("stagehand.FunctionPolling is unset")
	}
}

func (value *FunctionPolling) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.FunctionPolling: UnmarshalJSON on nil pointer")
	}
	if firstJSONByte(data) == '"' {
		var name string
		if err := json.Unmarshal(data, &name); err != nil {
			return fmt.Errorf("decode function polling: %w", err)
		}
		if name != "raf" {
			return errors.New("decode function polling: expected \"raf\" or a positive interval")
		}
		*value = AnimationFramePolling()
		return nil
	}
	var milliseconds float64
	if err := json.Unmarshal(data, &milliseconds); err != nil {
		return fmt.Errorf("decode function polling: %w", err)
	}
	if err := validateFunctionPollingInterval(milliseconds); err != nil {
		return err
	}
	*value = IntervalPolling(milliseconds)
	return nil
}

func validateFunctionPollingInterval(milliseconds float64) error {
	if !(milliseconds > 0 && milliseconds <= 2_147_483_647) {
		return errors.New("stagehand.FunctionPolling interval must be positive and at most 2147483647ms")
	}
	return nil
}
