package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
)

const (
	proxyTypeBrowserbase   = "browserbase"
	proxyTypeExternal      = "external"
	modelSourceClient      = "client"
	contentTypeText        = "text"
	contentTypeImage       = "image"
	contentTypeToolUse     = "tool_use"
	contentTypeToolResult  = "tool_result"
	outputFormatText       = "text"
	outputFormatJSONSchema = "json_schema"
)

type actInstructionValue interface {
	isActInstructionValue()
}

type actInstruction string

func (actInstruction) isActInstructionValue() {}
func (Action) isActInstructionValue()         {}

// ActInstructionValue is either a natural-language instruction or an observed action.
type ActInstructionValue struct {
	value actInstructionValue
}

// ActInstruction constructs a natural-language act instruction.
func ActInstruction(value string) ActInstructionValue {
	return ActInstructionValue{value: actInstruction(value)}
}

// ObservedAction constructs an act instruction from an action returned by Observe.
func ObservedAction(value Action) ActInstructionValue {
	return ActInstructionValue{value: value}
}

// AsInstruction returns the instruction variant, if present.
func (value ActInstructionValue) AsInstruction() (string, bool) {
	instruction, ok := value.value.(actInstruction)
	return string(instruction), ok
}

// AsAction returns the observed-action variant, if present.
func (value ActInstructionValue) AsAction() (Action, bool) {
	action, ok := value.value.(Action)
	return action, ok
}

func (value ActInstructionValue) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.ActInstructionValue is unset")
	}
	return json.Marshal(value.value)
}

func (value *ActInstructionValue) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.ActInstructionValue: UnmarshalJSON on nil pointer")
	}
	var instruction string
	if err := json.Unmarshal(data, &instruction); err == nil {
		*value = ActInstruction(instruction)
		return nil
	}
	var action Action
	if err := json.Unmarshal(data, &action); err != nil {
		return fmt.Errorf("decode act instruction: %w", err)
	}
	*value = ObservedAction(action)
	return nil
}

type modelConfigValue interface {
	isModelConfig()
}

func (KnownModelConfig) isModelConfig()  {}
func (CustomModelConfig) isModelConfig() {}

// ModelConfig is either a known provider model or a custom OpenAI-compatible
// endpoint.
type ModelConfig struct {
	value modelConfigValue
}

// KnownModel constructs a known-provider model configuration.
func KnownModel(value KnownModelConfig) ModelConfig {
	return ModelConfig{value: value}
}

// CustomModel constructs a custom-endpoint model configuration.
func CustomModel(value CustomModelConfig) ModelConfig {
	return ModelConfig{value: value}
}

// AsKnown returns the known-provider variant, if present.
func (value ModelConfig) AsKnown() (KnownModelConfig, bool) {
	result, ok := value.value.(KnownModelConfig)
	return result, ok
}

// AsCustom returns the custom-endpoint variant, if present.
func (value ModelConfig) AsCustom() (CustomModelConfig, bool) {
	result, ok := value.value.(CustomModelConfig)
	return result, ok
}

func (value ModelConfig) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.ModelConfig is unset")
	}
	return json.Marshal(value.value)
}

func (value *ModelConfig) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.ModelConfig: UnmarshalJSON on nil pointer")
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(data, &keys); err != nil {
		return fmt.Errorf("decode model config: %w", err)
	}
	if _, custom := keys["base_url"]; custom {
		baseURL, baseURLOK := stringProperty(data, "base_url")
		modelName, modelNameOK := stringProperty(data, "model_name")
		if !baseURLOK || baseURL == "" || !modelNameOK || modelName == "" {
			return errors.New("decode custom model config: base_url and model_name are required")
		}
		var decoded CustomModelConfig
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode custom model config: %w", err)
		}
		*value = CustomModel(decoded)
		return nil
	}
	modelName, modelNameOK := stringProperty(data, "model_name")
	if !modelNameOK || modelName == "" {
		return errors.New("decode known model config: model_name is required")
	}
	var decoded KnownModelConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode known model config: %w", err)
	}
	*value = KnownModel(decoded)
	return nil
}

type stagehandInitModelValue interface {
	isStagehandInitModel()
}

func (ModelConfig) isStagehandInitModel()          {}
func (ClientModelReference) isStagehandInitModel() {}

// StagehandInitModel is either a server model configuration or a reference to
// a model supplied by the client.
type StagehandInitModel struct {
	value stagehandInitModelValue
}

// ServerModel constructs a server-side init model.
func ServerModel(value ModelConfig) StagehandInitModel {
	return StagehandInitModel{value: value}
}

