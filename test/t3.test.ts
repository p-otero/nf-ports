import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { detect } from "../src/detect/index.ts";
import { T3FileError, mergeScripts, t3SchemaUrl, writeT3Scripts } from "../src/t3/project-file.ts";
import { t3ScriptsFor } from "../src/t3/scripts.ts";

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);
const temporary: string[] = [];

const repoCopy = (name: string): string => {
  const root = mkdtempSync(join(tmpdir(), "nfp-t3-"));
  temporary.push(root);
  cpSync(fixture(name), root, { recursive: true });
  mkdirSync(join(root, ".git"));
  return root;
};

const readT3 = (root: string): { $schema: string; scripts: Record<string, unknown>[]; [key: string]: unknown } =>
  JSON.parse(readFileSync(join(root, "t3.json"), "utf8")) as {
    $schema: string;
    scripts: Record<string, unknown>[];
  };

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("t3ScriptsFor", () => {
  test("derives dev and both e2e scripts for the lumen fixture", () => {
    const scripts = t3ScriptsFor(detect(fixture("lumen-notes")), { bin: "nfp", previewUrl: null });
    expect(scripts.map((script) => [script.name, script.command, script.icon])).toEqual([
      ["Dev (portless)", "nfp up", "play"],
      ["E2E", "nfp e2e", "test"],
      ["E2E (hidden)", "nfp e2e --hidden", "test"],
    ]);
    expect(scripts[0]?.runOnWorktreeCreate).toBe(false);
    expect(scripts[0]).not.toHaveProperty("previewUrl");
  });

  test("adds previewUrl and autoOpenPreview only when asked", () => {
    const [dev] = t3ScriptsFor(detect(fixture("lumen-notes")), {
      bin: "bunx nfp",
      previewUrl: "https://lumen.localhost",
    });
    expect(dev).toMatchObject({ command: "bunx nfp up", previewUrl: "https://lumen.localhost", autoOpenPreview: true });
  });

  test("skips e2e scripts when no e2e config exists", () => {
    const names = t3ScriptsFor(detect(fixture("kettle-procfile")), { bin: "nfp", previewUrl: null }).map(
      (script) => script.name,
    );
    expect(names).toEqual(["Dev (portless)"]);
  });
});

describe("mergeScripts", () => {
  const dev = { name: "Dev (portless)", command: "nfp up", icon: "play" as const };

  test("keeps foreign scripts and top-level keys, replaces by name and appends new ones", () => {
    const outcome = mergeScripts(
      {
        defaultThreadEnvMode: "worktree",
        scripts: [
          { name: "Board", command: "board serve", previewUrl: "http://localhost:4646" },
          { name: " Dev (portless) ", command: "old up", keybinding: "mod+d" },
        ],
      },
      [dev, { name: "E2E", command: "nfp e2e", icon: "test" }],
    );
    expect(outcome.added).toEqual(["E2E"]);
    expect(outcome.updated).toEqual(["Dev (portless)"]);
    expect(outcome.file).toEqual({
      $schema: t3SchemaUrl,
      defaultThreadEnvMode: "worktree",
      scripts: [
        { name: "Board", command: "board serve", previewUrl: "http://localhost:4646" },
        { name: "Dev (portless)", command: "nfp up", keybinding: "mod+d", icon: "play" },
        { name: "E2E", command: "nfp e2e", icon: "test" },
      ],
    });
  });

  test("keeps an existing $schema value", () => {
    expect(mergeScripts({ $schema: "./schema.json" }, [dev]).file["$schema"]).toBe("./schema.json");
  });

  test("rejects a scripts value that is not an array of objects", () => {
    expect(() => mergeScripts({ scripts: { name: "x" } }, [dev])).toThrow(T3FileError);
    expect(() => mergeScripts({ scripts: ["x"] }, [dev])).toThrow(T3FileError);
  });

  test("rejects merges above the 50 script limit", () => {
    const scripts = Array.from({ length: 50 }, (_, index) => ({ name: `s${index}`, command: "true" }));
    expect(() => mergeScripts({ scripts }, [dev])).toThrow("at most 50 scripts");
  });

  test("rejects empty names and unknown icons", () => {
    expect(() => mergeScripts({}, [{ name: " ", command: "x" }])).toThrow(T3FileError);
    expect(() => mergeScripts({}, [{ ...dev, icon: "rocket" as unknown as "play" }])).toThrow("unknown icon");
  });
});

