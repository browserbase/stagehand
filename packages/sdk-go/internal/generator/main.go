// Command generator projects the Stagehand protocol schema into the subset
// supported by go-jsonschema, then generates ordinary Go structs and enums.
// JSON unions are deliberately routed to handwritten types in the parent
// package; generated Go source is never post-processed.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"

	"github.com/atombender/go-jsonschema/pkg/generator"
	"github.com/atombender/go-jsonschema/pkg/schemas"
)

const (
	generatedFile       = "models.gen.go"
	protocolVersionFile = "protocol_version.gen.go"
	rootType            = "generatedModelCatalog"
)

var customDefinitions = map[string]string{
	"Caching":                      "Caching",
	"CookieFilter":                 "CookieFilter",
	"ContextActivePageResult":      "ContextActivePageResult",
	"ContextGetDomainPolicyResult": "ContextGetDomainPolicyResult",
	"EmptyParams":                  "EmptyParams",
	"LLMGenerateParams":            "LLMGenerateParams",
	"LLMGenerateResult":            "LLMGenerateResult",
	"LLMMessageContentBlock":       "LLMMessageContentBlock",
	"LLMMessageGenerateResult":     "LLMMessageGenerateResult",
	"LLMStructuredGenerateResult":  "LLMStructuredGenerateResult",
	"LLMToolResultContentBlock":    "LLMToolResultContentBlock",
	"LoadState":                    "LoadState",
	"ModelConfig":                  "ModelConfig",
	"ModelName":                    "ModelName",
	"ProxyConfig":                  "ProxyConfig",
	"VariablePrimitive":            "VariablePrimitive",
	"VariableValue":                "VariableValue",
	"__schema0":                    "json.RawMessage",
	"__schema1":                    "json.RawMessage",
	"__schema2":                    "json.RawMessage",
	"__schema3":                    "json.RawMessage",
	"__schema4":                    "json.RawMessage",
	"__schema5":                    "json.RawMessage",
	"__schema6":                    "json.RawMessage",
	"__schema7":                    "json.RawMessage",
	"__schema8":                    "json.RawMessage",
}

var customProperties = map[string]string{
	"$defs/BrowserbaseBrowserSource/properties/proxies":       "BrowserbaseProxies",
	"$defs/BrowserbaseBrowserSource/properties/user_metadata": "map[string]json.RawMessage",
	"$defs/ContextCookiesParams/properties/urls":              "StringList",
	"$defs/ExtractResult/properties/result":                   "json.RawMessage",
	"$defs/LLMMessage/properties/content":                     "LLMMessageContent",
	"$defs/LocatorScrollToParams/properties/percent":          "ScrollPercent",
	"$defs/LocatorSelectOptionParams/properties/values":       "StringList",
	"$defs/StagehandActParams/properties/input":               "ActInput",
	"$defs/StagehandInitParams/properties/model":              "StagehandInitModel",
}

// Omissis normally applies the configured Go initialisms. Its case splitter
// cannot separate the adjacent "LLM" and "Json" tokens in this schema name,
// so rename that projected definition before generation.
var renamedDefinitions = map[string]string{
	"LLMJsonSchemaResponseFormat": "LLMJSONSchemaResponseFormat",
}

