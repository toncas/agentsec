import { describe, expect, it } from "vitest";

import { InvalidProviderError } from "../../src/errors";
import { extract } from "../../src/proxy/extractor";

describe("SystemPromptExtractor (Anthropic)", () => {
  it("extracts a plain string system prompt", () => {
    const result = extract({
      url: "/v1/messages",
      body: { system: "You are helpful.", messages: [{ role: "user", content: "hi" }] },
    });
    expect(result.provider).toBe("anthropic");
    expect(result.system).toBe("You are helpful.");
    expect(result.tools).toEqual([]);
  });

  it("joins content-block system arrays with newlines", () => {
    const result = extract({
      url: "/v1/messages",
      body: {
        system: [
          { type: "text", text: "Block A" },
          { type: "text", text: "Block B" },
        ],
        messages: [],
      },
    });
    expect(result.system).toBe("Block A\nBlock B");
  });

  it("normalizes the tools array into ToolDescriptor[]", () => {
    const result = extract({
      url: "/v1/messages",
      body: {
        system: "s",
        messages: [],
        tools: [
          {
            name: "read_file",
            description: "Reads a file",
            input_schema: { type: "object", properties: { path: { type: "string" } } },
          },
          {
            name: "write_file",
            input_schema: { type: "object" },
          },
        ],
      },
    });
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toMatchObject({
      name: "read_file",
      description: "Reads a file",
    });
    expect(result.tools[0]!.inputSchema).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
    });
    expect(result.tools[1]!.name).toBe("write_file");
    expect(result.tools[1]!.description).toBeUndefined();
  });

  it("returns empty system string when the system field is missing", () => {
    const result = extract({
      url: "/v1/messages",
      body: { messages: [] },
    });
    expect(result.system).toBe("");
    expect(result.tools).toEqual([]);
  });

  it("throws InvalidProviderError on a malformed body", () => {
    expect(() =>
      extract({ url: "/v1/messages", body: "not-an-object" }),
    ).toThrow(InvalidProviderError);
    expect(() =>
      extract({ url: "/v1/messages", body: null }),
    ).toThrow(InvalidProviderError);
  });

  it("throws InvalidProviderError on unknown routes", () => {
    expect(() => extract({ url: "/v1/unknown", body: {} })).toThrow(
      InvalidProviderError,
    );
  });
});
