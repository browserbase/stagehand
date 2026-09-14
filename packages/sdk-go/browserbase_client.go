package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBrowserbaseBaseURL      = "https://api.browserbase.com"
	defaultBrowserbaseHTTPTimeout  = 60 * time.Second
	defaultBrowserbaseMaxRetries   = 2
	maxBrowserbaseRetryDelay       = defaultBrowserbaseHTTPTimeout
	maxBrowserbaseAPIResponseBytes = 4 << 20
	stagehandExtensionUploadName   = "stagehand-extension.zip"
)

// BrowserbaseAPIError is a non-successful response from the Browserbase API.
type BrowserbaseAPIError struct {
	Method     string
	Path       string
	StatusCode int
	RequestID  string
	Body       string
}

func (err *BrowserbaseAPIError) Error() string {
	message := browserbaseErrorMessage([]byte(err.Body))
	if message == "" {
		message = http.StatusText(err.StatusCode)
	}
	if message == "" {
		message = "request failed"
	}
	return fmt.Sprintf(
		"Browserbase %s %s returned %d: %s",
		err.Method,
		err.Path,
		err.StatusCode,
		message,
	)
}

type browserbaseHTTPClientOptions struct {
	baseURL    string
	httpClient *http.Client
	maxRetries *int
	sleep      func(context.Context, time.Duration) error
}

type browserbaseHTTPClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	maxRetries int
	sleep      func(context.Context, time.Duration) error
}

type browserbaseAPI interface {
	uploadExtension(context.Context, []byte) (browserbaseExtensionResponse, error)
	deleteExtension(context.Context, string) error
	createSession(
		context.Context,
		browserbaseCreateSessionRequest,
	) (browserbaseCreateSessionResponse, error)
	retrieveSession(context.Context, string) (browserbaseRetrieveSessionResponse, error)
	releaseSession(context.Context, string) (browserbaseSessionResponse, error)
}

func newBrowserbaseHTTPClient(
	apiKey string,
	options browserbaseHTTPClientOptions,
) (*browserbaseHTTPClient, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("stagehand Browserbase API key is required")
	}

	baseURL := options.baseURL
	if baseURL == "" {
		baseURL = defaultBrowserbaseBaseURL
	}
	parsedBaseURL, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse Browserbase base URL: %w", err)
	}
	if (parsedBaseURL.Scheme != "http" && parsedBaseURL.Scheme != "https") ||
		parsedBaseURL.Host == "" ||
		parsedBaseURL.RawQuery != "" ||
		parsedBaseURL.Fragment != "" {
		return nil, fmt.Errorf("invalid Browserbase base URL %q", baseURL)
	}

	httpClient := options.httpClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultBrowserbaseHTTPTimeout}
	}
	maxRetries := defaultBrowserbaseMaxRetries
	if options.maxRetries != nil {
		maxRetries = *options.maxRetries
	}
	if maxRetries < 0 {
		return nil, errors.New("stagehand Browserbase max retries cannot be negative")
	}
	sleep := options.sleep
	if sleep == nil {
		sleep = sleepWithContext
	}

	return &browserbaseHTTPClient{
		baseURL:    strings.TrimRight(parsedBaseURL.String(), "/"),
		apiKey:     apiKey,
		httpClient: httpClient,
		maxRetries: maxRetries,
		sleep:      sleep,
	}, nil
}

func (client *browserbaseHTTPClient) uploadExtension(
	ctx context.Context,
	archive []byte,
) (browserbaseExtensionResponse, error) {
	return sendBrowserbaseRequest[browserbaseExtensionResponse](
		ctx,
		client,
		browserbaseUploadExtensionRequest{
			Archive:  archive,
			FileName: stagehandExtensionUploadName,
		},
	)
}

func (client *browserbaseHTTPClient) deleteExtension(
	ctx context.Context,
	extensionID string,
) error {
	_, err := sendBrowserbaseRequest[browserbaseNoContentResponse](
		ctx,
		client,
		browserbaseDeleteExtensionRequest{ExtensionID: extensionID},
	)
	return err
}

func (client *browserbaseHTTPClient) createSession(
	ctx context.Context,
	request browserbaseCreateSessionRequest,
) (browserbaseCreateSessionResponse, error) {
	return sendBrowserbaseRequest[browserbaseCreateSessionResponse](ctx, client, request)
}

func (client *browserbaseHTTPClient) releaseSession(
	ctx context.Context,
	sessionID string,
) (browserbaseSessionResponse, error) {
	return sendBrowserbaseRequest[browserbaseSessionResponse](
		ctx,
		client,
		browserbaseReleaseSessionRequest{
			SessionID: sessionID,
			Status:    browserbaseSessionReleaseStatus,
		},
	)
}