func main() {
	check := flag.Bool("check", false, "fail when generated models differ")
	flag.Parse()

	if err := run(*check); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(check bool) error {
	sdkRoot, err := findSDKRoot()
	if err != nil {
		return err
	}

	protocolPath := filepath.Join(sdkRoot, "..", "protocol", "stagehand.v4.json")
	protocolData, err := os.ReadFile(protocolPath)
	if err != nil {
		return fmt.Errorf("read protocol schema: %w", err)
	}
	protocolPackagePath := filepath.Join(sdkRoot, "..", "protocol", "package.json")
	protocolPackageData, err := os.ReadFile(protocolPackagePath)
	if err != nil {
		return fmt.Errorf("read protocol package: %w", err)
	}
	protocolVersionSource, err := generateProtocolVersionSource(protocolPackageData)
	if err != nil {
		return err
	}

	protocol, err := decodeObject(protocolData)
	if err != nil {
		return fmt.Errorf("decode protocol schema: %w", err)
	}

	projected, err := projectSchema(protocol)
	if err != nil {
		return fmt.Errorf("project protocol schema: %w", err)
	}

	projectedData, err := json.Marshal(projected)
	if err != nil {
		return fmt.Errorf("encode projected schema: %w", err)
	}
	parsed, err := schemas.FromJSONReader(bytes.NewReader(projectedData))
	if err != nil {
		return fmt.Errorf("parse projected schema: %w", err)
	}

	gen, err := generator.New(generator.Config{
		Capitalizations: []string{
			"AP", "API", "CDP", "CSS", "DOM", "EU", "HTML", "HTTP", "ID", "IOS",
			"JPEG", "JS", "JSON", "LLM", "MIME", "OS", "PNG", "RPC", "TLS", "URI",
			"URL", "US", "UUID", "XML", "XPath",
		},
		DefaultOutputName:  generatedFile,
		DefaultPackageName: "stagehand",
		OnlyModels:         true,
		SchemaMappings: []generator.SchemaMapping{{
			SchemaID:    "",
			PackageName: "stagehand",
			RootType:    rootType,
			OutputName:  generatedFile,
		}},
		Tags: []string{"json"},
		Warner: func(message string) {
			fmt.Fprintf(os.Stderr, "go-jsonschema: %s\n", message)
		},
	})
	if err != nil {
		return fmt.Errorf("create generator: %w", err)
	}
	if err := gen.AddFile("stagehand.models.schema.json", parsed); err != nil {
		return fmt.Errorf("generate models: %w", err)
	}
	sources, err := gen.Sources()
	if err != nil {
		return fmt.Errorf("render generated models: %w", err)
	}
	source, ok := sources[generatedFile]
	if !ok {
		return fmt.Errorf("generator did not produce %s", generatedFile)
	}
	source = append([]byte("// Code generated by go generate; DO NOT EDIT.\n\n"), source...)

	outputPath := filepath.Join(sdkRoot, generatedFile)
	protocolVersionOutputPath := filepath.Join(sdkRoot, protocolVersionFile)
	if check {
		for path, expected := range map[string][]byte{
			outputPath:                source,
			protocolVersionOutputPath: protocolVersionSource,
		} {
			current, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(current, expected) {
				return fmt.Errorf(
					"generated Go files are stale: %s",
					filepath.Base(path),
				)
			}
		}
		return nil
	}

	if err := os.WriteFile(outputPath, source, 0o644); err != nil {
		return fmt.Errorf("write generated models: %w", err)
	}
	if err := os.WriteFile(protocolVersionOutputPath, protocolVersionSource, 0o644); err != nil {
		return fmt.Errorf("write generated protocol version: %w", err)
	}
	return nil
}

func generateProtocolVersionSource(packageData []byte) ([]byte, error) {
	var protocolPackage struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(packageData, &protocolPackage); err != nil {
		return nil, fmt.Errorf("decode protocol package: %w", err)
	}
	majorText, _, _ := strings.Cut(protocolPackage.Version, ".")
	major, err := strconv.Atoi(majorText)
	if err != nil || major <= 0 {
		return nil, fmt.Errorf(
			"invalid Stagehand protocol package version: %s",
			protocolPackage.Version,
		)
	}
	return []byte(fmt.Sprintf(
		"// Code generated from packages/protocol/package.json; DO NOT EDIT.\n\n"+
			"package stagehand\n\n"+
			"const stagehandProtocolVersion = %d\n",
		major,
	)), nil
}

func findSDKRoot() (string, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return "", errors.New("locate generator source")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..")), nil
}

func decodeObject(data []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil {
		return nil, err
	}
	return object, nil
}

func projectSchema(protocol map[string]any) (map[string]any, error) {
	definitions, err := objectAt(protocol, "$defs")
	if err != nil {
		return nil, err
	}

	reachable, err := reachableDefinitions(protocol, definitions)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(reachable))
	for name := range reachable {
		names = append(names, name)
	}
	slices.Sort(names)

	projectedDefinitions := make(map[string]any, len(names))
	catalog := make(map[string]any, len(names))
	for _, name := range names {
		if customType, custom := customDefinitions[name]; custom {
			catalog[name] = customTypeSchema(customType)
			continue
		}
		definition, ok := definitions[name]
		if !ok {
			return nil, fmt.Errorf("reachable definition %q is missing", name)
		}
		projectedName := renamedDefinitions[name]
		if projectedName == "" {
			projectedName = name
		}
		projectedDefinitions[projectedName] = definition
		catalog[name] = map[string]any{"$ref": "#/$defs/" + projectedName}
	}

	projected := map[string]any{
		"$schema":              "https://json-schema.org/draft/2020-12/schema",
		"type":                 "object",
		"properties":           catalog,
		"additionalProperties": false,
		"$defs":                projectedDefinitions,
	}
	transformed, err := transform(projected, nil)
	if err != nil {
		return nil, err
	}
	result, ok := transformed.(map[string]any)
	if !ok {
		return nil, errors.New("projected schema root is not an object")
	}
	if path, keyword, found := findUnion(result, nil); found {
		return nil, fmt.Errorf("unsupported %s remains at %s", keyword, strings.Join(path, "/"))
	}
	return result, nil
}