// ClientModel constructs a client-provided init model.
func ClientModel() StagehandInitModel {
	return StagehandInitModel{value: ClientModelReference{Source: modelSourceClient}}
}

// AsServerModel returns the server model variant, if present.
func (value StagehandInitModel) AsServerModel() (ModelConfig, bool) {
	result, ok := value.value.(ModelConfig)
	return result, ok
}

// AsClientModel returns the client model variant, if present.
func (value StagehandInitModel) AsClientModel() (ClientModelReference, bool) {
	result, ok := value.value.(ClientModelReference)
	return result, ok
}

func (value StagehandInitModel) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.StagehandInitModel is unset")
	}
	return json.Marshal(value.value)
}

func (value *StagehandInitModel) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.StagehandInitModel: UnmarshalJSON on nil pointer")
	}
	source, _ := stringProperty(data, "source")
	if source == modelSourceClient {
		*value = ClientModel()
		return nil
	}
	var decoded ModelConfig
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode init model: %w", err)
	}
	*value = ServerModel(decoded)
	return nil
}

type proxyConfigValue interface {
	isProxyConfig()
}

func (BrowserbaseProxyConfig) isProxyConfig() {}
func (ExternalProxyConfig) isProxyConfig()    {}

// ProxyConfig is either a Browserbase-managed or external proxy.
type ProxyConfig struct {
	value proxyConfigValue
}

// BrowserbaseProxy constructs a Browserbase-managed proxy configuration.
func BrowserbaseProxy(value BrowserbaseProxyConfig) ProxyConfig {
	value.Type = proxyTypeBrowserbase
	return ProxyConfig{value: value}
}

// ExternalProxy constructs an external proxy configuration.
func ExternalProxy(value ExternalProxyConfig) ProxyConfig {
	value.Type = proxyTypeExternal
	return ProxyConfig{value: value}
}

// AsBrowserbase returns the Browserbase variant, if present.
func (value ProxyConfig) AsBrowserbase() (BrowserbaseProxyConfig, bool) {
	result, ok := value.value.(BrowserbaseProxyConfig)
	return result, ok
}

// AsExternal returns the external variant, if present.
func (value ProxyConfig) AsExternal() (ExternalProxyConfig, bool) {
	result, ok := value.value.(ExternalProxyConfig)
	return result, ok
}

func (value ProxyConfig) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.ProxyConfig is unset")
	}
	return json.Marshal(value.value)
}

func (value *ProxyConfig) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.ProxyConfig: UnmarshalJSON on nil pointer")
	}
	discriminator, err := requiredStringProperty(data, "type")
	if err != nil {
		return fmt.Errorf("decode proxy config: %w", err)
	}
	switch discriminator {
	case proxyTypeBrowserbase:
		var decoded BrowserbaseProxyConfig
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode Browserbase proxy: %w", err)
		}
		*value = BrowserbaseProxy(decoded)
	case proxyTypeExternal:
		var decoded ExternalProxyConfig
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode external proxy: %w", err)
		}
		*value = ExternalProxy(decoded)
	default:
		return fmt.Errorf("decode proxy config: unknown type %q", discriminator)
	}
	return nil
}

type browserbaseProxiesKind uint8

const (
	browserbaseProxiesUnset browserbaseProxiesKind = iota
	browserbaseProxiesEnabled
	browserbaseProxiesList
)

// BrowserbaseProxies is either the Browserbase proxy toggle or an explicit
// proxy configuration list.
type BrowserbaseProxies struct {
	kind    browserbaseProxiesKind
	enabled bool
	list    []ProxyConfig
}

// BrowserbaseProxyEnabled constructs the boolean proxy form.
func BrowserbaseProxyEnabled(enabled bool) BrowserbaseProxies {
	return BrowserbaseProxies{kind: browserbaseProxiesEnabled, enabled: enabled}
}

// BrowserbaseProxyList constructs the explicit proxy-list form.
func BrowserbaseProxyList(values ...ProxyConfig) BrowserbaseProxies {
	return BrowserbaseProxies{kind: browserbaseProxiesList, list: append([]ProxyConfig(nil), values...)}
}

// AsEnabled returns the boolean variant, if present.
func (value BrowserbaseProxies) AsEnabled() (bool, bool) {
	return value.enabled, value.kind == browserbaseProxiesEnabled
}

// AsList returns a copy of the proxy-list variant, if present.
func (value BrowserbaseProxies) AsList() ([]ProxyConfig, bool) {
	if value.kind != browserbaseProxiesList {
		return nil, false
	}
	return append([]ProxyConfig(nil), value.list...), true
}

