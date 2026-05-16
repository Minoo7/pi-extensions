import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getChangedFiles } from "./git-diff.js";
import { buildSimplifyPrompt } from "./prompt-builder.js";
import {
  DEFAULT_PROMPT_MODE,
  readSimplifySettings,
  readSimplifyPromptMode,
  writeAutoRun,
  writeSimplifyPromptMode,
} from "./settings.js";
import type { SimplifyOptions, SimplifyPromptMode } from "./types.js";

export const COMMAND_NAME = "simplify";
export const SETTINGS_COMMAND_NAME = "simplify-settings";

function parsePromptMode(value: string | undefined): SimplifyPromptMode | undefined {
  if (value === "built-in" || value === "anthropic") return value;
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "on" || value === "true" || value === "enabled") return true;
  if (value === "off" || value === "false" || value === "disabled") return false;
  return undefined;
}

function findPromptMode(tokens: readonly string[]): SimplifyPromptMode | undefined {
  return tokens
    .map((token) => token.startsWith("--prompt=") ? token.slice("--prompt=".length) : token)
    .map(parsePromptMode)
    .find((mode): mode is SimplifyPromptMode => mode !== undefined);
}

function findAutoRunValue(tokens: readonly string[]): boolean | undefined {
  const fromFlag = tokens
    .filter((token) => token.startsWith("--auto="))
    .map((token) => parseBoolean(token.slice("--auto=".length)))
    .find((value): value is boolean => value !== undefined);
  if (fromFlag !== undefined) return fromFlag;

  const autoRunIndex = tokens.findIndex((token) => token === "auto" || token === "--auto");
  return autoRunIndex === -1 ? undefined : parseBoolean(tokens[autoRunIndex + 1]);
}

export function parseArgs(args: string): SimplifyOptions {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const files: string[] = [];
  let ref = "HEAD";
  let staged = false;
  let promptMode: SimplifyPromptMode | undefined;

  for (const token of tokens) {
    if (token === "--staged") {
      staged = true;
    } else if (token === "--anthropic") {
      promptMode = "anthropic";
    } else if (token === "--built-in") {
      promptMode = "built-in";
    } else if (token.startsWith("--prompt=")) {
      promptMode = parsePromptMode(token.slice("--prompt=".length));
    } else if (token.startsWith("--ref=")) {
      ref = token.slice("--ref=".length);
    } else {
      files.push(token);
    }
  }

  return promptMode ? { files, ref, staged, promptMode } : { files, ref, staged };
}

export async function handleSimplifyCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const options = parseArgs(args);
  const files = await getChangedFiles(pi, ctx.cwd, options);

  if (files.length === 0) {
    ctx.ui.notify(
      "No changed files found. Specify file paths or make some changes first.",
      "info",
    );
    return;
  }

  const promptMode = options.promptMode ?? await readSimplifyPromptMode(ctx.cwd);
  const prompt = buildSimplifyPrompt(files, promptMode);
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}

export async function handleSimplifySettingsCommand(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const scope = tokens.includes("--project") ? "project" : "global";
  const explicitAutoRun = findAutoRunValue(tokens);

  if (explicitAutoRun !== undefined) {
    await writeAutoRun(ctx.cwd, explicitAutoRun, scope);
    ctx.ui.notify(
      `pi-simplify auto-run ${explicitAutoRun ? "enabled" : "disabled"} (${scope})`,
      "info",
    );
    return;
  }

  const explicitMode = findPromptMode(tokens);
  const currentSettings = await readSimplifySettings(ctx.cwd);
  const selectedMode = explicitMode ?? await ctx.ui.select(
    `Simplify prompt: ${currentSettings.prompt || DEFAULT_PROMPT_MODE}; auto-run: ${currentSettings.autoRun ? "on" : "off"}`,
    ["built-in", "anthropic", "auto on", "auto off"],
  );

  const selectedAutoRun = selectedMode?.startsWith("auto ")
    ? parseBoolean(selectedMode.slice("auto ".length))
    : undefined;
  if (selectedAutoRun !== undefined) {
    await writeAutoRun(ctx.cwd, selectedAutoRun, scope);
    ctx.ui.notify(
      `pi-simplify auto-run ${selectedAutoRun ? "enabled" : "disabled"} (${scope})`,
      "info",
    );
    return;
  }

  const promptMode = parsePromptMode(selectedMode);
  if (!promptMode) return;

  await writeSimplifyPromptMode(ctx.cwd, promptMode, scope);
  ctx.ui.notify(`pi-simplify prompt set to ${promptMode} (${scope})`, "info");
}
