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

## Examples

Run the flat examples directly from the repository:

```sh
go -C packages/sdk-go run examples/act.go
go -C packages/sdk-go run examples/extract.go
```
