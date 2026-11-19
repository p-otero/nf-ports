import { join } from "node:path";
import type { E2eConfig, E2eRunner, Evidence } from "./types.ts";
import { firstExisting, readText } from "./files.ts";

const configFiles = (base: string): string[] =>
  ["ts", "mts", "cts", "js", "mjs", "cjs"].map((extension) => `${base}.${extension}`);

const runners: readonly { runner: E2eRunner; files: readonly string[]; key: string }[] = [
  { runner: "playwright", files: configFiles("playwright.config"), key: "baseURL" },
  { runner: "cypress", files: configFiles("cypress.config"), key: "baseUrl" },
];

const envReference = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g;

const envNames = (text: string): string[] =>
  [...new Set([...text.matchAll(envReference)].map((match) => match[1] ?? match[2] ?? ""))].filter(Boolean);

const identifier = /^[A-Za-z_$][\w$]*$/;

const resolveValue = (text: string, key: string): string | null => {
  const match = new RegExp(String.raw`\b${key}\b\s*(?::\s*([^,\n}]+))?\s*[,}\n]`).exec(text);
  if (!match) return null;
  const expression = (match[1] ?? key).trim();
  if (!identifier.test(expression)) return expression;
  const declaration = new RegExp(String.raw`(?:const|let|var)\s+${expression}\s*=\s*([^;\n]+)`).exec(text);
  return declaration?.[1]?.trim() ?? expression;
};

const overrideFor = (runner: E2eRunner, baseUrlEnv: string | null, webServer: boolean): string => {
  if (runner === "cypress") return "env CYPRESS_BASE_URL (native Cypress override)";
  if (baseUrlEnv && !webServer) return `env ${baseUrlEnv}`;
  if (baseUrlEnv) return `env ${baseUrlEnv}; confirm webServer is skipped or reused when it is set`;
  return "wrapper config passed with --config that overrides use.baseURL and drops webServer";
};

export const detectE2e = (root: string, relativeDirectory: string): E2eConfig[] => {
  const directory = join(root, relativeDirectory);
  const prefix = relativeDirectory === "" ? "" : `${relativeDirectory}/`;
  return runners.flatMap(({ runner, files, key }) => {
    const file = firstExisting(directory, files);
    const text = file ? readText(join(directory, file)) : null;
    if (!file || text === null) return [];
    const value = resolveValue(text, key);
    const baseUrl: Evidence | null = value ? { value, source: `${prefix}${file}` } : null;
    const baseUrlEnv = value ? (envNames(value)[0] ?? null) : null;
    const webServer = /\bwebServer\s*:/.test(text);
    return [
      {
        runner,
        configFile: `${prefix}${file}`,
        baseUrl,
        baseUrlEnv,
        webServer,
        envVars: envNames(text),
        override: overrideFor(runner, baseUrlEnv, webServer),
      },
    ];
  });
};
