# nf-ports

`nfp` is a Bun CLI that gives each git worktree its own ports and `.localhost` name through
[portless](https://portless.sh), keeps e2e pointed at that worktree, and writes T3 Code project
scripts into `t3.json`. `preload/localhost-dns.mjs` lets Node resolve `*.localhost` without
admin. Design and evidence: `docs/spike.md`.

```sh
bun install
bun src/cli.ts detect [dir] [--json]
bun src/cli.ts setup [--quiet]             # once per machine: proxy + CA trust, no dialog timeout
bun src/cli.ts up [dir] [--print]          # first stdout line: the front's branch URL
bun src/cli.ts url [app]                   # branch URL of an app (default: the front)
bun src/cli.ts e2e [dir] [--headed | --ui | --hidden[=env|desktop]] [--print] [-- args]
bun src/cli.ts t3 scripts [dir] [--dry-run] [--bin <cmd>]
bun run verify                             # lint, typecheck, tests
```

`nfp up` wires fronts and backs from their `.env*` keys: API-URL keys in a front get the first
back's URL, and origin keys in a back (`CORS_ORIGIN`, `FRONTEND_URL`, `APP_URL`, …) get the
front's URL. A back that reads `<NAME>_PORT` instead of `PORT` gets a port chosen by nfp
(`portless run --app-port`). `nfp e2e` runs against the running front of this worktree.

Optional `nfp.json` at the repository root, for what detection cannot guess:

```json
{
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
