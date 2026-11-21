import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export const readJson = (path: string): unknown => {
  const text = readText(path);
  return text === null ? null : parseJson(text);
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const stringField = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

export const isPresent = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value !== "";

export const stringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

export const firstExisting = (directory: string, names: readonly string[]): string | null =>
  names.find((name) => existsSync(join(directory, name))) ?? null;

export const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const listDirectories = (path: string): string[] => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return [];
  }
};

export const parseEnv = (text: string): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(rawLine);
    if (!isPresent(match?.[1])) continue;
    entries[match[1]] = (match[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return entries;
};

export const toPosix = (path: string): string => path.replaceAll("\\", "/");
