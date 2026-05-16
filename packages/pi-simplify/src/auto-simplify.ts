import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSimplifyPrompt } from "./prompt-builder.js";
import { readSimplifySettings } from "./settings.js";
import type { ChangedFile, SimplifyPromptMode } from "./types.js";

const DEFAULT_COOLDOWN_MS = 30_000;
const AUTO_SIMPLIFY_MARKER = "<!-- pi-simplify:auto -->";

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".cxx",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const EXCLUDED_BASENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

const WRITE_TOOL_STATUS = new Map<string, ChangedFile["status"]>([
  ["write", "added"],
  ["Write", "added"],
  ["edit", "modified"],
  ["Edit", "modified"],
]);

interface ToolExecutionEndEventLike {
  readonly toolName?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly isError?: boolean;
}

interface BeforeAgentStartEventLike {
  readonly prompt?: string;
}

function getBasename(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(lastSlash + 1);
}

function getExtension(path: string): string {
  const basename = getBasename(path);
  const lastDot = basename.lastIndexOf(".");
  return lastDot === -1 ? "" : basename.slice(lastDot).toLowerCase();
}

export function isCodePath(path: string): boolean {
  return Boolean(path)
    && !EXCLUDED_BASENAMES.has(getBasename(path))
    && CODE_EXTENSIONS.has(getExtension(path));
}

function extractPath(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath"]) {
    if (typeof record[key] === "string") return record[key];
  }

  return undefined;
}

function extractEditedPath(event: ToolExecutionEndEventLike): string | undefined {
  return extractPath(event.args) ?? extractPath(event.result);
}

function getWriteToolStatus(toolName: string | undefined): ChangedFile["status"] | undefined {
  return toolName ? WRITE_TOOL_STATUS.get(toolName) : undefined;
}

function isSimplifyPrompt(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return normalized.startsWith("/simplify") || normalized.includes(AUTO_SIMPLIFY_MARKER);
}

function buildAutoSimplifyPrompt(
  files: readonly ChangedFile[],
  promptMode: SimplifyPromptMode,
): string {
  return [
    AUTO_SIMPLIFY_MARKER,
    "",
    "Auto-simplify the code files edited in the previous turn.",
    "",
    buildSimplifyPrompt(files, promptMode),
  ].join("\n");
}

export function createAutoSimplifyHooks(pi: ExtensionAPI): void {
  const editedCodeFiles = new Map<string, ChangedFile>();
  let currentPrompt = "";
  let currentRunIsAutoSimplify = false;
  let pendingAutoPrompt: string | undefined;
  let lastAutoRunAt = 0;

  pi.on("before_agent_start", (event) => {
    const prompt = (event as BeforeAgentStartEventLike).prompt ?? "";
    currentPrompt = prompt;
    currentRunIsAutoSimplify = pendingAutoPrompt === prompt || prompt.includes(AUTO_SIMPLIFY_MARKER);
    if (currentRunIsAutoSimplify) pendingAutoPrompt = undefined;
  });

  pi.on("tool_execution_end", (event) => {
    const toolEvent = event as ToolExecutionEndEventLike;
    const status = getWriteToolStatus(toolEvent.toolName);
    if (toolEvent.isError || !status) return;

    const path = extractEditedPath(toolEvent);
    if (!path || !isCodePath(path)) return;

    editedCodeFiles.set(path, { path, status });
  });

  pi.on("agent_end", async (_event, ctx: ExtensionContext) => {
    if (currentRunIsAutoSimplify) {
      editedCodeFiles.clear();
      currentRunIsAutoSimplify = false;
      return;
    }

    const files = [...editedCodeFiles.values()];
    editedCodeFiles.clear();
    if (files.length === 0 || isSimplifyPrompt(currentPrompt)) return;

    const settings = await readSimplifySettings(ctx.cwd);
    if (!settings.autoRun) return;

    const now = Date.now();
    const cooldownMs = settings.autoRunCooldownMs ?? DEFAULT_COOLDOWN_MS;
    if (now - lastAutoRunAt < cooldownMs) return;

    lastAutoRunAt = now;
    const prompt = buildAutoSimplifyPrompt(files, settings.prompt);
    pendingAutoPrompt = prompt;
    ctx.ui.notify(`Auto-simplifying ${files.length} edited code file(s)…`, "info");
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  });
}
