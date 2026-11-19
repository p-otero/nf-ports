import type { PortOverride, StackRole } from "./types.ts";

export type Framework = {
  readonly name: string;
  readonly role: StackRole;
  readonly packages: readonly string[];
  readonly configs: readonly string[];
  readonly defaultPort: number | null;
  readonly override: PortOverride;
};

const configNames = (base: string): string[] =>
  ["ts", "mts", "js", "mjs", "cjs"].map((extension) => `${base}.${extension}`);

export const frameworks: readonly Framework[] = [
  { name: "next", role: "front", packages: ["next"], configs: configNames("next.config"), defaultPort: 3000, override: "env:PORT" },
  { name: "nuxt", role: "front", packages: ["nuxt"], configs: configNames("nuxt.config"), defaultPort: 3000, override: "env:PORT" },
  { name: "astro", role: "front", packages: ["astro"], configs: configNames("astro.config"), defaultPort: 4321, override: "env:PORT+flag:--port" },
  { name: "sveltekit", role: "front", packages: ["@sveltejs/kit"], configs: configNames("svelte.config"), defaultPort: 5173, override: "env:PORT+flag:--port" },
  { name: "react-router", role: "front", packages: ["@react-router/dev"], configs: configNames("react-router.config"), defaultPort: 5173, override: "env:PORT+flag:--port" },
  { name: "angular", role: "front", packages: ["@angular/cli"], configs: ["angular.json"], defaultPort: 4200, override: "env:PORT+flag:--port" },
  { name: "vite", role: "front", packages: ["vite"], configs: configNames("vite.config"), defaultPort: 5173, override: "env:PORT+flag:--port" },
  { name: "nestjs", role: "back", packages: ["@nestjs/core"], configs: ["nest-cli.json"], defaultPort: 3000, override: "env:PORT" },
  { name: "hono", role: "back", packages: ["hono"], configs: [], defaultPort: null, override: "env:PORT" },
  { name: "fastify", role: "back", packages: ["fastify"], configs: [], defaultPort: null, override: "env:PORT" },
  { name: "express", role: "back", packages: ["express"], configs: [], defaultPort: null, override: "env:PORT" },
  { name: "koa", role: "back", packages: ["koa"], configs: [], defaultPort: null, override: "env:PORT" },
  { name: "elysia", role: "back", packages: ["elysia"], configs: [], defaultPort: null, override: "env:PORT" },
];
