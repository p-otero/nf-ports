import { basename, dirname, extname, join } from "node:path";
import type { DetectReport, E2eConfig } from "../detect/types.ts";
import { isPresent, readText } from "../detect/files.ts";
import { ConfigError, expandTemplate, type NfpConfig, normalizeDirectory } from "../config.ts";
import { findLaunch, preloadUrl, type UpPlan } from "../up/plan.ts";

export type HiddenRequest = "auto" | "env" | "desktop";
export type HiddenMode = "env" | "desktop";

export type E2eOptions = {
  readonly headed: boolean;
  readonly ui: boolean;
  readonly hidden: HiddenRequest | null;
  readonly args: readonly string[];
};

export type Wrapper = { readonly path: string; readonly content: string };

export type E2ePlan = {
  readonly runner: E2eConfig["runner"];
  readonly configFile: string;
  readonly cwd: string;
  readonly baseUrl: string | null;
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly wrapper: Wrapper | null;
  readonly hidden: HiddenMode | null;
  readonly desktop: string | null;
};

const execPrefix: Record<DetectReport["packageManager"], readonly string[]> = {
  npm: ["npx", "--no"],
  pnpm: ["pnpm", "exec"],
  yarn: ["yarn"],
  bun: ["bunx"],
};

export const hiddenEnvFlag = "NFP_E2E_HIDDEN";
export const baseUrlEnv = "NFP_BASE_URL";

const pickConfig = (report: DetectReport, config: NfpConfig): E2eConfig => {
  const wanted = isPresent(config.e2e.config) ? normalizeDirectory(config.e2e.config) : null;
  if (wanted !== null) {
    const found = report.e2e.find((entry) => normalizeDirectory(entry.configFile) === wanted);
    if (!found) throw new ConfigError(`nfp.json e2e.config: ${wanted} is not a detected Playwright or Cypress config`);
    return found;
  }
  const first = report.e2e.find((entry) => entry.runner === "playwright") ?? report.e2e[0];
  if (!first) throw new ConfigError(`no playwright.config.* or cypress.config.* found in ${report.root}`);
  return first;
};

export const startsWebServerAlways = (configText: string): boolean => /\bwebServer\s*:\s*[[{]/.test(configText);

export const wrapperFor = (configPath: string): Wrapper => {
  const extension = extname(configPath);
  const content = [
    `import base from "./${basename(configPath)}";`,
    "",
    `const baseURL = process.env.${baseUrlEnv};`,
    "",
    "export default {",
    "  ...base,",
    "  webServer: undefined,",
    "  use: { ...base.use, baseURL },",
    "  ...(base.projects ? { projects: base.projects.map((project) => ({ ...project, use: { ...project.use, baseURL } })) } : {}),",
    "};",
    "",
  ].join("\n");
  return { path: join(dirname(configPath), `.nfp-playwright.config${extension}`), content };
};

export const desktopName = (branch: string): string =>
  `nfp-e2e-${(branch || "main").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;

export const planE2e = (
  report: DetectReport,
  up: UpPlan,
  config: NfpConfig,
  options: E2eOptions,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS,
): E2ePlan => {
  const e2e = pickConfig(report, config);
  const configFile = join(report.root, e2e.configFile);
  const cwd = dirname(configFile);
  const baseUrl = findLaunch(up, "front")?.url ?? null;

  const needsWrapper =
    e2e.runner === "playwright" &&
    baseUrl !== null &&
    (e2e.baseUrlEnv === null || startsWebServerAlways(readText(configFile) ?? ""));
  const wrapper = needsWrapper ? wrapperFor(configFile) : null;

  const hidden: HiddenMode | null =
    options.hidden === null ? null : options.hidden === "auto" ? (isPresent(config.e2e.hiddenEnv) ? "env" : "desktop") : options.hidden;

  const urlEnv: Record<string, string> = {};
  if (isPresent(baseUrl)) {
    urlEnv[baseUrlEnv] = baseUrl;
    if (isPresent(e2e.baseUrlEnv)) urlEnv[e2e.baseUrlEnv] = baseUrl;
    if (e2e.runner === "cypress") urlEnv.CYPRESS_BASE_URL = baseUrl;
  }
  const hiddenEnv: Record<string, string> =
    hidden === null ? {} : { [hiddenEnvFlag]: "1", ...(isPresent(config.e2e.hiddenEnv) ? { [config.e2e.hiddenEnv]: "1" } : {}) };
  const lookup = (reference: string): string | null => findLaunch(up, reference)?.url ?? null;
  const extra = Object.fromEntries(
    Object.entries(config.e2e.env ?? {}).map(([key, template]) => [
      key,
      expandTemplate(template, { branch: up.branch, url: lookup }, `nfp.json e2e.env.${key}`),
    ]),
  );
  const node = [nodeOptions, "--use-system-ca", `--import=${preloadUrl}`].filter(Boolean).join(" ");

  const exec = execPrefix[report.packageManager];
  const command =
    e2e.runner === "playwright"
      ? [
          ...exec,
          "playwright",
          "test",
          ...(wrapper ? ["--config", basename(wrapper.path)] : []),
          ...(options.headed ? ["--headed"] : []),
          ...(options.ui ? ["--ui"] : []),
          ...options.args,
        ]
      : [...exec, "cypress", options.ui ? "open" : "run", ...(options.headed ? ["--headed"] : []), ...options.args];

  return {
    runner: e2e.runner,
    configFile,
    cwd,
    baseUrl,
    command,
    env: { PORTLESS_PREFIX: up.prefix, ...urlEnv, NODE_OPTIONS: node, ...hiddenEnv, ...extra },
    wrapper,
    hidden,
    desktop: hidden === "desktop" ? desktopName(up.branch) : null,
  };
};
