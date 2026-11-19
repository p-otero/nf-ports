import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { detect } from "../detect/index.ts";
import { formatBanner, type Launch, planUp } from "./plan.ts";

const isWindows = process.platform === "win32";

const portless = (args: readonly string[], env: Readonly<Record<string, string>> = {}) =>
  spawnSync("portless", [...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: isWindows,
    windowsHide: true,
  });

export const currentBranch = (root: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

export const resolvePortlessUrl = (name: string, prefix: string): string => {
  const result = portless(["get", name, "--json"], { PORTLESS_PREFIX: prefix });
  if (result.status !== 0) throw new Error(`portless get ${name} failed: ${result.stderr.trim()}`);
  const parsed = JSON.parse(result.stdout) as { url?: unknown };
  if (typeof parsed.url !== "string") throw new Error(`portless get ${name} returned no url`);
  return parsed.url;
};

const pipeWithPrefix = (stream: NodeJS.ReadableStream | null, label: string, write: (line: string) => void): void => {
  if (!stream) return;
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) write(`[${label}] ${line}`);
  });
  stream.on("end", () => {
    if (buffer) write(`[${label}] ${buffer}`);
  });
};

const stopTree = (child: ChildProcess): void => {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (isWindows) spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  else child.kill("SIGTERM");
};

const launch = (entry: Launch): ChildProcess => {
  const child = spawn("portless", ["run", "--name", entry.name], {
    cwd: entry.directory,
    env: { ...process.env, ...entry.env },
    shell: isWindows,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pipeWithPrefix(child.stdout, entry.name, (line) => process.stdout.write(`${line}\n`));
  pipeWithPrefix(child.stderr, entry.name, (line) => process.stderr.write(`${line}\n`));
  return child;
};

export const runUp = async (root: string): Promise<number> => {
  const proxy = portless(["proxy", "start", "--skip-trust"]);
  if (proxy.status !== 0) {
    process.stderr.write(`portless proxy start failed:\n${proxy.stdout}${proxy.stderr}`);
    return 1;
  }
  const plan = planUp(detect(root), currentBranch(root), resolvePortlessUrl);
  if (plan.launches.length === 0) {
    process.stderr.write(`no launchable stacks in ${root}\n`);
    return 1;
  }
  process.stdout.write(`${formatBanner(plan).join("\n")}\n`);
  if (plan.skipped.length > 0) process.stderr.write(`not launched (start them yourself): ${plan.skipped.join(", ")}\n`);

  const children = plan.launches.map(launch);
  const stopAll = (): void => children.forEach(stopTree);
  process.once("SIGINT", stopAll);
  process.once("SIGTERM", stopAll);
  const codes = await Promise.all(
    children.map((child) => new Promise<number>((resolve) => child.once("exit", (code) => resolve(code ?? 1)))),
  );
  stopAll();
  return codes.find((code) => code !== 0) ?? 0;
};