func (value BrowserbaseProxies) MarshalJSON() ([]byte, error) {
	switch value.kind {
	case browserbaseProxiesEnabled:
		return json.Marshal(value.enabled)
	case browserbaseProxiesList:
		if value.list == nil {
			value.list = []ProxyConfig{}
		}
		return json.Marshal(value.list)
	default:
		return nil, errors.New("stagehand.BrowserbaseProxies is unset")
	}
}

func (value *BrowserbaseProxies) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.BrowserbaseProxies: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case '[':
		var decoded []ProxyConfig
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode Browserbase proxy list: %w", err)
		}
		*value = BrowserbaseProxyList(decoded...)
		return nil
	case 't', 'f':
	default:
		return errors.New("decode Browserbase proxies: expected boolean or array")
	}
	var enabled bool
	if err := json.Unmarshal(data, &enabled); err != nil {
		return fmt.Errorf("decode Browserbase proxies: %w", err)
	}
	*value = BrowserbaseProxyEnabled(enabled)
	return nil
}

type variableValueValue interface {
	isVariableValue()
}

func (VariablePrimitive) isVariableValue()      {}
func (DescribedVariableValue) isVariableValue() {}

// VariableValue is either a primitive or a described variable.
type VariableValue struct {
	value variableValueValue
}

// PrimitiveVariable constructs a primitive variable value.
func PrimitiveVariable(value VariablePrimitive) VariableValue {
	return VariableValue{value: value}
}

// DescribedVariable constructs a described variable value.
func DescribedVariable(value DescribedVariableValue) VariableValue {
	return VariableValue{value: value}
}

// AsPrimitive returns the primitive variant, if present.
func (value VariableValue) AsPrimitive() (VariablePrimitive, bool) {
	result, ok := value.value.(VariablePrimitive)
	return result, ok
}

// AsDescribed returns the described variant, if present.
func (value VariableValue) AsDescribed() (DescribedVariableValue, bool) {
	result, ok := value.value.(DescribedVariableValue)
	return result, ok
}

func (value VariableValue) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.VariableValue is unset")
	}
	return json.Marshal(value.value)
}

func (value *VariableValue) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.VariableValue: UnmarshalJSON on nil pointer")
	}
	if firstJSONByte(data) == '{' {
		var decoded DescribedVariableValue
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode described variable: %w", err)
		}
		*value = DescribedVariable(decoded)
		return nil
	}
	var decoded VariablePrimitive
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode primitive variable: %w", err)
	}
	*value = PrimitiveVariable(decoded)
	return nil
}

type cookieFilterValue interface {
	isCookieFilter()
}

type cookieName string

func (cookieName) isCookieFilter()  {}
func (CookieRegex) isCookieFilter() {}

// CookieFilter is either an exact string or a regular-expression object.
type CookieFilter struct {
	value cookieFilterValue
}

// ExactCookie constructs an exact string cookie filter.
func ExactCookie(value string) CookieFilter {
	return CookieFilter{value: cookieName(value)}
}

// RegexCookie constructs a regular-expression cookie filter.
func RegexCookie(value CookieRegex) CookieFilter {
	return CookieFilter{value: value}
}

// AsExact returns the exact string variant, if present.
func (value CookieFilter) AsExact() (string, bool) {
	result, ok := value.value.(cookieName)
	return string(result), ok
}

// AsRegex returns the regular-expression variant, if present.
func (value CookieFilter) AsRegex() (CookieRegex, bool) {
	result, ok := value.value.(CookieRegex)
	return result, ok
}

func (value CookieFilter) MarshalJSON() ([]byte, error) {
	if value.value == nil {
		return nil, errors.New("stagehand.CookieFilter is unset")
	}
	return json.Marshal(value.value)
}

func (value *CookieFilter) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.CookieFilter: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case '"':
		var decoded string
		if err := json.Unmarshal(data, &decoded); err != nil {
			return fmt.Errorf("decode exact cookie filter: %w", err)
		}
		*value = ExactCookie(decoded)
		return nil
	case '{':
	default:
		return errors.New("decode cookie filter: expected string or object")
	}
	var decoded CookieRegex
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode regex cookie filter: %w", err)
	}
	*value = RegexCookie(decoded)
	return nil
}

func stringProperty(data []byte, name string) (string, bool) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return "", false
	}
	raw, ok := object[name]
	if !ok {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func requiredStringProperty(data []byte, name string) (string, error) {
	value, ok := stringProperty(data, name)
	if !ok {
		return "", fmt.Errorf("missing or invalid %q discriminator", name)
	}
	return value, nil
}
