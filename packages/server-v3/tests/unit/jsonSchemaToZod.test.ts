import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { jsonSchemaToZod } from "../../src/lib/utils.js";

// ---------------------------------------------------------------------------
// Happy‑path: primitive types
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – primitives", () => {
  it("converts a string schema", () => {
    const zod = jsonSchemaToZod({ type: "string" });
    assert.equal(zod.parse("hello"), "hello");
    assert.throws(() => zod.parse(123));
  });

  it("converts a number schema", () => {
    const zod = jsonSchemaToZod({ type: "number" });
    assert.equal(zod.parse(42), 42);
    assert.throws(() => zod.parse("not a number"));
  });

  it("converts an integer schema", () => {
    const zod = jsonSchemaToZod({ type: "integer" });
    assert.equal(zod.parse(7), 7);
    assert.throws(() => zod.parse("nope"));
  });

  it("converts a boolean schema", () => {
    const zod = jsonSchemaToZod({ type: "boolean" });
    assert.equal(zod.parse(true), true);
    assert.throws(() => zod.parse("true"));
  });

  it("converts a null schema", () => {
    const zod = jsonSchemaToZod({ type: "null" });
    assert.equal(zod.parse(null), null);
    assert.throws(() => zod.parse(undefined));
  });

  it("returns z.any() for unknown type", () => {
    const zod = jsonSchemaToZod({});
    // z.any() should accept anything without throwing
    assert.equal(zod.parse("anything"), "anything");
    assert.equal(zod.parse(42), 42);
  });
});

// ---------------------------------------------------------------------------
// Happy‑path: string formats & enums
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – string formats and enums", () => {
  it("validates url format", () => {
    const zod = jsonSchemaToZod({ type: "string", format: "url" });
    assert.equal(zod.parse("https://example.com"), "https://example.com");
    assert.throws(() => zod.parse("not-a-url"));
  });

  it("validates uri format", () => {
    const zod = jsonSchemaToZod({ type: "string", format: "uri" });
    assert.equal(zod.parse("https://example.com"), "https://example.com");
    assert.throws(() => zod.parse("not-a-uri"));
  });

  it("validates email format", () => {
    const zod = jsonSchemaToZod({ type: "string", format: "email" });
    assert.equal(zod.parse("a@b.com"), "a@b.com");
    assert.throws(() => zod.parse("not-an-email"));
  });

  it("validates uuid format", () => {
    const zod = jsonSchemaToZod({ type: "string", format: "uuid" });
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    assert.equal(zod.parse(uuid), uuid);
    assert.throws(() => zod.parse("not-a-uuid"));
  });

  it("handles enum values", () => {
    const zod = jsonSchemaToZod({
      type: "string",
      enum: ["red", "green", "blue"],
    });
    assert.equal(zod.parse("red"), "red");
    assert.throws(() => zod.parse("yellow"));
  });
});

// ---------------------------------------------------------------------------
// Happy‑path: number constraints
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – number constraints", () => {
  it("enforces minimum", () => {
    const zod = jsonSchemaToZod({ type: "number", minimum: 5 });
    assert.equal(zod.parse(5), 5);
    assert.throws(() => zod.parse(4));
  });

  it("enforces maximum", () => {
    const zod = jsonSchemaToZod({ type: "number", maximum: 10 });
    assert.equal(zod.parse(10), 10);
    assert.throws(() => zod.parse(11));
  });

  it("enforces both minimum and maximum", () => {
    const zod = jsonSchemaToZod({ type: "number", minimum: 1, maximum: 10 });
    assert.equal(zod.parse(5), 5);
    assert.throws(() => zod.parse(0));
    assert.throws(() => zod.parse(11));
  });
});

// ---------------------------------------------------------------------------
// Happy‑path: objects and arrays
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – objects and arrays", () => {
  it("converts a simple object", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    });
    const result = zod.parse({ name: "Alice", age: 30 });
    assert.deepEqual(result, { name: "Alice", age: 30 });
  });

  it("converts an object with optional fields", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["name"],
    });
    const result = zod.parse({ name: "Alice" });
    assert.equal(result.name, "Alice");
  });

  it("converts an empty object schema", () => {
    const zod = jsonSchemaToZod({ type: "object" });
    const result = zod.parse({});
    assert.deepEqual(result, {});
  });

  it("converts an array of strings", () => {
    const zod = jsonSchemaToZod({
      type: "array",
      items: { type: "string" },
    });
    const result = zod.parse(["a", "b", "c"]);
    assert.deepEqual(result, ["a", "b", "c"]);
    assert.throws(() => zod.parse([1, 2, 3]));
  });

  it("converts an array without items (z.any())", () => {
    const zod = jsonSchemaToZod({ type: "array" });
    const result = zod.parse([1, "two", true]);
    assert.deepEqual(result, [1, "two", true]);
  });

  it("converts nested objects", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
          required: ["street", "city"],
        },
      },
      required: ["address"],
    });
    const result = zod.parse({
      address: { street: "123 Main", city: "Springfield" },
    });
    assert.deepEqual(result, {
      address: { street: "123 Main", city: "Springfield" },
    });
  });
});

