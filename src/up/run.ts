import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { loadConfig } from "../config.ts";
import { portlessCommand } from "../package.ts";
import { detect } from "../detect/index.ts";
import { isRecord, stringField } from "../detect/files.ts";
import { formatBanner, type Launch, planUp, portPlaceholder, type UpPlan } from "./plan.ts";

const isWindows = process.platform === "win32";

export const portless = (args: readonly string[], env: Readonly<Record<string, string>> = {}) => {
  const command = portlessCommand(args);
  return spawnSync(command.program, [...command.args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: command.shell,
    windowsHide: true,
  });
};

export const currentBranch = (root: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

export class UpError extends Error {
  override readonly name = "UpError";
}

export const resolvePortlessUrl = (name: string, prefix: string): string => {
  const result = portless(["get", name, "--json"], { PORTLESS_PREFIX: prefix });
  if (result.status !== 0) throw new UpError(`portless get ${name} failed: ${result.stderr.trim()}`);
  const url = stringField(JSON.parse(result.stdout) as unknown, "url");
  if (url === undefined) throw new UpError(`portless get ${name} returned no url`);
  return url;
};

export const planFor = (root: string): UpPlan =>
  planUp(detect(root), currentBranch(root), resolvePortlessUrl, process.env.NODE_OPTIONS, loadConfig(root));

export const activeRouteUrls = (): Set<string> => {
  const result = portless(["list", "--json"]);
  if (result.status !== 0) return new Set();
  const parsed = JSON.parse(result.stdout) as unknown;
  const routes: unknown[] = isRecord(parsed) && Array.isArray(parsed.routes) ? parsed.routes : [];
  return new Set(
    routes.flatMap((route) => {
      const url = stringField(route, "url");
      return url === undefined ? [] : [url.replace(/\/+$/, "")];
    }),
  );
};

const isFree = async (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => {
        resolve(true);
      });
    });
  });

export const freePort = async (taken: ReadonlySet<number>, attempts = 200): Promise<number> => {
  if (attempts === 0) throw new UpError("no free port between 4000 and 4999");
  const port = 4000 + Math.floor(Math.random() * 1000);
  return !taken.has(port) && (await isFree(port)) ? port : freePort(taken, attempts - 1);
};

const allocatePorts = async (launches: readonly Launch[], taken: ReadonlySet<number>): Promise<(number | null)[]> => {
  const [first, ...rest] = launches;
  if (!first) return [];
  const port = first.appPort ? await freePort(taken) : null;
  return [port, ...(await allocatePorts(rest, port === null ? taken : new Set([...taken, port])))];
};

export const withPort = (env: Readonly<Record<string, string>>, port: number): Record<string, string> =>
  Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value.replaceAll(portPlaceholder, String(port))]));

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

const launch = (entry: Launch, port: number | null): ChildProcess => {
  const command = portlessCommand(["run", "--name", entry.name, ...(port === null ? [] : ["--app-port", String(port)])]);
  const child = spawn(command.program, [...command.args], {
    cwd: entry.directory,
    env: { ...process.env, ...(port === null ? entry.env : withPort(entry.env, port)) },
    shell: command.shell,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pipeWithPrefix(child.stdout, entry.name, (line) => {
    process.stdout.write(`${line}\n`);
  });
  pipeWithPrefix(child.stderr, entry.name, (line) => {
    process.stderr.write(`${line}\n`);
  });
  return child;
};

export const runUp = async (root: string): Promise<number> => {
  const proxy = portless(["proxy", "start", "--skip-trust"]);
  if (proxy.status !== 0) {
    process.stderr.write(`portless proxy start failed:\n${proxy.stdout}${proxy.stderr}`);
    return 1;
  }
  const plan = planFor(root);
  if (plan.launches.length === 0) {
    process.stderr.write(`no launchable stacks in ${root}\n`);
    return 1;
  }
  process.stdout.write(`${formatBanner(plan).join("\n")}\n`);
  if (plan.skipped.length > 0) process.stderr.write(`not launched (start them yourself): ${plan.skipped.join(", ")}\n`);

  for (const warning of plan.warnings) process.stderr.write(`warning: ${warning}\n`);

  const ports = await allocatePorts(plan.launches, new Set());
  const children = plan.launches.map((entry, index) => launch(entry, ports[index] ?? null));
  const stopAll = (): void => {
    children.forEach(stopTree);
  };
  process.once("SIGINT", stopAll);
  process.once("SIGTERM", stopAll);
  const codes = await Promise.all(
    children.map(
      async (child) =>
        new Promise<number>((resolve) => {
          child.once("exit", (code) => {
            resolve(code ?? 1);
          });
        }),
    ),
  );
  stopAll();
  return codes.find((code) => code !== 0) ?? 0;
};
