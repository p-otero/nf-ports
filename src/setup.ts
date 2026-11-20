import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { portless } from "./up/run.ts";

type Finding = { readonly status: string; readonly message: string };
type Doctor = { readonly stateDir: string; readonly findings: readonly Finding[] };

const isWindows = process.platform === "win32";

const readDoctor = (): Doctor | null => {
  const result = portless(["doctor", "--json"]);
  try {
    const parsed = JSON.parse(result.stdout) as Partial<Doctor>;
    if (typeof parsed.stateDir !== "string" || !Array.isArray(parsed.findings)) return null;
    return { stateDir: parsed.stateDir, findings: parsed.findings };
  } catch {
    return null;
  }
};

export const caTrusted = (doctor: Doctor): boolean =>
  doctor.findings.some((finding) => finding.status === "ok" && /Local CA is trusted/i.test(finding.message));

const trustCa = (stateDir: string): boolean => {
  const ca = join(stateDir, "ca.pem");
  if (!existsSync(ca)) return false;
  const result = isWindows
    ? spawnSync("certutil", ["-addstore", "-user", "Root", ca], { stdio: "inherit" })
    : spawnSync("portless", ["trust"], { stdio: "inherit" });
  return result.status === 0;
};

export const runSetup = (quiet: boolean): number => {
  const say = (line: string): void => {
    if (!quiet) process.stdout.write(`${line}\n`);
  };
  const version = portless(["--version"]);
  if (version.status !== 0) {
    process.stderr.write("portless is not installed: npm install --global portless@0.18.1\n");
    return 1;
  }
  say(`portless ${version.stdout.trim()}`);

  const proxy = portless(["proxy", "start", "--skip-trust"]);
  if (proxy.status !== 0) {
    process.stderr.write(`portless proxy start failed:\n${proxy.stdout}${proxy.stderr}`);
    return 1;
  }
  say("proxy: running");

  const doctor = readDoctor();
  if (!doctor) {
    process.stderr.write("portless doctor --json returned no readable report\n");
    return 1;
  }
  if (caTrusted(doctor)) {
    say("CA: trusted");
    return 0;
  }
  process.stdout.write("Trusting the portless CA for this user; accept the Windows dialog (no time limit).\n");
  const after = trustCa(doctor.stateDir) ? readDoctor() : null;
  if (!after || !caTrusted(after)) {
    process.stderr.write(`the portless CA is still not trusted; run: certutil -addstore -user Root "${join(doctor.stateDir, "ca.pem")}"\n`);
    return 1;
  }
  say("CA: trusted");
  return 0;
};
