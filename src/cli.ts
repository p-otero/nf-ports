#!/usr/bin/env bun
import { detect } from "./detect/index.ts";
import { formatReport } from "./format.ts";
import { findRepoRoot } from "./git.ts";
import { T3FileError, writeT3Scripts } from "./t3/project-file.ts";
import { t3ScriptsFor } from "./t3/scripts.ts";

const usage = `wtp - per-worktree ports and names through portless

Usage:
  wtp detect [dir] [--json]
      Print the stacks, dev commands, ports and e2e config found
  wtp t3 scripts [dir] [--dry-run] [--json] [--bin <cmd>] [--preview-url <url>]
      Write or merge the wtp scripts into t3.json at the repository root, by script name
  wtp help`;

export type CliResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

const usageError = (message: string): CliResult => ({ code: 2, stdout: "", stderr: `${message}\n\n${usage}` });

type Parsed = {
  readonly positional: string[];
  readonly flags: Set<string>;
  readonly values: Map<string, string>;
};

const parseArgs = (
  args: readonly string[],
  booleanFlags: readonly string[],
  valueFlags: readonly string[],
): Parsed | string => {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    const [flag = "", inline] = argument.split(/=(.*)/s, 2);
    if (booleanFlags.includes(flag) && inline === undefined) {
      flags.add(flag);
      continue;
    }
    if (!valueFlags.includes(flag)) return `unknown flag: ${flag}`;
    const value = inline ?? args[index + 1];
    if (value === undefined || value === "") return `${flag} needs a value`;
    if (inline === undefined) index += 1;
    values.set(flag, value);
  }
  return { positional, flags, values };
};

const runDetect = (args: readonly string[]): CliResult => {
  const parsed = parseArgs(args, ["--json"], []);
  if (typeof parsed === "string") return usageError(parsed);
  if (parsed.positional.length > 1) return usageError("detect takes at most one directory");
  const report = detect(parsed.positional[0] ?? process.cwd());
  const stdout = parsed.flags.has("--json") ? JSON.stringify(report, null, 2) : formatReport(report);
  return { code: 0, stdout, stderr: "" };
};

const runT3Scripts = (args: readonly string[]): CliResult => {
  const parsed = parseArgs(args, ["--dry-run", "--json"], ["--bin", "--preview-url"]);
  if (typeof parsed === "string") return usageError(parsed);
  if (parsed.positional.length > 1) return usageError("t3 scripts takes at most one directory");
  const start = parsed.positional[0] ?? process.cwd();
  const root = findRepoRoot(start);
  if (!root) return { code: 1, stdout: "", stderr: `no git repository at or above ${start}` };
  const scripts = t3ScriptsFor(detect(root), {
    bin: parsed.values.get("--bin") ?? "wtp",
    previewUrl: parsed.values.get("--preview-url") ?? null,
  });
  if (scripts.length === 0) return { code: 1, stdout: "", stderr: `no dev stacks detected in ${root}` };
  try {
    const dryRun = parsed.flags.has("--dry-run");
    const outcome = writeT3Scripts(root, scripts, { dryRun });
    if (parsed.flags.has("--json")) {
      const { file: _file, content: _content, ...summary } = outcome;
      return { code: 0, stdout: JSON.stringify({ ...summary, dryRun }, null, 2), stderr: "" };
    }
    const summary = [
      `${dryRun ? "would be " : ""}${outcome.status}: ${outcome.path}`,
      `added: ${outcome.added.join(", ") || "none"}`,
      `updated: ${outcome.updated.join(", ") || "none"}`,
      `unchanged: ${outcome.unchanged.join(", ") || "none"}`,
    ];
    return { code: 0, stdout: dryRun ? `${summary.join("\n")}\n\n${outcome.content.trimEnd()}` : summary.join("\n"), stderr: "" };
  } catch (error) {
    if (error instanceof T3FileError) return { code: 1, stdout: "", stderr: error.message };
    throw error;
  }
};

export const run = (argv: readonly string[]): CliResult => {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { code: 0, stdout: usage, stderr: "" };
  }
  if (command === "detect") return runDetect(rest);
  if (command === "t3") {
    const [subcommand, ...args] = rest;
    if (subcommand === "scripts") return runT3Scripts(args);
    return usageError(`unknown t3 subcommand: ${subcommand ?? "(none)"}`);
  }
  return usageError(`unknown command: ${command}`);
};

if (import.meta.main) {
  const result = run(process.argv.slice(2));
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exitCode = result.code;
}
