package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/propagation"
)

const (
	jsonRPCVersion                 = "2.0"
	jsonRPCParseError              = -32700
	jsonRPCInvalidRequest          = -32600
	jsonRPCMethodNotFound          = -32601
	jsonRPCInvalidParams           = -32602
	jsonRPCInternalError           = -32603
	maxJSONRPCRequestID     uint64 = 9_007_199_254_740_991
	maxPendingNotifications        = 100
	rpcResponseGrace               = 10 * time.Second
	maxRPCResponseTimeout          = time.Duration(math.MaxInt64)
)

var (
	ErrRPCClientClosed       = errors.New("stagehand RPC client is closed")
	rpcTracePropagator       = propagation.TraceContext{}
	defaultOperationTimeouts = map[string]time.Duration{
		"page.goto":                15 * time.Second,
		"page.reload":              15 * time.Second,
		"page.go_back":             15 * time.Second,
		"page.go_forward":          15 * time.Second,
		"page.wait_for_load_state": 15 * time.Second,
		"page.wait_for_selector":   30 * time.Second,
		"page.webmcp_tools":        time.Second,
	}
	unboundedByDefaultMethods = map[string]struct{}{
		"stagehand.init":                 {},
		"stagehand.close":                {},
		"stagehand.act":                  {},
		"stagehand.extract":              {},
		"stagehand.observe":              {},
		"context.new_page":               {},
		"context.add_init_script":        {},
		"context.set_extra_http_headers": {},
		"context.get_domain_policy":      {},
		"context.set_domain_policy":      {},
		"context.cookies":                {},
		"context.add_cookies":            {},
		"context.clear_cookies":          {},
		"context.clipboard_read_text":    {},
		"context.clipboard_write_text":   {},
		"context.clipboard_clear":        {},
		"context.clipboard_paste":        {},
		"context.clipboard_copy":         {},
		"context.clipboard_cut":          {},
		"page.close":                     {},
		"page.evaluate":                  {},
		"page.screenshot":                {},
		"page.snapshot":                  {},
		"page.webmcp_invocation_result":  {},
	}
)

// RPCError is a JSON-RPC error returned by the Stagehand worker.
type RPCError struct {
	Code    int
	Message string
	Data    json.RawMessage
}

func (e *RPCError) Error() string {
	return e.Message
}

// rpcTransport is implemented by the CDP client. Keeping this boundary small
// lets the JSON-RPC state machine run against deterministic transcript tests.
type rpcTransport interface {
	Send(context.Context, json.RawMessage) error
	Receive(context.Context) (json.RawMessage, error)
	Close() error
}

type rpcClient struct {
	transport           rpcTransport
	ownsTransport       bool
	browserWebSocketURL string

	ctx        context.Context
	cancel     context.CancelFunc
	readerDone chan struct{}

	mu                   sync.Mutex
	nextRequestID        uint64
	nextRegistrationID   uint64
	pending              map[uint64]*pendingRPCRequest
	requestHandlers      map[string]registeredRequestHandler
	notificationHandlers map[string][]registeredNotificationHandler
	pendingNotifications []bufferedRPCNotification
	notificationQueue    []rpcNotificationDeliveryGroup
	notificationWake     chan struct{}
	closed               bool
	closeReason          error
	transportCloseError  error
}

var _ protocolClient = (*rpcClient)(nil)

func (client *rpcClient) browserWebSocketDebuggerURL() string {
	return client.browserWebSocketURL
}

type pendingRPCRequest struct {
	method   string
	response chan rpcCallResponse
}

type rpcCallResponse struct {
	result json.RawMessage
	err    error
}

type registeredRequestHandler struct {
	id      uint64
	handler requestHandler
}

type registeredNotificationHandler struct {
	id      uint64
	decode  func(json.RawMessage) (any, error)
	handler func(any)
}

type bufferedRPCNotification struct {
	method string
	params json.RawMessage
}

type rpcNotificationDelivery struct {
	handler      func(any)
	notification any
}

type rpcNotificationDeliveryGroup struct {
	deliveries []rpcNotificationDelivery
}

