package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"

	"github.com/invopop/jsonschema"
)

// TypedExtractResult contains caller-decoded extract data and its protocol metadata.
type TypedExtractResult[T any] struct {
	Data     T                       `json:"data"`
	Metadata StagehandResultMetadata `json:"metadata"`
}

// Extract derives a JSON Schema from T, extracts matching data from the selected
// or active page, and decodes the result into T.
func Extract[T any](
	ctx context.Context,
	client *Stagehand,
	instruction string,
	options *StagehandClientExtractOptions,
) (TypedExtractResult[T], error) {
	var typedResult TypedExtractResult[T]
	if client == nil {
		return typedResult, errors.New("stagehand: client is required")
	}
	schema, err := schemaForType(reflect.TypeFor[T]())
	if err != nil {
		return typedResult, err
	}

	rpc, err := client.connectedProtocol()
	if err != nil {
		return typedResult, err
	}
	page, err := client.targetPage(ctx, pageFromExtractOptions(options))
	if err != nil {
		return typedResult, err
	}
	params := StagehandExtractParams{
		PageID:      page.PageID(),
		Instruction: instruction,
		Schema:      schema,
	}
	if options != nil {
		params.Options = &options.ExtractOptions
	}
	var result ExtractResult
	if err := rpc.call(ctx, "stagehand.extract", params, &result); err != nil {
		return typedResult, err
	}

	typedResult.Metadata = result.Metadata
	if err := json.Unmarshal(result.Data, &typedResult.Data); err != nil {
		return typedResult, fmt.Errorf("decode stagehand.extract result: %w", err)
	}
	return typedResult, nil
}

func schemaForType(resultType reflect.Type) (schema json.RawMessage, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("derive JSON Schema from %s: %v", resultType, recovered)
		}
	}()

	reflected := (&jsonschema.Reflector{Anonymous: true}).ReflectFromType(resultType)
	encoded, err := json.Marshal(reflected)
	if err != nil {
		return nil, fmt.Errorf("encode JSON Schema for %s: %w", resultType, err)
	}
	return encoded, nil
}
