import { join } from "node:path";
import type { PortFinding } from "./types.ts";
import { parseEnv, readText } from "./files.ts";

export const envFiles = [".env", ".env.development", ".env.local", ".env.development.local"] as const;

const portKey = /(^|_)PORT$/;

export const envPorts = (directory: string, prefix: string): PortFinding[] =>
  envFiles.flatMap((file) => {
    const text = readText(join(directory, file));
    if (text === null) return [];
    return Object.entries(parseEnv(text)).flatMap(([key, value]) => {
      const port = Number(value);
      if (!portKey.test(key) || !Number.isInteger(port) || port <= 0) return [];
      return [{ port, source: `${prefix}${file}:${key}`, kind: "env-file" as const }];
    });
  });

const sourcePatterns = [
  /\bport\s*:\s*(\d{2,5})\b/g,
  /PORT\s*(?:\?\?|\|\|)\s*['"]?(\d{2,5})/g,
  /\.listen\(\s*(\d{2,5})\b/g,
];

export const sourcePorts = (path: string, label: string): PortFinding[] => {
  const text = readText(path);
  if (text === null) return [];
  const ports = sourcePatterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => Number(match[1])));
  return [...new Set(ports)].map((port) => ({ port, source: label, kind: "config" as const }));
};

export const scriptFlagPorts = (command: string, label: string): PortFinding[] =>
  [...command.matchAll(/(?:--port[=\s]|-p\s)(\d{2,5})\b/g)].map((match) => ({
    port: Number(match[1]),
    source: label,
    kind: "script-flag" as const,
  }));

const precedence: readonly PortFinding["kind"][] = ["script-flag", "env-file", "config", "framework-default"];

export const effectivePort = (ports: readonly PortFinding[]): number | null => {
  for (const kind of precedence) {
    const candidates = ports.filter((finding) => finding.kind === kind);
    const exact = kind === "env-file" ? candidates.filter((finding) => finding.source.endsWith(":PORT")) : candidates;
    const chosen = exact.at(-1);
    if (chosen) return chosen.port;
  }
  return null;
};