type rpcRequestEnvelope struct {
	JSONRPC     string          `json:"jsonrpc"`
	ID          uint64          `json:"id"`
	Method      string          `json:"method"`
	Params      json.RawMessage `json:"params,omitempty"`
	Traceparent string          `json:"traceparent,omitempty"`
	Tracestate  string          `json:"tracestate,omitempty"`
}

type rpcSuccessEnvelope struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      uint64          `json:"id"`
	Result  json.RawMessage `json:"result"`
}

type rpcErrorEnvelope struct {
	JSONRPC string             `json:"jsonrpc"`
	ID      any                `json:"id"`
	Error   rpcWireErrorObject `json:"error"`
}

type rpcWireErrorObject struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func newRPCClient(transport rpcTransport, ownsTransport bool) (*rpcClient, error) {
	if transport == nil {
		return nil, errors.New("stagehand RPC transport is required")
	}

	ctx, cancel := context.WithCancel(context.Background())
	client := &rpcClient{
		transport:            transport,
		ownsTransport:        ownsTransport,
		ctx:                  ctx,
		cancel:               cancel,
		readerDone:           make(chan struct{}),
		nextRequestID:        1,
		nextRegistrationID:   1,
		pending:              make(map[uint64]*pendingRPCRequest),
		requestHandlers:      make(map[string]registeredRequestHandler),
		notificationHandlers: make(map[string][]registeredNotificationHandler),
		notificationWake:     make(chan struct{}, 1),
	}
	go client.deliverNotifications()
	go client.read()
	return client, nil
}

func (c *rpcClient) call(ctx context.Context, method string, params any, result any) error {
	if ctx == nil {
		return errors.New("stagehand RPC context is required")
	}
	if method == "" {
		return errors.New("stagehand RPC method is required")
	}
	if result == nil {
		return errors.New("stagehand RPC result target is required")
	}

	encodedParams, err := marshalValidatedJSON(params)
	if err != nil {
		return fmt.Errorf("validate RPC params for %s: %w", method, err)
	}
	callContext := ctx
	cancel := func() {}
	if timeout, ok := rpcResponseTimeout(method, encodedParams); ok {
		callContext, cancel = context.WithTimeout(ctx, timeout)
	}
	defer cancel()

	pending := &pendingRPCRequest{
		method:   method,
		response: make(chan rpcCallResponse, 1),
	}
	requestID, err := c.registerPending(pending)
	if err != nil {
		return err
	}
	defer c.removePending(requestID, pending)

	traceCarrier := propagation.MapCarrier{}
	rpcTracePropagator.Inject(callContext, traceCarrier)
	request, err := json.Marshal(rpcRequestEnvelope{
		JSONRPC:     jsonRPCVersion,
		ID:          requestID,
		Method:      method,
		Params:      encodedParams,
		Traceparent: traceCarrier.Get("traceparent"),
		Tracestate:  traceCarrier.Get("tracestate"),
	})
	if err != nil {
		return fmt.Errorf("encode RPC request for %s: %w", method, err)
	}
	if err := c.transport.Send(callContext, request); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("RPC request canceled: %s: %w", method, ctx.Err())
		}
		if callContext.Err() != nil {
			return fmt.Errorf("RPC response timed out: %s: %w", method, callContext.Err())
		}
		return fmt.Errorf("send RPC request for %s: %w", method, err)
	}

	select {
	case response := <-pending.response:
		if response.err != nil {
			return response.err
		}
		if err := decodeStrictJSON(response.result, result); err != nil {
			return fmt.Errorf("decode RPC result for %s: %w", method, err)
		}
		return nil
	case <-callContext.Done():
		if ctx.Err() != nil {
			return fmt.Errorf("RPC request canceled: %s: %w", method, ctx.Err())
		}
		return fmt.Errorf("RPC response timed out: %s: %w", method, callContext.Err())
	}
}

