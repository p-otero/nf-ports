import { join } from "node:path";
import type { DetectReport, Stack } from "../detect/types.ts";
import { isRecord, parseEnv, readJson, readText } from "../detect/files.ts";
import { envFiles } from "../detect/ports.ts";
import { type AppConfig, emptyConfig, expandTemplate, type NfpConfig, normalizeDirectory } from "../config.ts";
import { packageFileUrl } from "../package.ts";

export const preloadUrl = packageFileUrl("preload/localhost-dns.mjs");

export const portPlaceholder = "{port}";

const defaultBranches = new Set(["main", "master", "HEAD", ""]);
const apiUrlKey = /API\w*(URL|ORIGIN|BASE|HOST)\b|^(VITE_|NEXT_PUBLIC_|PUBLIC_|NUXT_PUBLIC_)?BACKEND_URL$/i;
const frontUrlKey =
  /^(?:CORS_ORIGINS?|ALLOWED_ORIGINS?|ORIGIN|(?:FRONTEND|FRONT|WEB|APP|CLIENT|SITE|UI|PUBLIC)_(?:URL|ORIGIN))$/i;

export type Launch = {
  readonly stack: string;
  readonly name: string;
  readonly directory: string;
  readonly role: Stack["role"];
  readonly url: string;
  readonly appPort: boolean;
  readonly env: Readonly<Record<string, string>>;
};

export type UpPlan = {
  readonly branch: string;
  readonly prefix: string;
  readonly launches: readonly Launch[];
  readonly skipped: readonly string[];
  readonly warnings: readonly string[];
};

export type UrlResolver = (name: string, prefix: string) => string;

export const worktreePrefix = (branch: string): string => (defaultBranches.has(branch.trim()) ? "" : branch.trim());