// ---------------------------------------------------------------------------
// Happy‑path: union types (type arrays, anyOf, oneOf)
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – unions", () => {
  it("handles type as array (string | number)", () => {
    const zod = jsonSchemaToZod({ type: ["string", "number"] });
    assert.equal(zod.parse("hello"), "hello");
    assert.equal(zod.parse(42), 42);
    assert.throws(() => zod.parse(true));
  });

  it("handles single-element type array", () => {
    const zod = jsonSchemaToZod({ type: ["string"] });
    assert.equal(zod.parse("hello"), "hello");
    assert.throws(() => zod.parse(42));
  });

  it("handles empty type array as z.any()", () => {
    const zod = jsonSchemaToZod({ type: [] });
    assert.equal(zod.parse("anything"), "anything");
  });

  it("handles anyOf", () => {
    const zod = jsonSchemaToZod({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    assert.equal(zod.parse("hello"), "hello");
    assert.equal(zod.parse(42), 42);
  });

  it("handles oneOf", () => {
    const zod = jsonSchemaToZod({
      oneOf: [{ type: "boolean" }, { type: "null" }],
    });
    assert.equal(zod.parse(true), true);
    assert.equal(zod.parse(null), null);
  });

  it("handles single-element anyOf", () => {
    const zod = jsonSchemaToZod({
      anyOf: [{ type: "string" }],
    });
    assert.equal(zod.parse("hello"), "hello");
    assert.throws(() => zod.parse(42));
  });

  it("handles empty anyOf as z.any()", () => {
    const zod = jsonSchemaToZod({ anyOf: [] });
    assert.equal(zod.parse("anything"), "anything");
  });
});

// ---------------------------------------------------------------------------
// Happy‑path: descriptions
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – descriptions", () => {
  it("preserves description on object", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      description: "A person",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    assert.equal(zod.description, "A person");
  });

  it("preserves description on string", () => {
    const zod = jsonSchemaToZod({
      type: "string",
      description: "A name",
    });
    assert.equal(zod.description, "A name");
  });

  it("preserves description on number", () => {
    const zod = jsonSchemaToZod({
      type: "number",
      description: "An age",
    });
    assert.equal(zod.description, "An age");
  });

  it("preserves description on boolean", () => {
    const zod = jsonSchemaToZod({
      type: "boolean",
      description: "Is active",
    });
    assert.equal(zod.description, "Is active");
  });

  it("preserves description on array", () => {
    const zod = jsonSchemaToZod({
      type: "array",
      description: "A list of items",
      items: { type: "string" },
    });
    assert.equal(zod.description, "A list of items");
  });
});

// ---------------------------------------------------------------------------
// $ref / $defs resolution (Pydantic .model_json_schema() style)
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – $ref/$defs resolution", () => {
  it("resolves a simple $ref", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        address: { $ref: "#/$defs/Address" },
      },
      required: ["address"],
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
          required: ["street", "city"],
        },
      },
    });
    const result = zod.parse({
      address: { street: "123 Main", city: "Springfield" },
    });
    assert.deepEqual(result, {
      address: { street: "123 Main", city: "Springfield" },
    });
  });

  it("resolves nested $refs (Pydantic pattern)", () => {
    // Pydantic generates schemas like this for nested models
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        company: { $ref: "#/$defs/Company" },
      },
      required: ["company"],
      $defs: {
        Company: {
          type: "object",
          properties: {
            name: { type: "string" },
            ceo: { $ref: "#/$defs/Person" },
          },
          required: ["name", "ceo"],
        },
        Person: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
          },
          required: ["first_name", "last_name"],
        },
      },
    });
    const result = zod.parse({
      company: {
        name: "Acme",
        ceo: { first_name: "Jane", last_name: "Doe" },
      },
    });
    assert.deepEqual(result, {
      company: {
        name: "Acme",
        ceo: { first_name: "Jane", last_name: "Doe" },
      },
    });
  });

  it("resolves $ref inside array items", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        people: {
          type: "array",
          items: { $ref: "#/$defs/Person" },
        },
      },
      required: ["people"],
      $defs: {
        Person: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
    });
    const result = zod.parse({
      people: [{ name: "Alice" }, { name: "Bob" }],
    });
    assert.deepEqual(result, {
      people: [{ name: "Alice" }, { name: "Bob" }],
    });
  });

  it("resolves $ref inside anyOf", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        value: {
          anyOf: [{ $ref: "#/$defs/StringVal" }, { $ref: "#/$defs/NumVal" }],
        },
      },
      required: ["value"],
      $defs: {
        StringVal: { type: "string" },
        NumVal: { type: "number" },
      },
    });
    assert.equal(zod.parse({ value: "hello" }).value, "hello");
    assert.equal(zod.parse({ value: 42 }).value, 42);
  });

  it("resolves $ref inside oneOf", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        item: {
          oneOf: [{ $ref: "#/$defs/A" }, { $ref: "#/$defs/B" }],
        },
      },
      required: ["item"],
      $defs: {
        A: { type: "string" },
        B: { type: "boolean" },
      },
    });
    assert.equal(zod.parse({ item: "hello" }).item, "hello");
    assert.equal(zod.parse({ item: true }).item, true);
  });

  it("returns empty object for unknown $ref", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        thing: { $ref: "#/$defs/DoesNotExist" },
      },
      required: ["thing"],
      $defs: {},
    });
    // Unknown ref resolves to {}, which becomes z.any()
    const result = zod.parse({ thing: "anything" });
    assert.equal(result.thing, "anything");
  });

  it("strips $defs from the resolved output", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
      $defs: {
        Unused: { type: "number" },
      },
    });
    // Should still work — $defs just gets cleaned up
    const result = zod.parse({ name: "Alice" });
    assert.equal(result.name, "Alice");
  });
});

