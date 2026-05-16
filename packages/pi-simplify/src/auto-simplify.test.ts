import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAutoSimplifyHooks, isCodePath } from "./auto-simplify.js";

describe("isCodePath", () => {
  it("accepts common code files", () => {
    expect(isCodePath("src/foo.ts")).toBe(true);
    expect(isCodePath("app.jsx")).toBe(true);
    expect(isCodePath("script.py")).toBe(true);
  });

  it("rejects docs and lockfiles", () => {
    expect(isCodePath("README.md")).toBe(false);
    expect(isCodePath("package-lock.json")).toBe(false);
  });
});

describe("createAutoSimplifyHooks", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "pi-simplify-auto-"));
    await mkdir(join(cwd, ".pi"), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function setup() {
    type Handler = (...args: unknown[]) => unknown;
    const handlers = new Map<string, Handler[]>();
    const pi = {
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, [...handlers.get(event) ?? [], handler]);
      }),
      sendUserMessage: vi.fn(),
    };
    createAutoSimplifyHooks(pi as never);
    return { pi, handlers };
  }

  async function enableAutoRun(): Promise<void> {
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ piSimplify: { autoRun: true, prompt: "anthropic", autoRunCooldownMs: 1 } }),
      "utf8",
    );
  }

  it("does not run when no code files were edited", async () => {
    await enableAutoRun();
    const { pi, handlers } = setup();

    handlers.get("before_agent_start")?.[0]?.({ prompt: "chat" });
    await handlers.get("agent_end")?.[0]?.({}, { cwd, ui: { notify: vi.fn() } });

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("queues a simplify prompt after a successful code edit", async () => {
    await enableAutoRun();
    const { pi, handlers } = setup();
    const ctx = { cwd, ui: { notify: vi.fn() } };

    handlers.get("before_agent_start")?.[0]?.({ prompt: "implement feature" });
    handlers.get("tool_execution_end")?.[0]?.({
      toolName: "edit",
      args: { path: "src/foo.ts" },
      isError: false,
    });
    await handlers.get("agent_end")?.[0]?.({}, ctx);

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const prompt = pi.sendUserMessage.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("pi-simplify:auto");
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("expert code simplification specialist");
  });

  it("does not auto-run after an explicit simplify prompt", async () => {
    await enableAutoRun();
    const { pi, handlers } = setup();

    handlers.get("before_agent_start")?.[0]?.({ prompt: "/simplify" });
    handlers.get("tool_execution_end")?.[0]?.({
      toolName: "edit",
      args: { path: "src/foo.ts" },
      isError: false,
    });
    await handlers.get("agent_end")?.[0]?.({}, { cwd, ui: { notify: vi.fn() } });

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });
});
