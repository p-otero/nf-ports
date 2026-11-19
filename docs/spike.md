# Spike NF-051-A1: per-worktree ports and names through portless

Date: 2026-11-19. Machine: Windows 11 Pro 10.0.26200, non-admin user, Git Bash + PowerShell 5.1.
Versions: portless 0.18.1 (npm, global), Node 24.13.0, Bun 1.4.4, Vite 7.2.2,
@playwright/test 1.56.1 (Chromium 141), Docker Engine 29.1.3 inside WSL2 Ubuntu-24.04
(NAT networking), image `mcr.microsoft.com/playwright:v1.56.1-noble`, T3 Code
0.1.10-nightly.20261115.4723.

Fixture: `C:\Desarrollo\scratch-portless-fixture` ("Lumen Notes", invented). npm workspaces
`apps/web` (Vite, `.env` `PORT=5173`, `VITE_API_URL`) and `apps/api` (Node `http`, `.env`
`PORT=8787`), Playwright at the root with `baseURL = process.env.BASE_URL ?? localhost` and a
`webServer` that is skipped when `BASE_URL` is set. Worktrees `.worktrees/alpha`
(`feat/alpha-search`) and `.worktrees/beta` (`fix/beta-sync`). A trimmed copy lives in
`test/fixtures/lumen-notes`.

## 1. portless on Windows: what was checked

| Claim from the brief | Verified against 0.18.1 docs + `dist/cli.js` | Result on this machine |
| --- | --- | --- |
| Random `PORT` 4000–4999 per run | `MIN_APP_PORT=4000`, `MAX_APP_PORT=4999`, 50 attempts, blocked-port list | Yes: 4256, 4641, 4750, 4092, 4396… |
| Worktree subdomain from branch | Last `/` segment of the branch; `worktree.prefix: "branch"` or `worktree.hostnameTemplate` change it; `--prefix`/`PORTLESS_PREFIX` override | `feat/alpha-search` → `alpha-search.lumen.localhost`; main checkout → `lumen.localhost` |
| `portless.json` apps map | Exists (`apps`, `name`, `script`, `appPort`, `proxy`, `worktree`, `turbo`) | Only honoured from the **root** run; see bug 2 |
| HTTPS on 443 with local CA | Yes, HTTP/2, CA `~/.portless/ca.pem`, 10-year CA, 1-year leaf | Proxy binds 443 **without admin** (Windows has no privileged ports; code skips sudo when `isWindows`) |
| `--no-tls` | Plain HTTP on 80 | Works, no admin |
| `--unprivileged` | "Binds without sudo, installs nothing, never writes the hosts file"; HTTP on 80 unless `--https`. Sticky until `PORTLESS_UNPRIVILEGED=0` | On Windows it equals `--no-tls` minus hosts writes |
| `hosts sync` | Writes a managed block in the hosts file | Fails: `Failed to update hosts file (run as Administrator).` (exit 1) |
| `portless get` | `--json` gives `{name, hostname, url}`, worktree-aware | Works; this is the URL source for e2e |
| `mcp` | stdio MCP; profiles core/proxy/diagnostics/all; **does not start dev servers** | Help verified |
| Nothing for e2e | Confirmed: no e2e command, no env beyond `PORTLESS_URL`, `PORT`, `HOST`, `NODE_EXTRA_CA_CERTS`, `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` | — |

Extra facts found in the source:

- Vite, Astro, Angular, Expo, Wrangler, react-router, rsbuild, vitepress get `--port N
  --strictPort --host 127.0.0.1` appended (`FRAMEWORKS_NEEDING_PORT`); others only get `PORT`.
- With TLS on, portless injects `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem` into the app, so
  server-side Node fetches to other `*.localhost` HTTPS routes trust the CA.
- Routes live in `~/.portless/routes.json` and survive proxy restarts and mode switches.
- Library exports (`portless` main) cover `RouteStore`, proxy and hosts primitives, but **not**
  worktree naming or `run`; those exist only in the CLI.

### CA trust

