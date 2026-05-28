import { InvalidProviderError } from "../errors.js";
import type { NormalizedPrompt, ToolDescriptor } from "../types.js";

interface AnthropicTool {
  name?: unknown;
  description?: unknown;
  input_schema?: unknown;
}

interface AnthropicBody {
  system?: unknown;
  tools?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAnthropicSystem(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const block of value) {
      if (
        isPlainObject(block) &&
        typeof block.text === "string" &&
        (block.type === undefined || block.type === "text")
      ) {
        parts.push(block.text);
      }
    }
    return parts.join("\n");
  }
  throw new InvalidProviderError("Anthropic: 'system' must be a string or content-block array");
}

function normalizeAnthropicTools(value: unknown): ToolDescriptor[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new InvalidProviderError("Anthropic: 'tools' must be an array");
  }
  const out: ToolDescriptor[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) {
      throw new InvalidProviderError("Anthropic: each tool must be an object");
    }
    const tool = raw as AnthropicTool;
    if (typeof tool.name !== "string") {
      throw new InvalidProviderError("Anthropic: tool 'name' must be a string");
    }
    const descriptor: ToolDescriptor = {
      name: tool.name,
      inputSchema: tool.input_schema ?? {},
    };
    if (typeof tool.description === "string") {
      descriptor.description = tool.description;
    }
    out.push(descriptor);
  }
  return out;
}

function extractAnthropic(body: unknown): NormalizedPrompt {
  if (!isPlainObject(body)) {
    throw new InvalidProviderError("Anthropic: request body must be a JSON object");
  }
  const anthropicBody = body as AnthropicBody;
  return {
    provider: "anthropic",
    system: normalizeAnthropicSystem(anthropicBody.system),
    tools: normalizeAnthropicTools(anthropicBody.tools),
    raw: body,
  };
}

export function extract(req: { url: string; body: unknown }): NormalizedPrompt {
  if (req.url.startsWith("/v1/messages")) {
    return extractAnthropic(req.body);
  }
  if (req.url.startsWith("/v1/chat/completions")) {
    throw new InvalidProviderError("OpenAI provider support arrives in T1.20");
  }
  throw new InvalidProviderError(`Unknown route: ${req.url}`);
}
