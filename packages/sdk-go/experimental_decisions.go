package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
)

// ExperimentalDecisions is the Stagehand.ExperimentalDecisions namespace: act,
// observe and extract resolved by a decision model (typed questions answered
// with probabilities, a few hundred milliseconds each) instead of an LLM call,
// falling back to the LLM when the model is not confident. Its operations take
// the same arguments and return the same results as Stagehand.Act,
// Stagehand.Observe and Extract; it requires CreateOptions.ExperimentalDecisions.
//
// Experimental: the surface and its behaviour may change between releases.
type ExperimentalDecisions struct {
	client *Stagehand
}

// Act performs a decision-model-guided action on the selected or active page.
func (d *ExperimentalDecisions) Act(
	ctx context.Context,
	instruction ActInstructionValue,
	options *StagehandClientActOptions,
) (ActResult, error) {
	rpc, err := d.client.connectedProtocol()
	if err != nil {
		return ActResult{}, err
	}
	page, err := d.client.targetPage(ctx, pageFromActOptions(options))
	if err != nil {
		return ActResult{}, err
	}
	params := StagehandActParams{PageID: page.PageID(), Instruction: instruction}
	if options != nil {
		protocolOptions, err := actProtocolOptions(options, page.PageID())
		if err != nil {
			return ActResult{}, err
		}
		params.Options = protocolOptions
	}
	var result ActResult
	if err := rpc.call(ctx, "stagehand.experimental_decisions_act", params, &result); err != nil {
		return ActResult{}, err
	}
	return result, nil
}

// Observe finds actions on the selected or active page with the decision model.
func (d *ExperimentalDecisions) Observe(
	ctx context.Context,
	instruction *string,
	options *StagehandClientObserveOptions,
) (ObserveResult, error) {
	rpc, err := d.client.connectedProtocol()
	if err != nil {
		return ObserveResult{}, err
	}
	page, err := d.client.targetPage(ctx, pageFromObserveOptions(options))
	if err != nil {
		return ObserveResult{}, err
	}
	params := StagehandObserveParams{PageID: page.PageID(), Instruction: instruction}
	if options != nil {
		protocolOptions, err := observeProtocolOptions(options, page.PageID())
		if err != nil {
			return ObserveResult{}, err
		}
		params.Options = protocolOptions
	}
	var result ObserveResult
	if err := rpc.call(ctx, "stagehand.experimental_decisions_observe", params, &result); err != nil {
		return ObserveResult{}, err
	}
	return result, nil
}

// ExperimentalDecisionsExtract is the decision-model variant of Extract: it
// derives a JSON Schema from T, extracts matching data from the selected or
// active page, and decodes the result into T. Go does not allow methods with
// their own type parameters, so it takes the namespace as an argument.
func ExperimentalDecisionsExtract[T any](
	ctx context.Context,
	decisions *ExperimentalDecisions,
	instruction string,
	options *StagehandClientExtractOptions,
) (TypedExtractResult[T], error) {
	var typedResult TypedExtractResult[T]
	if decisions == nil || decisions.client == nil {
		return typedResult, errors.New("stagehand: client is required")
	}
	client := decisions.client
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
		protocolOptions, err := extractProtocolOptions(options, page.PageID())
		if err != nil {
			return typedResult, err
		}
		params.Options = protocolOptions
	}
	var result ExtractResult
	if err := rpc.call(ctx, "stagehand.experimental_decisions_extract", params, &result); err != nil {
		return typedResult, err
	}

	typedResult.Metadata = result.Metadata
	if err := json.Unmarshal(result.Data, &typedResult.Data); err != nil {
		return typedResult, fmt.Errorf("decode stagehand.experimental_decisions_extract result: %w", err)
	}
	return typedResult, nil
}
