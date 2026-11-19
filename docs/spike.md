# Spike NF-051: per-worktree ports and names through portless

Attempts: A1 and A2, 2026-11-19. Machine: Windows 11 Pro 10.0.26200, non-admin user,
Git Bash and PowerShell 5.1.

Versions: portless 0.18.1 (npm, global), Node 24.13.0, Bun 1.4.4, Vite 7.2.2,
@playwright/test 1.56.1 (Chromium 141), Docker Engine 29.1.3 inside WSL2 Ubuntu-24.04 (NAT
networking), image `mcr.microsoft.com/playwright:v1.56.1-noble`, T3 Code
0.1.10-nightly.20261115.4723.

Fixture: `C:\Desarrollo\scratch-portless-fixture` ("Lumen Notes", invented names).
- npm workspaces `apps/web` (Vite; `.env` has `PORT=5173` and `VITE_API_URL`) and `apps/api`
  (Node `http`; `.env` has `PORT=8787`).
- Playwright at the root, with `baseURL = process.env.BASE_URL ?? localhost` and a `webServer`
  that is skipped when `BASE_URL` is set.
- Worktrees `.worktrees/alpha` (`feat/alpha-search`) and `.worktrees/beta` (`fix/beta-sync`).
- A trimmed copy lives in `test/fixtures/lumen-notes`.

## Summary

| Question | Answer |
| --- | --- |
| Port and DNS per worktree | portless `run --name <app>` per stack, with `PORTLESS_PREFIX` set to the whole branch: `feat/alpha-search` → `https://feat-alpha-search.lumen.localhost` |
| Host HTTPS with the CA trusted | Verified in both worktrees at once, without `E2E_IGNORE_HTTPS_ERRORS` |
| Default e2e | On the host: about 1.9 s wall time for the fixture suite, and headed/UI mode works |
| `e2e --docker` | Opt-in. Works with real CA trust inside the container; about 17.9 s warm and 47 s cold |
| Node server-to-server by name | Use the `--import` DNS preload (shipped in `preload/`), plus the CA that portless already injects |
| T3 | `wtp t3 scripts` writes or merges `t3.json` at the repo root by script name (implemented) |
| Per-worktree preview URL | No placeholder support in this T3 build. Closest working setups are in §5 |

## 1. portless on Windows

| Claim from the brief | What 0.18.1 docs and `dist/cli.js` say | Result on this machine |
| --- | --- | --- |
| Random `PORT` 4000–4999 per run | `MIN_APP_PORT=4000`, `MAX_APP_PORT=4999`, 50 attempts, blocked-port list | Yes |
| Worktree subdomain from branch | Last `/` segment by default; `worktree.prefix: "branch"` uses the whole branch; `PORTLESS_PREFIX`/`--prefix` override. `main`/`master` get no prefix | `PORTLESS_PREFIX=feat-alpha-search` → `feat-alpha-search.lumen.localhost` |
| `portless.json` apps map | Exists | Only honoured from the **root** run; see bug 2 |
| HTTPS on 443 with local CA | HTTP/2, CA `~/.portless/ca.pem` | Binds 443 **without admin**; the code skips sudo on Windows |
| `--no-tls` / `--unprivileged` | HTTP on 80; unprivileged also never writes hosts and is sticky until `PORTLESS_UNPRIVILEGED=0` | Both work without admin |
| `hosts sync` | Managed block in the hosts file | `Failed to update hosts file (run as Administrator).` |
| `get`, `list`, `doctor` | `--json` output, exit codes 0/1/2 | Work |
| `mcp` | stdio, does not start dev servers | — |
| Nothing for e2e | Confirmed | — |

Injected into every app: `PORT`, `HOST=127.0.0.1`, `PORTLESS_URL`, and with TLS
`NODE_EXTRA_CA_CERTS=~/.portless/ca.pem`. Vite, Astro, Angular, Expo, Wrangler, react-router,
rsbuild and vitepress also get `--port N --strictPort --host 127.0.0.1`.

### CA trust (A2: verified)

Pablo accepted the dialog. `certutil -user -store Root` shows `CN=portless Local CA`
(serial `685a006a…fab6`, valid until 2036-11-16). `portless doctor` reports
`ok Local CA is trusted by the OS trust store`.

How we got there: `portless trust` runs `certutil -addstore -user Root`. That always opens a
Windows confirmation dialog, and portless kills certutil after 30 s. While the CA is untrusted,
every `portless run` retries trust and blocks on a new dialog. The tool must therefore:
- trust once, interactively and with no timeout (`wtp setup`);
- always start the proxy itself with `--skip-trust`.

