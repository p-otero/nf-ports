#!/usr/bin/env bun
import { detect } from "./detect/index.ts";
import { formatReport } from "./format.ts";

const usage = `wtp - per-worktree ports and names through portless

Usage:
  wtp detect [dir] [--json]   Print the stacks, dev commands, ports and e2e config found
  wtp help                    Show this help`;

export const run = (argv: readonly string[]): { code: number; stdout: string; stderr: string } => {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { code: 0, stdout: usage, stderr: "" };
  }
  if (command !== "detect") return { code: 2, stdout: "", stderr: `unknown command: ${command}\n\n${usage}` };
  const json = rest.includes("--json");
  const unknownFlag = rest.find((argument) => argument.startsWith("-") && argument !== "--json");
  if (unknownFlag) return { code: 2, stdout: "", stderr: `unknown flag: ${unknownFlag}` };
  const positional = rest.filter((argument) => !argument.startsWith("-"));
  if (positional.length > 1) return { code: 2, stdout: "", stderr: "detect takes at most one directory" };
  const report = detect(positional[0] ?? process.cwd());
  return { code: 0, stdout: json ? JSON.stringify(report, null, 2) : formatReport(report), stderr: "" };
};

if (import.meta.main) {
  const result = run(process.argv.slice(2));
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exitCode = result.code;
}
