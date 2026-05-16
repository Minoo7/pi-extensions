import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SimplifyPromptMode } from "./types.js";

export const DEFAULT_PROMPT_MODE: SimplifyPromptMode = "built-in";
export const SETTINGS_KEY = "piSimplify";

interface RawSimplifySettings {
  readonly prompt?: unknown;
}

interface RawSettings {
  readonly piSimplify?: RawSimplifySettings;
}

function isPromptMode(value: unknown): value is SimplifyPromptMode {
  return value === "built-in" || value === "anthropic";
}

async function readJson(path: string): Promise<RawSettings> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RawSettings;
  } catch {
    return {};
  }
}

export async function readSimplifyPromptMode(cwd: string): Promise<SimplifyPromptMode> {
  const globalSettings = await readJson(getGlobalSettingsPath());
  const projectSettings = await readJson(getProjectSettingsPath(cwd));

  const projectMode = projectSettings.piSimplify?.prompt;
  if (isPromptMode(projectMode)) return projectMode;

  const globalMode = globalSettings.piSimplify?.prompt;
  if (isPromptMode(globalMode)) return globalMode;

  return DEFAULT_PROMPT_MODE;
}

export async function writeSimplifyPromptMode(
  cwd: string,
  mode: SimplifyPromptMode,
  scope: "global" | "project" = "global",
): Promise<void> {
  const path = scope === "project" ? getProjectSettingsPath(cwd) : getGlobalSettingsPath();
  const settings = await readJson(path) as Record<string, unknown>;
  const existing = typeof settings[SETTINGS_KEY] === "object" && settings[SETTINGS_KEY] !== null
    ? settings[SETTINGS_KEY] as Record<string, unknown>
    : {};

  settings[SETTINGS_KEY] = { ...existing, prompt: mode };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function getGlobalSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

export function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}
