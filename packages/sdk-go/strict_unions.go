package stagehand

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// decodeStrictVariantJSON decodes one closed object variant. Semantic JSON
// Schema constraints remain the responsibility of the generated model layer
// or the authoritative protocol boundary.
func decodeStrictVariantJSON(data []byte, target any) error {
	if firstJSONByte(data) != '{' {
		return errors.New("expected JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return fmt.Errorf("decode trailing JSON: %w", err)
	}
	return nil
}