`portless proxy start` and `portless trust` run `certutil -addstore -user Root ca.pem`. Adding to
the *user* Root store needs no admin but always shows a Windows "Security Warning" dialog, and
portless kills certutil after **30 s** (`WINDOWS_COMMAND_TIMEOUT_MS`): both attempts ended with
`The trust command timed out. Try: portless trust`. While the CA is untrusted, **every
`portless run` retries trust and opens another dialog**, which blocks the run until it times out
(`Failed to trust CA: Command failed: certutil -addstore …`). A plain
`certutil -addstore -user Root %USERPROFILE%\.portless\ca.pem` with no timeout was left waiting
for the click; at the time of writing it was still unanswered, so OS-level trust on the host is
**not verified**. Implication: the tool's `doctor`/`setup` must run trust once, interactively,
without a timeout, and `up` must start the proxy with `--skip-trust` so it never pops dialogs.

### How Windows resolves `*.localhost`

| Client | `a.b.localhost` | Notes |
| --- | --- | --- |
| Windows resolver (`Resolve-DnsName`, .NET, `getaddrinfo`) | **ENOTFOUND** | Only bare `localhost` resolves |
| Node 24 `dns.lookup`, Bun `dns.lookup` | **ENOTFOUND** | So `fetch("https://x.app.localhost")` from Node/Bun fails |
| curl 8.17 (mingw) and 8.22 (Windows) | 127.0.0.1 | curl special-cases `.localhost` |
| Chromium / Playwright / Edge / Chrome | 127.0.0.1 | Built-in rule; ignores the OS resolver and `/etc/hosts` |

`portless hosts sync` would fix Node/Bun but needs an elevated shell. Consequences for the design:
browser-side calls (Vite `VITE_API_URL`) work; a server-side proxy (Vite `server.proxy` to
`https://alpha-search.api.lumen.localhost`) or a Node test runner calling the API by name will not,
unless hosts are synced once as admin or the tool targets `127.0.0.1:<proxy port>` with a `Host`
header.

### portless bugs and gaps found on Windows

1. **Monorepo mode is broken on Windows**: `portless` at a workspace root spawns `npm run dev`
   with `spawn("npm", …)` and no shell (`spawnChildProcess`), so it dies with
   `Error: spawn npm ENOENT`. Single-app `run` is fine because it goes through `cmd.exe /d /s /c`.
2. A per-app `portless run` inside `apps/api` ignores the root `portless.json` `apps` map and
   names the app from `package.json` (`@lumen/api` → `api`, so `alpha-search.api.localhost`
   instead of `alpha-search.api.lumen.localhost`). `portless get api.lumen` from the same
   directory still prints the `api.lumen` URL, so the two disagree. Passing `--name` fixes it.
3. The 30 s certutil timeout plus "retry trust on every run" (above).
4. A killed process leaves a stale route until `portless prune` (doctor reports it).

## 2. Two worktrees at once (host)

Commands (Git Bash), HTTP mode first (`portless proxy start --no-tls`), then HTTPS
(`PORTLESS_UNPRIVILEGED=0 portless proxy start --skip-trust`):

```sh
for w in alpha beta; do
  R=/c/Desarrollo/scratch-portless-fixture/.worktrees/$w
  cd $R; API=$(portless get api.lumen)
  (cd apps/api && portless run --name api.lumen) &
  (cd apps/web && VITE_API_URL=$API portless run --name lumen) &
done
```

portless output (HTTPS run, abridged):

```
Running: PORT=4396 HOST=127.0.0.1 PORTLESS_URL=https://alpha-search.api.lumen.localhost NODE_EXTRA_CA_CERTS="C:\Users\otero\.portless\ca.pem" npm run dev
Running: PORT=4024 HOST=127.0.0.1 PORTLESS_URL=https://beta-sync.lumen.localhost NODE_EXTRA_CA_CERTS="C:\Users\otero\.portless\ca.pem" npm run dev -- --port 4024 --strictPort --host 127.0.0.1

$ portless list
  https://alpha-search.api.lumen.localhost  ->  localhost:4396
  https://alpha-search.lumen.localhost      ->  localhost:4748
  https://beta-sync.api.lumen.localhost     ->  localhost:4636
  https://beta-sync.lumen.localhost         ->  localhost:4024
```

