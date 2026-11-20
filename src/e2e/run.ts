import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeRouteUrls } from "../up/run.ts";
import type { E2ePlan } from "./plan.ts";

const isWindows = process.platform === "win32";
const hiddenDesktopScript = fileURLToPath(new URL("../../scripts/hidden-desktop.ps1", import.meta.url));

const quoteForCmd = (argument: string): string =>
  /^[\w./:=@+-]+$/.test(argument) ? argument : `"${argument.replaceAll('"', '""')}"`;

export const desktopCommandLine = (command: readonly string[], log: string): string =>
  `cmd.exe /d /s /c "${command.map(quoteForCmd).join(" ")} > "${log}" 2>&1"`;

const waitForExit = (child: ChildProcess): Promise<number> =>
  new Promise((resolve) => {
    child.once("exit", (code) => resolve(code ?? 1));
    child.once("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
  });

const stopTree = (child: ChildProcess): void => {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (isWindows) spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  else child.kill("SIGTERM");
};

const tailFile = (path: string): (() => void) => {
  let offset = 0;
  const pump = (): void => {
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return;
    }
    if (size <= offset) return;
    const buffer = Buffer.alloc(size - offset);
    const descriptor = openSync(path, "r");
    try {
      readSync(descriptor, buffer, 0, buffer.length, offset);
    } finally {
      closeSync(descriptor);
    }
    offset = size;
    process.stdout.write(buffer);
  };
  const timer = setInterval(pump, 250);
  return () => {
    clearInterval(timer);
    pump();
  };
};

const runVisible = (plan: E2ePlan): ChildProcess => {
  const [program = "", ...args] = plan.command;
  return spawn(program, args, {
    cwd: plan.cwd,
    env: { ...process.env, ...plan.env },
    shell: isWindows,
    stdio: "inherit",
  });
};

const runOnHiddenDesktop = (plan: E2ePlan, log: string): ChildProcess =>
  spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& $env:NFP_DESKTOP_SCRIPT -DesktopName $env:NFP_DESKTOP_NAME -CommandLine $env:NFP_DESKTOP_COMMAND -WorkDir $env:NFP_DESKTOP_CWD; exit $LASTEXITCODE",
    ],
    {
      env: {
        ...process.env,
        ...plan.env,
        NFP_DESKTOP_SCRIPT: hiddenDesktopScript,
        NFP_DESKTOP_NAME: plan.desktop ?? "nfp-e2e",
        NFP_DESKTOP_COMMAND: desktopCommandLine(plan.command, log),
        NFP_DESKTOP_CWD: plan.cwd,
      },
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    },
  );

export const runE2e = async (plan: E2ePlan): Promise<number> => {
  if (plan.hidden === "desktop" && !isWindows) {
    process.stderr.write("--hidden=desktop needs Windows; declare e2e.hiddenEnv in nfp.json and use --hidden=env\n");
    return 2;
  }
  if (plan.baseUrl && !activeRouteUrls().has(plan.baseUrl.replace(/\/+$/, ""))) {
    process.stderr.write(`nothing is serving ${plan.baseUrl}; start nfp up in this worktree first\n`);
    return 1;
  }
  const shown = [
    plan.baseUrl ? `baseURL ${plan.baseUrl}` : "no front",
    plan.hidden ? `hidden: ${plan.hidden === "desktop" ? `desktop ${plan.desktop ?? ""}` : "app env"}` : null,
    process.env["ELECTRON_OVERRIDE_DIST_PATH"] ? `electron ${process.env["ELECTRON_OVERRIDE_DIST_PATH"]}` : null,
  ].filter(Boolean);
  process.stderr.write(`e2e: ${plan.command.join(" ")}  (${shown.join(", ")})\n`);

  if (plan.wrapper) writeFileSync(plan.wrapper.path, plan.wrapper.content);
  const log = join(tmpdir(), `${plan.desktop ?? "nfp-e2e"}-${process.pid}.log`);
  const child = plan.hidden === "desktop" ? runOnHiddenDesktop(plan, log) : runVisible(plan);
  const stopTail = plan.hidden === "desktop" ? tailFile(log) : () => undefined;
  const stop = (): void => stopTree(child);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await waitForExit(child);
  } finally {
    stopTail();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (plan.wrapper) rmSync(plan.wrapper.path, { force: true });
    rmSync(log, { force: true });
  }
};
