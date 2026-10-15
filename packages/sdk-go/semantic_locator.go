package stagehand

import (
	"encoding/json"
	"fmt"
	"strings"
)

const semanticLocatorPrefix = "internal:locator="

// GetByRole creates a lazy locator for elements with the given ARIA role.
// Name and Description filter the accessible name and description, not just
// visible text. Hidden elements are excluded unless IncludeHidden is true.
// Pass nil options for defaults.
func (p *Page) GetByRole(role AriaRole, options *GetByRoleOptions) (*PageLocator, error) {
	return newSemanticLocator(p.rpc, p.PageID(), nil, RoleQueryStep{Kind: "role", Role: role, Options: options})
}

// GetByText creates a lazy locator for elements matching normalized text.
// Pass nil options for case-insensitive substring matching. Exact makes literal
// matches case-sensitive and whole-string; it does not change regular expressions.
func (p *Page) GetByText(text TextMatch, options *GetByTextOptions) (*PageLocator, error) {
	return newSemanticLocator(p.rpc, p.PageID(), nil, textStep(text, options))
}

// GetByRole creates a descendant locator for the given ARIA role. If this locator
// uses First or Nth, the descendant search is scoped to that selected match.
func (l *PageLocator) GetByRole(role AriaRole, options *GetByRoleOptions) (*PageLocator, error) {
	return extendSemanticLocator(l, RoleQueryStep{Kind: "role", Role: role, Options: options})
}

// GetByText creates a descendant locator matching normalized text. If this
// locator uses First or Nth, the search is scoped to that selected match.
func (l *PageLocator) GetByText(text TextMatch, options *GetByTextOptions) (*PageLocator, error) {
	return extendSemanticLocator(l, textStep(text, options))
}

// Locator creates a descendant CSS or XPath locator. Selection by First or Nth
// stays at its current position in the locator chain.
func (l *PageLocator) Locator(selector string) (*PageLocator, error) {
	if strings.HasPrefix(strings.TrimSpace(selector), semanticLocatorPrefix) {
		return nil, fmt.Errorf("selector steps cannot contain another semantic locator query")
	}
	return extendSemanticLocator(l, SelectorQueryStep{Kind: "selector", Selector: selector})
}

type semanticLocatorStep interface {
	SelectorQueryStep | RoleQueryStep | TextQueryStep | NthQueryStep
}

func textStep(text TextMatch, options *GetByTextOptions) TextQueryStep {
	step := TextQueryStep{Kind: "text", Text: text}
	if options != nil {
		step.Exact = options.Exact
	}
	return step
}

func extendSemanticLocator[Step semanticLocatorStep](l *PageLocator, step Step) (*PageLocator, error) {
	var steps []json.RawMessage
	if query, encoded := strings.CutPrefix(l.descriptor.Selector, semanticLocatorPrefix); encoded {
		if err := json.Unmarshal([]byte(query), &steps); err != nil {
			return nil, fmt.Errorf("decode semantic locator query: %w", err)
		}
		if len(steps) == 0 {
			return nil, fmt.Errorf("decode semantic locator query: expected a non-empty array")
		}
		if err := checkLocatorComposition(steps); err != nil {
			return nil, fmt.Errorf("decode semantic locator query: %w", err)
		}
	} else {
		selector, err := json.Marshal(SelectorQueryStep{Kind: "selector", Selector: l.descriptor.Selector})
		if err != nil {
			return nil, fmt.Errorf("encode locator selector: %w", err)
		}
		steps = append(steps, selector)
	}
	if l.descriptor.Nth != nil {
		selection, err := json.Marshal(NthQueryStep{Kind: "nth", Index: *l.descriptor.Nth})
		if err != nil {
			return nil, fmt.Errorf("encode locator index: %w", err)
		}
		steps = append(steps, selection)
	}
	return newSemanticLocator(l.rpc, l.descriptor.PageID, steps, step)
}

// Check composition rules without duplicating the extension's schema validation.
func checkLocatorComposition(steps []json.RawMessage) error {
	for index, raw := range steps {
		var step struct {
			Kind     string `json:"kind"`
			Selector string `json:"selector"`
		}
		if err := json.Unmarshal(raw, &step); err != nil {
			return fmt.Errorf("decode locator step %d: %w", index, err)
		}
		if index == 0 && step.Kind == "nth" {
			return fmt.Errorf("a semantic locator query cannot start with nth")
		}
		if step.Kind == "selector" && strings.HasPrefix(strings.TrimSpace(step.Selector), semanticLocatorPrefix) {
			return fmt.Errorf("selector steps cannot contain another semantic locator query")
		}
	}
	return nil
}

func newSemanticLocator[Step semanticLocatorStep](rpc protocolClient, pageID string, steps []json.RawMessage, step Step) (*PageLocator, error) {
	encodedStep, err := json.Marshal(step)
	if err != nil {
		return nil, fmt.Errorf("encode locator step: %w", err)
	}
	query, err := json.Marshal(append(steps, encodedStep))
	if err != nil {
		return nil, fmt.Errorf("encode semantic locator query: %w", err)
	}
	return &PageLocator{
		rpc: rpc,
		descriptor: LocatorDescriptor{
			PageID: pageID, Selector: semanticLocatorPrefix + string(query),
		},
	}, nil
}
