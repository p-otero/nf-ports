import type { DetectReport } from "../detect/types.ts";
import type { T3Script } from "./project-file.ts";
import { isPresent } from "../detect/files.ts";

export type ScriptOptions = {
  readonly bin: string;
  readonly previewUrl: string | null;
};

export const retiredScripts = ["Ports setup", "E2E (Docker)"] as const;

const localBin: Record<DetectReport["packageManager"], string> = {
  npm: "npx --no nfp",
  pnpm: "pnpm exec nfp",
  yarn: "yarn nfp",
  bun: "bunx nfp",
};

export const defaultBin = (report: DetectReport): string => localBin[report.packageManager];

export const t3ScriptsFor = (report: DetectReport, options: ScriptOptions): T3Script[] => {
  if (report.stacks.length === 0) return [];
  const scripts: T3Script[] = [
    {
      name: "Dev (portless)",
      command: `${options.bin} up`,
      icon: "play",
      runOnWorktreeCreate: false,
      stopOnSettle: true,
      ...(isPresent(options.previewUrl) ? { previewUrl: options.previewUrl, autoOpenPreview: true } : {}),
    },
  ];
  if (report.e2e.length === 0) return scripts;
  scripts.push({ name: "E2E", command: `${options.bin} e2e`, icon: "test", runOnWorktreeCreate: false });
  scripts.push({ name: "E2E (hidden)", command: `${options.bin} e2e --hidden`, icon: "test", runOnWorktreeCreate: false });
  return scripts;
};