func rpcResponseTimeout(method string, params json.RawMessage) (time.Duration, bool) {
	var path []string
	switch method {
	case "stagehand.act",
		"stagehand.extract",
		"stagehand.observe",
		"stagehand.callback_batch",
		"page.goto",
		"page.reload",
		"page.go_back",
		"page.go_forward",
		"page.screenshot",
		"page.wait_for_selector",
		"page.webmcp_tools",
		"page.webmcp_invocation_result":
		path = []string{"options", "timeout"}
	case "page.wait_for_load_state":
		path = []string{"timeout"}
	case "page.wait_for_timeout":
		path = []string{"ms"}
	}

	if durationMilliseconds, found := jsonNumberAtPath(params, path...); found {
		return rpcResponseTimeoutForDuration(durationMilliseconds), true
	}
	if defaultTimeout, found := defaultOperationTimeouts[method]; found {
		return rpcResponseGrace + defaultTimeout, true
	}
	// These operations had no v3 deadline. Keep the server as the owner of their
	// lifetime instead of turning the transport grace period into a 10s ceiling.
	if _, found := unboundedByDefaultMethods[method]; found || strings.HasPrefix(method, "locator.") {
		return 0, false
	}
	return rpcResponseGrace, true
}

func rpcResponseTimeoutForDuration(durationMilliseconds float64) time.Duration {
	if durationMilliseconds < 0 {
		durationMilliseconds = 0
	}
	maxOperationDuration := maxRPCResponseTimeout - rpcResponseGrace
	operationNanoseconds := durationMilliseconds * float64(time.Millisecond)
	if math.IsInf(operationNanoseconds, 1) ||
		operationNanoseconds >= float64(maxOperationDuration) {
		return maxRPCResponseTimeout
	}
	return rpcResponseGrace + time.Duration(operationNanoseconds)
}

func jsonNumberAtPath(encoded json.RawMessage, path ...string) (float64, bool) {
	if len(path) == 0 {
		return 0, false
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var current any
	if err := decoder.Decode(&current); err != nil {
		return 0, false
	}
	for _, property := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return 0, false
		}
		current, ok = object[property]
		if !ok {
			return 0, false
		}
	}
	number, ok := current.(json.Number)
	if !ok {
		return 0, false
	}
	value, err := number.Float64()
	if err != nil {
		if math.IsInf(value, 1) {
			return value, true
		}
		return 0, false
	}
	return value, true
}

func (c *rpcClient) onRequest(method string, handler requestHandler) func() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return func() {}
	}
	registration := registeredRequestHandler{id: c.nextRegistrationID, handler: handler}
	c.nextRegistrationID++
	c.requestHandlers[method] = registration
	c.mu.Unlock()

	return func() {
		c.mu.Lock()
		current, ok := c.requestHandlers[method]
		if ok && current.id == registration.id {
			delete(c.requestHandlers, method)
		}
		c.mu.Unlock()
	}
}

func (c *rpcClient) onNotification(method string, handler func(StagehandLog)) func() {
	return registerNotification(c, method, handler)
}

func (c *rpcClient) onPageCDPEvent(handler func(PageCDPEventNotification)) func() {
	return registerNotification(c, "page.cdp_event", handler)
}

func registerNotification[Notification any](
	c *rpcClient,
	method string,
	handler func(Notification),
) func() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return func() {}
	}
	registration := registeredNotificationHandler{
		id: c.nextRegistrationID,
		decode: func(raw json.RawMessage) (any, error) {
			var notification Notification
			if err := decodeStrictJSON(raw, &notification); err != nil {
				return nil, err
			}
			return notification, nil
		},
		handler: func(notification any) {
			handler(notification.(Notification))
		},
	}
	c.nextRegistrationID++
	c.notificationHandlers[method] = append(c.notificationHandlers[method], registration)

	retained := c.pendingNotifications[:0]
	for _, notification := range c.pendingNotifications {
		if notification.method == method {
			if decoded, err := registration.decode(notification.params); err == nil {
				c.enqueueNotificationLocked(rpcNotificationDeliveryGroup{
					deliveries: []rpcNotificationDelivery{{
						handler:      registration.handler,
						notification: decoded,
					}},
				})
			}
		} else {
			retained = append(retained, notification)
		}
	}
	c.pendingNotifications = retained
	c.mu.Unlock()
	c.wakeNotificationDelivery()

	return func() {
		c.mu.Lock()
		handlers := c.notificationHandlers[method]
		for index, current := range handlers {
			if current.id != registration.id {
				continue
			}
			handlers = append(handlers[:index], handlers[index+1:]...)
			break
		}
		if len(handlers) == 0 {
			delete(c.notificationHandlers, method)
		} else {
			c.notificationHandlers[method] = handlers
		}
		c.mu.Unlock()
	}
}

