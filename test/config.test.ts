import { describe, expect, test } from "bun:test";
import { ConfigError, expandTemplate, parseConfig } from "../src/config.ts";

describe("parseConfig", () => {
  test("normalizes app directories and keeps known fields", () => {
    const config = parseConfig(
      JSON.stringify({
        apps: { "./services/core/": { name: "api.harbor", role: "back", portEnv: "CORE_PORT", env: { A: "{branch}" } } },
        e2e: { hiddenEnv: "HIDE", config: "e2e/playwright.config.ts" },
      }),
    );
    expect(config).toEqual({
      apps: { "services/core": { name: "api.harbor", role: "back", portEnv: "CORE_PORT", env: { A: "{branch}" } } },
      e2e: { config: "e2e/playwright.config.ts", hiddenEnv: "HIDE" },
    });
  });

  test("rejects invalid values with the path to them", () => {
    expect(() => parseConfig("{")).toThrow(ConfigError);
    expect(() => parseConfig(JSON.stringify({ apps: { web: { role: "db" } } }))).toThrow("apps.web.role must be one of");
    expect(() => parseConfig(JSON.stringify({ apps: { web: { portEnv: "core port" } } }))).toThrow("environment variable name");
    expect(() => parseConfig(JSON.stringify({ e2e: { env: { A: 1 } } }))).toThrow("e2e.env.A must be a string");
  });
});

describe("expandTemplate", () => {
  const context = { branch: "feat/dock", url: (reference: string) => (reference === "web" ? "https://w.localhost" : null) };

  test("replaces branch and url tokens and leaves the port placeholder", () => {
    expect(expandTemplate("{url:web}/cb?b={branch}&p={port}", context, "x")).toBe("https://w.localhost/cb?b=feat/dock&p={port}");
  });

  test("fails on an unknown app", () => {
    expect(() => expandTemplate("{url:api}", context, "apps.web.env.API")).toThrow("apps.web.env.API: no app matches {url:api}");
  });
});