describe("writeT3Scripts", () => {
  const scripts = [{ name: "E2E", command: "nfp e2e", icon: "test" as const }];

  test("creates t3.json, then reports unchanged on a second run", () => {
    const root = repoCopy("lumen-notes");
    expect(writeT3Scripts(root, scripts, { dryRun: false }).status).toBe("created");
    const before = readFileSync(join(root, "t3.json"), "utf8");
    const again = writeT3Scripts(root, scripts, { dryRun: false });
    expect(again.status).toBe("unchanged");
    expect(again.unchanged).toEqual(["E2E"]);
    expect(readFileSync(join(root, "t3.json"), "utf8")).toBe(before);
    expect(before.endsWith("}\n")).toBe(true);
  });

  test("dry run leaves the file untouched", () => {
    const root = repoCopy("lumen-notes");
    writeFileSync(join(root, "t3.json"), '{ "scripts": [] }\n');
    const outcome = writeT3Scripts(root, scripts, { dryRun: true });
    expect(outcome.status).toBe("updated");
    expect(readFileSync(join(root, "t3.json"), "utf8")).toBe('{ "scripts": [] }\n');
  });

  test("refuses to overwrite invalid JSON", () => {
    const root = repoCopy("lumen-notes");
    writeFileSync(join(root, "t3.json"), "{ not json");
    expect(() => writeT3Scripts(root, scripts, { dryRun: false })).toThrow("is not valid JSON");
    expect(readFileSync(join(root, "t3.json"), "utf8")).toBe("{ not json");
  });
});

describe("nfp t3 scripts", () => {
  test("writes the repository root t3.json from a subdirectory", () => {
    const root = repoCopy("lumen-notes");
    const result = run(["t3", "scripts", join(root, "apps", "web"), "--bin", "bunx nfp"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("created:");
    const file = readT3(root);
    expect(file.$schema).toBe(t3SchemaUrl);
    expect(file.scripts.map((script) => script["command"])).toEqual([
      "bunx nfp up",
      "bunx nfp e2e",
      "bunx nfp e2e --hidden",
    ]);
  });

  test("merges into an existing t3.json and keeps its other scripts", () => {
    const root = repoCopy("lumen-notes");
    writeFileSync(
      join(root, "t3.json"),
      JSON.stringify({ $schema: t3SchemaUrl, scripts: [{ name: "Board", command: "board serve" }] }),
    );
    const result = run(["t3", "scripts", root, "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "updated", added: ["Dev (portless)", "E2E", "E2E (hidden)"] });
    expect(readT3(root).scripts.map((script) => script["name"])).toEqual([
      "Board",
      "Dev (portless)",
      "E2E",
      "E2E (hidden)",
    ]);
  });

  test("defaults to the local runner and retires old nfp scripts it owns", () => {
    const root = repoCopy("lumen-notes");
    writeFileSync(
      join(root, "t3.json"),
      JSON.stringify({
        scripts: [
          { name: "Ports setup", command: "bunx nfp setup --quiet" },
          { name: "E2E (Docker)", command: "my-docker-e2e" },
        ],
      }),
    );
    const result = run(["t3", "scripts", root, "--json"]);
    expect(JSON.parse(result.stdout)).toMatchObject({ removed: ["Ports setup"] });
    expect(readT3(root).scripts.map((script) => [script["name"], script["command"]])).toEqual([
      ["E2E (Docker)", "my-docker-e2e"],
      ["Dev (portless)", "npx --no nfp up"],
      ["E2E", "npx --no nfp e2e"],
      ["E2E (hidden)", "npx --no nfp e2e --hidden"],
    ]);
  });

  test("fails outside a git repository and on invalid t3.json", () => {
    const outside = mkdtempSync(join(tmpdir(), "nfp-nogit-"));
    temporary.push(outside);
    expect(run(["t3", "scripts", outside]).code).toBe(1);
    const root = repoCopy("lumen-notes");
    writeFileSync(join(root, "t3.json"), "[]");
    const result = run(["t3", "scripts", root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("must contain a JSON object");
  });

  test("rejects unknown subcommands and missing flag values", () => {
    expect(run(["t3", "apply"]).code).toBe(2);
    expect(run(["t3", "scripts", "--bin"]).code).toBe(2);
  });
});
