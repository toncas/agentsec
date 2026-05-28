import { describe, expect, it } from "vitest";

import { VERSION } from "../../src/version";

describe("smoke", () => {
  it("exposes a semver version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