func (client *browserbaseHTTPClient) retrieveSession(
	ctx context.Context,
	sessionID string,
) (browserbaseRetrieveSessionResponse, error) {
	return sendBrowserbaseRequest[browserbaseRetrieveSessionResponse](
		ctx,
		client,
		browserbaseRetrieveSessionRequest{SessionID: sessionID},
	)
}

type browserbaseEncodedRequest struct {
	method      string
	path        string
	body        []byte
	contentType string
	accept      string
	replaySafe  bool
}

type browserbaseEndpointRequest interface {
	encode() (browserbaseEncodedRequest, error)
}

type browserbaseEndpointResponse interface {
	validate() error
}

func sendBrowserbaseRequest[Response browserbaseEndpointResponse](
	ctx context.Context,
	client *browserbaseHTTPClient,
	request browserbaseEndpointRequest,
) (Response, error) {
	var zero Response
	if ctx == nil {
		return zero, errors.New("stagehand Browserbase request context is required")
	}
	if client == nil {
		return zero, errors.New("stagehand Browserbase HTTP client is required")
	}

	encoded, err := request.encode()
	if err != nil {
		return zero, fmt.Errorf("validate Browserbase %s request: %w", encoded.path, err)
	}
	for attempt := 0; ; attempt++ {
		httpRequest, err := http.NewRequestWithContext(
			ctx,
			encoded.method,
			client.baseURL+encoded.path,
			bytes.NewReader(encoded.body),
		)
		if err != nil {
			return zero, fmt.Errorf("create Browserbase request: %w", err)
		}
		httpRequest.Header.Set("X-BB-API-Key", client.apiKey)
		httpRequest.Header.Set("User-Agent", stagehandSDKClientName+"/"+stagehandSDKVersion)
		if encoded.contentType != "" {
			httpRequest.Header.Set("Content-Type", encoded.contentType)
		}
		if encoded.accept != "" {
			httpRequest.Header.Set("Accept", encoded.accept)
		} else {
			httpRequest.Header.Set("Accept", "application/json")
		}

		httpResponse, requestErr := client.httpClient.Do(httpRequest)
		if requestErr != nil {
			if ctx.Err() != nil {
				return zero, ctx.Err()
			}
			if !encoded.replaySafe || attempt >= client.maxRetries {
				return zero, fmt.Errorf("send Browserbase request: %w", requestErr)
			}
			if err := client.sleep(ctx, browserbaseDefaultRetryDelay(attempt)); err != nil {
				return zero, err
			}
			continue
		}

		responseBody, readErr := readBrowserbaseResponse(httpResponse.Body)
		closeErr := httpResponse.Body.Close()
		if readErr != nil || closeErr != nil {
			return zero, errors.Join(readErr, closeErr)
		}
		if encoded.replaySafe &&
			browserbaseShouldRetry(httpResponse) &&
			attempt < client.maxRetries {
			if err := client.sleep(
				ctx,
				browserbaseRetryDelay(httpResponse.Header, attempt),
			); err != nil {
				return zero, err
			}
			continue
		}
		if httpResponse.StatusCode < http.StatusOK ||
			httpResponse.StatusCode >= http.StatusMultipleChoices {
			return zero, &BrowserbaseAPIError{
				Method:     encoded.method,
				Path:       encoded.path,
				StatusCode: httpResponse.StatusCode,
				RequestID:  httpResponse.Header.Get("x-request-id"),
				Body:       string(responseBody),
			}
		}

		var response Response
		if len(bytes.TrimSpace(responseBody)) != 0 {
			decoder := json.NewDecoder(bytes.NewReader(responseBody))
			if err := decoder.Decode(&response); err != nil {
				return zero, fmt.Errorf(
					"decode Browserbase %s response: %w",
					encoded.path,
					err,
				)
			}
			var trailing any
			if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
				if err == nil {
					err = errors.New("multiple JSON values")
				}
				return zero, fmt.Errorf(
					"decode Browserbase %s response: %w",
					encoded.path,
					err,
				)
			}
		}
		if err := response.validate(); err != nil {
			return zero, fmt.Errorf(
				"validate Browserbase %s response: %w",
				encoded.path,
				err,
			)
		}
		return response, nil
	}
}

