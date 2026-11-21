import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "./config.ts";
import { detect } from "./detect/index.ts";
import { isPresent, isRecord, stringField } from "./detect/files.ts";
import { T3FileError, writeT3Scripts } from "./t3/project-file.ts";
import { defaultBin, retiredScripts, t3ScriptsFor } from "./t3/scripts.ts";

export const syncCommand = "nfp sync";
export const schemaPath = "./node_modules/nf-ports/nfp.schema.json";

export const isCi = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const value = env.CI;
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
};

export type PortlessState = "ready" | "no-ca" | "untrusted";

const stateDir = (): string => process.env.PORTLESS_STATE_DIR ?? join(homedir(), ".portless");

export const portlessState = (): PortlessState => {
  const ca = join(stateDir(), "ca.pem");
  if (!existsSync(ca)) return "no-ca";
  if (process.platform !== "win32") return "ready";
  try {
    const fingerprint = new X509Certificate(readFileSync(ca)).fingerprint.replaceAll(":", "").toLowerCase();
    const listing = spawnSync("certutil", ["-user", "-store", "Root"], { encoding: "utf8", windowsHide: true });
    return listing.stdout.replace(/\s/g, "").toLowerCase().includes(fingerprint) ? "ready" : "untrusted";
  } catch {
    return "untrusted";
  }
};

export type SyncResult = { readonly code: number; readonly lines: readonly string[] };

export const syncProject = (root: string, readiness: () => PortlessState = portlessState): SyncResult => {
  const lines: string[] = [];
  try {
    loadConfig(root);
    const report = detect(root);
    const scripts = t3ScriptsFor(report, { bin: defaultBin(report), previewUrl: null });
    if (scripts.length > 0) {
      const outcome = writeT3Scripts(root, scripts, { dryRun: false, retired: retiredScripts });
      const changes = [...outcome.added, ...outcome.updated].join(", ");
      const removed = outcome.removed.length > 0 ? `; removed ${outcome.removed.join(", ")}` : "";
      lines.push(`t3.json ${outcome.status}${changes ? `: ${changes}` : ""}${removed}`);
    } else {
      lines.push("no dev stacks detected; t3.json left alone");
    }
  } catch (error) {
    if (!(error instanceof ConfigError || error instanceof T3FileError)) throw error;
    return { code: 0, lines: [`warning: ${error.message}`] };
  }
  const state = readiness();
  if (state !== "ready") {
    lines.push(`portless ${state === "no-ca" ? "has no CA yet" : "CA is not trusted"}; run nfp setup once on this machine`);
  }
  return { code: 0, lines };
};

const detectIndent = (text: string): string => /^[ \t]+(?=")/m.exec(text)?.[0] ?? "  ";

export type InitResult = { readonly changed: readonly string[] };

export const initProject = (root: string): InitResult => {
  const changed: string[] = [];
  const manifestPath = join(root, "package.json");
  const text = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(text) as unknown;
  if (!isRecord(manifest)) throw new ConfigError(`${manifestPath} must contain an object`);
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  const postinstall = stringField(scripts, "postinstall");
  if (postinstall?.includes(syncCommand) !== true) {
    manifest.scripts = { ...scripts, postinstall: isPresent(postinstall) ? `${postinstall} && ${syncCommand}` : syncCommand };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, detectIndent(text))}\n`);
    changed.push("package.json scripts.postinstall");
  }
  const configPath = join(root, "nfp.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify({ $schema: schemaPath }, null, 2)}\n`);
    changed.push("nfp.json");
  }
  return { changed };
};