// ---------------------------------------------------------------------------
// Deep recursion / self-referencing schemas
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – recursion guard", () => {
  it("handles direct self-reference without infinite loop", () => {
    // A tree node that references itself
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        value: { type: "string" },
        child: { $ref: "#/$defs/Node" },
      },
      required: ["value"],
      $defs: {
        Node: {
          type: "object",
          properties: {
            value: { type: "string" },
            child: { $ref: "#/$defs/Node" },
          },
          required: ["value"],
        },
      },
    });
    // Should parse a flat node (recursive child is guarded to {})
    const result = zod.parse({ value: "root" });
    assert.equal(result.value, "root");
  });

  it("handles mutual recursion (A -> B -> A)", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        a: { $ref: "#/$defs/TypeA" },
      },
      required: ["a"],
      $defs: {
        TypeA: {
          type: "object",
          properties: {
            name: { type: "string" },
            b: { $ref: "#/$defs/TypeB" },
          },
          required: ["name"],
        },
        TypeB: {
          type: "object",
          properties: {
            label: { type: "string" },
            a: { $ref: "#/$defs/TypeA" },
          },
          required: ["label"],
        },
      },
    });
    // Should not hang — recursion is broken by the seen set
    const result = zod.parse({
      a: { name: "hello", b: { label: "world" } },
    });
    assert.equal(result.a.name, "hello");
    assert.equal(result.a.b.label, "world");
  });

  it("handles deeply nested $ref chains (A -> B -> C -> D)", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        start: { $ref: "#/$defs/A" },
      },
      required: ["start"],
      $defs: {
        A: {
          type: "object",
          properties: {
            next: { $ref: "#/$defs/B" },
            val: { type: "string" },
          },
          required: ["val"],
        },
        B: {
          type: "object",
          properties: {
            next: { $ref: "#/$defs/C" },
            val: { type: "number" },
          },
          required: ["val"],
        },
        C: {
          type: "object",
          properties: {
            next: { $ref: "#/$defs/D" },
            val: { type: "boolean" },
          },
          required: ["val"],
        },
        D: {
          type: "object",
          properties: {
            val: { type: "string" },
          },
          required: ["val"],
        },
      },
    });
    const result = zod.parse({
      start: {
        val: "a",
        next: {
          val: 1,
          next: {
            val: true,
            next: { val: "end" },
          },
        },
      },
    });
    assert.equal(result.start.val, "a");
    assert.equal(result.start.next.val, 1);
    assert.equal(result.start.next.next.val, true);
    assert.equal(result.start.next.next.next.val, "end");
  });
});

