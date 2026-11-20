# nf-ports

`nfp` gives each git worktree its own ports and a `.localhost` name through
[portless](https://portless.sh), keeps end-to-end tests pointed at that worktree, and writes
[T3 Code](https://t3.codes) project scripts into `t3.json`.

On branch `feat/search`, `nfp up` serves the front at `https://feat-search.myapp.localhost` and
the API at `https://feat-search.api.myapp.localhost`, while `main` keeps `https://myapp.localhost`.
Several worktrees run side by side without port clashes, over HTTPS, without admin rights.

## Install

```sh
npm install --save-dev nf-ports      # or: bun add -d nf-ports / pnpm add -D nf-ports
npx nfp init                         # adds "postinstall": "nfp sync" and nfp.json
npx nfp setup                        # once per machine: starts the proxy, trusts its CA
```

`nfp sync` then runs on every install, including the first install of a new worktree. It merges
the nfp scripts into `t3.json` and tells you when `nfp setup` is still needed. It never prompts,
never fails the install and does nothing when `CI` is set. It runs from your project's own
`postinstall`, so it works with npm, pnpm and Bun without allow-listing dependency scripts.

portless comes as a dependency; no global install is needed. Node 22.15 or later.

## Commands

```sh
nfp up [--print]                 # start every app; the first line is the front's branch URL
nfp url [app]                    # branch URL of an app (default: the front)
nfp e2e [--headed | --ui] [-- runner args]
nfp e2e --hidden[=env|desktop]   # no window on screen (see below)
nfp detect [--json]              # what nfp found: apps, dev commands, ports, e2e config
nfp t3 scripts [--dry-run] [--bin <cmd>] [--preview-url <url>]
nfp setup [--quiet]
nfp sync [--quiet]
nfp init
```

### `nfp up`

Finds the apps from `package.json#workspaces` or `pnpm-workspace.yaml` and their `dev`,
`start:dev`, `serve` or `start` script, tells fronts from backs by framework, and starts each one
with `portless run`. The branch becomes the subdomain prefix.

- API-URL keys in a front's `.env*` (`VITE_API_URL`, `NEXT_PUBLIC_API_URL`, `BACKEND_URL`, …) get
  the first back's URL.
- Origin keys in a back's `.env*` (`CORS_ORIGIN`, `FRONTEND_URL`, `APP_URL`, `WEB_URL`, …) get the
  front's URL.
- A back that listens on `<NAME>_PORT` instead of `PORT` gets a port chosen by nfp.
- Node apps can call each other by name: nfp preloads a resolver for `*.localhost`.

### `nfp e2e`

Runs Playwright or Cypress against the running front of this worktree (start `nfp up` first).
It sets the `baseURL` variable the config reads, or, when `baseURL` is a literal or `webServer`
always starts, runs through a temporary wrapper config that overrides `baseURL` and drops
`webServer`.

`--hidden` sets `NFP_E2E_HIDDEN=1` and the app's own variable from `e2e.hiddenEnv`, so an
Electron app can keep its window off screen. Without one, or with `--hidden=desktop`, the run
happens on a hidden Windows desktop and its output is streamed back.

## `nfp.json`

Optional, at the repository root, for what detection cannot guess. `nfp init` adds the schema
for editor completion.

```json
{
  "$schema": "./node_modules/nf-ports/nfp.schema.json",
  "apps": {
    "services/core": {
      "name": "api.harbor",
      "role": "back",
      "portEnv": "CORE_PORT",
      "env": { "AUTH_CALLBACK_URL": "{url:front}/auth/callback", "RELEASE_LABEL": "{branch}" }
    }
  },
  "e2e": {
    "config": "playwright.config.ts",
    "hiddenEnv": "APP_E2E_HIDDEN_WINDOW",
    "env": { "API_URL": "{url:core}" }
  }
}
```

`{url:<ref>}` takes an app name, package name, directory, `front` or `back`.

## Development

```sh
bun install
bun src/bin.ts detect test/fixtures/lumen-notes
bun run verify    # lint, typecheck, build, tests
```

Design notes and measurements: `docs/spike.md`.
