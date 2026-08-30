package stagehand

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSchemaForTypeMatchesProtocolGoldens(t *testing.T) {
	t.Parallel()

	type Node struct {
		Value    string  `json:"value"`
		Children []*Node `json:"children,omitempty"`
	}
	type BinaryPayload struct {
		Data []byte `json:"data"`
	}

	cases := []struct {
		fixture string
		typ     reflect.Type
	}{
		{fixture: "invopop-recursive-root.json", typ: reflect.TypeFor[Node]()},
		{fixture: "invopop-bytes.json", typ: reflect.TypeFor[BinaryPayload]()},
	}

	for _, tt := range cases {
		t.Run(tt.fixture, func(t *testing.T) {
			t.Parallel()

			raw, err := schemaForType(tt.typ)
			if err != nil {
				t.Fatalf("schemaForType() error = %v", err)
			}
			want, err := os.ReadFile(filepath.Join("..", "protocol", "tests", "fixtures", tt.fixture))
			if err != nil {
				t.Fatalf("read fixture: %v", err)
			}
			if !schemaJSONEqual(t, raw, want) {
				t.Fatalf("schemaForType JSON = %s\nwant %s", raw, want)
			}
		})
	}
}

func schemaJSONEqual(t *testing.T, got, want []byte) bool {
	t.Helper()
	var gotValue any
	var wantValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("decode generated schema: %v", err)
	}
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return reflect.DeepEqual(gotValue, wantValue)
}
