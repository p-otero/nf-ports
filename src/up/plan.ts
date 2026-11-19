import { join } from "node:path";
import type { DetectReport, Stack } from "../detect/types.ts";
import { isRecord, parseEnv, readJson, readText } from "../detect/files.ts";
import { envFiles } from "../detect/ports.ts";

export const preloadUrl = new URL("../../preload/localhost-dns.mjs", import.meta.url).href;

const defaultBranches = new Set(["main", "master", "HEAD", ""]);
const apiUrlKey = /API\w*(URL|ORIGIN|BASE|HOST)\b|^(VITE_|NEXT_PUBLIC_|PUBLIC_|NUXT_PUBLIC_)?BACKEND_URL$/i;

export type Launch = {
  readonly stack: string;
  readonly name: string;
  readonly directory: string;
  readonly role: Stack["role"];
  readonly url: string;
  readonly env: Readonly<Record<string, string>>;
};

export type UpPlan = {
  readonly prefix: string;
  readonly launches: readonly Launch[];
  readonly skipped: readonly string[];
};

export type UrlResolver = (name: string, prefix: string) => string;

export const worktreePrefix = (branch: string): string => (defaultBranches.has(branch.trim()) ? "" : branch.trim());

const shortName = (name: string): string => name.replace(/^@[^/]+\//, "");

const configuredNames = (root: string): Map<string, string> => {
  const config = readJson(join(root, "portless.json"));
  const apps = isRecord(config) && isRecord(config["apps"]) ? config["apps"] : {};
  return new Map(
    Object.entries(apps).flatMap(([directory, app]) =>
      isRecord(app) && typeof app["name"] === "string" ? [[directory.replace(/\/+$/, ""), app["name"]]] : [],
    ),
  );
};

const baseName = (root: string, fallback: string): string => {
  const manifest = readJson(join(root, "package.json"));
  const name = isRecord(manifest) && typeof manifest["name"] === "string" ? manifest["name"] : fallback;
  return shortName(name).toLowerCase();
};

const appName = (stack: Stack, base: string, isPrimaryFront: boolean, configured: Map<string, string>): string => {
  const fromConfig = configured.get(stack.directory);
  if (fromConfig) return fromConfig;
  if (isPrimaryFront) return base;
  const label = shortName(stack.name).toLowerCase().replace(new RegExp(`^${base}-`), "");
  return `${label}.${base}`;
};

export const apiUrlKeys = (directory: string): string[] => {
  const keys = envFiles.flatMap((file) => {
    const text = readText(join(directory, file));
    return text === null ? [] : Object.keys(parseEnv(text));
  });
  return [...new Set(keys.filter((key) => apiUrlKey.test(key)))];
};

const usesNode = (stack: Stack): boolean => !/^bunx?\b/.test(stack.devCommand?.value ?? "");

const withPreload = (existing: string | undefined): string =>
  [existing, `--import=${preloadUrl}`].filter((part): part is string => Boolean(part)).join(" ");

export const planUp = (
  report: DetectReport,
  branch: string,
  resolveUrl: UrlResolver,
  nodeOptions: string | undefined = process.env["NODE_OPTIONS"],
): UpPlan => {
  const prefix = worktreePrefix(branch);
  const configured = configuredNames(report.root);
  const base = baseName(report.root, report.root.split(/[\\/]/).at(-1) ?? "app");
  const runnable = report.stacks.filter((stack) => stack.devCommand?.source.startsWith("package.json") ?? false);
  const skipped = report.stacks.filter((stack) => !runnable.includes(stack)).map((stack) => stack.name);
  const ordered = [...runnable.filter((stack) => stack.role === "front"), ...runnable.filter((stack) => stack.role !== "front")];
  const primaryFront = ordered.find((stack) => stack.role === "front");

  const named = ordered.map((stack) => {
    const name = appName(stack, base, stack === primaryFront, configured);
    return { stack, name, url: resolveUrl(name, prefix) };
  });
  const firstBack = named.find((entry) => entry.stack.role === "back");

  const launches = named.map(({ stack, name, url }): Launch => {
    const directory = join(report.root, stack.directory);
    const apiEnv =
      stack.role === "front" && firstBack
        ? Object.fromEntries(apiUrlKeys(directory).map((key) => [key, firstBack.url]))
        : {};
    const nodeEnv: Record<string, string> = usesNode(stack) ? { NODE_OPTIONS: withPreload(nodeOptions) } : {};
    return {
      stack: stack.name,
      name,
      directory,
      role: stack.role,
      url,
      env: { PORTLESS_PREFIX: prefix, ...apiEnv, ...nodeEnv },
    };
  });
  return { prefix, launches, skipped };
};

export const formatBanner = (plan: UpPlan): string[] => {
  const [first, ...rest] = plan.launches;
  if (!first) return [];
  return [first.url, ...rest.map((launch) => `${launch.name}: ${launch.url}`)];
};