const shortName = (name: string): string => name.replace(/^@[^/]+\//, "");

const portlessNames = (root: string): Map<string, string> => {
  const config = readJson(join(root, "portless.json"));
  const apps = isRecord(config) && isRecord(config["apps"]) ? config["apps"] : {};
  return new Map(
    Object.entries(apps).flatMap(([directory, app]) =>
      isRecord(app) && typeof app["name"] === "string" ? [[normalizeDirectory(directory), app["name"]]] : [],
    ),
  );
};

const baseName = (root: string, fallback: string): string => {
  const manifest = readJson(join(root, "package.json"));
  const name = isRecord(manifest) && typeof manifest["name"] === "string" ? manifest["name"] : fallback;
  return shortName(name).toLowerCase();
};

const derivedName = (stack: Stack, base: string, isPrimaryFront: boolean): string => {
  if (isPrimaryFront) return base;
  const label = shortName(stack.name).toLowerCase().replace(new RegExp(`^${base}-`), "");
  return `${label}.${base}`;
};

const envKeys = (directory: string, pattern: RegExp): string[] => {
  const keys = envFiles.flatMap((file) => {
    const text = readText(join(directory, file));
    return text === null ? [] : Object.keys(parseEnv(text));
  });
  return [...new Set(keys.filter((key) => pattern.test(key)))];
};

export const apiUrlKeys = (directory: string): string[] => envKeys(directory, apiUrlKey);

export const frontUrlKeys = (directory: string): string[] => envKeys(directory, frontUrlKey);

const usesNode = (stack: Stack): boolean => !/^bunx?\b/.test(stack.devCommand?.value ?? "");

const withPreload = (existing: string | undefined): string =>
  [existing, `--import=${preloadUrl}`].filter((part): part is string => Boolean(part)).join(" ");

type Entry = {
  readonly stack: Stack;
  readonly app: AppConfig;
  readonly role: Stack["role"];
  readonly name: string;
  readonly url: string;
};

const matches = (entry: Entry, reference: string): boolean =>
  [entry.name, entry.stack.name, shortName(entry.stack.name), entry.stack.directory].includes(reference);

export const planUp = (
  report: DetectReport,
  branch: string,
  resolveUrl: UrlResolver,
  nodeOptions: string | undefined = process.env["NODE_OPTIONS"],
  config: NfpConfig = emptyConfig,
): UpPlan => {
  const prefix = worktreePrefix(branch);
  const fromPortless = portlessNames(report.root);
  const base = baseName(report.root, report.root.split(/[\\/]/).at(-1) ?? "app");
  const runnable = report.stacks.filter((stack) => stack.devCommand?.source.startsWith("package.json") ?? false);
  const skipped = report.stacks.filter((stack) => !runnable.includes(stack)).map((stack) => stack.name);
  const configured = runnable.map((stack) => {
    const app = config.apps[normalizeDirectory(stack.directory)] ?? {};
    return { stack, app, role: app.role ?? stack.role };
  });
  const ordered = [
    ...configured.filter((entry) => entry.role === "front"),
    ...configured.filter((entry) => entry.role !== "front"),
  ];
  const primaryFront = ordered.find((entry) => entry.role === "front");

  const entries: Entry[] = ordered.map((entry) => {
    const name =
      entry.app.name ??
      fromPortless.get(normalizeDirectory(entry.stack.directory)) ??
      derivedName(entry.stack, base, entry === primaryFront);
    return { stack: entry.stack, app: entry.app, role: entry.role, name, url: resolveUrl(name, prefix) };
  });
  const firstFront = entries.find((entry) => entry.role === "front");
  const firstBack = entries.find((entry) => entry.role === "back");
  const lookup = (reference: string): string | null => {
    if (reference === "front") return firstFront?.url ?? null;
    if (reference === "back") return firstBack?.url ?? null;
    return entries.find((entry) => matches(entry, reference))?.url ?? null;
  };

  const launches = entries.map(({ stack, app, role, name, url }): Launch => {
    const directory = join(report.root, stack.directory);
    const wired: Record<string, string> = {};
    if (role === "front" && firstBack) for (const key of apiUrlKeys(directory)) wired[key] = firstBack.url;
    if (role === "back" && firstFront) for (const key of frontUrlKeys(directory)) wired[key] = firstFront.url;
    const portEnv = app.portEnv ?? stack.portEnv;
    if (portEnv) wired[portEnv] = portPlaceholder;
    const nodeEnv: Record<string, string> = usesNode(stack) ? { NODE_OPTIONS: withPreload(nodeOptions) } : {};
    const extra = Object.fromEntries(
      Object.entries(app.env ?? {}).map(([key, template]) => [
        key,
        expandTemplate(template, { branch, url: lookup }, `nfp.json apps.${stack.directory}.env.${key}`),
      ]),
    );
    const env = { PORTLESS_PREFIX: prefix, ...wired, ...nodeEnv, ...extra };
    const appPort = Object.values(env).some((value) => value.includes(portPlaceholder));
    return { stack: stack.name, name, directory, role, url, appPort, env };
  });
  const warnings = entries.flatMap(({ stack, name }) => stack.warnings.map((warning) => `${name}: ${warning}`));
  return { branch, prefix, launches, skipped, warnings };
};

export const findLaunch = (plan: UpPlan, reference: string | undefined): Launch | undefined => {
  if (reference === undefined || reference === "front") {
    return plan.launches.find((launch) => launch.role === "front") ?? plan.launches[0];
  }
  if (reference === "back") return plan.launches.find((launch) => launch.role === "back");
  return plan.launches.find((launch) =>
    [launch.name, launch.stack, shortName(launch.stack)].includes(reference) ||
    normalizeDirectory(launch.directory).endsWith(`/${normalizeDirectory(reference)}`),
  );
};

export const formatBanner = (plan: UpPlan): string[] => {
  const [first, ...rest] = plan.launches;
  if (!first) return [];
  return [first.url, ...rest.map((launch) => `${launch.name}: ${launch.url}`)];
};
