import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "../src/state-machine.js";

describe("NADS state machine", () => {
  it("allows happy path transitions", () => {
    expect(canTransition("READY", "CONTEXT_GATHERING")).toBe(true);
    expect(canTransition("REVIEWING", "ACCEPTED")).toBe(true);
    expect(canTransition("REVISION_REQUIRED", "PROMPT_CREATED")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("READY", "ACCEPTED")).toBe(false);
    expect(() => assertTransition("TESTING", "ACCEPTED")).toThrow(/Illegal/);
  });

  it("allows emergency stop from active states", () => {
    expect(canTransition("AGENT_RUNNING", "STOPPED")).toBe(true);
    expect(canTransition("STOPPED", "READY")).toBe(false);
  });
});