func (c *rpcClient) close() error {
	c.shutdown(ErrRPCClientClosed)
	<-c.readerDone

	c.mu.Lock()
	defer c.mu.Unlock()
	return c.transportCloseError
}

func (c *rpcClient) read() {
	defer close(c.readerDone)
	for {
		message, err := c.transport.Receive(c.ctx)
		if err != nil {
			if c.ctx.Err() == nil {
				c.shutdown(err)
			}
			return
		}
		if err := c.receive(message); err != nil {
			c.shutdown(err)
			return
		}
	}
}

func (c *rpcClient) receive(message json.RawMessage) error {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(message, &envelope); err != nil {
		c.sendError(nil, jsonRPCParseError, "Parse error", nil)
		return nil
	}
	if envelope == nil {
		c.sendError(nil, jsonRPCInvalidRequest, "Invalid request", nil)
		return nil
	}

	_, hasResult := envelope["result"]
	_, hasError := envelope["error"]
	if hasResult || hasError {
		return c.receiveResponse(envelope)
	}

	method, ok := strictJSONString(envelope["method"])
	if !ok || !validJSONRPCVersion(envelope) {
		c.sendError(requestIDForError(envelope), jsonRPCInvalidRequest, "Invalid request", nil)
		return nil
	}

	params := envelope["params"]
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}
	if !validRPCParams(params) {
		c.sendError(requestIDForError(envelope), jsonRPCInvalidRequest, "Invalid request", nil)
		return nil
	}

	rawID, hasID := envelope["id"]
	if !hasID {
		if !hasOnlyKeys(envelope, "jsonrpc", "method", "params") {
			return nil
		}
		c.receiveNotification(method, params)
		return nil
	}

	requestID, ok := parseRPCRequestID(rawID)
	if !ok || !hasOnlyKeys(
		envelope,
		"jsonrpc",
		"id",
		"method",
		"params",
		"traceparent",
		"tracestate",
	) {
		c.sendError(requestIDForError(envelope), jsonRPCInvalidRequest, "Invalid request", nil)
		return nil
	}
	traceparent, traceparentOK := optionalJSONString(envelope, "traceparent")
	tracestate, tracestateOK := optionalJSONString(envelope, "tracestate")
	if !traceparentOK || !tracestateOK {
		c.sendError(requestID, jsonRPCInvalidRequest, "Invalid request", nil)
		return nil
	}

	c.receiveRequest(requestID, method, params, traceparent, tracestate)
	return nil
}

func (c *rpcClient) receiveResponse(envelope map[string]json.RawMessage) error {
	if !validJSONRPCVersion(envelope) {
		return errors.New("invalid JSON-RPC response")
	}
	_, hasResult := envelope["result"]
	_, hasError := envelope["error"]
	if hasResult == hasError || !hasOnlyKeys(envelope, "jsonrpc", "id", "result", "error") {
		return errors.New("invalid JSON-RPC response")
	}

	requestID, ok := parseRPCRequestID(envelope["id"])
	if !ok {
		if hasError && bytes.Equal(bytes.TrimSpace(envelope["id"]), []byte("null")) {
			return nil
		}
		return errors.New("invalid JSON-RPC response")
	}

	response := rpcCallResponse{result: envelope["result"]}
	if hasError {
		rpcError, err := decodeRPCError(envelope["error"])
		if err != nil {
			return errors.New("invalid JSON-RPC response")
		}
		response.result = nil
		response.err = rpcError
	}

	c.mu.Lock()
	pending := c.pending[requestID]
	if pending != nil {
		delete(c.pending, requestID)
	}
	c.mu.Unlock()
	if pending != nil {
		pending.response <- response
	}
	return nil
}