func readBrowserbaseResponse(body io.Reader) ([]byte, error) {
	responseBody, err := io.ReadAll(io.LimitReader(body, maxBrowserbaseAPIResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read Browserbase response: %w", err)
	}
	if len(responseBody) > maxBrowserbaseAPIResponseBytes {
		return nil, fmt.Errorf(
			"Browserbase response exceeds %d bytes",
			maxBrowserbaseAPIResponseBytes,
		)
	}
	return responseBody, nil
}

func browserbaseShouldRetry(response *http.Response) bool {
	switch strings.ToLower(strings.TrimSpace(response.Header.Get("x-should-retry"))) {
	case "true":
		return true
	case "false":
		return false
	}
	return response.StatusCode == http.StatusRequestTimeout ||
		response.StatusCode == http.StatusConflict ||
		response.StatusCode == http.StatusTooManyRequests ||
		response.StatusCode >= http.StatusInternalServerError
}

func browserbaseRetryDelay(headers http.Header, attempt int) time.Duration {
	if milliseconds, err := strconv.ParseFloat(
		strings.TrimSpace(headers.Get("retry-after-ms")),
		64,
	); err == nil {
		if delay, ok := browserbaseRetryDuration(milliseconds, time.Millisecond); ok {
			return delay
		}
	}

	retryAfter := strings.TrimSpace(headers.Get("Retry-After"))
	if seconds, err := strconv.ParseFloat(retryAfter, 64); err == nil {
		if delay, ok := browserbaseRetryDuration(seconds, time.Second); ok {
			return delay
		}
	}
	if retryTime, err := http.ParseTime(retryAfter); err == nil {
		if delay := time.Until(retryTime); delay > 0 {
			return min(delay, maxBrowserbaseRetryDelay)
		}
		return 0
	}
	return browserbaseDefaultRetryDelay(attempt)
}

func browserbaseRetryDuration(value float64, unit time.Duration) (time.Duration, bool) {
	if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	if value >= float64(maxBrowserbaseRetryDelay)/float64(unit) {
		return maxBrowserbaseRetryDelay, true
	}
	return time.Duration(value * float64(unit)), true
}

func browserbaseDefaultRetryDelay(attempt int) time.Duration {
	delay := 500 * time.Millisecond * time.Duration(1<<min(attempt, 4))
	return min(delay, 8*time.Second)
}

func sleepWithContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func browserbaseErrorMessage(body []byte) string {
	var response struct {
		Message json.RawMessage `json:"message"`
	}
	if json.Unmarshal(body, &response) != nil || len(response.Message) == 0 {
		return strings.TrimSpace(string(body))
	}
	var message string
	if json.Unmarshal(response.Message, &message) == nil {
		return message
	}
	return strings.TrimSpace(string(response.Message))
}

type browserbaseUploadExtensionRequest struct {
	Archive  []byte
	FileName string
}

func (request browserbaseUploadExtensionRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method: http.MethodPost,
		path:   "/v1/extensions",
	}
	if len(request.Archive) == 0 {
		return encoded, errors.New("extension archive is required")
	}
	if strings.TrimSpace(request.FileName) == "" {
		return encoded, errors.New("extension filename is required")
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", request.FileName)
	if err != nil {
		return encoded, fmt.Errorf("create extension multipart file: %w", err)
	}
	if _, err := file.Write(request.Archive); err != nil {
		return encoded, fmt.Errorf("write extension multipart file: %w", err)
	}
	if err := writer.Close(); err != nil {
		return encoded, fmt.Errorf("close extension multipart body: %w", err)
	}
	encoded.body = body.Bytes()
	encoded.contentType = writer.FormDataContentType()
	return encoded, nil
}

type browserbaseDeleteExtensionRequest struct {
	ExtensionID string
}

func (request browserbaseDeleteExtensionRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method:     http.MethodDelete,
		path:       "/v1/extensions/" + url.PathEscape(request.ExtensionID),
		accept:     "*/*",
		replaySafe: true,
	}
	if strings.TrimSpace(request.ExtensionID) == "" {
		return encoded, errors.New("extension ID is required")
	}
	return encoded, nil
}

type browserbaseReleaseSessionRequest struct {
	SessionID string `json:"-"`
	Status    string `json:"status"`
}

type browserbaseRetrieveSessionRequest struct {
	SessionID string
}

func (request browserbaseRetrieveSessionRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method:     http.MethodGet,
		path:       "/v1/sessions/" + url.PathEscape(request.SessionID),
		replaySafe: true,
	}
	if strings.TrimSpace(request.SessionID) == "" {
		return encoded, errors.New("session ID is required")
	}
	return encoded, nil
}

const browserbaseSessionReleaseStatus = "REQUEST_RELEASE"

func (request browserbaseReleaseSessionRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method:     http.MethodPost,
		path:       "/v1/sessions/" + url.PathEscape(request.SessionID),
		replaySafe: true,
	}
	if strings.TrimSpace(request.SessionID) == "" {
		return encoded, errors.New("session ID is required")
	}
	if request.Status != browserbaseSessionReleaseStatus {
		return encoded, fmt.Errorf("invalid release status %q", request.Status)
	}
	body, err := json.Marshal(request)
	if err != nil {
		return encoded, fmt.Errorf("encode release request: %w", err)
	}
	encoded.body = body
	encoded.contentType = "application/json"
	return encoded, nil
}

type browserbaseCreateSessionRequest struct {
	BrowserSettings *browserbaseBrowserSettingsRequest `json:"browserSettings,omitempty"`
	ExtensionID     *string                            `json:"extensionId,omitempty"`
	KeepAlive       *bool                              `json:"keepAlive,omitempty"`
	Proxies         *browserbaseProxiesRequest         `json:"proxies,omitempty"`
	Region          *BrowserbaseRegion                 `json:"region,omitempty"`
	Timeout         *int64                             `json:"timeout,omitempty"`
	UserMetadata    map[string]json.RawMessage         `json:"userMetadata,omitempty"`
}

func (request browserbaseCreateSessionRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method: http.MethodPost,
		path:   "/v1/sessions",
	}
	if err := request.validate(); err != nil {
		return encoded, err
	}
	body, err := json.Marshal(request)
	if err != nil {
		return encoded, fmt.Errorf("encode session request: %w", err)
	}
	encoded.body = body
	encoded.contentType = "application/json"
	return encoded, nil
}

func (request browserbaseCreateSessionRequest) validate() error {
	if request.ExtensionID != nil && strings.TrimSpace(*request.ExtensionID) == "" {
		return errors.New("extensionId cannot be empty")
	}
	if request.Region != nil && !isBrowserbaseRegion(*request.Region) {
		return fmt.Errorf("invalid region %q", *request.Region)
	}
	if request.Timeout != nil && (*request.Timeout < 60 || *request.Timeout > 21600) {
		return errors.New("timeout must be between 60 and 21600 seconds")
	}
	if request.BrowserSettings != nil {
		if err := request.BrowserSettings.validate(); err != nil {
			return fmt.Errorf("browserSettings: %w", err)
		}
	}
	if request.Proxies != nil {
		if err := request.Proxies.validate(); err != nil {
			return fmt.Errorf("proxies: %w", err)
		}
	}
	for key, value := range request.UserMetadata {
		if !json.Valid(value) {
			return fmt.Errorf("userMetadata[%q] is not valid JSON", key)
		}
	}
	return nil
}

type browserbaseBrowserSettingsRequest struct {
	AdvancedStealth      *bool                          `json:"advancedStealth,omitempty"`
	BlockAds             *bool                          `json:"blockAds,omitempty"`
	CaptchaImageSelector *string                        `json:"captchaImageSelector,omitempty"`
	CaptchaInputSelector *string                        `json:"captchaInputSelector,omitempty"`
	Context              *browserbaseContextRequest     `json:"context,omitempty"`
	ExtensionID          *string                        `json:"extensionId,omitempty"`
	Fingerprint          *browserbaseFingerprintRequest `json:"fingerprint,omitempty"`
	LogSession           *bool                          `json:"logSession,omitempty"`
	OS                   *BrowserbaseBrowserSettingsOS  `json:"os,omitempty"`
	RecordSession        *bool                          `json:"recordSession,omitempty"`
	SolveCaptchas        *bool                          `json:"solveCaptchas,omitempty"`
	Verified             *bool                          `json:"verified,omitempty"`
	Viewport             *browserbaseViewportRequest    `json:"viewport,omitempty"`
}

func (settings browserbaseBrowserSettingsRequest) validate() error {
	if settings.ExtensionID != nil && strings.TrimSpace(*settings.ExtensionID) == "" {
		return errors.New("extensionId cannot be empty")
	}
	if settings.OS != nil && !isBrowserbaseOS(*settings.OS) {
		return fmt.Errorf("invalid os %q", *settings.OS)
	}
	if settings.Fingerprint != nil {
		if err := settings.Fingerprint.validate(); err != nil {
			return fmt.Errorf("fingerprint: %w", err)
		}
	}
	return nil
}

type browserbaseContextRequest struct {
	ID      string `json:"id"`
	Persist *bool  `json:"persist,omitempty"`
}

type browserbaseViewportRequest struct {
	Height *float64 `json:"height,omitempty"`
	Width  *float64 `json:"width,omitempty"`
}

