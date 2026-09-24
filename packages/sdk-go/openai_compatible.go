package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// OpenAICompatibleOptions configures an OpenAI-compatible Chat Completions endpoint.
type OpenAICompatibleOptions struct {
	Model     string
	BaseURL   string
	APIKey    string
	Headers   http.Header
	ExtraBody map[string]any
	Client    *http.Client
}

type chatContentPart struct {
	Type     string            `json:"type"`
	Text     string            `json:"text,omitempty"`
	ImageURL map[string]string `json:"image_url,omitempty"`
}

func chatMessageContent(content LLMMessageContent) (any, error) {
	parts := make([]chatContentPart, 0, len(content))
	textOnly := true
	for _, block := range content {
		if text, ok := block.AsText(); ok {
			parts = append(parts, chatContentPart{Type: "text", Text: text.Text})
			continue
		}
		if image, ok := block.AsImage(); ok {
			parts = append(parts, chatContentPart{
				Type:     "image_url",
				ImageURL: map[string]string{"url": "data:" + image.MIMEType + ";base64," + image.Data},
			})
			textOnly = false
			continue
		}
		return nil, errors.New("OpenAI-compatible models accept only text and image content")
	}
	if textOnly {
		var text strings.Builder
		for _, part := range parts {
			text.WriteString(part.Text)
		}
		return text.String(), nil
	}
	return parts, nil
}

// OpenAICompatible returns a client-side callback for Chat Completions endpoints.
func OpenAICompatible(options OpenAICompatibleOptions) LLMGenerateFunc {
	client := options.Client
	if client == nil {
		client = http.DefaultClient
	}
	return func(ctx context.Context, params LLMGenerateParams) (LLMGenerateResult, error) {
		request, ok := params.AsStructured()
		if !ok {
			return LLMGenerateResult{}, errors.New("Stagehand only issues structured generations")
		}
		messages := make([]map[string]any, 0, len(request.Messages)+1)
		if request.SystemPrompt != nil {
			messages = append(messages, map[string]any{"role": "system", "content": *request.SystemPrompt})
		}
		for _, message := range request.Messages {
			content, err := chatMessageContent(message.Content)
			if err != nil {
				return LLMGenerateResult{}, err
			}
			messages = append(messages, map[string]any{"role": message.Role, "content": content})
		}
		jsonSchema := map[string]any{
			"name":   request.ResponseFormat.Name,
			"schema": request.ResponseFormat.Schema,
			"strict": true,
		}
		if request.ResponseFormat.Description != nil {
			jsonSchema["description"] = *request.ResponseFormat.Description
		}
		payload := map[string]any{}
		for k, v := range options.ExtraBody {
			payload[k] = v
		}
		payload["model"] = options.Model
		payload["messages"] = messages
		payload["response_format"] = map[string]any{
			"type":        "json_schema",
			"json_schema": jsonSchema,
		}
		if request.Temperature != nil {
			if _, ok := payload["temperature"]; !ok {
				payload["temperature"] = *request.Temperature
			}
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return LLMGenerateResult{}, err
		}
		endpoint := strings.TrimRight(options.BaseURL, "/") + "/chat/completions"
		httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return LLMGenerateResult{}, err
		}
		for name, values := range options.Headers {
			for _, value := range values {
				httpRequest.Header.Add(name, value)
			}
		}
		httpRequest.Header.Set("Authorization", "Bearer "+options.APIKey)
		httpRequest.Header.Set("Content-Type", "application/json")
		response, err := client.Do(httpRequest)
		if err != nil {
			return LLMGenerateResult{}, err
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			message, _ := io.ReadAll(response.Body)
			return LLMGenerateResult{}, fmt.Errorf("OpenAI-compatible request failed (%d): %s", response.StatusCode, message)
		}
		var completion struct {
			Choices []struct {
				Message struct {
					Content *string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.NewDecoder(response.Body).Decode(&completion); err != nil {
			return LLMGenerateResult{}, err
		}
		if len(completion.Choices) == 0 || completion.Choices[0].Message.Content == nil {
			return LLMGenerateResult{}, errors.New("OpenAI-compatible response did not include message content")
		}
		text := *completion.Choices[0].Message.Content
		if !json.Valid([]byte(text)) {
			return LLMGenerateResult{}, errors.New("OpenAI-compatible response content is not valid JSON")
		}
		return StructuredGenerateResult(LLMStructuredGenerateResult{
			Role:              LLMRoleAssistant,
			Content:           LLMMessageContent{TextContentBlock(LLMTextContent{Text: text})},
			StructuredContent: json.RawMessage(text),
		}), nil
	}
}