func (c *rpcClient) receiveRequest(
	requestID uint64,
	method string,
	params json.RawMessage,
	traceparent string,
	tracestate string,
) {
	c.mu.Lock()
	registration, ok := c.requestHandlers[method]
	closed := c.closed
	c.mu.Unlock()
	if closed {
		return
	}
	if !ok {
		c.sendError(requestID, jsonRPCMethodNotFound, "Method not found", nil)
		return
	}

	go func() {
		decoded, err := registration.handler.decode(params)
		if err != nil {
			c.sendError(requestID, jsonRPCInvalidParams, "Invalid params", nil)
			return
		}
		traceCarrier := propagation.MapCarrier{}
		traceCarrier.Set("traceparent", traceparent)
		traceCarrier.Set("tracestate", tracestate)
		handlerContext := rpcTracePropagator.Extract(c.ctx, traceCarrier)
		result, err := registration.handler.handle(handlerContext, decoded)
		if err != nil {
			data, _ := json.Marshal(map[string]string{"name": "Error"})
			c.sendError(requestID, jsonRPCInternalError, err.Error(), data)
			return
		}
		encoded, err := registration.handler.encode(result)
		if err != nil {
			c.sendError(requestID, jsonRPCInternalError, "Internal error", nil)
			return
		}
		c.sendSuccess(requestID, encoded)
	}()
}

func (c *rpcClient) receiveNotification(method string, params json.RawMessage) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	handlers := append([]registeredNotificationHandler(nil), c.notificationHandlers[method]...)
	if len(handlers) == 0 {
		c.pendingNotifications = append(c.pendingNotifications, bufferedRPCNotification{
			method: method,
			params: append(json.RawMessage(nil), params...),
		})
		if len(c.pendingNotifications) > maxPendingNotifications {
			c.pendingNotifications = c.pendingNotifications[len(c.pendingNotifications)-maxPendingNotifications:]
		}
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()

	deliveries := make([]rpcNotificationDelivery, 0, len(handlers))
	for _, registration := range handlers {
		notification, err := registration.decode(params)
		if err != nil {
			continue
		}
		deliveries = append(deliveries, rpcNotificationDelivery{
			handler:      registration.handler,
			notification: notification,
		})
	}
	if len(deliveries) == 0 {
		return
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.enqueueNotificationLocked(rpcNotificationDeliveryGroup{deliveries: deliveries})
	c.mu.Unlock()
	c.wakeNotificationDelivery()
}

func (c *rpcClient) enqueueNotificationLocked(group rpcNotificationDeliveryGroup) {
	c.notificationQueue = append(c.notificationQueue, group)
	if len(c.notificationQueue) > maxPendingNotifications {
		dropped := len(c.notificationQueue) - maxPendingNotifications
		clear(c.notificationQueue[:dropped])
		c.notificationQueue = c.notificationQueue[dropped:]
	}
}

func (c *rpcClient) wakeNotificationDelivery() {
	select {
	case c.notificationWake <- struct{}{}:
	default:
	}
}

func (c *rpcClient) deliverNotifications() {
	for {
		c.mu.Lock()
		if len(c.notificationQueue) > 0 {
			group := c.notificationQueue[0]
			c.notificationQueue[0] = rpcNotificationDeliveryGroup{}
			c.notificationQueue = c.notificationQueue[1:]
			c.mu.Unlock()
			for _, delivery := range group.deliveries {
				delivery.handler(delivery.notification)
			}
			continue
		}
		c.mu.Unlock()

		select {
		case <-c.notificationWake:
		case <-c.ctx.Done():
			return
		}
	}
}

func (c *rpcClient) sendSuccess(requestID uint64, result json.RawMessage) {
	response, err := json.Marshal(rpcSuccessEnvelope{
		JSONRPC: jsonRPCVersion,
		ID:      requestID,
		Result:  result,
	})
	if err != nil {
		return
	}
	_ = c.transport.Send(c.ctx, response)
}

func (c *rpcClient) sendError(requestID any, code int, message string, data json.RawMessage) {
	response, err := json.Marshal(rpcErrorEnvelope{
		JSONRPC: jsonRPCVersion,
		ID:      requestID,
		Error: rpcWireErrorObject{
			Code:    code,
			Message: message,
			Data:    data,
		},
	})
	if err != nil {
		return
	}
	_ = c.transport.Send(c.ctx, response)
}

func (c *rpcClient) registerPending(pending *pendingRPCRequest) (uint64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		if c.closeReason != nil {
			return 0, c.closeReason
		}
		return 0, ErrRPCClientClosed
	}
	if c.nextRequestID > maxJSONRPCRequestID {
		return 0, errors.New("stagehand RPC request ID space exhausted")
	}
	requestID := c.nextRequestID
	c.nextRequestID++
	c.pending[requestID] = pending
	return requestID, nil
}