type browserbaseFingerprintRequest struct {
	Browsers         []BrowserbaseFingerprintBrowsersElem         `json:"browsers,omitempty"`
	Devices          []BrowserbaseFingerprintDevicesElem          `json:"devices,omitempty"`
	HTTPVersion      *BrowserbaseFingerprintHTTPVersion           `json:"httpVersion,omitempty"`
	Locales          []string                                     `json:"locales,omitempty"`
	OperatingSystems []BrowserbaseFingerprintOperatingSystemsElem `json:"operatingSystems,omitempty"`
	Screen           *browserbaseFingerprintScreenRequest         `json:"screen,omitempty"`
}

func (fingerprint browserbaseFingerprintRequest) validate() error {
	for _, browser := range fingerprint.Browsers {
		switch browser {
		case BrowserbaseFingerprintBrowsersElemChrome,
			BrowserbaseFingerprintBrowsersElemEdge,
			BrowserbaseFingerprintBrowsersElemFirefox,
			BrowserbaseFingerprintBrowsersElemSafari:
		default:
			return fmt.Errorf("invalid browser %q", browser)
		}
	}
	for _, device := range fingerprint.Devices {
		switch device {
		case BrowserbaseFingerprintDevicesElemDesktop,
			BrowserbaseFingerprintDevicesElemMobile:
		default:
			return fmt.Errorf("invalid device %q", device)
		}
	}
	if fingerprint.HTTPVersion != nil {
		switch *fingerprint.HTTPVersion {
		case BrowserbaseFingerprintHTTPVersionA1, BrowserbaseFingerprintHTTPVersionA2:
		default:
			return fmt.Errorf("invalid HTTP version %q", *fingerprint.HTTPVersion)
		}
	}
	for _, operatingSystem := range fingerprint.OperatingSystems {
		switch operatingSystem {
		case BrowserbaseFingerprintOperatingSystemsElemAndroid,
			BrowserbaseFingerprintOperatingSystemsElemIOS,
			BrowserbaseFingerprintOperatingSystemsElemLinux,
			BrowserbaseFingerprintOperatingSystemsElemMacos,
			BrowserbaseFingerprintOperatingSystemsElemWindows:
		default:
			return fmt.Errorf("invalid operating system %q", operatingSystem)
		}
	}
	return nil
}

type browserbaseFingerprintScreenRequest struct {
	MaxHeight *float64 `json:"maxHeight,omitempty"`
	MaxWidth  *float64 `json:"maxWidth,omitempty"`
	MinHeight *float64 `json:"minHeight,omitempty"`
	MinWidth  *float64 `json:"minWidth,omitempty"`
}

type browserbaseProxyGeolocationRequest struct {
	Country string  `json:"country"`
	City    *string `json:"city,omitempty"`
	State   *string `json:"state,omitempty"`
}

type browserbaseProxyRequest struct {
	Type          string                              `json:"type"`
	DomainPattern *string                             `json:"domainPattern,omitempty"`
	Geolocation   *browserbaseProxyGeolocationRequest `json:"geolocation,omitempty"`
	Server        *string                             `json:"server,omitempty"`
	Username      *string                             `json:"username,omitempty"`
	Password      *string                             `json:"password,omitempty"`
}

func (proxy browserbaseProxyRequest) validate() error {
	switch proxy.Type {
	case proxyTypeBrowserbase:
		if proxy.Geolocation != nil && strings.TrimSpace(proxy.Geolocation.Country) == "" {
			return errors.New("Browserbase proxy geolocation country is required")
		}
		if proxy.Server != nil || proxy.Username != nil || proxy.Password != nil {
			return errors.New("Browserbase proxy cannot contain external proxy credentials")
		}
	case proxyTypeExternal:
		if proxy.Server == nil || strings.TrimSpace(*proxy.Server) == "" {
			return errors.New("external proxy server is required")
		}
		if proxy.Geolocation != nil {
			return errors.New("external proxy cannot contain Browserbase geolocation")
		}
	default:
		return fmt.Errorf("invalid proxy type %q", proxy.Type)
	}
	return nil
}

type browserbaseProxiesRequest struct {
	enabled *bool
	list    []browserbaseProxyRequest
}

func (proxies browserbaseProxiesRequest) validate() error {
	if proxies.enabled != nil {
		if proxies.list != nil {
			return errors.New("boolean and list proxy variants are mutually exclusive")
		}
		return nil
	}
	if proxies.list == nil {
		return errors.New("proxy configuration is unset")
	}
	for index, proxy := range proxies.list {
		if err := proxy.validate(); err != nil {
			return fmt.Errorf("proxy %d: %w", index, err)
		}
	}
	return nil
}

