import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { ValidationError } from "../../src/errors.js";

// Capture and restore env vars around each test so tests are isolated.
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

describe("loadConfig", () => {
  // Clear AGENTSEC_KEY before each test so the env is predictable.
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env["AGENTSEC_KEY"];
    delete process.env["AGENTSEC_KEY"];
  });
  afterEach(() => {
    if (savedKey !== undefined) {
      process.env["AGENTSEC_KEY"] = savedKey;
    } else {
      delete process.env["AGENTSEC_KEY"];
    }
  });

  it("throws ValidationError when AGENTSEC_KEY is not set", () => {
    expect(() => loadConfig()).toThrow(ValidationError);
  });

  it("throws ValidationError when AGENTSEC_KEY is shorter than 32 chars", () => {
    process.env["AGENTSEC_KEY"] = "tooshort";
    expect(() => loadConfig()).toThrow(ValidationError);
  });

  it("throws ValidationError with helpful message about key length", () => {
    process.env["AGENTSEC_KEY"] = "short";
    expect(() => loadConfig()).toThrow(/32/);
  });

  it("returns config when AGENTSEC_KEY is exactly 32 chars", () => {
    process.env["AGENTSEC_KEY"] = "a".repeat(32);
    const config = loadConfig();
    expect(config.agentsecKey).toBe("a".repeat(32));
  });

  it("returns defaults for optional fields when only AGENTSEC_KEY is set", () => {
    process.env["AGENTSEC_KEY"] = "a".repeat(32);
    const config = loadConfig();
    expect(config.upstreamUrl).toBe("https://api.anthropic.com");
    expect(config.port).toBe(7777);
    expect(config.host).toBe("127.0.0.1");
    expect(config.sensitivity).toBe("permissive");
  });

  it("throws ValidationError when AGENTSEC_SENSITIVITY is an unknown value", () => {
    process.env["AGENTSEC_KEY"] = "a".repeat(32);
    withEnv({ AGENTSEC_SENSITIVITY: "unknown-mode" }, () => {
      expect(() => loadConfig()).toThrow(ValidationError);
    });
  });

  it("accepts all valid sensitivity values", () => {
    process.env["AGENTSEC_KEY"] = "a".repeat(32);
    for (const val of ["strict", "balanced", "permissive"] as const) {
      withEnv({ AGENTSEC_SENSITIVITY: val }, () => {
        expect(() => loadConfig()).not.toThrow();
        expect(loadConfig().sensitivity).toBe(val);
      });
    }
  });
});
