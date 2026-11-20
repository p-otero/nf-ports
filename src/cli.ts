import { ConfigError, loadConfig } from "./config.ts";
import { detect } from "./detect/index.ts";
import { type E2eOptions, type HiddenRequest, planE2e } from "./e2e/plan.ts";
import { runE2e } from "./e2e/run.ts";
import { formatReport } from "./format.ts";
import { findRepoRoot } from "./git.ts";
import { initProject, isCi, syncProject } from "./install.ts";
import { packageVersion } from "./package.ts";
import { runSetup } from "./setup.ts";
import { T3FileError, writeT3Scripts } from "./t3/project-file.ts";
import { defaultBin, retiredScripts, t3ScriptsFor } from "./t3/scripts.ts";
import { findLaunch, formatBanner } from "./up/plan.ts";
import { planFor, runUp } from "./up/run.ts";

const usage = `nfp - per-worktree ports and names through portless

Usage:
  nfp init
      Add "postinstall": "nfp sync" to the project's package.json and create nfp.json
  nfp sync [--quiet]
      Run on every install: merge the nfp scripts into t3.json and say if nfp setup is still needed.
      Silent when nothing changed, never interactive, never fails the install, skipped when CI is set.
      --quiet only prints warnings and the setup hint
  nfp detect [dir] [--json]
      Print the stacks, dev commands, ports and e2e config found
  nfp t3 scripts [dir] [--dry-run] [--json] [--bin <cmd>] [--preview-url <url>]
      Write or merge the nfp scripts into t3.json at the repository root, by script name.
      --bin defaults to the package manager's local runner (npx --no nfp, pnpm exec nfp, bunx nfp)
  nfp up [dir] [--print]
      Start every stack through portless under the branch name; the first line is the front URL.
      --print resolves and prints the launch plan as JSON without starting anything
  nfp url [app]
      Print the branch URL of an app (name, package, directory, front or back; default: the front)
  nfp e2e [dir] [--headed | --ui | --hidden[=env|desktop]] [--print] [-- runner args]
      Run Playwright or Cypress against this worktree's running front (start nfp up first).
      --hidden sets NFP_E2E_HIDDEN=1 and the app's e2e.hiddenEnv from nfp.json; without one,
      or with --hidden=desktop, the run happens on a hidden Windows desktop
  nfp setup [--quiet]
      Once per machine: start the portless proxy and trust its CA (no time limit on the dialog)
  nfp help | --version

Optional nfp.json at the repository root:
  { "apps": { "<dir>": { "name", "role", "portEnv", "env": { "KEY": "{url:<app>} | {branch}" } } },
    "e2e": { "config", "hiddenEnv", "env": { ... } } }`;

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
  const report = detect(root);
  const scripts = t3ScriptsFor(report, {
    bin: parsed.values.get("--bin") ?? defaultBin(report),
    previewUrl: parsed.values.get("--preview-url") ?? null,
  });
  if (scripts.length === 0) return { code: 1, stdout: "", stderr: `no dev stacks detected in ${root}` };
  try {
    const dryRun = parsed.flags.has("--dry-run");
    const outcome = writeT3Scripts(root, scripts, { dryRun, retired: retiredScripts });
    if (parsed.flags.has("--json")) {
      const { file: _file, content: _content, ...summary } = outcome;
      return { code: 0, stdout: JSON.stringify({ ...summary, dryRun }, null, 2), stderr: "" };
    }
    const summary = [
      `${dryRun ? "would be " : ""}${outcome.status}: ${outcome.path}`,
      `added: ${outcome.added.join(", ") || "none"}`,
      `updated: ${outcome.updated.join(", ") || "none"}`,
      `unchanged: ${outcome.unchanged.join(", ") || "none"}`,
      ...(outcome.removed.length > 0 ? [`removed: ${outcome.removed.join(", ")}`] : []),
    ];
    return { code: 0, stdout: dryRun ? `${summary.join("\n")}\n\n${outcome.content.trimEnd()}` : summary.join("\n"), stderr: "" };
  } catch (error) {
    if (error instanceof T3FileError) return { code: 1, stdout: "", stderr: error.message };
    throw error;
  }
};

export const runSync = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): CliResult => {
  const parsed = parseArgs(args, ["--quiet"], []);
  if (typeof parsed === "string" || parsed.positional.length > 0) return usageError("sync takes only --quiet");
  if (isCi(env)) return { code: 0, stdout: "", stderr: "" };
  const root = findRepoRoot(env["INIT_CWD"] ?? process.cwd());
  if (!root) return { code: 0, stdout: "", stderr: "" };
  const result = syncProject(root);
  const quiet = parsed.flags.has("--quiet");
  const lines = result.lines.filter(
    (line) => !line.startsWith("t3.json unchanged") && !(quiet && line.startsWith("t3.json")),
  );
  return { code: result.code, stdout: lines.map((line) => `nfp: ${line}`).join("\n"), stderr: "" };
};

const runInit = (args: readonly string[]): CliResult => {
  if (args.length > 0) return usageError("init takes no arguments");
  const root = findRepoRoot(process.cwd());
  if (!root) return { code: 1, stdout: "", stderr: `no git repository at or above ${process.cwd()}` };
  const { changed } = initProject(root);
  const synced = syncProject(root);
  const lines = [changed.length > 0 ? `updated ${changed.join(", ")}` : "already set up", ...synced.lines];
  return { code: 0, stdout: lines.map((line) => `nfp: ${line}`).join("\n"), stderr: "" };
};

