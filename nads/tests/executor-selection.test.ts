import { describe, expect, it } from "vitest";
import {
  assertNoAutomaticCursorFallback,
  createExecutorFromEnv,
} from "../src/adapters/executor.js";
import { HttpCursorAgentProvider } from "../src/adapters/cursor-http-adapter.js";

describe("createExecutorFromEnv", () => {
  it("defaults to mock (no network, no cursor API)", () => {
    const executor = createExecutorFromEnv({});
    expect(executor.kind).toBe("mock");
  });

  it("selects automation without requiring cursor key and without falling back", () => {
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "automation",
      NADS_AUTOMATION_ENABLED: "false",
      CURSOR_API_KEY: "",
    });
    expect(executor.kind).toBe("automation");
  });

  it("requires explicit cursor executor + key (fail closed)", () => {
    expect(() =>
      createExecutorFromEnv({
        NADS_EXECUTOR: "cursor",
        CURSOR_API_KEY: "",
      }),
    ).toThrow(/CURSOR_API_KEY/);
  });

  it("builds HttpCursorAgentProvider only for explicit cursor executor", () => {
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "cursor",
      CURSOR_API_KEY: "test-key",
    });
    expect(executor.kind).toBe("cursor");
    expect(executor.cursorProvider).toBeInstanceOf(HttpCursorAgentProvider);
  });

  it("treats cursor_api alias as cursor", () => {
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "cursor_api",
      CURSOR_API_KEY: "test-key",
    });
    expect(executor.kind).toBe("cursor");
  });
});

describe("assertNoAutomaticCursorFallback", () => {
  it("blocks automation→cursor fallback", () => {
    expect(() => assertNoAutomaticCursorFallback("automation", "cursor")).toThrow(
      /automatic fallback/i,
    );
  });
});
