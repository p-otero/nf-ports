import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { DetectReport, Orchestrator } from "./types.ts";
import { isDirectory, isRecord, listDirectories, readJson, readText, toPosix } from "./files.ts";

const workspacePatterns = (root: string): string[] => {
  const manifest = readJson(join(root, "package.json"));
  const fromManifest = isRecord(manifest) ? manifest["workspaces"] : undefined;
  const list = isRecord(fromManifest) ? fromManifest["packages"] : fromManifest;
  const patterns = Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  const pnpm = readText(join(root, "pnpm-workspace.yaml"));
  if (pnpm) {
    for (const match of pnpm.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)) {
      if (match[1]) patterns.push(match[1]);
    }
  }
  return patterns;
};

const expandPattern = (root: string, pattern: string): string[] => {
  if (pattern.startsWith("!")) return [];
  const clean = pattern.replace(/\/\*\*?$/, "");
  if (clean === pattern) return isDirectory(join(root, pattern)) ? [pattern] : [];
  return listDirectories(join(root, clean)).map((name) => `${clean}/${name}`);
};

export const findPackageDirectories = (root: string): string[] => {
  const expanded = workspacePatterns(root).flatMap((pattern) => expandPattern(root, pattern));
  const withManifest = expanded.filter((directory) => existsSync(join(root, directory, "package.json")));
  return [...new Set(withManifest)].map((directory) => toPosix(relative(root, join(root, directory)))).toSorted();
};

export const detectPackageManager = (root: string): DetectReport["packageManager"] => {
  const manifest = readJson(join(root, "package.json"));
  const declared = isRecord(manifest) ? manifest["packageManager"] : undefined;
  if (typeof declared === "string") {
    const name = declared.split("@")[0];
    if (name === "bun" || name === "pnpm" || name === "yarn" || name === "npm") return name;
  }
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  return "npm";
};

export const detectOrchestrators = (root: string): Orchestrator[] => {
  const found: Orchestrator[] = [];
  if (existsSync(join(root, "turbo.json"))) found.push("turbo");
  if (existsSync(join(root, "nx.json"))) found.push("nx");
  if (existsSync(join(root, "Procfile")) || existsSync(join(root, "Procfile.dev"))) found.push("procfile");
  return found;
};

export const readProcfile = (root: string): { name: string; command: string; source: string }[] => {
  const file = existsSync(join(root, "Procfile.dev")) ? "Procfile.dev" : "Procfile";
  const text = readText(join(root, file));
  if (!text) return [];
  return [...text.matchAll(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/gm)].flatMap((match) =>
    match[1] && match[2] ? [{ name: match[1], command: match[2], source: file }] : [],
  );
};
