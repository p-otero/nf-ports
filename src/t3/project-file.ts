import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../detect/files.ts";

export const t3FileName = "t3.json";
export const t3SchemaUrl = "https://t3.codes/schema/t3.json";
export const t3MaxScripts = 50;
export const t3ScriptIcons = ["play", "test", "lint", "configure", "build", "debug"] as const;
export type T3ScriptIcon = (typeof t3ScriptIcons)[number];

export type T3Script = {
  readonly name: string;
  readonly command: string;
  readonly icon?: T3ScriptIcon;
  readonly runOnWorktreeCreate?: boolean;
  readonly runOnSettle?: boolean;
  readonly stopOnSettle?: boolean;
  readonly async?: boolean;
  readonly previewUrl?: string;
  readonly autoOpenPreview?: boolean;
};

export class T3FileError extends Error {
  override readonly name = "T3FileError";
}

export type MergeOutcome = {
  readonly file: Record<string, unknown>;
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly unchanged: readonly string[];
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const validateScript = (script: T3Script): void => {
  if (script.name.trim() === "" || script.command.trim() === "") {
    throw new T3FileError(`script "${script.name}" needs a non-empty name and command`);
  }
  if (script.icon !== undefined && !t3ScriptIcons.includes(script.icon)) {
    throw new T3FileError(`script "${script.name}" has an unknown icon "${String(script.icon)}"`);
  }
};

const existingScripts = (file: Record<string, unknown>): Record<string, unknown>[] => {
  const scripts = file["scripts"];
  if (scripts === undefined) return [];
  if (!Array.isArray(scripts) || !scripts.every(isRecord)) {
    throw new T3FileError(`${t3FileName} "scripts" must be an array of objects`);
  }
  return scripts;
};

const scriptName = (script: Record<string, unknown>): string =>
  typeof script["name"] === "string" ? script["name"].trim() : "";

export const mergeScripts = (file: Record<string, unknown>, scripts: readonly T3Script[]): MergeOutcome => {
  scripts.forEach(validateScript);
  const current = existingScripts(file);
  const wanted = new Map(scripts.map((script) => [script.name.trim(), script]));
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  const merged = current.map((script) => {
    const replacement = wanted.get(scriptName(script));
    if (!replacement) return script;
    wanted.delete(scriptName(script));
    const next: Record<string, unknown> = Object.assign({}, script, replacement);
    (sameJson(next, script) ? unchanged : updated).push(replacement.name);
    return next;
  });
  for (const script of wanted.values()) {
    merged.push({ ...script });
    added.push(script.name);
  }
  if (merged.length > t3MaxScripts) {
    throw new T3FileError(`${t3FileName} allows at most ${t3MaxScripts} scripts; the merge would produce ${merged.length}`);
  }

  const schema = typeof file["$schema"] === "string" ? file["$schema"] : t3SchemaUrl;
  return { file: { $schema: schema, ...file, scripts: merged }, added, updated, unchanged };
};

export type WriteOutcome = MergeOutcome & {
  readonly path: string;
  readonly status: "created" | "updated" | "unchanged";
  readonly content: string;
};

const readProjectFile = (path: string): Record<string, unknown> | null => {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new T3FileError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new T3FileError(`${path} must contain a JSON object`);
  return parsed;
};

export const writeT3Scripts = (
  root: string,
  scripts: readonly T3Script[],
  options: { readonly dryRun: boolean },
): WriteOutcome => {
  const path = join(root, t3FileName);
  const existing = readProjectFile(path);
  const outcome = mergeScripts(existing ?? {}, scripts);
  const content = `${JSON.stringify(outcome.file, null, 2)}\n`;
  const status = existing === null ? "created" : sameJson(existing, outcome.file) ? "unchanged" : "updated";
  if (!options.dryRun && status !== "unchanged") writeFileSync(path, content);
  return { ...outcome, path, status, content };
};