func (c *rpcClient) removePending(requestID uint64, pending *pendingRPCRequest) {
	c.mu.Lock()
	if c.pending[requestID] == pending {
		delete(c.pending, requestID)
	}
	c.mu.Unlock()
}

func (c *rpcClient) shutdown(reason error) {
	if reason == nil {
		reason = ErrRPCClientClosed
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.closeReason = reason
	pending := make([]*pendingRPCRequest, 0, len(c.pending))
	for _, request := range c.pending {
		pending = append(pending, request)
	}
	clear(c.pending)
	clear(c.requestHandlers)
	clear(c.notificationHandlers)
	c.pendingNotifications = nil
	c.notificationQueue = nil
	c.cancel()
	c.mu.Unlock()

	for _, request := range pending {
		request.response <- rpcCallResponse{err: reason}
	}
	if c.ownsTransport {
		closeErr := c.transport.Close()
		c.mu.Lock()
		c.transportCloseError = closeErr
		c.mu.Unlock()
	}
}

func newRequestHandler[Params any, Result any](
	handler func(context.Context, Params) (Result, error),
) requestHandler {
	return requestHandler{
		decode: func(raw json.RawMessage) (any, error) {
			var params Params
			if err := decodeStrictJSON(raw, &params); err != nil {
				return nil, err
			}
			return params, nil
		},
		handle: func(ctx context.Context, value any) (any, error) {
			params, ok := value.(Params)
			if !ok {
				return nil, errors.New("invalid RPC handler params")
			}
			return handler(ctx, params)
		},
		encode: func(value any) (json.RawMessage, error) {
			result, ok := value.(Result)
			if !ok {
				return nil, errors.New("invalid RPC handler result")
			}
			return marshalValidatedJSON(result)
		},
	}
}

func (h requestHandler) invoke(ctx context.Context, raw json.RawMessage) (any, error) {
	params, err := h.decode(raw)
	if err != nil {
		return nil, err
	}
	return h.handle(ctx, params)
}

func marshalValidatedJSON(value any) (json.RawMessage, error) {
	if value == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}

	valueType := reflect.TypeOf(value)
	var target reflect.Value
	if valueType.Kind() == reflect.Pointer {
		target = reflect.New(valueType.Elem())
	} else {
		target = reflect.New(valueType)
	}
	if err := decodeStrictJSON(encoded, target.Interface()); err != nil {
		return nil, err
	}
	return encoded, nil
}

