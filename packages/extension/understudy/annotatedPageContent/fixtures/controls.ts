import type { AnnotatedPageContent } from "../index.js";
import type {
  ContentAttributesJson,
  ContentNodeJson,
  FormControlTypeJson,
} from "../common_quality_data_pb.js";

export function text(value: string): ContentNodeJson {
  return {
    contentAttributes: {
      attributeType: "CONTENT_ATTRIBUTE_TEXT",
      textData: { textContent: value },
    },
  };
}

export function control(
  type: FormControlTypeJson,
  name: string,
  attributes: ContentAttributesJson = {},
): ContentNodeJson {
  return {
    contentAttributes: {
      attributeType: "CONTENT_ATTRIBUTE_FORM_CONTROL",
      interactionInfo: {},
      ...attributes,
      formControlData: { formControlType: type, fieldName: name, ...attributes.formControlData },
    },
  };
}

export const controls: AnnotatedPageContent = {
  mainFrameData: {
    url: "https://shop.test/",
    title: "Checkout",
    documentIdentifier: { serializedToken: "main-document" },
  },
  rootNode: {
    contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_ROOT" },
    childrenNodes: [
      {
        contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_HEADING" },
        childrenNodes: [text("Unrelated sale")],
      },
      {
        contentAttributes: {
          attributeType: "CONTENT_ATTRIBUTE_FORM",
          formData: { formName: "Checkout" },
        },
        childrenNodes: [
          {
            contentAttributes: {
              attributeType: "CONTENT_ATTRIBUTE_CONTAINER",
              labelForDomNodeId: 42,
              interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_CLICK_HANDLER"] },
            },
            childrenNodes: [text("Email address")],
          },
          control("FORM_CONTROL_TYPE_INPUT_EMAIL", "email", {
            commonAncestorDomNodeId: 42,
            formControlData: { placeholder: "you@example.com", fieldValue: "", isRequired: true },
          }),
          control("FORM_CONTROL_TYPE_INPUT_TEXT", "readonly", {
            formControlData: { isReadonly: true, fieldValue: "Saved" },
          }),
          control("FORM_CONTROL_TYPE_INPUT_CHECKBOX", "terms", {
            label: "Accept terms",
            formControlData: { isChecked: false },
          }),
          control("FORM_CONTROL_TYPE_SELECT_ONE", "plan", {
            formControlData: {
              selectOptions: [
                { text: "Basic", value: "basic", isSelected: true },
                { text: "Pro", value: "pro", isSelected: false, isDisabled: true },
                { text: "Unknown state" },
              ],
            },
          }),
          {
            contentAttributes: {
              attributeType: "CONTENT_ATTRIBUTE_CONTAINER",
              ariaRole: "AX_ROLE_BUTTON",
              interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_CLICK_HANDLER"] },
            },
            childrenNodes: [
              {
                contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_CONTAINER" },
                childrenNodes: [text(' Pay\n  "now" ')],
              },
              {
                contentAttributes: {
                  attributeType: "CONTENT_ATTRIBUTE_IMAGE",
                  imageData: { imageCaption: "Card" },
                },
              },
            ],
          },
          control("FORM_CONTROL_TYPE_BUTTON_SUBMIT", "disabled", {
            interactionInfo: { isDisabled: true },
          }),
        ],
      },
      {
        contentAttributes: { attributeType: "CONTENT_ATTRIBUTE_PARAGRAPH" },
        childrenNodes: [text("Unrelated footer")],
      },
    ],
  },
};
