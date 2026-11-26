import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../src/cli.ts";
import { initProject, isCi, schemaPath, syncProject } from "../src/install.ts";
import { stringField } from "../src/detect/files.ts";
import { parseRecord } from "./json.ts";

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);
const temporary: string[] = [];

const repoCopy = (name: string): string => {
  const root = mkdtempSync(join(tmpdir(), "nfp-install-"));
  temporary.push(root);
  cpSync(fixture(name), root, { recursive: true });
  mkdirSync(join(root, ".git"));
  return root;
};

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("initProject", () => {
  test("adds the postinstall hook once, keeps an existing one and the indent", () => {
    const root = repoCopy("harbor-split");
    const manifestPath = join(root, "package.json");
    const manifest = parseRecord(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, scripts: { postinstall: "patch-package" } }, null, 4));
    rmSync(join(root, "nfp.json"));
    expect(initProject(root).changed).toEqual(["package.json scripts.postinstall", "nfp.json"]);
    const text = readFileSync(manifestPath, "utf8");
    expect(text).toContain('\n    "scripts"');
    expect(stringField(parseRecord(text).scripts, "postinstall")).toBe("patch-package && nfp sync");
    expect(JSON.parse(readFileSync(join(root, "nfp.json"), "utf8"))).toEqual({ $schema: schemaPath });
    expect(initProject(root).changed).toEqual([]);
  });
});

describe("syncProject", () => {
  test("writes t3.json, is idempotent and asks for setup when portless is not ready", () => {
    const root = repoCopy("lumen-notes");
    expect(syncProject(root, () => "untrusted").lines).toEqual([
      "t3.json created: Dev (portless), E2E, E2E (hidden)",
      "portless CA is not trusted; run nfp setup once on this machine",
    ]);
    expect(syncProject(root, () => "ready").lines).toEqual(["t3.json unchanged"]);
  });

  test("warns instead of failing the install on a broken nfp.json", () => {
    const root = repoCopy("lumen-notes");
    writeFileSync(join(root, "nfp.json"), "{");
    const result = syncProject(root, () => "ready");
    expect(result.code).toBe(0);
    expect(result.lines[0]).toStartWith("warning: nfp.json is not valid JSON");
    expect(existsSync(join(root, "t3.json"))).toBe(false);
  });
});

describe("runSync", () => {
  test("does nothing in CI or outside a repository", () => {
    const root = repoCopy("lumen-notes");
    expect(runSync([], { CI: "true", INIT_CWD: root })).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(existsSync(join(root, "t3.json"))).toBe(false);
    const outside = mkdtempSync(join(tmpdir(), "nfp-nogit-"));
    temporary.push(outside);
    expect(runSync([], { INIT_CWD: outside }).stdout).toBe("");
  });

  test("uses INIT_CWD to find the project", () => {
    const root = repoCopy("lumen-notes");
    expect(runSync(["--quiet"], { INIT_CWD: root }).code).toBe(0);
    expect(existsSync(join(root, "t3.json"))).toBe(true);
  });

  test("isCi reads the usual values", () => {
    expect(isCi({ CI: "true" })).toBe(true);
    expect(isCi({ CI: "1" })).toBe(true);
    expect(isCi({ CI: "false" })).toBe(false);
    expect(isCi({})).toBe(false);
  });
});

describe("built bin", () => {
  const bin = join(import.meta.dir, "..", "dist", "bin.js");

  test("runs on Node, resolves its own portless and points at its preload", () => {
    const version = spawnSync("node", [bin, "--version"], { encoding: "utf8" });
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const root = repoCopy("lumen-notes");
    const url = spawnSync("node", [bin, "url", "api"], { cwd: root, encoding: "utf8" });
    expect(url.stderr).toBe("");
    expect(url.stdout.trim()).toMatch(/^https?:\/\/api\.lumen\.localhost(?::\d+)?$/);
    const plan = spawnSync("node", [bin, "e2e", "--print"], { cwd: root, encoding: "utf8" });
    const nodeOptions = stringField(parseRecord(plan.stdout).env, "NODE_OPTIONS") ?? "";
    const preload = /--import=(file:\S+)/.exec(nodeOptions)?.[1];
    expect(preload !== undefined && existsSync(fileURLToPath(preload))).toBe(true);
  }, 30_000);
});