func (proxies browserbaseProxiesRequest) MarshalJSON() ([]byte, error) {
	if err := proxies.validate(); err != nil {
		return nil, err
	}
	if proxies.enabled != nil {
		return json.Marshal(*proxies.enabled)
	}
	return json.Marshal(proxies.list)
}

type browserbaseExtensionResponse struct {
	ID        *string `json:"id"`
	CreatedAt *string `json:"createdAt"`
	FileName  *string `json:"fileName"`
	ProjectID *string `json:"projectId"`
	UpdatedAt *string `json:"updatedAt"`
}

func (response browserbaseExtensionResponse) validate() error {
	if err := requireBrowserbaseResponseFields(map[string]bool{
		"id":        response.ID != nil,
		"createdAt": response.CreatedAt != nil,
		"fileName":  response.FileName != nil,
		"projectId": response.ProjectID != nil,
		"updatedAt": response.UpdatedAt != nil,
	}); err != nil {
		return err
	}
	if strings.TrimSpace(*response.FileName) == "" {
		return errors.New("fileName cannot be empty")
	}
	if err := validateBrowserbaseDateTime("createdAt", *response.CreatedAt); err != nil {
		return err
	}
	return validateBrowserbaseDateTime("updatedAt", *response.UpdatedAt)
}

type browserbaseSessionResponseFields struct {
	ID           *string                    `json:"id"`
	CreatedAt    *string                    `json:"createdAt"`
	ExpiresAt    *string                    `json:"expiresAt"`
	KeepAlive    *bool                      `json:"keepAlive"`
	ProjectID    *string                    `json:"projectId"`
	ProxyBytes   *int64                     `json:"proxyBytes"`
	Region       *BrowserbaseRegion         `json:"region"`
	StartedAt    *string                    `json:"startedAt"`
	Status       *browserbaseSessionStatus  `json:"status"`
	UpdatedAt    *string                    `json:"updatedAt"`
	ContextID    *string                    `json:"contextId,omitempty"`
	EndedAt      *string                    `json:"endedAt,omitempty"`
	UserMetadata map[string]json.RawMessage `json:"userMetadata,omitempty"`
}

func (response browserbaseSessionResponseFields) validate() error {
	if err := requireBrowserbaseResponseFields(map[string]bool{
		"id":         response.ID != nil,
		"createdAt":  response.CreatedAt != nil,
		"expiresAt":  response.ExpiresAt != nil,
		"keepAlive":  response.KeepAlive != nil,
		"projectId":  response.ProjectID != nil,
		"proxyBytes": response.ProxyBytes != nil,
		"region":     response.Region != nil,
		"startedAt":  response.StartedAt != nil,
		"status":     response.Status != nil,
		"updatedAt":  response.UpdatedAt != nil,
	}); err != nil {
		return err
	}
	if !isBrowserbaseRegion(*response.Region) {
		return fmt.Errorf("invalid region %q", *response.Region)
	}
	if !isBrowserbaseSessionStatus(*response.Status) {
		return fmt.Errorf("invalid status %q", *response.Status)
	}
	for name, value := range map[string]*string{
		"createdAt": response.CreatedAt,
		"expiresAt": response.ExpiresAt,
		"startedAt": response.StartedAt,
		"updatedAt": response.UpdatedAt,
	} {
		if err := validateBrowserbaseDateTime(name, *value); err != nil {
			return err
		}
	}
	if response.EndedAt != nil {
		if err := validateBrowserbaseDateTime("endedAt", *response.EndedAt); err != nil {
			return err
		}
	}
	return nil
}

type browserbaseSessionResponse struct {
	browserbaseSessionResponseFields
}

type browserbaseRetrieveSessionResponse struct {
	ID         *string            `json:"id"`
	ConnectURL *string            `json:"connectUrl,omitempty"`
	Region     *BrowserbaseRegion `json:"region,omitempty"`
}

func (response browserbaseRetrieveSessionResponse) validate() error {
	if response.ID == nil {
		return errors.New("required field id is missing")
	}
	if strings.TrimSpace(*response.ID) == "" {
		return errors.New("id cannot be empty")
	}
	if response.ConnectURL != nil {
		if err := validateBrowserbaseURL("connectUrl", *response.ConnectURL, "ws", "wss"); err != nil {
			return err
		}
	}
	if response.Region != nil && !isBrowserbaseRegion(*response.Region) {
		return fmt.Errorf("invalid region %q", *response.Region)
	}
	return nil
}

