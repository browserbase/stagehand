package stagehand

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestSemanticLocatorBuildersAreLazyAndPreserveRoleOptions(t *testing.T) {
	t.Parallel()
	rpc := &recordingProtocolClient{}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	name := RegexText(`(?<=Publish)\s+now`, "i")
	description := LiteralText("Publishes the draft")
	yes, no, level := true, false, 2
	options := &GetByRoleOptions{
		Name: &name, Description: &description, Exact: &no, IncludeHidden: &yes, Disabled: &no,
		Expanded: &yes, Selected: &no, Checked: &no, Pressed: &yes, Level: &level,
	}
	locator, err := page.GetByRole("button", options)
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"kind":"role","role":"button","options":{"name":{"source":"(?<=Publish)\\s+now","flags":"i"},"description":"Publishes the draft","exact":false,"include_hidden":true,"disabled":false,"expanded":true,"selected":false,"checked":false,"pressed":true,"level":2}}]`
	assertSemanticQuery(t, locator, want)
	if len(rpc.calls) != 0 {
		t.Fatalf("building a locator made %d RPC calls", len(rpc.calls))
	}
	if locator.Descriptor().PageID != "page-1" {
		t.Fatalf("descriptor = %#v", locator.Descriptor())
	}
	// A builder snapshots its options, so subsequent caller mutation cannot
	// change a locator that was already constructed.
	name = LiteralText("changed")
	description = LiteralText("changed description")
	yes = false
	level = 3
	assertSemanticQuery(t, locator, want)
}

func TestSemanticLocatorRoleDescriptionSupportsRegularExpressions(t *testing.T) {
	t.Parallel()
	page := &Page{rpc: &recordingProtocolClient{}, ref: PageRef{PageID: "page-1"}}
	description := RegexText(`^Publishes\b`, "i")
	locator, err := page.GetByRole(AriaRoleButton, &GetByRoleOptions{Description: &description})
	if err != nil {
		t.Fatal(err)
	}
	assertSemanticQuery(t, locator, `[{"kind":"role","role":"button","options":{"description":{"source":"^Publishes\\b","flags":"i"}}}]`)
}

func TestSemanticLocatorChainsPreserveScopeAndNthPosition(t *testing.T) {
	t.Parallel()
	rpc := &recordingProtocolClient{}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	base := page.Locator("iframe >> body").First()
	role, err := base.GetByRole("article", nil)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := role.Nth(2)
	if err != nil {
		t.Fatal(err)
	}
	exact := true
	text, err := selected.GetByText(LiteralText("Publish >> now\n\"yes\""), &GetByTextOptions{Exact: &exact})
	if err != nil {
		t.Fatal(err)
	}
	child, err := text.Locator("span")
	if err != nil {
		t.Fatal(err)
	}
	assertSemanticQuery(t, child, `[{"kind":"selector","selector":"iframe >> body"},{"kind":"nth","index":0},{"kind":"role","role":"article"},{"kind":"nth","index":2},{"kind":"text","text":"Publish >> now\n\"yes\"","exact":true},{"kind":"selector","selector":"span"}]`)
	if child.Descriptor().Nth != nil {
		t.Fatal("ancestor nth was left on the final descriptor")
	}
	if got := base.Descriptor(); got.Selector != "iframe >> body" || got.Nth == nil || *got.Nth != 0 {
		t.Fatalf("base locator was mutated: %#v", got)
	}
	assertSemanticQuery(t, role, `[{"kind":"selector","selector":"iframe >> body"},{"kind":"nth","index":0},{"kind":"role","role":"article"}]`)
	if len(rpc.calls) != 0 {
		t.Fatalf("building a locator made %d RPC calls", len(rpc.calls))
	}
}

func TestSemanticLocatorUsesExistingActionDescriptor(t *testing.T) {
	t.Parallel()
	rpc := &recordingProtocolClient{responses: map[string]any{"locator.count": LocatorCountResult(2)}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	locator, err := page.GetByText(LiteralText("Save"), nil)
	if err != nil {
		t.Fatal(err)
	}
	locator = locator.First()
	count, err := locator.Count(context.Background())
	if err != nil || count != 2 {
		t.Fatalf("Count() = %d, %v", count, err)
	}
	if len(rpc.calls) != 1 || rpc.calls[0].method != "locator.count" {
		t.Fatalf("calls = %#v", rpc.calls)
	}
	params, ok := rpc.calls[0].params.(LocatorParams)
	if !ok || params.PageID != "page-1" || params.Selector != locator.Descriptor().Selector || params.Nth == nil || *params.Nth != 0 {
		t.Fatalf("Count params = %#v", rpc.calls[0].params)
	}
}

func TestSemanticLocatorRejectsMalformedReservedQueries(t *testing.T) {
	t.Parallel()
	page := &Page{rpc: &recordingProtocolClient{}, ref: PageRef{PageID: "page-1"}}
	for _, query := range []string{"", "null", "[]", "{}", "[", `"text"`} {
		t.Run(query, func(t *testing.T) {
			locator, err := page.Locator(semanticLocatorPrefix+query).GetByRole("button", nil)
			if err == nil || locator != nil || !strings.Contains(err.Error(), "decode semantic locator query") {
				t.Fatalf("GetByRole() = %#v, %v", locator, err)
			}
		})
	}
}

func TestSemanticLocatorCanExtendButNotNestEncodedQueries(t *testing.T) {
	t.Parallel()
	page := &Page{rpc: &recordingProtocolClient{}, ref: PageRef{PageID: "page-1"}}
	encoded := semanticLocatorPrefix + `[{"kind":"role","role":"button"}]`
	locator, err := page.Locator(encoded).GetByText(LiteralText("Save"), nil)
	if err != nil {
		t.Fatal(err)
	}
	assertSemanticQuery(t, locator, `[{"kind":"role","role":"button"},{"kind":"text","text":"Save"}]`)
	for _, selector := range []string{encoded, "  " + encoded} {
		child, err := page.Locator("section").Locator(selector)
		if err == nil || child != nil || !strings.Contains(err.Error(), "cannot contain another semantic locator query") {
			t.Fatalf("Locator(%q) = %#v, %v", selector, child, err)
		}
	}
}

func assertSemanticQuery(t *testing.T, locator *PageLocator, want string) {
	t.Helper()
	query, ok := strings.CutPrefix(locator.Descriptor().Selector, semanticLocatorPrefix)
	if !ok {
		t.Fatalf("missing semantic query prefix: %q", locator.Descriptor().Selector)
	}
	var gotJSON, wantJSON any
	if err := json.Unmarshal([]byte(query), &gotJSON); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(want), &wantJSON); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotJSON, wantJSON) {
		t.Fatalf("query = %s, want %s", query, want)
	}
}
