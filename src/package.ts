import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPresent, isRecord, stringField } from "./detect/files.ts";

const readManifest = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;

export class PackageError extends Error {
  override readonly name = "PackageError";
}

const findPackageRoot = (start: string): string => {
  let current = start;
  for (;;) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest) && stringField(readManifest(manifest), "name") === "nf-ports") {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new PackageError(`nf-ports package.json not found above ${start}`);
    current = parent;
  }
};

export const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

export const packageFile = (relative: string): string => join(packageRoot, relative);

export const packageFileUrl = (relative: string): string => pathToFileURL(packageFile(relative)).href;

export const packageVersion = (): string => stringField(readManifest(packageFile("package.json")), "version") ?? "";

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
  if (directory === null) return null;
  const manifest = readManifest(join(directory, "package.json"));
  const bin = stringField(manifest, "bin") ?? (isRecord(manifest) ? stringField(manifest.bin, "portless") : undefined);
  return isPresent(bin) ? resolve(directory, bin) : null;
};

const portlessBin = localPortlessBin();

const quote = (argument: string): string => (/^[\w./:=@+-]+$/.test(argument) ? argument : `"${argument}"`);

export const portlessCommand = (args: readonly string[]): Command =>
  portlessBin === null
    ? { program: ["portless", ...args].map(quote).join(" "), args: [], shell: true }
    : { program: "node", args: [portlessBin, ...args], shell: false };
