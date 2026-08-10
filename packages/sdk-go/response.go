package stagehand

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Response is a lazy wrapper around a navigation response descriptor.
type Response struct {
	rpc        protocolClient
	descriptor NavigationResponseDescriptor
}

func newResponse(rpc protocolClient, descriptor NavigationResponseDescriptor) *Response {
	descriptor.Headers = copyStringMap(descriptor.Headers)
	return &Response{rpc: rpc, descriptor: descriptor}
}

// URL returns the final response URL.
func (r *Response) URL() string {
	return r.descriptor.URL
}

// Status returns the HTTP response status code.
func (r *Response) Status() int {
	return r.descriptor.Status
}

// StatusText returns the HTTP response status text.
func (r *Response) StatusText() string {
	return r.descriptor.StatusText
}

// OK reports whether the response status is in the 2xx range.
func (r *Response) OK() bool {
	return r.Status() >= 200 && r.Status() <= 299
}

// Headers returns a copy of the normalized provisional response headers.
func (r *Response) Headers() map[string]string {
	return copyStringMap(r.descriptor.Headers)
}

// AllHeaders retrieves all response headers, including extra-info headers.
func (r *Response) AllHeaders(ctx context.Context) (map[string]string, error) {
	var result ResponseAllHeadersResult
	if err := r.call(ctx, "response.all_headers", &result); err != nil {
		return nil, err
	}
	return copyStringMap(result.Headers), nil
}

// HeaderValue retrieves all matching header values and joins them with a comma.
func (r *Response) HeaderValue(ctx context.Context, name string) (string, bool, error) {
	values, err := r.HeaderValues(ctx, name)
	if err != nil {
		return "", false, err
	}
	if len(values) == 0 {
		return "", false, nil
	}
	return strings.Join(values, ", "), true, nil
}

// HeaderValues retrieves separate values for a case-insensitive header name.
func (r *Response) HeaderValues(ctx context.Context, name string) ([]string, error) {
	headers, err := r.HeadersArray(ctx)
	if err != nil {
		return nil, err
	}
	values := make([]string, 0)
	for _, header := range headers {
		if strings.EqualFold(header.Name, name) {
			values = append(values, header.Value)
		}
	}
	return values, nil
}

// HeadersArray retrieves ordered response headers while preserving duplicates.
func (r *Response) HeadersArray(ctx context.Context) ([]NavigationHeader, error) {
	var result ResponseHeadersArrayResult
	if err := r.call(ctx, "response.headers_array", &result); err != nil {
		return nil, err
	}
	return append([]NavigationHeader(nil), result.Headers...), nil
}

// FromServiceWorker reports whether a service worker produced the response.
func (r *Response) FromServiceWorker() bool {
	return r.descriptor.FromServiceWorker
}

// SecurityDetails retrieves TLS details when they are available.
func (r *Response) SecurityDetails(ctx context.Context) (*NavigationSecurityDetails, error) {
	var result ResponseSecurityDetailsResult
	if err := r.call(ctx, "response.security_details", &result); err != nil {
		return nil, err
	}
	if result.Value == nil {
		return nil, nil
	}
	details := *result.Value
	return &details, nil
}

// ServerAddr retrieves the server address when it is available.
func (r *Response) ServerAddr(ctx context.Context) (*NavigationServerAddr, error) {
	var result ResponseServerAddrResult
	if err := r.call(ctx, "response.server_addr", &result); err != nil {
		return nil, err
	}
	if result.Value == nil {
		return nil, nil
	}
	address := *result.Value
	return &address, nil
}

// Body retrieves and decodes the raw response body.
func (r *Response) Body(ctx context.Context) ([]byte, error) {
	var result ResponseBodyResult
	if err := r.call(ctx, "response.body", &result); err != nil {
		return nil, err
	}
	if strings.ContainsAny(result.Body, "\r\n") {
		return nil, errors.New("response.body returned invalid base64")
	}
	body, err := base64.StdEncoding.Strict().DecodeString(result.Body)
	if err != nil {
		return nil, fmt.Errorf("response.body returned invalid base64: %w", err)
	}
	return body, nil
}

// Text retrieves the response body as UTF-8 text.
func (r *Response) Text(ctx context.Context) (string, error) {
	body, err := r.Body(ctx)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// JSON decodes the response body into destination.
func (r *Response) JSON(ctx context.Context, destination any) error {
	body, err := r.Body(ctx)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, destination); err != nil {
		return fmt.Errorf("decode response body as JSON: %w", err)
	}
	return nil
}

// Finished waits for the response to finish and returns its loading error, if any.
func (r *Response) Finished(ctx context.Context) error {
	var result ResponseFinishedResult
	if err := r.call(ctx, "response.finished", &result); err != nil {
		return err
	}
	if result.Error != nil {
		return errors.New(result.Error.Message)
	}
	return nil
}

func (r *Response) call(ctx context.Context, method string, result any) error {
	return r.rpc.call(ctx, method, ResponseIDParams{ResponseID: r.descriptor.ResponseID}, result)
}

func copyStringMap[Map ~map[string]string](source Map) map[string]string {
	if source == nil {
		return nil
	}
	copy := make(map[string]string, len(source))
	for name, value := range source {
		copy[name] = value
	}
	return copy
}