// ---------------------------------------------------------------------------
// Edge cases / unusual schemas
// ---------------------------------------------------------------------------
describe("jsonSchemaToZod – edge cases", () => {
  it("handles schema with only $ref at root level", () => {
    const zod = jsonSchemaToZod({
      $ref: "#/$defs/Root",
      $defs: {
        Root: {
          type: "object",
          properties: {
            id: { type: "number" },
          },
          required: ["id"],
        },
      },
    });
    const result = zod.parse({ id: 42 });
    assert.equal(result.id, 42);
  });

  it("handles allOf with multiple schemas", () => {
    // allOf currently resolves refs but each sub-schema becomes a union member
    const zod = jsonSchemaToZod({
      allOf: [{ type: "object", properties: { a: { type: "string" } } }],
    });
    // Single allOf element gets parsed
    const result = zod.parse({ a: "hello" });
    assert.equal(result.a, "hello");
  });

  it("handles $ref inside allOf", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        item: {
          allOf: [{ $ref: "#/$defs/Base" }],
        },
      },
      required: ["item"],
      $defs: {
        Base: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
    });
    const result = zod.parse({ item: { name: "test" } });
    assert.equal(result.item.name, "test");
  });

  it("handles real-world Pydantic model_json_schema output", () => {
    // Simulates what Python's BaseModel.model_json_schema() produces
    const pydanticSchema = {
      $defs: {
        Address: {
          properties: {
            street: { title: "Street", type: "string" },
            city: { title: "City", type: "string" },
            zip_code: { title: "Zip Code", type: "string" },
          },
          required: ["street", "city", "zip_code"],
          title: "Address",
          type: "object",
        },
        PhoneNumber: {
          properties: {
            country_code: { title: "Country Code", type: "string" },
            number: { title: "Number", type: "string" },
          },
          required: ["country_code", "number"],
          title: "PhoneNumber",
          type: "object",
        },
      },
      properties: {
        name: { title: "Name", type: "string" },
        age: { title: "Age", type: "integer" },
        address: { $ref: "#/$defs/Address" },
        phones: {
          items: { $ref: "#/$defs/PhoneNumber" },
          title: "Phones",
          type: "array",
        },
      },
      required: ["name", "age", "address", "phones"],
      title: "Contact",
      type: "object",
    };

    const zod = jsonSchemaToZod(pydanticSchema);
    const result = zod.parse({
      name: "John Doe",
      age: 30,
      address: {
        street: "123 Main St",
        city: "Anytown",
        zip_code: "12345",
      },
      phones: [{ country_code: "+1", number: "555-0100" }],
    });
    assert.equal(result.name, "John Doe");
    assert.equal(result.age, 30);
    assert.equal(result.address.city, "Anytown");
    assert.equal(result.phones[0].number, "555-0100");
  });

  it("handles Pydantic Optional fields (anyOf with null)", () => {
    // Pydantic represents Optional[X] as anyOf: [{type: X}, {type: "null"}]
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
      required: ["name"],
    });
    assert.equal(zod.parse({ name: "Alice", nickname: "Ali" }).nickname, "Ali");
    assert.equal(zod.parse({ name: "Alice", nickname: null }).nickname, null);
  });

  it("handles schema with extra/unknown fields gracefully", () => {
    // Fields not in the JSONSchema interface should be ignored
    const schema = {
      type: "string",
      title: "A title",
      examples: ["foo", "bar"],
      default: "baz",
    } as Record<string, unknown>;
    const zod = jsonSchemaToZod(
      schema as Parameters<typeof jsonSchemaToZod>[0],
    );
    assert.equal(zod.parse("hello"), "hello");
  });

  it("handles deeply nested objects without $ref", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        level1: {
          type: "object",
          properties: {
            level2: {
              type: "object",
              properties: {
                level3: {
                  type: "object",
                  properties: {
                    value: { type: "string" },
                  },
                  required: ["value"],
                },
              },
              required: ["level3"],
            },
          },
          required: ["level2"],
        },
      },
      required: ["level1"],
    });
    const result = zod.parse({
      level1: { level2: { level3: { value: "deep" } } },
    });
    assert.equal(result.level1.level2.level3.value, "deep");
  });

  it("handles array of objects with $ref items", () => {
    const zod = jsonSchemaToZod({
      type: "array",
      items: { $ref: "#/$defs/Item" },
      $defs: {
        Item: {
          type: "object",
          properties: {
            id: { type: "number" },
            tags: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["id", "tags"],
        },
      },
    });
    const result = zod.parse([
      { id: 1, tags: ["a", "b"] },
      { id: 2, tags: ["c"] },
    ]);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0].tags, ["a", "b"]);
  });

  it("handles same $ref used in multiple places", () => {
    const zod = jsonSchemaToZod({
      type: "object",
      properties: {
        home: { $ref: "#/$defs/Address" },
        work: { $ref: "#/$defs/Address" },
      },
      required: ["home", "work"],
      $defs: {
        Address: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
      },
    });
    const result = zod.parse({
      home: { city: "Portland" },
      work: { city: "Seattle" },
    });
    assert.equal(result.home.city, "Portland");
    assert.equal(result.work.city, "Seattle");
  });
});
