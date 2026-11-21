import { join } from "node:path";
import { isStackRole, stackRoles, type StackRole } from "./detect/types.ts";
import { isRecord, readText } from "./detect/files.ts";

export type AppConfig = {
  readonly name?: string;
  readonly role?: StackRole;
  readonly portEnv?: string;
  readonly env?: Readonly<Record<string, string>>;
};

export type E2eSettings = {
  readonly config?: string;
  readonly hiddenEnv?: string;
  readonly env?: Readonly<Record<string, string>>;
};

export type NfpConfig = {
  readonly apps: Readonly<Record<string, AppConfig>>;
  readonly e2e: E2eSettings;
};

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

const optionalString = (value: unknown, where: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new ConfigError(`${where} must be a non-empty string`);
  return value.trim();
};

const optionalEnvName = (value: unknown, where: string): string | undefined => {
  const name = optionalString(value, where);
  if (name !== undefined && !envName.test(name)) throw new ConfigError(`${where} must be an environment variable name`);
  return name;
};

const envMap = (value: unknown, where: string): Record<string, string> | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new ConfigError(`${where} must be an object of strings`);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (!envName.test(key)) throw new ConfigError(`${where}.${key} is not an environment variable name`);
      if (typeof entry !== "string") throw new ConfigError(`${where}.${key} must be a string`);
      return [key, entry];
    }),
  );
};

const appConfig = (value: unknown, where: string): AppConfig => {
  if (!isRecord(value)) throw new ConfigError(`${where} must be an object`);
  const role = value.role;
  if (role !== undefined && !isStackRole(role)) {
    throw new ConfigError(`${where}.role must be one of ${stackRoles.join(", ")}`);
  }
  const name = optionalString(value.name, `${where}.name`);
  const portEnv = optionalEnvName(value.portEnv, `${where}.portEnv`);
  const env = envMap(value.env, `${where}.env`);
  return {
    ...(name === undefined ? {} : { name }),
    ...(role === undefined ? {} : { role }),
    ...(portEnv === undefined ? {} : { portEnv }),
    ...(env === undefined ? {} : { env }),
  };
};

export const parseConfig = (text: string, file = "nfp.json"): NfpConfig => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${error instanceof SyntaxError ? error.message : String(error)}`);
  }
  if (!isRecord(raw)) throw new ConfigError(`${file} must contain an object`);
  const apps = raw.apps ?? {};
  if (!isRecord(apps)) throw new ConfigError(`${file}: apps must be an object keyed by directory`);
  const e2e = raw.e2e ?? {};
  if (!isRecord(e2e)) throw new ConfigError(`${file}: e2e must be an object`);
  const config = optionalString(e2e.config, "e2e.config");
  const hiddenEnv = optionalEnvName(e2e.hiddenEnv, "e2e.hiddenEnv");
  const env = envMap(e2e.env, "e2e.env");
  return {
    apps: Object.fromEntries(
      Object.entries(apps).map(([directory, value]) => [normalizeDirectory(directory), appConfig(value, `apps.${directory}`)]),
    ),
    e2e: {
      ...(config === undefined ? {} : { config }),
      ...(hiddenEnv === undefined ? {} : { hiddenEnv }),
      ...(env === undefined ? {} : { env }),
    },
  };
};

export const normalizeDirectory = (directory: string): string =>
  directory.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "") || ".";

export const emptyConfig: NfpConfig = { apps: {}, e2e: {} };

export const loadConfig = (root: string): NfpConfig => {
  const text = readText(join(root, "nfp.json"));
  return text === null ? emptyConfig : parseConfig(text);
};

export type TemplateContext = {
  readonly branch: string;
  readonly url: (reference: string) => string | null;
};

export const expandTemplate = (template: string, context: TemplateContext, where: string): string =>
  template.replace(/\{(branch|url:([^}]+))\}/g, (_match, token: string, reference: string | undefined) => {
    if (token === "branch") return context.branch;
    const url = context.url((reference ?? "").trim());
    if (url === null) throw new ConfigError(`${where}: no app matches {url:${reference ?? ""}}`);
    return url;
  });
