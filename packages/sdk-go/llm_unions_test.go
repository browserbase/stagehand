package stagehand

import (
	"encoding/json"
	"testing"
)

func TestLLMToolResultContentBlockVariants(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name  string
		input string
		check func(*testing.T, LLMToolResultContentBlock)
	}{
		{
			name:  "text",
			input: `{"type":"text","text":"done"}`,
			check: func(t *testing.T, block LLMToolResultContentBlock) {
				text, ok := block.AsText()
				if !ok || text.Text != "done" {
					t.Fatal("decoded the wrong text block")
				}
			},
		},
		{
			name:  "image",
			input: `{"type":"image","data":"aW1hZ2U=","mime_type":"image/png"}`,
			check: func(t *testing.T, block LLMToolResultContentBlock) {
				image, ok := block.AsImage()
				if !ok || image.Data != "aW1hZ2U=" || image.MIMEType != "image/png" {
					t.Fatal("decoded the wrong image block")
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var block LLMToolResultContentBlock
			if err := json.Unmarshal([]byte(test.input), &block); err != nil {
				t.Fatal(err)
			}
			test.check(t, block)
			data, err := json.Marshal(block)
			if err != nil {
				t.Fatal(err)
			}
			if !jsonEqual([]byte(test.input), data) {
				t.Fatalf("tool-result block round trip mismatch:\nwant %s\n got %s", test.input, data)
			}
		})
	}

	var block LLMToolResultContentBlock
	if err := json.Unmarshal([]byte(`{"type":"audio"}`), &block); err == nil {
		t.Fatal("expected unknown tool-result discriminator to fail")
	}
}

func TestLLMMessageGenerateResultTextAndOpenProperties(t *testing.T) {
	t.Parallel()

	input := []byte(`{
		"role":"assistant",
		"content":{"type":"text","text":"done"},
		"output_format":"text",
		"provider_request_id":"req_123"
	}`)
	var result LLMGenerateResult
	if err := json.Unmarshal(input, &result); err != nil {
		t.Fatal(err)
	}
	message, ok := result.AsMessage()
	if !ok {
		t.Fatal("decoded the wrong LLM result variant")
	}
	if string(message.AdditionalProperties["provider_request_id"]) != `"req_123"` {
		t.Fatal("did not retain message result additional property")
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	want := []byte(`{
		"role":"assistant",
		"content":[{"type":"text","text":"done"}],
		"output_format":"text",
		"provider_request_id":"req_123"
	}`)
	if !jsonEqual(want, data) {
		t.Fatalf("message result round trip mismatch:\nwant %s\n got %s", want, data)
	}

	if err := json.Unmarshal([]byte(`{"output_format":"audio"}`), &result); err == nil {
		t.Fatal("expected unknown result discriminator to fail")
	}

	var messageResult LLMMessageGenerateResult
	if err := json.Unmarshal([]byte(`{"output_format":"json_schema"}`), &messageResult); err == nil {
		t.Fatal("expected non-text message result discriminator to fail")
	}
}