### Name resolution and trust per client (A2 measurements)

Target: `https://feat-alpha-search.api.lumen.localhost/api/greeting` through the proxy.

| # | Client | Result |
| --- | --- | --- |
| 1 | Node 24 `fetch`, no flags | `ENOTFOUND` |
| 2 | Node + `--import localhost-dns.mjs` | `SELF_SIGNED_CERT_IN_CHAIN` (DNS fixed; Node's bundled CA list lacks the CA) |
| 3 | Node + preload + `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem` | 200 |
| 4 | Node + preload + `--use-system-ca` | 200 (reads the Windows user Root store) |
| 5 | Same as 4 via `NODE_OPTIONS="--use-system-ca --import=file:///C:/…/localhost-dns.mjs"` | 200. A bare `C:/…` path fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`, so it must be a `file://` URL |
| 6 | Node `fetch` of `http://127.0.0.1:<app port>` | 200 |
| 7 | Bun `fetch`, no flags | `SELF_SIGNED_CERT_IN_CHAIN`: Bun's fetch resolves `*.localhost` itself |
| 11 | Bun `fetch` + `NODE_EXTRA_CA_CERTS` | 200, no preload needed |
| 12 | Bun `fetch` + `--use-system-ca` | 200 |
| 13 | Bun `node:https` + CA | `ENOTFOUND` (Bun's `node:dns` is the OS resolver) |
| — | Process launched by `portless run` with only `NODE_OPTIONS=--import=<preload>` | 200: portless supplies the CA, the preload supplies DNS |
| — | Chromium / Playwright / curl | Resolve `*.localhost` to loopback themselves. Chromium uses the Windows store, so no flag is needed |
| — | Windows resolver, `Resolve-DnsName`, .NET | `ENOTFOUND` |

Answer to "NODE_EXTRA_CA_CERTS or --use-system-ca": either works on Node 24.
- Inside processes started by `portless run`, nothing is needed: portless already sets
  `NODE_EXTRA_CA_CERTS`.
- For processes started outside portless (test runners, scripts), `--use-system-ca` is the
  better default because it follows the OS store that `wtp setup` populated.
- `NODE_EXTRA_CA_CERTS` is the fallback for older Node versions.

### portless bugs found on Windows

1. Monorepo root mode spawns `npm` without a shell, so it fails with `spawn npm ENOENT`.
   Single-app `run` works because it goes through `cmd.exe`.
2. A per-app `run` ignores the root `portless.json` `apps` map and names the app from
   `package.json` (`@lumen/api` → `api`), while `portless get api.lumen` disagrees. Passing
   `--name` fixes it.
3. The 30 s certutil timeout, combined with retrying trust on every run.
4. A killed process leaves a stale route until `portless prune`.

## 2. Two worktrees at once on the host (A2: HTTPS, CA trusted, branch names)

```sh
for w in alpha beta; do
  R=/c/Desarrollo/scratch-portless-fixture/.worktrees/$w; cd $R
  export PORTLESS_PREFIX=$(git rev-parse --abbrev-ref HEAD | tr '/' '-')
  API=$(portless get api.lumen)
  (cd apps/api && portless run --name api.lumen &)
  (cd apps/web && VITE_API_URL=$API portless run --name lumen &)
done
```

```
$ portless list
  https://feat-alpha-search.api.lumen.localhost  ->  localhost:4856
  https://feat-alpha-search.lumen.localhost      ->  localhost:4721
  https://fix-beta-sync.api.lumen.localhost      ->  localhost:4450
  https://fix-beta-sync.lumen.localhost          ->  localhost:4224
```

E2E in both worktrees at the same time, with `E2E_IGNORE_HTTPS_ERRORS` unset:

```sh
(cd .worktrees/alpha && BASE_URL=https://feat-alpha-search.lumen.localhost EXPECT_BRANCH=feat/alpha-search npx playwright test) &
(cd .worktrees/beta  && BASE_URL=https://fix-beta-sync.lumen.localhost     EXPECT_BRANCH=fix/beta-sync     npx playwright test) &
```

| Run | alpha | beta |
| --- | --- | --- |
| A1: no portless (`webServer` on 5173/8787) | passed | — |
| A1: HTTP proxy | passed | passed |
| A1: HTTPS, CA untrusted, ignore flag | passed | passed |
| A1: negative check (alpha URL expecting beta's branch) | failed as expected: received `[feat/alpha-search]` | — |
| **A2: HTTPS, CA trusted, no ignore flag** | **1 passed (1.2 s)** | **1 passed (1.2 s)** |

## 3. Detection rules

Implemented in `src/detect/` and tested on four fixtures: lumen-notes, orbit-turbo,
kettle-procfile and quill-single.

### Dev commands

| Rule | Misses |
| --- | --- |
| Workspaces from `package.json#workspaces` and `pnpm-workspace.yaml`, with one-level globs | `**` globs, negations, Rush/Lerna |
| Per package, the first of `dev`, `start:dev`, `serve`, `start` | Custom names; scripts that only chain others |
| Nx `project.json` targets `serve`/`dev` | Nx inferred targets |
| Turbo/Nx recorded as orchestrators; per-package scripts still used | Turbo filters that start more processes |
| Procfile / Procfile.dev lines become stacks | Foreman port bases |
| Front framework from deps or config file (meta-frameworks checked before vite) | Gatsby, Storybook, Qwik, SolidStart |
| Back from deps, or a dev command running `node/bun/tsx/deno/nodemon <file>` | Non-JS servers, Compose services |

### Ports

| Rule (highest precedence first) | Misses |
| --- | --- |
| `--port N` / `-p N` in the dev command | `PORT=3001 cmd` prefixes |
| `.env`, `.env.development`, `.env.local`, `.env.development.local`, key `PORT` | Other modes, dotenv-expand |
| Literal in the config or server entry: `port: N`, `PORT ?? N`, `PORT \|\| N`, `.listen(N` | Computed or imported ports |
| Framework default | Defaults that changed between majors |

### E2E

| Rule | Misses |
| --- | --- |
| `playwright.config.*` at the root and per workspace; `baseURL`, following an identifier to its `const` | Split configs, per-project `baseURL` |
| `process.env.X` inside `baseURL` → the variable to override | Env helpers |
| `webServer:` present | Whether it is conditional |
| `cypress.config.*` `baseUrl` | `cypress.json` |

### How each is overridden (env injection first)

| Target | Mechanism |
| --- | --- |
| Port | portless `PORT` (+ `--port` flag); warn if the entry never reads `PORT` or uses dotenv `override: true` |
| Front → API URL | Inject the detected env var with `portless get <api>` |
| Server → server by name | `NODE_OPTIONS=--import=<file URL of preload>` (§6) |
| Playwright `baseURL` read from env | Inject that variable |
| Literal `baseURL` or unconditional `webServer` | Generated wrapper config passed with `--config` |
| Cypress | `CYPRESS_BASE_URL` |
| Names | `--name` per app + `PORTLESS_PREFIX=<branch>` |

## 4. E2E: host by default, Docker as opt-in

The host run is the default: it is about 10× faster for this suite, and `--headed` / `--ui` open
Chromium on screen. `e2e --docker` stays for isolation and CI-like runs.

Timings: alpha worktree, HTTPS with the CA trusted, sequential runs, wall time measured
around the whole command.

| Mode | Runs (wall) | Playwright-reported | Typical |
| --- | --- | --- | --- |
| Host `npx playwright test` | 1.70, 1.79, 1.97, 2.31, 3.91 s | 0.66–2.2 s | **~1.9 s** |
| Docker, derived image `wtp-playwright:1.56.1` (Playwright + `libnss3-tools`), container start + NSS import + bridges | 47.35 (cold), 17.89, 17.89, 17.81, 18.29 s | 8.8–10.2 s | **~17.9 s warm** |

Most of the Docker cost is container start plus loading `node_modules` over the WSL `/mnt/c` 9P
mount. The `wsl` hop itself costs about 65 ms. Copying the worktree into a volume, or running
from a WSL-native checkout, would shrink it.

How the container reaches the worktree (A1, unchanged):
1. The proxy listens only on Windows loopback, and WSL is in NAT mode. A small Node TCP bridge
   on the WSL vEthernet address (`172.23.128.1:80/443 → 127.0.0.1`) fixes that without admin.
   The address changes across WSL restarts, so read it each time.
2. Chromium maps `*.localhost` to its own loopback whatever `/etc/hosts` says. A second bridge
   inside the container (`127.0.0.1:80/443 → 172.23.128.1`) keeps that rule useful. `Host` and
   SNI pass through.
3. The image does not trust the CA (`ERR_CERT_AUTHORITY_INVALID`). Importing `ca.pem` into
   `~/.pki/nssdb` with `certutil` fixes it without `ignoreHTTPSErrors`. A derived image avoids
   paying for apt on every run.
4. The container uses the worktree's own `@playwright/test`. Its version must match the image
   tag (1.56.1 ↔ `v1.56.1-noble`).

## 5. T3 Code integration

### `t3.json` (supported path)

The installed build defines it in `packages/contracts/src/t3ProjectFile.ts`.
- Schema URL `https://t3.codes/schema/t3.json`; at most 50 scripts.
- Script fields: `name`, `command` (non-empty, trimmed), `icon`, `runOnWorktreeCreate`,
  `runOnSettle`, `stopOnSettle`, `async`, `previewUrl` ("only honored on the desktop build"),
  `autoOpenPreview`.
- Top-level keys: `$schema`, `iconPath`, `defaultThreadEnvMode`, `worktreeSubmodules`, `scripts`.
- The client reads `t3.json` per checkout. In project settings it offers **"Import from
  t3.json — add actions declared by this checkout"**, and in the scripts menu a **"From
  t3.json"** group.
- Importing copies the script into the project's scripts; it is not a live link. After
  `t3.json` changes, re-import the script.

`wtp t3 scripts [dir] [--dry-run] [--json] [--bin <cmd>] [--preview-url <url>]` is implemented:
- It finds the repository root (works from a worktree, where `.git` is a file).
- It merges by trimmed script name. A wtp script replaces the fields it sets and keeps any extra
  fields; other scripts and top-level keys stay untouched; new scripts are appended.
- It adds `$schema` when missing, enforces the 50-script limit and the icon list, refuses to
  touch invalid JSON, and reports `created` / `updated` / `unchanged`. A second run reports
  `unchanged` and leaves the bytes the same.
- Tests: `test/t3.test.ts`.

Output on the fixture (`--bin "bunx wtp"`):

```json
{
  "$schema": "https://t3.codes/schema/t3.json",
  "scripts": [
    { "name": "Ports setup", "command": "bunx wtp setup --quiet", "icon": "configure", "runOnWorktreeCreate": true },
    { "name": "Dev (portless)", "command": "bunx wtp up", "icon": "play", "runOnWorktreeCreate": false, "stopOnSettle": true },
    { "name": "E2E", "command": "bunx wtp e2e", "icon": "test", "runOnWorktreeCreate": false },
    { "name": "E2E (Docker)", "command": "bunx wtp e2e --docker", "icon": "test", "runOnWorktreeCreate": false }
  ]
}
```

### Per-worktree preview URL: what this T3 build does

Read-only inspection of `resources/server.asar` (client bundle `_chat-*.js`,
`browserDefaults-*.js`, `preview-*.js`; server `runtimeLayer-*.mjs`).

- **Script-run path.** After writing the command to the terminal, T3 calls
  `openPreview(ph(environmentId, script.previewUrl))` when `autoOpenPreview` is set. `ph`
  normalizes the URL (adds a scheme, validates the protocol). For a remote environment it also
  rewrites `localhost`/`127.0.0.1` to the environment's address. There is **no placeholder
  substitution, no env expansion and no branch/worktree token**. The server only validates
  `previewUrl`; it never rewrites it. So a single `previewUrl` cannot follow the branch.
- **Scripts get** `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` in their environment, and
  their cwd is the worktree. That is where the branch is available — inside the script, not in
  `previewUrl`.
- **"Local servers" discovery.** This is the per-worktree mechanism that exists.
  - A `PortDiscovery` service polls listeners every 3 s (via `lsof`, `/proc`, or the Windows
    listener path) and keeps only those **owned by the thread's terminals or agents**.
  - It probes each one for an HTML response.
  - The empty preview then shows "Local servers this thread starts will show up here
    automatically", and one click opens that server.
  - Each thread therefore sees its own worktree's dev server, but as `http://localhost:<port>`,
    not as the branch name. `T3CODE_PORT_DISCOVERY=0` disables it.
  - This is most likely what Pablo uses in the other project. No `t3.json` on this machine
    other than nf-stack's sets a `previewUrl`, and no stored project script contains a
    placeholder.
- **Clicking a terminal link.** Links printed in a T3 terminal are clickable. With the setting
  `browserLinkTarget: "app"` they open in the in-app preview; on this machine it is `"system"`.
- **Agents** can open any URL in the preview through T3's preview tools (`preview_open`).

Closest working setups that keep the subdomain named after the branch:

1. **Recommended.** `wtp up` prints `https://<branch>.<app>.localhost` (from `portless get`) as
   the first stdout line, and the Dev script has no `previewUrl`. With `browserLinkTarget: "app"`,
   one click opens the branch URL in T3's preview. If nobody clicks, "Local servers" still lists
   the thread's own dev server automatically (port URL). When an agent runs the stack, it calls
   `preview_open` with `wtp url web`.
2. **Main-checkout only.** Pass `--preview-url https://lumen.localhost` (no prefix on
   `main`/`master`) to get `autoOpenPreview` in the main checkout. Worktree threads would open
   main's app, so this is not the default.
3. **Not viable:** a fixed per-repo alias that `up` repoints to the current worktree
   (`portless alias`). It is per machine, not per thread, so two running worktrees fight over
   it.
4. **T3 feature request:** expand `${env:VAR}` or a `{branch}` / `{worktree}` token in
   `previewUrl` before `ph`. `wtp` could then write
   `previewUrl: "https://{branch}.lumen.localhost"`.

## 6. Server-to-server calls by name without admin

| Option | Works for | Keeps the branch HTTPS name | Setup | Weak points |
| --- | --- | --- | --- | --- |
| A. `up` injects `http://127.0.0.1:<port>` | Any language | No: plain HTTP straight to the app, a different origin from the browser, cookies/CORS differ | `up` must read `portless list --json` after start; dependents restart when a port changes | Port changes every run; differs from what the browser uses |
| **B. `--import` DNS preload** (`preload/localhost-dns.mjs`) | Node (fetch/undici, `http`, `https`, `dns.promises`). Bun `fetch` already resolves `*.localhost` itself | Yes; same URL as the browser | `up` adds `NODE_OPTIONS=--import=file:///…/localhost-dns.mjs`; portless already adds the CA | Node only; Bun `node:https` and non-JS servers are not covered |
| C. `portless hosts sync` | Everything | Yes | One elevated shell **per new route**, so every new branch | Needs admin each time; breaks the no-admin goal |

**Recommendation: B by default for Node stacks, A as the automatic fallback for non-Node stacks,
C only on Pablo's explicit choice.** Evidence:
- B passed by itself (rows 3–5).
- B passed inside a `portless run` with only `NODE_OPTIONS` added.
- B is tested in `test/preload.test.ts`: Node `fetch` reaches
  `feat-alpha-search.api.lumen.localhost:<port>`, and `dns.promises.lookup` answers while other
  names are left alone.

## 7. Recommended design

Working name `worktree-ports`, binary `wtp` (still provisional). "treeport" was a coined word:
work*tree* + *port*. Other candidates: `wtport`, `lanes`, `forkport`.

**Wrap the portless CLI**: it has a stable `--json` contract and owns worktree naming. Pin its
version as a dependency.

| Command | Does |
| --- | --- |
| `wtp detect [--json]` | Implemented |
| `wtp t3 scripts` | Implemented: writes or merges `t3.json` by name |
| `wtp setup [--quiet]` | Once per machine: start the proxy, trust the CA with no timeout, check for Docker in WSL. No-op when ready (`runOnWorktreeCreate`) |
| `wtp up` | Per stack: `portless run --name <app>` with `PORTLESS_PREFIX=<sanitized branch>` and the proxy on `--skip-trust`. Injects the API URL into fronts and `NODE_OPTIONS` (preload) into Node stacks. Prints the branch URLs, front first |
| `wtp e2e [--headed\|--ui] [-- args]` | Host by default: injects `BASE_URL` (or the wrapper config) and `NODE_OPTIONS=--use-system-ca` |
| `wtp e2e --docker` | Opt-in: derived image matching the installed Playwright, Windows bridge + in-container bridge, NSS import of the CA |
| `wtp url <stack>` | `portless get` with the same prefix |
| `wtp doctor [--json]` | portless doctor + CA in the user Root store + WSL gateway + image/version checks |

Config: none by default. An optional `wtp.json` can override detected names, the API env var,
the e2e command and the image.

## Cleanup

Everything started by the spike was stopped (stacks, bridges, containers, proxy). To remove
portless:

```sh
portless proxy stop
portless clean --yes
certutil -delstore -user Root "portless Local CA"   # only if clean leaves it
npm rm -g portless
```

Fixture: run `git worktree remove` on both worktrees, then delete
`C:\Desarrollo\scratch-portless-fixture`.

Images:
`wsl -d Ubuntu-24.04 -- docker rmi wtp-playwright:1.56.1 mcr.microsoft.com/playwright:v1.56.1-noble`.