func (response browserbaseSessionResponse) validate() error {
	return response.browserbaseSessionResponseFields.validate()
}

type browserbaseCreateSessionResponse struct {
	browserbaseSessionResponseFields
	ConnectURL        *string `json:"connectUrl"`
	SeleniumRemoteURL *string `json:"seleniumRemoteUrl"`
	SigningKey        *string `json:"signingKey"`
}

func (response browserbaseCreateSessionResponse) validate() error {
	if err := response.browserbaseSessionResponseFields.validate(); err != nil {
		return err
	}
	if err := requireBrowserbaseResponseFields(map[string]bool{
		"connectUrl":        response.ConnectURL != nil,
		"seleniumRemoteUrl": response.SeleniumRemoteURL != nil,
		"signingKey":        response.SigningKey != nil,
	}); err != nil {
		return err
	}
	if err := validateBrowserbaseURL("connectUrl", *response.ConnectURL, "ws", "wss"); err != nil {
		return err
	}
	return validateBrowserbaseURL(
		"seleniumRemoteUrl",
		*response.SeleniumRemoteURL,
		"http",
		"https",
	)
}

type browserbaseNoContentResponse struct{}

func (browserbaseNoContentResponse) validate() error {
	return nil
}

type browserbaseSessionStatus string

const (
	browserbaseSessionStatusPending   browserbaseSessionStatus = "PENDING"
	browserbaseSessionStatusRunning   browserbaseSessionStatus = "RUNNING"
	browserbaseSessionStatusError     browserbaseSessionStatus = "ERROR"
	browserbaseSessionStatusTimedOut  browserbaseSessionStatus = "TIMED_OUT"
	browserbaseSessionStatusCompleted browserbaseSessionStatus = "COMPLETED"
)

func isBrowserbaseSessionStatus(status browserbaseSessionStatus) bool {
	switch status {
	case browserbaseSessionStatusPending,
		browserbaseSessionStatusRunning,
		browserbaseSessionStatusError,
		browserbaseSessionStatusTimedOut,
		browserbaseSessionStatusCompleted:
		return true
	default:
		return false
	}
}

func isBrowserbaseRegion(region BrowserbaseRegion) bool {
	switch region {
	case BrowserbaseRegionAPSoutheast1,
		BrowserbaseRegionEUCentral1,
		BrowserbaseRegionUSEast1,
		BrowserbaseRegionUSWest2:
		return true
	default:
		return false
	}
}

func isBrowserbaseOS(value BrowserbaseBrowserSettingsOS) bool {
	switch value {
	case BrowserbaseBrowserSettingsOSLinux,
		BrowserbaseBrowserSettingsOSMac,
		BrowserbaseBrowserSettingsOSMobile,
		BrowserbaseBrowserSettingsOSTablet,
		BrowserbaseBrowserSettingsOSWindows:
		return true
	default:
		return false
	}
}

func requireBrowserbaseResponseFields(fields map[string]bool) error {
	for name, present := range fields {
		if !present {
			return fmt.Errorf("required field %s is missing", name)
		}
	}
	return nil
}

func validateBrowserbaseDateTime(name string, value string) error {
	if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
		return fmt.Errorf("%s must be an RFC 3339 date-time: %w", name, err)
	}
	return nil
}

func validateBrowserbaseURL(name string, value string, schemes ...string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("%s must be an absolute URL", name)
	}
	for _, scheme := range schemes {
		if parsed.Scheme == scheme {
			return nil
		}
	}
	return fmt.Errorf("%s must use one of these schemes: %s", name, strings.Join(schemes, ", "))
}

func newBrowserbaseCreateSessionRequest(
	params BrowserbaseLaunchOptions,
	extensionID *string,
) (browserbaseCreateSessionRequest, error) {
	request := browserbaseCreateSessionRequest{
		ExtensionID:  extensionID,
		KeepAlive:    params.KeepAlive,
		Region:       params.Region,
		UserMetadata: cloneRawMessageMap(params.UserMetadata),
	}
	if params.Timeout != nil {
		timeout := *params.Timeout
		if math.IsNaN(timeout) || math.IsInf(timeout, 0) || math.Trunc(timeout) != timeout {
			return browserbaseCreateSessionRequest{}, errors.New(
				"Browserbase timeout must be a whole number of seconds",
			)
		}
		timeoutSeconds := int64(timeout)
		request.Timeout = &timeoutSeconds
	}
	if params.BrowserSettings != nil {
		request.BrowserSettings = convertBrowserbaseBrowserSettings(*params.BrowserSettings)
	}
	if params.Proxies != nil {
		proxies, err := convertBrowserbaseProxies(*params.Proxies)
		if err != nil {
			return browserbaseCreateSessionRequest{}, err
		}
		request.Proxies = &proxies
	}
	if err := request.validate(); err != nil {
		return browserbaseCreateSessionRequest{}, err
	}
	return request, nil
}