`curl http://alpha-search.api.lumen.localhost/api/greeting` →
`{"message":"hello from lumen api","branch":"feat/alpha-search","port":4773}`; the beta URL
answers with `fix/beta-sync`. The `.env` `PORT` values (5173/8787) lost to the injected ones in
both stacks: Node's `--env-file` never overrides an existing variable, and Vite gets `--port`.

E2E, both worktrees concurrently:

```sh
(cd .worktrees/alpha && BASE_URL=$(portless get lumen) EXPECT_BRANCH=feat/alpha-search npx playwright test) &
(cd .worktrees/beta  && BASE_URL=$(portless get lumen) EXPECT_BRANCH=fix/beta-sync   npx playwright test) &
```

| Run | alpha | beta |
| --- | --- | --- |
| Baseline, no portless (`webServer` on 5173/8787) | 1 passed | — |
| HTTP proxy | 1 passed (18.6 s) | 1 passed (19.0 s) |
| HTTPS proxy, CA untrusted, `E2E_IGNORE_HTTPS_ERRORS=1` | 1 passed (1.6 s) | 1 passed (1.4 s) |
| Negative: alpha URL with `EXPECT_BRANCH=fix/beta-sync` | 1 failed: received `[feat/alpha-search]` | — |

## 3. Detection rules

Implemented in `src/detect/` and exercised by `test/detect.test.ts` on four fixtures
(lumen-notes, orbit-turbo, kettle-procfile, quill-single).

### Dev commands

| Rule | Source | Misses |
| --- | --- | --- |
| Workspaces from `package.json#workspaces` (array or `{packages}`) and `pnpm-workspace.yaml`; globs expanded one level (`apps/*`) | manifests | `**` deep globs, negations, Yarn `nohoist`, Bun catalogs, Rush/Lerna |
| Per package: first of `dev`, `start:dev`, `serve`, `start` script | `package.json#scripts` | Custom names (`develop`, `web`), scripts that only chain others (`run-p dev:*`) |
| Nx: `project.json` targets `serve`/`dev` → `nx run <name>:serve` | `project.json` | Nx inferred targets from plugins, `workspace.json` |
| Turbo/Nx noted as orchestrators; per-package scripts are still used | `turbo.json`, `nx.json` | Turbo filters and `dependsOn` setups that start more processes |
| Procfile / Procfile.dev lines become stacks | Procfile | Foreman `.env` port bases, `PORT` offsets per process |
| Front framework from deps or config file: next, nuxt, astro, sveltekit, react-router, angular, vite (meta-frameworks before vite) | deps + `*.config.*` | Remix classic, Gatsby, Docusaurus, Storybook, Expo, Qwik, SolidStart |
| Back from deps (nestjs, hono, fastify, express, koa, elysia) or a dev command that runs `node/bun/tsx/deno/nodemon <file>` | deps + command | Go/Python/Ruby servers, Docker Compose services, `bun --hot` with no file |

### Ports

| Rule (highest precedence first) | Misses |
| --- | --- |
| `--port N` / `-p N` in the dev command | Ports set through env in the script (`PORT=3001 next dev`) |
| `.env`, `.env.development`, `.env.local`, `.env.development.local` (later wins), key `PORT`; other `*_PORT` keys are listed | `.env.<mode>` beyond development, dotenv-expand, secrets managers |
| Literal in the framework config or server entry: `port: N`, `PORT ?? N`, `PORT \|\| N`, `.listen(N` | Computed ports, ports in imported modules |
| Framework default (5173, 3000, 4321, 4200) | Frameworks whose default changed between majors |

### E2E

| Rule | Misses |
| --- | --- |
| `playwright.config.{ts,mts,cts,js,mjs,cjs}` at the root and in each workspace; `baseURL` value, resolving a shorthand or identifier to its `const` | Configs split across files, per-project `baseURL`, `--config` paths in scripts |
| `process.env.X` names inside the `baseURL` expression → override variable | Env read through helpers (`env("BASE_URL")`) |
| `webServer:` presence | Whether it is conditional (needs reading the code) |
| `cypress.config.*` `baseUrl` | `cypress.json` (legacy), component testing |

### How each is overridden (env injection first)

