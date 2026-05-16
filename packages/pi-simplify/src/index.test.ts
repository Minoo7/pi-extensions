import { describe, it, expect, vi } from "vitest";
import registerExtension from "./index.js";

describe("pi-simplify extension", () => {
  it("registers the simplify commands", () => {
    const pi = {
      registerCommand: vi.fn(),
      on: vi.fn(),
    } as unknown as Parameters<typeof registerExtension>[0];

    registerExtension(pi);

    expect(pi.registerCommand).toHaveBeenCalledTimes(2);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "simplify",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "simplify-settings",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });

  it("registers auto-simplify event handlers", () => {
    const pi = {
      registerCommand: vi.fn(),
      on: vi.fn(),
    } as unknown as Parameters<typeof registerExtension>[0];

    registerExtension(pi);

    expect(pi.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("tool_execution_end", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
  });
});