func reachableDefinitions(protocol, definitions map[string]any) (map[string]struct{}, error) {
	properties, err := objectAt(protocol, "properties")
	if err != nil {
		return nil, err
	}
	reachable := make(map[string]struct{})
	var visitValue func(any) error
	visitValue = func(value any) error {
		switch value := value.(type) {
		case []any:
			for _, entry := range value {
				if err := visitValue(entry); err != nil {
					return err
				}
			}
		case map[string]any:
			if ref, ok := value["$ref"].(string); ok && strings.HasPrefix(ref, "#/$defs/") {
				name := strings.TrimPrefix(ref, "#/$defs/")
				if _, seen := reachable[name]; !seen {
					definition, exists := definitions[name]
					if !exists {
						return fmt.Errorf("reference %q has no definition", ref)
					}
					reachable[name] = struct{}{}
					if err := visitValue(definition); err != nil {
						return err
					}
				}
			}
			for key, entry := range value {
				if key == "$ref" {
					continue
				}
				if err := visitValue(entry); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, key := range []string{"methods", "notifications"} {
		entry, ok := properties[key]
		if !ok {
			return nil, fmt.Errorf("protocol properties missing %q", key)
		}
		if err := visitValue(entry); err != nil {
			return nil, err
		}
	}
	return reachable, nil
}

func transform(value any, path []string) (any, error) {
	switch value := value.(type) {
	case []any:
		result := make([]any, len(value))
		for index, entry := range value {
			transformed, err := transform(entry, appendPath(path, fmt.Sprintf("%d", index)))
			if err != nil {
				return nil, err
			}
			result[index] = transformed
		}
		return result, nil
	case map[string]any:
		pathString := strings.Join(path, "/")
		if customType, ok := customProperties[pathString]; ok {
			return customTypeSchemaWithPointer(customType, nullable(value)), nil
		}

		if ref, ok := value["$ref"].(string); ok {
			name := strings.TrimPrefix(ref, "#/$defs/")
			if customType, custom := customDefinitions[name]; custom {
				return customTypeSchema(customType), nil
			}
			if renamed := renamedDefinitions[name]; renamed != "" {
				copy := make(map[string]any, len(value))
				for key, entry := range value {
					copy[key] = entry
				}
				copy["$ref"] = "#/$defs/" + renamed
				value = copy
			}
		}

		if concrete, ok := nullableConcrete(value); ok {
			transformed, err := transform(concrete, path)
			if err != nil {
				return nil, err
			}
			object, ok := transformed.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("nullable schema at %s did not transform to an object", pathString)
			}
			return withPointer(object), nil
		}

		result := make(map[string]any, len(value))
		for key, entry := range value {
			transformed, err := transform(entry, appendPath(path, key))
			if err != nil {
				return nil, err
			}
			result[key] = transformed
		}
		return result, nil
	default:
		return value, nil
	}
}

func nullable(value map[string]any) bool {
	_, ok := nullableConcrete(value)
	return ok
}

func nullableConcrete(value map[string]any) (map[string]any, bool) {
	for _, keyword := range []string{"anyOf", "oneOf"} {
		entries, ok := value[keyword].([]any)
		if !ok || len(entries) != 2 {
			continue
		}
		var concrete map[string]any
		foundNull := false
		for _, entry := range entries {
			object, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			if object["type"] == "null" {
				foundNull = true
			} else {
				concrete = object
			}
		}
		if foundNull && concrete != nil {
			return concrete, true
		}
	}
	return nil, false
}

func customTypeSchema(customType string) map[string]any {
	return customTypeSchemaWithPointer(customType, false)
}

func customTypeSchemaWithPointer(customType string, pointer bool) map[string]any {
	extension := map[string]any{"type": customType}
	if customType == "json.RawMessage" || strings.HasPrefix(customType, "map[") {
		extension["nillable"] = true
	}
	if pointer {
		extension["pointer"] = true
	}
	if strings.Contains(customType, "json.") {
		extension["imports"] = []any{"encoding/json"}
	}
	return map[string]any{"goJSONSchema": extension}
}

func withPointer(value map[string]any) map[string]any {
	result := make(map[string]any, len(value)+1)
	for key, entry := range value {
		result[key] = entry
	}
	extension, _ := result["goJSONSchema"].(map[string]any)
	if extension == nil {
		extension = make(map[string]any)
		result["goJSONSchema"] = extension
	}
	extension["pointer"] = true
	return result
}

func findUnion(value any, path []string) ([]string, string, bool) {
	switch value := value.(type) {
	case []any:
		for index, entry := range value {
			if foundPath, keyword, found := findUnion(entry, appendPath(path, fmt.Sprintf("%d", index))); found {
				return foundPath, keyword, true
			}
		}
	case map[string]any:
		for _, keyword := range []string{"anyOf", "oneOf"} {
			if _, ok := value[keyword]; ok {
				return appendPath(path, keyword), keyword, true
			}
		}
		for key, entry := range value {
			if foundPath, keyword, found := findUnion(entry, appendPath(path, key)); found {
				return foundPath, keyword, true
			}
		}
	}
	return nil, "", false
}

func objectAt(object map[string]any, key string) (map[string]any, error) {
	value, ok := object[key].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%q is not an object", key)
	}
	return value, nil
}

func appendPath(path []string, value string) []string {
	result := make([]string, len(path), len(path)+1)
	copy(result, path)
	return append(result, value)
}
