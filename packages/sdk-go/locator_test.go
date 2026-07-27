package stagehand

import (
	"context"
	"testing"
)

func TestPageLocatorPropagatesDescriptorAndMapsResults(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"locator.count":         LocatorCountResult{Count: 3},
		"locator.select_option": LocatorSelectOptionResult{Values: []string{"one"}},
	}}
	locator := (&Page{
		rpc: rpc,
		ref: PageRef{PageID: "page-1"},
	}).Locator("button").Nth(2)

	if err := locator.Click(context.Background(), nil); err != nil {
		t.Fatalf("Click() error = %v", err)
	}
	count, err := locator.Count(context.Background())
	if err != nil {
		t.Fatalf("Count() error = %v", err)
	}
	if count != 3 {
		t.Fatalf("Count() = %d, want 3", count)
	}
	values, err := locator.SelectOption(context.Background(), StringList{"one"})
	if err != nil {
		t.Fatalf("SelectOption() error = %v", err)
	}
	if len(values) != 1 || values[0] != "one" {
		t.Fatalf("SelectOption() = %#v", values)
	}

	clickParams, ok := rpc.calls[0].params.(LocatorClickParams)
	if !ok ||
		clickParams.PageID != "page-1" ||
		clickParams.Selector != "button" ||
		clickParams.Nth == nil ||
		*clickParams.Nth != 2 {
		t.Fatalf("Click() params = %#v", rpc.calls[0].params)
	}
	selectParams, ok := rpc.calls[2].params.(LocatorSelectOptionParams)
	if !ok ||
		selectParams.Nth == nil ||
		*selectParams.Nth != 2 ||
		len(selectParams.Values) != 1 ||
		selectParams.Values[0] != "one" {
		t.Fatalf("SelectOption() params = %#v", rpc.calls[2].params)
	}
}

func TestPageLocatorFirstAndNthReturnIndependentDescriptors(t *testing.T) {
	t.Parallel()

	base := &PageLocator{descriptor: LocatorDescriptor{PageID: "page-1", Selector: "button"}}
	first := base.First().Descriptor()
	third := base.Nth(3).Descriptor()
	original := base.Descriptor()
	if first.Nth == nil || *first.Nth != 0 {
		t.Fatalf("First().Descriptor() = %#v", first)
	}
	if third.Nth == nil || *third.Nth != 3 {
		t.Fatalf("Nth(3).Descriptor() = %#v", third)
	}
	if original.Nth != nil {
		t.Fatalf("base Descriptor() was mutated: %#v", original)
	}
}
