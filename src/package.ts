import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const findPackageRoot = (start: string): string => {
  let current = start;
  for (;;) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === "nf-ports") {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`nf-ports package.json not found above ${start}`);
    current = parent;
  }
};

export const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

export const packageFile = (relative: string): string => join(packageRoot, relative);

export const packageFileUrl = (relative: string): string => pathToFileURL(packageFile(relative)).href;

export const packageVersion = (): string =>
  (JSON.parse(readFileSync(packageFile("package.json"), "utf8")) as { version: string }).version;

export type Command = { readonly program: string; readonly args: readonly string[]; readonly shell: boolean };

const findDependency = (name: string, start: string): string | null => {
  let current = start;
  for (;;) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const localPortlessBin = (): string | null => {
  const directory = findDependency("portless", packageRoot);
  if (!directory) return null;
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { bin?: unknown };
  const bin = typeof manifest.bin === "string" ? manifest.bin : (manifest.bin as Record<string, string> | undefined)?.["portless"];
  return bin ? resolve(directory, bin) : null;
};

const portlessBin = localPortlessBin();

const quote = (argument: string): string => (/^[\w./:=@+-]+$/.test(argument) ? argument : `"${argument}"`);

export const portlessCommand = (args: readonly string[]): Command =>
  portlessBin
    ? { program: "node", args: [portlessBin, ...args], shell: false }
    : { program: ["portless", ...args].map(quote).join(" "), args: [], shell: true };
