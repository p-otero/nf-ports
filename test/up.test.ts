import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseUp } from "../src/cli.ts";
import { detect } from "../src/detect/index.ts";
import { loadConfig, parseConfig } from "../src/config.ts";
import { findLaunch, formatBanner, planUp, portPlaceholder, preloadUrl, worktreePrefix } from "../src/up/plan.ts";
import { withPort } from "../src/up/run.ts";

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);

const fakeUrl = (name: string, prefix: string): string =>
  `https://${prefix ? `${prefix.replaceAll("/", "-")}.` : ""}${name}.localhost`;

describe("worktreePrefix", () => {
  test("uses the whole branch and none on default branches or a detached HEAD", () => {
    expect(worktreePrefix("feat/alpha-search")).toBe("feat/alpha-search");
    expect(worktreePrefix("main")).toBe("");
    expect(worktreePrefix("master")).toBe("");
    expect(worktreePrefix("HEAD")).toBe("");
  });
});

describe("planUp on lumen-notes", () => {
  const plan = planUp(detect(fixture("lumen-notes")), "feat/alpha-search", fakeUrl, "--max-old-space-size=4096");

  test("names apps from the portless.json apps map and launches the front first", () => {
    expect(plan.launches.map((launch) => [launch.name, launch.role, launch.url])).toEqual([
      ["lumen", "front", "https://feat-alpha-search.lumen.localhost"],
      ["api.lumen", "back", "https://feat-alpha-search.api.lumen.localhost"],
    ]);
    expect(plan.launches[0]?.directory).toBe(join(fixture("lumen-notes"), "apps/web"));
  });

  test("puts the branch URL alone on the first banner line", () => {
    expect(formatBanner(plan)).toEqual([
      "https://feat-alpha-search.lumen.localhost",
      "api.lumen: https://feat-alpha-search.api.lumen.localhost",
    ]);
  });

  test("injects the API URL into the front and the DNS preload into Node stacks", () => {
    const [web, api] = plan.launches;
    expect(web?.env).toEqual({
      PORTLESS_PREFIX: "feat/alpha-search",
      VITE_API_URL: "https://feat-alpha-search.api.lumen.localhost",
      NODE_OPTIONS: `--max-old-space-size=4096 --import=${preloadUrl}`,
    });
    expect(api?.env).toEqual({ PORTLESS_PREFIX: "feat/alpha-search", NODE_OPTIONS: `--max-old-space-size=4096 --import=${preloadUrl}` });
    expect(preloadUrl).toStartWith("file:///");
    expect(preloadUrl).toEndWith("/preload/localhost-dns.mjs");
  });

  test("disables the prefix on main", () => {
    const main = planUp(detect(fixture("lumen-notes")), "main", fakeUrl, undefined);
    expect(main.prefix).toBe("");
    expect(main.launches[0]?.url).toBe("https://lumen.localhost");
    expect(main.launches[0]?.env["NODE_OPTIONS"]).toBe(`--import=${preloadUrl}`);
  });
});

describe("planUp without portless.json", () => {
  test("derives names from the root package name", () => {
    const plan = planUp(detect(fixture("orbit-turbo")), "fix/ledger", fakeUrl, undefined);
    expect(plan.launches.map((launch) => launch.name)).toEqual(["orbit", "ledger.orbit"]);
    expect(plan.skipped).toEqual([]);
  });

  test("skips Procfile stacks it cannot launch through package scripts", () => {
    const plan = planUp(detect(fixture("kettle-procfile")), "fix/x", fakeUrl, undefined);
    expect(plan.launches).toEqual([]);
    expect(plan.skipped).toEqual(["web", "worker", "api"]);
  });
});

describe("parseUp", () => {
  test("finds the repository root and the --print flag", () => {
    const request = parseUp([import.meta.dir, "--print"]);
    expect(request).toEqual({ root: join(import.meta.dir, ".."), print: true });
  });

  test("rejects unknown flags", () => {
    expect(parseUp(["--detach"])).toMatchObject({ code: 2 });
  });
});

describe("planUp on harbor-split with nfp.json", () => {
  const root = fixture("harbor-split");
  const plan = planUp(detect(root), "feat/dock", fakeUrl, undefined, loadConfig(root));
  const [client, core] = plan.launches;

  test("wires the front to the back and the back to the front", () => {
    expect(plan.launches.map((launch) => launch.name)).toEqual(["harbor", "core.harbor"]);
    expect(client?.env["VITE_CORE_API_URL"]).toBe("https://feat-dock.core.harbor.localhost");
    expect(core?.env["CORS_ORIGIN"]).toBe("https://feat-dock.harbor.localhost");
    expect(core?.env).not.toHaveProperty("DATABASE_URL");
  });

  test("picks the port for a back that reads its own variable", () => {
    expect(client?.appPort).toBe(false);
    expect(core?.appPort).toBe(true);
    expect(core?.env["CORE_PORT"]).toBe(portPlaceholder);
    expect(withPort(core?.env ?? {}, 4321)["CORE_PORT"]).toBe("4321");
  });

  test("expands the nfp.json env templates", () => {
    expect(core?.env["AUTH_CALLBACK_URL"]).toBe("https://feat-dock.harbor.localhost/auth/callback");
    expect(core?.env["RELEASE_LABEL"]).toBe("feat/dock");
  });

  test("lets nfp.json override names and roles", () => {
    const config = parseConfig(JSON.stringify({ apps: { "services/core/": { name: "api.harbor", role: "front" } } }));
    const custom = planUp(detect(root), "feat/dock", fakeUrl, undefined, config);
    expect(custom.launches.map((launch) => [launch.name, launch.role])).toEqual([
      ["harbor", "front"],
      ["api.harbor", "front"],
    ]);
    expect(custom.launches[1]?.env).not.toHaveProperty("CORS_ORIGIN");
  });

  test("finds launches by name, package, directory or role", () => {
    expect(findLaunch(plan, undefined)?.name).toBe("harbor");
    expect(findLaunch(plan, "back")?.name).toBe("core.harbor");
    expect(findLaunch(plan, "core")?.name).toBe("core.harbor");
    expect(findLaunch(plan, "@harbor/core")?.name).toBe("core.harbor");
    expect(findLaunch(plan, "services/core")?.name).toBe("core.harbor");
    expect(findLaunch(plan, "nope")).toBeUndefined();
  });

  test("passes stack warnings through", () => {
    expect(plan.warnings).toEqual([
      "core.harbor: server entry reads CORE_PORT, not PORT; nfp up picks the port and sets CORE_PORT",
    ]);
  });
});
