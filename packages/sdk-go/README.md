# Go SDK

Navigation methods return the main-document response when the browser performs a network request:

```go
response, err := page.Goto(ctx, "https://example.com", nil)
if err != nil {
	return err
}
if response != nil {
	body, err := response.Body(ctx)
	if err != nil {
		return err
	}
	fmt.Println(response.Status(), string(body))
}
```

`Reload`, `GoBack`, and `GoForward` use the same `(*Response, error)` pattern. A successful
navigation without a main-document network response returns `(nil, nil)`. Response bodies and
complete headers are retrieved lazily while the Stagehand session remains open.

## Extraction

Define the output as a Go type and call the package-level generic function. Stagehand derives the JSON Schema from the type and returns decoded data with the usual result metadata:

```go
type story struct {
	Title  string `json:"title"`
	Points int    `json:"points"`
}

type stories struct {
	Stories []story `json:"stories"`
}

result, err := stagehand.Extract[stories](ctx, sh, "Extract the top 5 stories", nil)
if err != nil {
	return err
}
fmt.Println(result.Data.Stories)
```

Fields omitted with `json:",omitempty"` are optional in the generated schema. Add constraints such as `jsonschema:"format=uri"` or `jsonschema:"description=the displayed price"` when the Go type alone is not specific enough.

## Examples

Run the flat examples directly from the repository:

```sh
go -C packages/sdk-go run examples/act.go
go -C packages/sdk-go run examples/extract.go
```
