export interface ChangedFile {
  readonly path: string;
  readonly status: "modified" | "added" | "renamed" | "copied";
}

export type SimplifyPromptMode = "built-in" | "anthropic";

export interface SimplifyOptions {
  readonly files: readonly string[];
  readonly ref: string;
  readonly staged: boolean;
  readonly promptMode?: SimplifyPromptMode;
}
