import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  handleSimplifyCommand,
  handleSimplifySettingsCommand,
  COMMAND_NAME,
  SETTINGS_COMMAND_NAME,
} from "./simplify-command.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Review recently changed files for clarity, consistency, and maintainability improvements",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleSimplifyCommand(args, ctx, pi),
  });

  pi.registerCommand(SETTINGS_COMMAND_NAME, {
    description: "Choose whether /simplify uses the built-in or Anthropic simplification prompt",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleSimplifySettingsCommand(args, ctx),
  });
}
