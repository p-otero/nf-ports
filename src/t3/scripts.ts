import type { DetectReport } from "../detect/types.ts";
import type { T3Script } from "./project-file.ts";

export type ScriptOptions = {
  readonly bin: string;
  readonly previewUrl: string | null;
};

export const t3ScriptsFor = (report: DetectReport, options: ScriptOptions): T3Script[] => {
  const scripts: T3Script[] = [];
  if (report.stacks.length === 0) return scripts;
  scripts.push({
    name: "Ports setup",
    command: `${options.bin} setup --quiet`,
    icon: "configure",
    runOnWorktreeCreate: true,
  });
  scripts.push({
    name: "Dev (portless)",
    command: `${options.bin} up`,
    icon: "play",
    runOnWorktreeCreate: false,
    stopOnSettle: true,
    ...(options.previewUrl ? { previewUrl: options.previewUrl, autoOpenPreview: true } : {}),
  });
  if (report.e2e.length === 0) return scripts;
  scripts.push({ name: "E2E", command: `${options.bin} e2e`, icon: "test", runOnWorktreeCreate: false });
  scripts.push({
    name: "E2E (hidden)",
    command: `${options.bin} e2e --hidden`,
    icon: "test",
    runOnWorktreeCreate: false,
  });
  return scripts;
};
