import { describe, expect, it } from "vitest";
import {
  createCursorProviderFromEnv,
  cursorAgentIdForTask,
} from "../src/adapters/cursor-factory.js";
import { HttpCursorAgentProvider } from "../src/adapters/cursor-http-adapter.js";
import { MockCursorAgentProvider } from "../src/adapters/mock-cursor-adapter.js";

describe("createCursorProviderFromEnv", () => {
  it("uses mock in dry-run even if key present", () => {
    const provider = createCursorProviderFromEnv({
      NADS_MODE: "dry-run",
      CURSOR_API_KEY: "present",
    });
    expect(provider).toBeInstanceOf(MockCursorAgentProvider);
  });

  it("fail-closes in live mode without CURSOR_API_KEY (no mock fallback)", () => {
    expect(() =>
      createCursorProviderFromEnv({
        NADS_MODE: "live",
        CURSOR_API_KEY: "",
      }),
    ).toThrow(/fail closed/i);
  });

  it("returns HttpCursorAgentProvider in live mode with key", () => {
    const provider = createCursorProviderFromEnv({
      NADS_MODE: "live",
      CURSOR_API_KEY: "test-key",
      CURSOR_API_BASE_URL: "https://api.cursor.com/v1",
    });
    expect(provider).toBeInstanceOf(HttpCursorAgentProvider);
  });
});

describe("cursorAgentIdForTask", () => {
  it("formats bc-<uuid>", () => {
    expect(cursorAgentIdForTask("11111111-1111-1111-1111-111111111111")).toBe(
      "bc-11111111-1111-1111-1111-111111111111",
    );
  });
});
