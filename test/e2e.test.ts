import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseE2e } from "../src/cli.ts";
import { emptyConfig, loadConfig } from "../src/config.ts";
import { detect } from "../src/detect/index.ts";
import { desktopName, type E2eOptions, planE2e, startsWebServerAlways } from "../src/e2e/plan.ts";
import { desktopCommandLine } from "../src/e2e/run.ts";
import { planUp, preloadUrl } from "../src/up/plan.ts";

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);

const fakeUrl = (name: string, prefix: string): string =>
  `https://${prefix ? `${prefix.replaceAll("/", "-")}.` : ""}${name}.localhost`;

const defaults: E2eOptions = { headed: false, ui: false, hidden: null, args: [] };

const planFor = (name: string, options: Partial<E2eOptions> = {}, branch = "feat/alpha-search") => {
  const root = fixture(name);
  const config = loadConfig(root);
  return planE2e(detect(root), planUp(detect(root), branch, fakeUrl, undefined, config), config, { ...defaults, ...options }, undefined);
};

describe("planE2e on lumen-notes (baseURL from env, conditional webServer)", () => {
  const plan = planFor("lumen-notes", { args: ["--grep", "greeting"] });

  test("points BASE_URL at the worktree front without a wrapper", () => {
    expect(plan.baseUrl).toBe("https://feat-alpha-search.lumen.localhost");
    expect(plan.wrapper).toBeNull();
    expect(plan.cwd).toBe(fixture("lumen-notes"));
    expect(plan.command).toEqual(["npx", "--no", "playwright", "test", "--grep", "greeting"]);
    expect(plan.env).toEqual({
      PORTLESS_PREFIX: "feat/alpha-search",
      NFP_BASE_URL: "https://feat-alpha-search.lumen.localhost",
      BASE_URL: "https://feat-alpha-search.lumen.localhost",
      NODE_OPTIONS: `--use-system-ca --import=${preloadUrl}`,
    });
  });

  test("--hidden without an app variable runs on a hidden desktop named after the branch", () => {
    const hidden = planFor("lumen-notes", { hidden: "auto" });
    expect(hidden.hidden).toBe("desktop");
    expect(hidden.desktop).toBe("nfp-e2e-feat-alpha-search");
    expect(hidden.env["NFP_E2E_HIDDEN"]).toBe("1");
  });

  test("passes --headed and --ui to playwright", () => {
    expect(planFor("lumen-notes", { headed: true }).command).toContain("--headed");
    expect(planFor("lumen-notes", { ui: true }).command).toContain("--ui");
  });
});

describe("planE2e on harbor-split (literal baseURL, unconditional webServer, nfp.json)", () => {
  const plan = planFor("harbor-split", { hidden: "auto" }, "feat/dock");

  test("generates a wrapper config next to the original", () => {
    expect(plan.wrapper?.path).toBe(join(fixture("harbor-split"), ".nfp-playwright.config.ts"));
    expect(plan.wrapper?.content).toContain('import base from "./playwright.config.ts";');
    expect(plan.wrapper?.content).toContain("webServer: undefined");
    expect(plan.command).toEqual(["npx", "--no", "playwright", "test", "--config", ".nfp-playwright.config.ts"]);
  });

  test("uses the app's hidden variable and expands e2e.env", () => {
    expect(plan.hidden).toBe("env");
    expect(plan.desktop).toBeNull();
    expect(plan.env["HARBOR_E2E_HIDDEN_WINDOW"]).toBe("1");
    expect(plan.env["NFP_E2E_HIDDEN"]).toBe("1");
    expect(plan.env["HARBOR_API_URL"]).toBe("https://feat-dock.core.harbor.localhost");
  });

  test("--hidden=desktop forces the desktop even with an app variable", () => {
    expect(planFor("harbor-split", { hidden: "desktop" }, "feat/dock").hidden).toBe("desktop");
  });
});

describe("planE2e on orbit-turbo (cypress)", () => {
  test("sets CYPRESS_BASE_URL and runs from the config directory", () => {
    const plan = planFor("orbit-turbo", { ui: true });
    expect(plan.runner).toBe("cypress");
    expect(plan.cwd).toBe(join(fixture("orbit-turbo"), "apps/site"));
    expect(plan.env["CYPRESS_BASE_URL"]).toBe("https://feat-alpha-search.orbit.localhost");
    expect(plan.command).toEqual(["pnpm", "exec", "cypress", "open"]);
  });
});

describe("planE2e without config", () => {
  test("explains that no e2e config exists", () => {
    const root = fixture("kettle-procfile");
    expect(() => planE2e(detect(root), planUp(detect(root), "x", fakeUrl, undefined), emptyConfig, defaults)).toThrow(
      "no playwright.config.* or cypress.config.* found",
    );
  });
});

describe("helpers", () => {
  test("startsWebServerAlways tells literal from conditional webServer", () => {
    expect(startsWebServerAlways("webServer: { command: 'x' }")).toBe(true);
    expect(startsWebServerAlways("webServer: [{ command: 'x' }]")).toBe(true);
    expect(startsWebServerAlways("webServer: external ? undefined : [")).toBe(false);
  });

  test("desktopName sanitizes the branch", () => {
    expect(desktopName("fix/beta sync!")).toBe("nfp-e2e-fix-beta-sync");
    expect(desktopName("")).toBe("nfp-e2e-main");
  });

  test("desktopCommandLine quotes for cmd and redirects to the log", () => {
    expect(desktopCommandLine(["npx", "--no", "playwright", "test", "--grep", "two words"], "C:/tmp/x.log")).toBe(
      'cmd.exe /d /s /c "npx --no playwright test --grep "two words" > "C:/tmp/x.log" 2>&1"',
    );
  });
});

describe("parseE2e", () => {
  test("splits own flags from runner arguments", () => {
    expect(parseE2e([import.meta.dir, "--hidden=env", "--", "--headed", "-g", "x"])).toMatchObject({
      root: join(import.meta.dir, ".."),
      print: false,
      options: { headed: false, ui: false, hidden: "env", args: ["--headed", "-g", "x"] },
    });
  });

  test("rejects exclusive or unknown modes", () => {
    expect(parseE2e(["--headed", "--ui"])).toMatchObject({ code: 2 });
    expect(parseE2e(["--hidden", "--headed"])).toMatchObject({ code: 2 });
    expect(parseE2e(["--hidden=xvfb"])).toMatchObject({ code: 2 });
    expect(parseE2e(["--docker"])).toMatchObject({ code: 2 });
  });
});