func decodeStrictJSON(data json.RawMessage, target any) error {
	targetType := reflect.TypeOf(target)
	if targetType == nil || targetType.Kind() != reflect.Pointer {
		return errors.New("strict JSON target must be a non-nil pointer")
	}
	if err := validateRequiredJSONFields(data, targetType.Elem()); err != nil {
		return err
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func validateRequiredJSONFields(data json.RawMessage, valueType reflect.Type) error {
	jsonUnmarshalerType := reflect.TypeOf((*json.Unmarshaler)(nil)).Elem()
	if valueType.Implements(jsonUnmarshalerType) ||
		(valueType.Kind() != reflect.Pointer && reflect.PointerTo(valueType).Implements(jsonUnmarshalerType)) {
		return nil
	}

	for valueType.Kind() == reflect.Pointer {
		valueType = valueType.Elem()
	}

	switch valueType.Kind() {
	case reflect.Struct:
		var object map[string]json.RawMessage
		if err := json.Unmarshal(data, &object); err != nil {
			return err
		}
		for index := 0; index < valueType.NumField(); index++ {
			field := valueType.Field(index)
			if !field.IsExported() {
				continue
			}
			tag := field.Tag.Get("json")
			name, options, _ := strings.Cut(tag, ",")
			if name == "-" {
				continue
			}
			if field.Anonymous && name == "" {
				if err := validateRequiredJSONFields(data, field.Type); err != nil {
					return err
				}
				continue
			}
			if name == "" {
				name = field.Name
			}
			raw, present := object[name]
			optional := false
			for _, option := range strings.Split(options, ",") {
				if option == "omitempty" || option == "omitzero" {
					optional = true
				}
			}
			if !present {
				if optional {
					continue
				}
				return fmt.Errorf("missing required JSON field %q", name)
			}
			if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
				continue
			}
			if err := validateRequiredJSONFields(raw, field.Type); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
	case reflect.Slice, reflect.Array:
		if valueType.Elem().Kind() == reflect.Uint8 {
			return nil
		}
		var values []json.RawMessage
		if err := json.Unmarshal(data, &values); err != nil {
			return err
		}
		for index, value := range values {
			if err := validateRequiredJSONFields(value, valueType.Elem()); err != nil {
				return fmt.Errorf("[%d]: %w", index, err)
			}
		}
	case reflect.Map:
		if valueType.Key().Kind() != reflect.String {
			return nil
		}
		var values map[string]json.RawMessage
		if err := json.Unmarshal(data, &values); err != nil {
			return err
		}
		for key, value := range values {
			if err := validateRequiredJSONFields(value, valueType.Elem()); err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
		}
	}
	return nil
}

func decodeRPCError(raw json.RawMessage) (*RPCError, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	if _, ok := fields["code"]; !ok {
		return nil, errors.New("missing JSON-RPC error code")
	}
	if _, ok := fields["message"]; !ok {
		return nil, errors.New("missing JSON-RPC error message")
	}
	var object struct {
		Code    json.Number     `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data,omitempty"`
	}
	if err := decodeStrictJSON(raw, &object); err != nil {
		return nil, err
	}
	code, err := strconv.ParseInt(object.Code.String(), 10, 64)
	if err != nil {
		return nil, err
	}
	return &RPCError{
		Code:    int(code),
		Message: object.Message,
		Data:    object.Data,
	}, nil
}

func validJSONRPCVersion(envelope map[string]json.RawMessage) bool {
	version, ok := strictJSONString(envelope["jsonrpc"])
	return ok && version == jsonRPCVersion
}

func validRPCParams(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || (trimmed[0] != '{' && trimmed[0] != '[') {
		return false
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	return decoder.Decode(&value) == nil
}

func parseRPCRequestID(raw json.RawMessage) (uint64, bool) {
	value := strings.TrimSpace(string(raw))
	if value == "" || strings.ContainsAny(value, ".eE+-") {
		return 0, false
	}
	requestID, err := strconv.ParseUint(value, 10, 64)
	return requestID, err == nil && requestID <= maxJSONRPCRequestID
}

func requestIDForError(envelope map[string]json.RawMessage) any {
	requestID, ok := parseRPCRequestID(envelope["id"])
	if !ok {
		return nil
	}
	return requestID
}

func strictJSONString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func optionalJSONString(
	envelope map[string]json.RawMessage,
	key string,
) (string, bool) {
	raw, ok := envelope[key]
	if !ok {
		return "", true
	}
	return strictJSONString(raw)
}

func hasOnlyKeys(envelope map[string]json.RawMessage, allowed ...string) bool {
	allowedKeys := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedKeys[key] = struct{}{}
	}
	for key := range envelope {
		if _, ok := allowedKeys[key]; !ok {
			return false
		}
	}
	return true
}
