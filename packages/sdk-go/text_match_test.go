package stagehand

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestTextMatchRoundTrip(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name  string
		value TextMatch
		json  string
	}{
		{name: "zero value", json: `""`},
		{name: "literal", value: LiteralText("Save >> \"now\"\n✓"), json: `"Save \u003e\u003e \"now\"\n✓"`},
		{name: "ECMAScript regex", value: RegexText(`(?<=Save)\s+now`, "ig"), json: `{"source":"(?\u003c=Save)\\s+now","flags":"ig"}`},
		{name: "empty regex", value: RegexText("", ""), json: `{"source":""}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			encoded, err := json.Marshal(test.value)
			if err != nil || string(encoded) != test.json {
				t.Fatalf("Marshal() = %s, %v; want %s", encoded, err, test.json)
			}
			var decoded TextMatch
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(decoded, test.value) {
				t.Fatalf("round trip = %#v, want %#v", decoded, test.value)
			}
		})
	}
	if literal, ok := LiteralText("Save").AsLiteral(); !ok || literal != "Save" {
		t.Fatalf("AsLiteral() = %q, %v", literal, ok)
	}
	if source, flags, ok := RegexText("Save", "i").AsRegex(); !ok || source != "Save" || flags != "i" {
		t.Fatalf("AsRegex() = %q, %q, %v", source, flags, ok)
	}
	if _, ok := RegexText("Save", "i").AsLiteral(); ok {
		t.Fatal("regex reported itself as a literal")
	}
	if _, _, ok := LiteralText("Save").AsRegex(); ok {
		t.Fatal("literal reported itself as a regex")
	}
}

func TestTextMatchRejectsInvalidShapesWithoutMutation(t *testing.T) {
	t.Parallel()
	for _, input := range []string{"null", "1", "true", "[]", `{}`, `{"source":null}`, `{"source":1}`, `{"source":"Save","unexpected":true}`, `{"source":"Save","flags":1}`, `{"source":"Save","flags":null}`} {
		t.Run(input, func(t *testing.T) {
			value := LiteralText("original")
			if err := json.Unmarshal([]byte(input), &value); err == nil {
				t.Fatalf("accepted invalid matcher %s", input)
			}
			if literal, ok := value.AsLiteral(); !ok || literal != "original" {
				t.Fatalf("failed decode mutated matcher: %#v", value)
			}
		})
	}
	var nilMatcher *TextMatch
	if err := nilMatcher.UnmarshalJSON([]byte(`"Save"`)); err == nil {
		t.Fatal("nil receiver did not return an error")
	}
}
