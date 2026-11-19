import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { detect } from "../src/detect/index.ts";

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);

const stackNamed = (root: string, name: string) => {
  const stack = detect(root).stacks.find((candidate) => candidate.name === name);
  if (!stack) throw new Error(`stack ${name} not detected`);
  return stack;
};

describe("lumen-notes fixture (npm workspaces, vite front, node back, playwright)", () => {
  const root = fixture("lumen-notes");

  test("finds both workspace stacks and the portless config", () => {
    const report = detect(root);
    expect(report.packageManager).toBe("npm");
    expect(report.workspaces).toEqual(["apps/api", "apps/web"]);
    expect(report.portlessConfig).toBe("portless.json");
    expect(report.stacks.map((stack) => stack.name)).toEqual(["@lumen/api", "@lumen/web"]);
  });

  test("classifies the vite front with its .env port and flag override", () => {
    const web = stackNamed(root, "@lumen/web");
    expect(web.role).toBe("front");
    expect(web.framework).toBe("vite");
    expect(web.devCommand?.value).toBe("vite");
    expect(web.effectivePort).toBe(5173);
    expect(web.ports.map((finding) => finding.kind)).toEqual(["env-file", "config", "framework-default"]);
    expect(web.portOverride).toBe("env:PORT+flag:--port");
  });

  test("classifies the node back from its server entry", () => {
    const api = stackNamed(root, "@lumen/api");
    expect(api.role).toBe("back");
    expect(api.framework).toBeNull();
    expect(api.effectivePort).toBe(8787);
    expect(api.portOverride).toBe("env:PORT");
    expect(api.warnings).toEqual([]);
  });

  test("reads the playwright baseURL env var and webServer", () => {
    const [e2e] = detect(root).e2e;
    expect(e2e?.runner).toBe("playwright");
    expect(e2e?.baseUrlEnv).toBe("BASE_URL");
    expect(e2e?.webServer).toBe(true);
    expect(e2e?.envVars).toEqual(["WEB_PORT", "BASE_URL", "E2E_IGNORE_HTTPS_ERRORS"]);
  });
});

describe("orbit-turbo fixture (pnpm, turbo, next, fastify, cypress)", () => {
  const root = fixture("orbit-turbo");

  test("expands pnpm workspace globs and notes turbo", () => {
    const report = detect(root);
    expect(report.packageManager).toBe("pnpm");
    expect(report.orchestrators).toEqual(["turbo"]);
    expect(report.workspaces).toEqual(["apps/site", "services/ledger"]);
  });

  test("prefers the script flag port for next", () => {
    const site = stackNamed(root, "orbit-site");
    expect(site.framework).toBe("next");
    expect(site.effectivePort).toBe(3100);
    expect(site.portOverride).toBe("env:PORT");
  });

  test("warns when a back never reads PORT", () => {
    const ledger = stackNamed(root, "orbit-ledger");
    expect(ledger.framework).toBe("fastify");
    expect(ledger.effectivePort).toBe(4010);
    expect(ledger.warnings).toEqual(["server entry never reads PORT; portless cannot move it without a code change"]);
  });

  test("uses CYPRESS_BASE_URL for cypress", () => {
    const [e2e] = detect(root).e2e;
    expect(e2e?.runner).toBe("cypress");
    expect(e2e?.configFile).toBe("apps/site/cypress.config.ts");
    expect(e2e?.baseUrl?.value).toBe('"http://localhost:3100"');
    expect(e2e?.override).toBe("env CYPRESS_BASE_URL (native Cypress override)");
  });
});

describe("other layouts", () => {
  test("turns Procfile entries into stacks", () => {
    const report = detect(fixture("kettle-procfile"));
    expect(report.orchestrators).toEqual(["procfile"]);
    expect(report.stacks.map((stack) => [stack.name, stack.role, stack.effectivePort, stack.portOverride])).toEqual([
      ["web", "front", 3200, "manual"],
      ["worker", "back", null, "manual"],
      ["api", "back", null, "env:PORT"],
    ]);
  });

  test("needs a wrapper config for a literal playwright baseURL", () => {
    const report = detect(fixture("quill-single"));
    expect(report.stacks[0]?.framework).toBe("astro");
    expect(report.stacks[0]?.effectivePort).toBe(4321);
    expect(report.e2e[0]?.baseUrlEnv).toBeNull();
    expect(report.e2e[0]?.override).toStartWith("wrapper config");
  });
});

describe("cli", () => {
  test("prints JSON with --json", () => {
    const result = run(["detect", fixture("lumen-notes"), "--json"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as { stacks: unknown[] };
    expect(parsed.stacks).toHaveLength(2);
  });

  test("prints a text report", () => {
    const result = run(["detect", fixture("lumen-notes")]);
    expect(result.stdout).toContain("@lumen/web  [front, vite]  apps/web");
    expect(result.stdout).toContain("override:  env BASE_URL");
  });

  test("rejects unknown commands and flags with exit code 2", () => {
    expect(run(["deploy"]).code).toBe(2);
    expect(run(["detect", "--yaml"]).code).toBe(2);
  });
});