| Target | Mechanism | File edit? |
| --- | --- | --- |
| Front/back port | portless `PORT` (+`--port` for listed frameworks) | No; warn when the entry never reads `PORT` or uses dotenv `override: true` |
| Front → API URL | Inject the detected API env var (`VITE_API_URL`, `NEXT_PUBLIC_API_URL`…) with `portless get <api>` | No; the variable name is the one thing to confirm per repo |
| Playwright `baseURL` read from env | Inject that variable | No |
| Playwright literal `baseURL` or unconditional `webServer` | Generated wrapper `.wtp/playwright.config.ts` that imports the user config and sets `use.baseURL`, `webServer: undefined`; run with `--config` | No (generated file, gitignored) |
| Cypress | `CYPRESS_BASE_URL` | No |
| Names | `--name` on each `portless run` | No; optional `portless.json` only for humans |

## 4. Docker: Playwright in a container against a worktree URL

Done for real; both worktrees ran concurrently and passed over HTTP and over HTTPS with the CA
trusted inside the container.

Obstacles and fixes:

1. The proxy listens only on `127.0.0.1`/`::1` on Windows. WSL2 is in NAT mode
   (`wslinfo --networking-mode` → `nat`), so WSL and its containers cannot reach it:
   `curl -H 'Host: …' http://172.23.128.1/` → no connection.
   Fix used: a 12-line Node TCP bridge on Windows bound to the WSL vEthernet address
   (`172.23.128.1:80/443 → 127.0.0.1:80/443`). No admin, no firewall change was needed here.
   Alternatives: WSL `networkingMode=mirrored` in `.wslconfig` (needs `wsl --shutdown`, which
   would stop the other WSL containers), or `portless proxy start --lan` (binds `0.0.0.0` and
   switches to `.local` names — not wanted).
2. Inside the container `getent hosts x.lumen.localhost` fails, and Chromium maps `*.localhost`
   to its own loopback regardless of `/etc/hosts` or `--add-host`. Fix used: a second tiny bridge
   inside the container on `127.0.0.1:80/443 → 172.23.128.1`. Chromium keeps its loopback rule,
   the `Host` header and SNI pass through untouched, and the fixture config is unchanged.
3. TLS: Chromium in the image does not trust the portless CA
   (`net::ERR_CERT_AUTHORITY_INVALID`). The image has no `certutil`; installing
   `libnss3-tools` at start and running
   `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n portless -i ca.pem` fixed it without
   `ignoreHTTPSErrors`. A derived image would avoid the apt step on every run.

Result:

| Container run | alpha | beta |
| --- | --- | --- |
| HTTP | 1 passed (9.9 s) | 1 passed (9.9 s) |
| HTTPS, CA untrusted | failed `ERR_CERT_AUTHORITY_INVALID` | same |
| HTTPS, CA imported into NSS | 1 passed (8.9 s) | 1 passed (8.9 s) |

The container ran the worktree's own `node_modules/@playwright/test` (installed on Windows; it is
pure JS) with the image's browsers; the versions must match (1.56.1 ↔ `v1.56.1-noble`). The WSL
gateway IP changes across WSL restarts, so the tool must read it each time
(`ip route show default` inside WSL, or the `vEthernet (WSL)` adapter on Windows).

## 5. T3 Code integration

Findings (read-only):

- `~/.t3/bin/t3.cmd` is a real CLI (bundled `bin.mjs`). `t3 project` has only `add`, `remove`,
  `rename`. There is no scripts subcommand.
- The server accepts a `project.update`/`project.meta.update` command whose `scripts` field
  **replaces the whole array**; new IDs must be 1–24 chars of lowercase letters, digits or
  hyphens. The CLI already dispatches `project.update` for rename, so a `t3 project scripts` verb
  would be small, but it is not exposed.
- The local server on `127.0.0.1:3773` (from `server-runtime.json`) speaks an authenticated
  WebSocket RPC; using it from our CLI would mean borrowing T3's auth, which is unsupported.
- The T3 MCP `t3_project_update` tool (available to agents in T3 threads) takes `scripts` with
  exactly the listed fields. This is the supported write path today.
