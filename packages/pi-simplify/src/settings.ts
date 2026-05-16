import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SimplifyPromptMode } from "./types.js";

export const DEFAULT_PROMPT_MODE: SimplifyPromptMode = "built-in";
export const SETTINGS_KEY = "piSimplify";

export interface SimplifySettings {
  readonly prompt: SimplifyPromptMode;
  readonly autoRun: boolean;
  readonly autoRunCooldownMs?: number;
}

interface RawSimplifySettings {
  readonly prompt?: unknown;
  readonly autoRun?: unknown;
  readonly autoRunCooldownMs?: unknown;
}

interface RawSettings {
  readonly piSimplify?: RawSimplifySettings;
}

function isPromptMode(value: unknown): value is SimplifyPromptMode {
  return value === "built-in" || value === "anthropic";
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function readJson(path: string): Promise<RawSettings> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RawSettings;
  } catch {
    return {};
  }
}

export async function readSimplifySettings(cwd: string): Promise<SimplifySettings> {
  const globalSettings = await readJson(getGlobalSettingsPath());
  const projectSettings = await readJson(getProjectSettingsPath(cwd));

  const autoRunCooldownMs = readMergedAutoRunCooldownMs(globalSettings, projectSettings);
  return {
    prompt: readMergedPromptMode(globalSettings, projectSettings),
    autoRun: readMergedAutoRun(globalSettings, projectSettings),
    ...(autoRunCooldownMs === undefined ? {} : { autoRunCooldownMs }),
  };
}

export async function readSimplifyPromptMode(cwd: string): Promise<SimplifyPromptMode> {
  return (await readSimplifySettings(cwd)).prompt;
}

export async function writeSimplifyPromptMode(
  cwd: string,
  mode: SimplifyPromptMode,
  scope: "global" | "project" = "global",
): Promise<void> {
  await writeSimplifySetting(cwd, scope, { prompt: mode });
}

export async function writeAutoRun(
  cwd: string,
  autoRun: boolean,
  scope: "global" | "project" = "global",
): Promise<void> {
  await writeSimplifySetting(cwd, scope, { autoRun });
}

async function writeSimplifySetting(
  cwd: string,
  scope: "global" | "project",
  values: Record<string, unknown>,
): Promise<void> {
  const path = scope === "project" ? getProjectSettingsPath(cwd) : getGlobalSettingsPath();
  const settings = await readJson(path) as Record<string, unknown>;
  const existing = typeof settings[SETTINGS_KEY] === "object" && settings[SETTINGS_KEY] !== null
    ? settings[SETTINGS_KEY] as Record<string, unknown>
    : {};

  settings[SETTINGS_KEY] = { ...existing, ...values };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function readMergedPromptMode(globalSettings: RawSettings, projectSettings: RawSettings): SimplifyPromptMode {
  const projectMode = projectSettings.piSimplify?.prompt;
  if (isPromptMode(projectMode)) return projectMode;

  const globalMode = globalSettings.piSimplify?.prompt;
  if (isPromptMode(globalMode)) return globalMode;

  return DEFAULT_PROMPT_MODE;
}

function readMergedAutoRun(globalSettings: RawSettings, projectSettings: RawSettings): boolean {
  return asBoolean(projectSettings.piSimplify?.autoRun)
    ?? asBoolean(globalSettings.piSimplify?.autoRun)
    ?? false;
}

function readMergedAutoRunCooldownMs(
  globalSettings: RawSettings,
  projectSettings: RawSettings,
): number | undefined {
  return asPositiveNumber(projectSettings.piSimplify?.autoRunCooldownMs)
    ?? asPositiveNumber(globalSettings.piSimplify?.autoRunCooldownMs);
}

export function getGlobalSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

export function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}
