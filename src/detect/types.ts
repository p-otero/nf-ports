export const stackRoles = ["front", "back", "unknown"] as const;
export type StackRole = (typeof stackRoles)[number];

export const isStackRole = (value: unknown): value is StackRole => stackRoles.some((role) => role === value);

export type Evidence = {
  readonly value: string;
  readonly source: string;
};

export type PortFinding = {
  readonly port: number;
  readonly source: string;
  readonly kind: "env-file" | "config" | "script-flag" | "framework-default";
};

export type PortOverride = "env:PORT" | "flag:--port" | "env:PORT+flag:--port" | "env:other" | "manual";

export type Stack = {
  readonly name: string;
  readonly directory: string;
  readonly role: StackRole;
  readonly framework: string | null;
  readonly devCommand: Evidence | null;
  readonly ports: readonly PortFinding[];
  readonly effectivePort: number | null;
  readonly portOverride: PortOverride;
  readonly portEnv: string | null;
  readonly warnings: readonly string[];
};

export type E2eRunner = "playwright" | "cypress";

export type E2eConfig = {
  readonly runner: E2eRunner;
  readonly configFile: string;
  readonly baseUrl: Evidence | null;
  readonly baseUrlEnv: string | null;
  readonly webServer: boolean;
  readonly envVars: readonly string[];
  readonly override: string;
};

export type Orchestrator = "turbo" | "nx" | "procfile";

export type DetectReport = {
  readonly root: string;
  readonly packageManager: "bun" | "pnpm" | "yarn" | "npm";
  readonly workspaces: readonly string[];
  readonly orchestrators: readonly Orchestrator[];
  readonly portlessConfig: string | null;
  readonly stacks: readonly Stack[];
  readonly e2e: readonly E2eConfig[];
};
