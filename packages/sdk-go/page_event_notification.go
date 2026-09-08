package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

type pageEventNotificationValue interface {
	isPageEventNotification()
}

func (PageToolsAddedNotification) isPageEventNotification()   {}
func (PageToolsRemovedNotification) isPageEventNotification() {}

// PageEventNotification is a typed protocol notification, not an SDK callback payload.
type PageEventNotification struct {
	value pageEventNotificationValue
}

// NewPageToolsAddedNotification constructs an added notification with its discriminator.
func NewPageToolsAddedNotification(value PageToolsAddedNotification) PageEventNotification {
	value.Event = "toolsadded"
	return PageEventNotification{value: value}
}

// NewPageToolsRemovedNotification constructs a removed notification with its discriminator.
func NewPageToolsRemovedNotification(value PageToolsRemovedNotification) PageEventNotification {
	value.Event = "toolsremoved"
	return PageEventNotification{value: value}
}

// AsToolsAdded returns the added variant, if present.
func (value PageEventNotification) AsToolsAdded() (PageToolsAddedNotification, bool) {
	result, ok := value.value.(PageToolsAddedNotification)
	return result, ok
}

// AsToolsRemoved returns the removed variant, if present.
func (value PageEventNotification) AsToolsRemoved() (PageToolsRemovedNotification, bool) {
	result, ok := value.value.(PageToolsRemovedNotification)
	return result, ok
}

func (value PageEventNotification) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.PageEventNotification is unset")
	}
	return json.Marshal(value.value)
}

func (value *PageEventNotification) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.PageEventNotification: UnmarshalJSON on nil pointer")
	}
	event, err := requiredStringProperty(data, "event")
	if err != nil {
		return fmt.Errorf("decode page event: %w", err)
	}
	switch event {
	case "toolsadded":
		var added PageToolsAddedNotification
		if err := decodeStrictJSON(data, &added); err != nil {
			return fmt.Errorf("decode tools-added notification: %w", err)
		}
		*value = NewPageToolsAddedNotification(added)
	case "toolsremoved":
		var removed PageToolsRemovedNotification
		if err := decodeStrictJSON(data, &removed); err != nil {
			return fmt.Errorf("decode tools-removed notification: %w", err)
		}
		*value = NewPageToolsRemovedNotification(removed)
	default:
		return fmt.Errorf("decode page event: unknown event %q", event)
	}
	return nil
}
