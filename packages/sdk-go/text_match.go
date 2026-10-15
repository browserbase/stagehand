package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

// TextMatch is a literal string or an ECMAScript regular expression used by
// GetByText and GetByRole. Its zero value matches an empty literal string.
type TextMatch struct {
	literal string
	regex   *textRegex
}

type textRegex struct {
	Source string `json:"source"`
	Flags  string `json:"flags,omitempty"`
}

// LiteralText constructs a literal text matcher. Matching is case-insensitive
// and accepts substrings unless the locator's Exact option is true.
func LiteralText(text string) TextMatch {
	return TextMatch{literal: text}
}

// RegexText constructs an ECMAScript regular-expression matcher. Pass an empty
// flags string for no flags. The browser validates and evaluates the expression;
// Go's regexp syntax is not used.
func RegexText(source, flags string) TextMatch {
	return TextMatch{regex: &textRegex{Source: source, Flags: flags}}
}

// AsLiteral returns the literal string, if present.
func (value TextMatch) AsLiteral() (string, bool) {
	return value.literal, value.regex == nil
}

// AsRegex returns the expression's source and flags, if present.
func (value TextMatch) AsRegex() (source, flags string, ok bool) {
	if value.regex == nil {
		return "", "", false
	}
	return value.regex.Source, value.regex.Flags, true
}

func (value TextMatch) MarshalJSON() ([]byte, error) {
	if value.regex != nil {
		return json.Marshal(value.regex)
	}
	return json.Marshal(value.literal)
}

func (value *TextMatch) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.TextMatch: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case '"':
		var literal string
		if err := json.Unmarshal(data, &literal); err != nil {
			return fmt.Errorf("decode literal text: %w", err)
		}
		*value = LiteralText(literal)
		return nil
	case '{':
		var pattern map[string]*string
		if err := json.Unmarshal(data, &pattern); err != nil {
			return fmt.Errorf("decode regular-expression text: %w", err)
		}
		for key := range pattern {
			if key != "source" && key != "flags" {
				return fmt.Errorf("decode regular-expression text: unknown field %q", key)
			}
		}
		if pattern["source"] == nil {
			return errors.New("decode regular-expression text: source is required")
		}
		var flags string
		if flag, present := pattern["flags"]; present {
			if flag == nil {
				return errors.New("decode regular-expression text: flags must be a string")
			}
			flags = *flag
		}
		*value = RegexText(*pattern["source"], flags)
		return nil
	default:
		return errors.New("decode text matcher: expected string or object")
	}
}