func convertBrowserbaseBrowserSettings(
	settings BrowserbaseBrowserSettings,
) *browserbaseBrowserSettingsRequest {
	converted := &browserbaseBrowserSettingsRequest{
		AdvancedStealth:      settings.AdvancedStealth,
		BlockAds:             settings.BlockAds,
		CaptchaImageSelector: settings.CaptchaImageSelector,
		CaptchaInputSelector: settings.CaptchaInputSelector,
		ExtensionID:          settings.ExtensionID,
		LogSession:           settings.LogSession,
		OS:                   settings.OS,
		RecordSession:        settings.RecordSession,
		SolveCaptchas:        settings.SolveCaptchas,
		Verified:             settings.Verified,
	}
	if settings.Context != nil {
		converted.Context = &browserbaseContextRequest{
			ID:      settings.Context.ID,
			Persist: settings.Context.Persist,
		}
	}
	if settings.Viewport != nil {
		converted.Viewport = &browserbaseViewportRequest{
			Height: settings.Viewport.Height,
			Width:  settings.Viewport.Width,
		}
	}
	if settings.Fingerprint != nil {
		converted.Fingerprint = convertBrowserbaseFingerprint(*settings.Fingerprint)
	}
	return converted
}

func convertBrowserbaseFingerprint(
	fingerprint BrowserbaseFingerprint,
) *browserbaseFingerprintRequest {
	converted := &browserbaseFingerprintRequest{
		Browsers:    append([]BrowserbaseFingerprintBrowsersElem(nil), fingerprint.Browsers...),
		Devices:     append([]BrowserbaseFingerprintDevicesElem(nil), fingerprint.Devices...),
		HTTPVersion: fingerprint.HTTPVersion,
		Locales:     append([]string(nil), fingerprint.Locales...),
		OperatingSystems: append(
			[]BrowserbaseFingerprintOperatingSystemsElem(nil),
			fingerprint.OperatingSystems...,
		),
	}
	if fingerprint.Screen != nil {
		converted.Screen = &browserbaseFingerprintScreenRequest{
			MaxHeight: fingerprint.Screen.MaxHeight,
			MaxWidth:  fingerprint.Screen.MaxWidth,
			MinHeight: fingerprint.Screen.MinHeight,
			MinWidth:  fingerprint.Screen.MinWidth,
		}
	}
	return converted
}

func convertBrowserbaseProxies(
	proxies BrowserbaseProxies,
) (browserbaseProxiesRequest, error) {
	if enabled, ok := proxies.AsEnabled(); ok {
		return browserbaseProxiesRequest{enabled: &enabled}, nil
	}
	values, ok := proxies.AsList()
	if !ok {
		return browserbaseProxiesRequest{}, errors.New("Browserbase proxies are unset")
	}
	converted := make([]browserbaseProxyRequest, 0, len(values))
	for index, value := range values {
		if managed, ok := value.AsBrowserbase(); ok {
			proxy := browserbaseProxyRequest{
				Type:          proxyTypeBrowserbase,
				DomainPattern: managed.DomainPattern,
			}
			if managed.Geolocation != nil {
				proxy.Geolocation = &browserbaseProxyGeolocationRequest{
					Country: managed.Geolocation.Country,
					City:    managed.Geolocation.City,
					State:   managed.Geolocation.State,
				}
			}
			converted = append(converted, proxy)
			continue
		}
		if external, ok := value.AsExternal(); ok {
			server := external.Server
			converted = append(converted, browserbaseProxyRequest{
				Type:          proxyTypeExternal,
				DomainPattern: external.DomainPattern,
				Server:        &server,
				Username:      external.Username,
				Password:      external.Password,
			})
			continue
		}
		return browserbaseProxiesRequest{}, fmt.Errorf("Browserbase proxy %d is unset", index)
	}
	result := browserbaseProxiesRequest{list: converted}
	if err := result.validate(); err != nil {
		return browserbaseProxiesRequest{}, err
	}
	return result, nil
}

func cloneRawMessageMap(
	source map[string]json.RawMessage,
) map[string]json.RawMessage {
	if source == nil {
		return nil
	}
	result := make(map[string]json.RawMessage, len(source))
	for key, value := range source {
		result[key] = bytes.Clone(value)
	}
	return result
}
