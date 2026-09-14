package stagehand

import "encoding/json"

func (options ActOptions) MarshalJSON() ([]byte, error) {
	type alias ActOptions
	return marshalWithIgnoreLocators(alias(options), options.IgnoreLocators)
}

func (options ObserveOptions) MarshalJSON() ([]byte, error) {
	type alias ObserveOptions
	return marshalWithIgnoreLocators(alias(options), options.IgnoreLocators)
}

func (options ExtractOptions) MarshalJSON() ([]byte, error) {
	type alias ExtractOptions
	return marshalWithIgnoreLocators(alias(options), options.IgnoreLocators)
}

func marshalWithIgnoreLocators(value any, ignoreLocators []Locator) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if ignoreLocators == nil {
		return encoded, nil
	}

	var object map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &object); err != nil {
		return nil, err
	}
	encodedIgnoreLocators, err := json.Marshal(ignoreLocators)
	if err != nil {
		return nil, err
	}
	object["ignore_locators"] = encodedIgnoreLocators
	return json.Marshal(object)
}
