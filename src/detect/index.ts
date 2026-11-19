import { resolve } from "node:path";
import type { DetectReport, Stack } from "./types.ts";
import { firstExisting } from "./files.ts";
import { detectE2e } from "./e2e.ts";
import { detectStack, procfileStack } from "./stack.ts";
import { detectOrchestrators, detectPackageManager, findPackageDirectories, readProcfile } from "./workspace.ts";

export const detect = (rootInput: string): DetectReport => {
  const root = resolve(rootInput);
  const workspaces = findPackageDirectories(root);
  const directories = workspaces.length > 0 ? workspaces : [""];
  const stacks: Stack[] = directories.flatMap((directory) => detectStack(root, directory) ?? []);
  const orchestrators = detectOrchestrators(root);
  if (orchestrators.includes("procfile")) stacks.push(...readProcfile(root).map(procfileStack));
  const e2eDirectories = workspaces.length > 0 ? ["", ...workspaces] : [""];
  return {
    root,
    packageManager: detectPackageManager(root),
    workspaces,
    orchestrators,
    portlessConfig: firstExisting(root, ["portless.json"]),
    stacks,
    e2e: e2eDirectories.flatMap((directory) => detectE2e(root, directory)),
  };
};
