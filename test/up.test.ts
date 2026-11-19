import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseUp } from "../src/cli.ts";
import { detect } from "../src/detect/index.ts";
import { formatBanner, planUp, preloadUrl, worktreePrefix } from "../src/up/plan.ts";

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
