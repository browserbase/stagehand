package stagehand

import (
	"encoding/json"
	"testing"
)

func TestVariablePrimitiveStringAndNumber(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name  string
		input string
		check func(*testing.T, VariablePrimitive)
	}{
		{
			name:  "string",
			input: `"value"`,
			check: func(t *testing.T, value VariablePrimitive) {
				decoded, ok := value.AsString()
				if !ok || decoded != "value" {
					t.Fatal("decoded the wrong string variable")
				}
			},
		},
		{
			name:  "number",
			input: `42.5`,
			check: func(t *testing.T, value VariablePrimitive) {
				decoded, ok := value.AsNumber()
				if !ok || decoded != 42.5 {
					t.Fatal("decoded the wrong numeric variable")
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var value VariablePrimitive
			if err := json.Unmarshal([]byte(test.input), &value); err != nil {
				t.Fatal(err)
			}
			test.check(t, value)
			data, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if !jsonEqual([]byte(test.input), data) {
				t.Fatalf("variable primitive round trip mismatch:\nwant %s\n got %s", test.input, data)
			}
		})
	}

	var value VariablePrimitive
	if err := json.Unmarshal([]byte(`{"value":1}`), &value); err == nil {
		t.Fatal("expected non-scalar variable primitive to fail")
	}
}

func TestScrollPercentStringAndNumber(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name  string
		input string
		check func(*testing.T, ScrollPercent)
	}{
		{
			name:  "string",
			input: `"top"`,
			check: func(t *testing.T, value ScrollPercent) {
				decoded, ok := value.AsString()
				if !ok || decoded != "top" {
					t.Fatal("decoded the wrong named scroll percentage")
				}
			},
		},
		{
			name:  "number",
			input: `75.5`,
			check: func(t *testing.T, value ScrollPercent) {
				decoded, ok := value.AsNumber()
				if !ok || decoded != 75.5 {
					t.Fatal("decoded the wrong numeric scroll percentage")
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var value ScrollPercent
			if err := json.Unmarshal([]byte(test.input), &value); err != nil {
				t.Fatal(err)
			}
			test.check(t, value)
			data, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if !jsonEqual([]byte(test.input), data) {
				t.Fatalf("scroll percentage round trip mismatch:\nwant %s\n got %s", test.input, data)
			}
		})
	}

	var value ScrollPercent
	if err := json.Unmarshal([]byte(`["top"]`), &value); err == nil {
		t.Fatal("expected non-scalar scroll percentage to fail")
	}
}