export const run = (argv: readonly string[]): CliResult => {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { code: 0, stdout: usage, stderr: "" };
  }
  if (command === "--version" || command === "-v") return { code: 0, stdout: packageVersion(), stderr: "" };
  if (command === "sync") return runSync(rest);
  if (command === "init") return runInit(rest);
  if (command === "detect") return runDetect(rest);
  if (command === "t3") {
    const [subcommand, ...args] = rest;
    if (subcommand === "scripts") return runT3Scripts(args);
    return usageError(`unknown t3 subcommand: ${subcommand ?? "(none)"}`);
  }
  return usageError(`unknown command: ${command}`);
};

export type UpRequest = { readonly root: string; readonly print: boolean };

export type E2eRequest = { readonly root: string; readonly print: boolean; readonly options: E2eOptions };

const hiddenRequests: Record<string, HiddenRequest> = { "--hidden": "auto", "--hidden=env": "env", "--hidden=desktop": "desktop" };

export const parseE2e = (args: readonly string[]): E2eRequest | CliResult => {
  const separator = args.indexOf("--");
  const own = separator === -1 ? args : args.slice(0, separator);
  const passthrough = separator === -1 ? [] : args.slice(separator + 1);
  let hidden: HiddenRequest | null = null;
  const rest: string[] = [];
  for (const argument of own) {
    const request = hiddenRequests[argument];
    if (request) hidden = request;
    else if (argument.startsWith("--hidden")) return usageError(`--hidden takes env or desktop, not ${argument}`);
    else rest.push(argument);
  }
  const parsed = parseArgs(rest, ["--headed", "--ui", "--print"], []);
  if (typeof parsed === "string") return usageError(parsed);
  if (parsed.positional.length > 1) return usageError("e2e takes at most one directory; pass runner arguments after --");
  const headed = parsed.flags.has("--headed");
  const ui = parsed.flags.has("--ui");
  if (headed && ui) return usageError("--headed and --ui are exclusive");
  if (hidden && (headed || ui)) return usageError("--hidden cannot be combined with --headed or --ui");
  const start = parsed.positional[0] ?? process.cwd();
  const root = findRepoRoot(start);
  if (!root) return { code: 1, stdout: "", stderr: `no git repository at or above ${start}` };
  return { root, print: parsed.flags.has("--print"), options: { headed, ui, hidden, args: passthrough } };
};

export const parseUp = (args: readonly string[]): UpRequest | CliResult => {
  const parsed = parseArgs(args, ["--print"], []);
  if (typeof parsed === "string") return usageError(parsed);
  if (parsed.positional.length > 1) return usageError("up takes at most one directory");
  const start = parsed.positional[0] ?? process.cwd();
  const root = findRepoRoot(start);
  if (!root) return { code: 1, stdout: "", stderr: `no git repository at or above ${start}` };
  return { root, print: parsed.flags.has("--print") };
};

const emit = (result: CliResult): number => {
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  return result.code;
};

const json = (value: unknown): CliResult => ({ code: 0, stdout: JSON.stringify(value, null, 2), stderr: "" });

const repoRoot = (): string | CliResult =>
  findRepoRoot(process.cwd()) ?? { code: 1, stdout: "", stderr: `no git repository at or above ${process.cwd()}` };

const runUrl = (args: readonly string[]): CliResult => {
  if (args.length > 1 || args.some((argument) => argument.startsWith("-"))) return usageError("url takes at most one app");
  const root = repoRoot();
  if (typeof root !== "string") return root;
  const launch = findLaunch(planFor(root), args[0]);
  if (!launch) return { code: 1, stdout: "", stderr: `no app matches ${args[0] ?? "front"}` };
  return { code: 0, stdout: launch.url, stderr: "" };
};

const dispatch = async (argv: readonly string[]): Promise<number> => {
  const [command, ...rest] = argv;
  if (command === "url") return emit(runUrl(rest));
  if (command === "setup") {
    const parsed = parseArgs(rest, ["--quiet"], []);
    if (typeof parsed === "string" || parsed.positional.length > 0) return emit(usageError("setup takes only --quiet"));
    return runSetup(parsed.flags.has("--quiet"));
  }
  if (command === "e2e") {
    const request = parseE2e(rest);
    if ("code" in request) return emit(request);
    const plan = planE2e(detect(request.root), planFor(request.root), loadConfig(request.root), request.options);
    return request.print ? emit(json(plan)) : runE2e(plan);
  }
  if (command !== "up") return emit(run(argv));
  const request = parseUp(rest);
  if ("code" in request) return emit(request);
  if (!request.print) return runUp(request.root);
  const plan = planFor(request.root);
  return emit(json({ banner: formatBanner(plan), ...plan }));
};

export const main = async (argv: readonly string[]): Promise<number> => {
  try {
    return await dispatch(argv);
  } catch (error) {
    if (error instanceof ConfigError) return emit({ code: 1, stdout: "", stderr: error.message });
    throw error;
  }
};
