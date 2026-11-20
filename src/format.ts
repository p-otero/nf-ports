import type { DetectReport, E2eConfig, Stack } from "./detect/types.ts";

const formatStack = (stack: Stack): string[] => {
  const ports = stack.ports.map((finding) => `${finding.port} (${finding.source})`).join(", ") || "none found";
  return [
    `  ${stack.name}  [${stack.role}${stack.framework ? `, ${stack.framework}` : ""}]  ${stack.directory}`,
    `    dev:      ${stack.devCommand ? `${stack.devCommand.value}  (${stack.devCommand.source})` : "not found"}`,
    `    port:     ${stack.effectivePort ?? "unknown"}  <- ${ports}`,
    `    override: ${stack.portEnv ? `env:${stack.portEnv} (nfp up picks the port)` : stack.portOverride}`,
    ...stack.warnings.map((warning) => `    warning:  ${warning}`),
  ];
};

const formatE2e = (config: E2eConfig): string[] => [
  `  ${config.runner}  ${config.configFile}`,
  `    baseURL:   ${config.baseUrl?.value ?? "not set"}`,
  `    webServer: ${config.webServer ? "yes" : "no"}`,
  `    env vars:  ${config.envVars.join(", ") || "none"}`,
  `    override:  ${config.override}`,
];

export const formatReport = (report: DetectReport): string =>
  [
    `root: ${report.root}`,
    `package manager: ${report.packageManager}`,
    `workspaces: ${report.workspaces.join(", ") || "none"}`,
    `orchestrators: ${report.orchestrators.join(", ") || "none"}`,
    `portless.json: ${report.portlessConfig ?? "absent"}`,
    "",
    `stacks (${report.stacks.length}):`,
    ...report.stacks.flatMap(formatStack),
    "",
    `e2e (${report.e2e.length}):`,
    ...report.e2e.flatMap(formatE2e),
  ].join("\n");