- `projection_projects.scripts_json` currently holds no scripts on this machine.
- When a script runs, T3 types the command into a terminal whose cwd is the thread's worktree
  (or the project root) and sets `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH`.
- `previewUrl` is a fixed string per project; no placeholder substitution was found. A single
  value cannot point at each worktree's own hostname.

Proposal: `wtp t3 scripts [--json]` prints the scripts array; the NF coordinator reads the
project (`t3_project_read`), merges by `id` (because update replaces the array) and applies it
with `t3_project_update`. The CLI never touches the database.

```json
[
  { "id": "wtp-setup", "name": "Setup ports", "command": "bunx wtp setup", "icon": "configure",
    "runOnWorktreeCreate": true, "async": false },
  { "id": "wtp-dev", "name": "Dev (portless)", "command": "bunx wtp up", "icon": "play",
    "runOnWorktreeCreate": false, "async": true,
    "previewUrl": "https://lumen.localhost", "autoOpenPreview": false },
  { "id": "wtp-e2e", "name": "E2E (this worktree)", "command": "bunx wtp e2e", "icon": "test",
    "runOnWorktreeCreate": false },
  { "id": "wtp-e2e-docker", "name": "E2E (container)", "command": "bunx wtp e2e --docker", "icon": "test",
    "runOnWorktreeCreate": false }
]
```

`previewUrl` can only carry the main checkout's URL; `wtp up` prints the worktree URL, and the
agent opens it with T3's preview tools. A `{worktree}` placeholder in `previewUrl` (or a
`t3 project scripts` verb) is a feature request for T3.

## 6. Recommended design

Working name: `worktree-ports` / binary `wtp`. Better names: **`treeport`** (short, says
worktree + port), `lanes`, `wtport`, `forkport`. Check npm availability before choosing.

**Wrap the portless CLI, do not embed its API.** The library does not export worktree naming or
`run`; the CLI has a documented contract (`--json` on `get`/`list`/`doctor`, exit codes 0/1/2,
`PORTLESS_*` env). Pin portless as a dependency of the tool so every worktree uses the same
version.

Commands:

| Command | Does |
| --- | --- |
| `wtp detect [--json]` | Implemented. Stacks, dev commands, ports, e2e config and override plan |
| `wtp doctor [--json]` | `portless doctor --json` + Windows checks: CA in user Root, hosts entries, WSL gateway reachability, Docker in WSL, Playwright image vs installed version |
| `wtp setup` | One-time: start proxy, run trust **without** a timeout (direct certutil on Windows), optional elevated `hosts sync`; T3 `runOnWorktreeCreate` runs it with `--quiet` and it no-ops when ready |
| `wtp up [--no-tls]` | For each detected stack: `portless run --name <name>` in its directory (never root monorepo mode on Windows), API URL env injected into fronts from `portless get`, proxy started with `--skip-trust`; prints the worktree URLs; Ctrl+C stops the tree |
| `wtp e2e [--docker] [-- args]` | Resolves URLs with `portless get`, injects `BASE_URL`-style env or generates the wrapper config, runs the runner; `--docker` adds the Windows bridge, the in-container loopback bridge and the NSS import, using the image tag that matches the installed Playwright |
| `wtp t3 scripts [--json]` | Prints the T3 scripts array above for the coordinator to merge and apply |
| `wtp url <stack>` | `portless get` with the tool's naming |

Config: none by default; detection drives everything. An optional `wtp.json` overrides the
detected values (stack names, API env var name, e2e command, Docker image). It does not replace
`portless.json`, which the tool leaves alone.

## Cleanup

Processes started by the spike were stopped (stacks, bridges, containers, proxy). To remove
portless completely:

```sh
portless proxy stop
portless clean --yes                 # removes ~/.portless state and the CA trust entry
certutil -delstore -user Root "portless Local CA"   # only if the CA was trusted and clean failed
npm rm -g portless
```

The fixture stays at `C:\Desarrollo\scratch-portless-fixture` (`git worktree remove` both
worktrees, then delete the folder, to remove it). The Playwright image can be removed with
`wsl -d Ubuntu-24.04 -- docker rmi mcr.microsoft.com/playwright:v1.56.1-noble`.
