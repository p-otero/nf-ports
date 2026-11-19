import { basename, join } from "node:path";
import type { Evidence, PortFinding, PortOverride, Stack, StackRole } from "./types.ts";
import { firstExisting, isRecord, readJson, readText, stringRecord } from "./files.ts";
import { type Framework, frameworks } from "./frameworks.ts";
import { effectivePort, envPorts, scriptFlagPorts, sourcePorts } from "./ports.ts";

const devScriptNames = ["dev", "start:dev", "serve", "start"] as const;
const serverRunner = /^(?:node|bun|tsx|ts-node|deno|nodemon)\b/;
const serverEntry = /([\w./-]+\.(?:[cm]?[jt]s))\b/;
const readsPort = /(?:process|Bun)\.env\.PORT|env\[["']PORT["']\]|env\.PORT/;

type Manifest = {
  readonly name: string | null;
  readonly scripts: Record<string, string>;
  readonly dependencies: Set<string>;
};

const readManifest = (directory: string): Manifest | null => {
  const manifest = readJson(join(directory, "package.json"));
  if (!isRecord(manifest)) return null;
  const dependencies = new Set([
    ...Object.keys(stringRecord(manifest["dependencies"])),
    ...Object.keys(stringRecord(manifest["devDependencies"])),
  ]);
  const name = typeof manifest["name"] === "string" ? manifest["name"] : null;
  return { name, scripts: stringRecord(manifest["scripts"]), dependencies };
};

const nxServeTarget = (directory: string, projectName: string): Evidence | null => {
  const project = readJson(join(directory, "project.json"));
  const targets = isRecord(project) && isRecord(project["targets"]) ? project["targets"] : null;
  if (!targets) return null;
  const target = ["serve", "dev"].find((name) => name in targets);
  return target ? { value: `nx run ${projectName}:${target}`, source: "project.json" } : null;
};

const findFramework = (directory: string, manifest: Manifest): Framework | null =>
  frameworks.find(
    (framework) =>
      framework.packages.some((name) => manifest.dependencies.has(name)) ||
      firstExisting(directory, framework.configs) !== null,
  ) ?? null;

const entryWarnings = (entryText: string | null): string[] => {
  if (entryText === null) return [];
  const warnings: string[] = [];
  if (!readsPort.test(entryText)) {
    warnings.push("server entry never reads PORT; portless cannot move it without a code change");
  }
  if (/override\s*:\s*true/.test(entryText)) {
    warnings.push("dotenv override:true lets .env replace the injected PORT");
  }
  return warnings;
};

type EntryAnalysis = {
  readonly ports: PortFinding[];
  readonly warnings: string[];
  readonly readsPort: boolean;
};

const analyzeEntry = (directory: string, prefix: string, command: string): EntryAnalysis | null => {
  const entry = serverRunner.test(command) ? serverEntry.exec(command)?.[1] : undefined;
  if (!entry) return null;
  const text = readText(join(directory, entry));
  return {
    ports: sourcePorts(join(directory, entry), `${prefix}${entry}`),
    warnings: entryWarnings(text),
    readsPort: text !== null && readsPort.test(text),
  };
};

const resolveDevCommand = (directory: string, manifest: Manifest, name: string): Evidence | null => {
  const scriptName = devScriptNames.find((candidate) => candidate in manifest.scripts);
  const script = scriptName ? manifest.scripts[scriptName] : undefined;
  if (scriptName && script) return { value: script, source: `package.json#scripts.${scriptName}` };
  return nxServeTarget(directory, name);
};

export const detectStack = (root: string, relativeDirectory: string): Stack | null => {
  const directory = join(root, relativeDirectory);
  const manifest = readManifest(directory);
  if (!manifest) return null;
  const name = manifest.name ?? basename(directory);
  const devCommand = resolveDevCommand(directory, manifest, name);
  if (!devCommand) return null;

  const framework = findFramework(directory, manifest);
  const prefix = relativeDirectory === "" ? "" : `${relativeDirectory}/`;
  const configFile = framework ? firstExisting(directory, framework.configs) : null;
  const entry = analyzeEntry(directory, prefix, devCommand.value);
  const ports: PortFinding[] = [
    ...scriptFlagPorts(devCommand.value, devCommand.source),
    ...envPorts(directory, prefix),
    ...(configFile ? sourcePorts(join(directory, configFile), `${prefix}${configFile}`) : []),
    ...(entry?.ports ?? []),
    ...(framework?.defaultPort
      ? [{ port: framework.defaultPort, source: `${framework.name} default`, kind: "framework-default" as const }]
      : []),
  ];

  const role: StackRole = framework?.role ?? (entry ? "back" : "unknown");
  const fallbackOverride: PortOverride = entry?.readsPort ? "env:PORT" : "manual";

  return {
    name,
    directory: relativeDirectory === "" ? "." : relativeDirectory,
    role,
    framework: framework?.name ?? null,
    devCommand,
    ports,
    effectivePort: effectivePort(ports),
    portOverride: framework?.override ?? fallbackOverride,
    warnings: entry?.warnings ?? [],
  };
};

const procfileRole = (name: string): StackRole => {
  if (/^(web|front|frontend|ui|client)$/.test(name)) return "front";
  if (/^(api|server|backend|worker)$/.test(name)) return "back";
  return "unknown";
};

export const procfileStack = (entry: { name: string; command: string; source: string }): Stack => {
  const ports = scriptFlagPorts(entry.command, `${entry.source}:${entry.name}`);
  return {
    name: entry.name,
    directory: ".",
    role: procfileRole(entry.name),
    framework: null,
    devCommand: { value: entry.command, source: `${entry.source}:${entry.name}` },
    ports,
    effectivePort: effectivePort(ports),
    portOverride: /\$PORT\b|\$\{PORT\}/.test(entry.command) ? "env:PORT" : "manual",
    warnings: [],
  };
};
