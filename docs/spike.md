# Spike NF-051: per-worktree ports and names through portless

Attempts: A1, A2 and A3, 2026-11-19; A4, 2026-11-20. Repository `nf-ports`, binary `nfp`. Machine: Windows 11 Pro 10.0.26200, non-admin user,
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
| T3 | `nfp t3 scripts` writes or merges `t3.json` at the repo root by script name (implemented) |
| Per-worktree preview URL | No placeholder support in this T3 build. `nfp up` prints the branch URL as the first line, so with `browserLinkTarget: "app"` one click opens it in T3's preview (§5). Feature request posted as [discussion #38888](https://github.com/pingdotgg/t3code/discussions/38888) (`docs/t3-preview-url-issue.md`) |
| `nfp up` | Implemented and verified in both worktrees at once (§2b). Front↔back wiring, `<NAME>_PORT` backs and `nfp.json` added in A4 (§9) |
| `nfp setup`, `nfp e2e`, `nfp url` | Implemented in A4 and verified on the fixture worktrees (§9); `e2e --docker` not implemented |
| E2E with no window on screen | Browser projects are headless by default. For Electron: a hidden Win32 desktop needs no app change; an offscreen `showInactive()` env flag needs a small app change (§7) |

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
- trust once, interactively and with no timeout (`nfp setup`);
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
  better default because it follows the OS store that `nfp setup` populated.
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

## 2b. `nfp up` (A3)

`src/up/plan.ts` builds the launch plan; `src/up/run.ts` executes it.
- **Names.** From the root `portless.json` `apps` map when present. Otherwise the first front
  takes the root package name, and other stacks become `<package>.<root>` (`orbit-ledger` →
  `ledger.orbit`).
- **Prefix.** `PORTLESS_PREFIX` = the raw branch; portless sanitizes it. It is empty on
  `main`/`master`/detached HEAD.
- **Env.** Fronts get every API-URL key found in their `.env*` files (`VITE_API_URL` here) set
  to the first back's URL. Every non-Bun stack gets `NODE_OPTIONS=--import=<file URL of
  preload/localhost-dns.mjs>`, appended to any existing value.
- **Order of output.** `portless proxy start --skip-trust` runs with its output captured
  (idempotent: "Proxy is already running", exit 0). The URLs are resolved with
  `portless get --json`. Then the banner goes to stdout — **line 1 is the front's branch URL on
  its own**, then `name: url` per other stack. Only after that does each stack start, with
  `portless run --name <app>` in its directory and its output prefixed `[name]`.
- **Stopping.** Ctrl+C / SIGTERM stops every child tree (`taskkill /T` on Windows). Procfile
  and Nx stacks are listed as "not launched".
- `nfp up --print` prints the plan as JSON without starting anything.

Run in both fixture worktrees at the same time (`bun <repo>/src/cli.ts up`):

```
alpha stdout                                        beta stdout
https://feat-alpha-search.lumen.localhost           https://fix-beta-sync.lumen.localhost
api.lumen: https://feat-alpha-search.api.lumen...   api.lumen: https://fix-beta-sync.api.lumen...
[lumen] > vite --port 4526 --strictPort ...         [lumen] > vite --port 4992 --strictPort ...
```

`portless list` showed the four routes. e2e against each worktree's line 1
(`BASE_URL=$(head -n 1 up.out)`, no ignore flag) passed in both at once, 1.1 s each. Killing
the two `nfp up` trees left no listener on 4000–4999. Unit tests: `test/up.test.ts`.

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
| Docker, derived image `nfp-playwright:1.56.1` (Playwright + `libnss3-tools`), container start + NSS import + bridges | 47.35 (cold), 17.89, 17.89, 17.81, 18.29 s | 8.8–10.2 s | **~17.9 s warm** |

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

`nfp t3 scripts [dir] [--dry-run] [--json] [--bin <cmd>] [--preview-url <url>]` is implemented:
- It finds the repository root (works from a worktree, where `.git` is a file).
- It merges by trimmed script name. A nfp script replaces the fields it sets and keeps any extra
  fields; other scripts and top-level keys stay untouched; new scripts are appended.
- It adds `$schema` when missing, enforces the 50-script limit and the icon list, refuses to
  touch invalid JSON, and reports `created` / `updated` / `unchanged`. A second run reports
  `unchanged` and leaves the bytes the same.
- Tests: `test/t3.test.ts`.

Output on the fixture (`--bin "bunx nfp"`):

```json
{
  "$schema": "https://t3.codes/schema/t3.json",
  "scripts": [
    { "name": "Ports setup", "command": "bunx nfp setup --quiet", "icon": "configure", "runOnWorktreeCreate": true },
    { "name": "Dev (portless)", "command": "bunx nfp up", "icon": "play", "runOnWorktreeCreate": false, "stopOnSettle": true },
    { "name": "E2E", "command": "bunx nfp e2e", "icon": "test", "runOnWorktreeCreate": false },
    { "name": "E2E (hidden)", "command": "bunx nfp e2e --hidden", "icon": "test", "runOnWorktreeCreate": false }
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
  `browserLinkTarget: "app"` they open in the in-app preview. Pablo switched it to `"app"` in A3.
- **Agents** can open any URL in the preview through T3's preview tools (`preview_open`).

Closest working setups that keep the subdomain named after the branch:

1. **Recommended, implemented in A3.** `nfp up` prints `https://<branch>.<app>.localhost` (from `portless get`) as
   the first stdout line, and the Dev script has no `previewUrl`. With `browserLinkTarget: "app"`,
   one click opens the branch URL in T3's preview. If nobody clicks, "Local servers" still lists
   the thread's own dev server automatically (port URL). When an agent runs the stack, it calls
   `preview_open` with `nfp url web`.
2. **Main-checkout only.** Pass `--preview-url https://lumen.localhost` (no prefix on
   `main`/`master`) to get `autoOpenPreview` in the main checkout. Worktree threads would open
   main's app, so this is not the default.
3. **Not viable:** a fixed per-repo alias that `up` repoints to the current worktree
   (`portless alias`). It is per machine, not per thread, so two running worktrees fight over
   it.
4. **T3 feature request:** expand `${env:VAR}` or a `{branch}` / `{worktree}` token in
   `previewUrl` before `ph`. `nfp` could then write
   `previewUrl: "https://{branch}.lumen.localhost"`. Posted as [discussion #38888](https://github.com/pingdotgg/t3code/discussions/38888):
   [`docs/t3-preview-url-issue.md`](t3-preview-url-issue.md).

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

## 7. E2E with no window on screen (A3)

Question: can e2e run on the host with no Docker and with no browser or Electron window popping
up or taking focus? Inspected read-only in an Electron + web project that uses Playwright 1.65
and Electron 45. Measured in a throwaway Electron fixture
(`C:\Desarrollo\scratch-electron-hidden`, "Driftwood", same Electron and Playwright versions).

### 7a. Browser projects

Playwright browser projects are **headless by default**. Nothing in that project forces headed:
the config sets no `headless`, `channel` or `launchOptions`, the package scripts pass no
`--headed`/`--ui`/`--debug`, and no `PWDEBUG` is set. The one explicit launch in the specs is
`chromium.launch({ headless: true })`. Browser windows appear only with `--headed`, `--ui`,
`--debug` or `PWDEBUG=1`.

### 7b. Electron (`_electron.launch` has no headless mode)

In the inspected app, `createWindow()` uses `new BrowserWindow({ show: false, … })` and then
`once("ready-to-show", () => win.show())`. On Windows, `show()` activates the window, so it jumps
in front. The `second-instance` handler also calls `show()` + `focus()`, and one spec exercises
it. All 14 `electron.launch` sites spread `process.env` into the app, so a variable set when
Playwright starts reaches the app.

Measured in the fixture (one spec: render, fill, click, CSS transition, 500 ms of
`requestAnimationFrame`, screenshot):

| Mode | App change | On screen / focus | rAF frames in 500 ms | Screenshot | Wall |
| --- | --- | --- | --- | --- | --- |
| Default (`show()`) | — | visible, **focused** | 52 | ok | 2.98 s |
| `show: false` never shown + `paintWhenInitiallyHidden` + `backgroundThrottling: false` | env flag | not visible, not focused | **0** (rAF stops; the transition still ends) | ok | test failed on the rAF check |
| **Offscreen: `x/y = -32000`, `skipTaskbar`, `showInactive()`** | env flag | off every monitor, **not focused**, no taskbar button | 52 | ok | 2.26–2.60 s |
| **Hidden Win32 desktop** (`CreateDesktop` + `STARTUPINFO.lpDesktop`), app unchanged | none | visible and focused only on a desktop nobody looks at | 53 | ok | 2.65 s |
| WSL2 Docker `xvfb-run` (image = Playwright 1.65 + Electron 45, sources mounted, `--no-sandbox`) | none (Linux build of the app) | inside Xvfb | 31 | ok | 2.23–2.77 s warm; once: base pull 89 s, image build 28 s |

Findings:
- **Never showing the window is not safe**: Chromium stops `requestAnimationFrame` for a window
  that was never shown, even with `paintWhenInitiallyHidden` and `backgroundThrottling: false`.
  Animation libraries, virtualized lists and anything waiting on rAF would hang.
- **The offscreen inactive window** keeps the page "visible" (rAF, transitions, screenshots,
  focus inside the page all work) and never activates. It is the best app-side option.
- **The hidden Win32 desktop needs no app change.**
  - A launcher creates a desktop object on the user's window station and starts
    `npx playwright test` with `lpDesktop` set to it. Every child (Electron, Chromium, web
    servers) inherits it.
  - It was verified with the unmodified default mode: the window was shown and focused, but
    only on that desktop.
  - Caveats: it is Windows-only. The launcher is about 40 lines of C#/PowerShell P/Invoke (
    `scripts/hidden-desktop.ps1`, the exact launcher used for the measurement). Nobody can watch or debug
    the run on screen. "Invisible on Pablo's desktop" follows from how Windows desktops work, but
    it still needs his visual confirmation.
- **A second virtual desktop (Win+Ctrl+D) is not a fit.** New windows open on the active
  virtual desktop. Moving another process's window there needs the undocumented
  `IVirtualDesktopManagerInternal` COM interface or a third-party tool, and it would still flash
  first.
- **WSL/Docker + xvfb** is fast for a small app once the image exists. For a real app it also
  needs a Linux build (Linux Electron binary, native modules, pnpm install inside the container)
  and network paths to the backend/database. That is the CI-like option, not the everyday one.

### 7c. How `nfp e2e` exposes it

- `nfp e2e --hidden` sets `NFP_E2E_HIDDEN=1` for the Playwright process. An app opts in by
  naming its own variable in `nfp.json` (`"e2e": { "hiddenEnv": "APP_E2E_HIDDEN_WINDOW" }`), and
  nfp sets that too.
- When no variable is declared, or `--hidden=desktop` is passed, nfp starts Playwright on a
  hidden Win32 desktop (`nfp-e2e-<branch>`) and streams its output back through a log file. The
  exit code is the test exit code.
- Browser projects need nothing: nfp just doesn't pass `--headed`. `--headed`/`--ui` and
  `--hidden` are mutually exclusive.
- `--docker` stays the isolated option.

## 8. Recommended design

Name decided in A3: repository `nf-ports`, binary `nfp`. `--bin` defaults to `nfp`, which Pablo installs globally.

**Wrap the portless CLI**: it has a stable `--json` contract and owns worktree naming. Pin its
version as a dependency.

| Command | Does |
| --- | --- |
| `nfp detect [--json]` | Implemented |
| `nfp t3 scripts` | Implemented: writes or merges `t3.json` by name |
| `nfp setup [--quiet]` | Implemented: start the proxy, trust the CA with no timeout. No-op when ready (`runOnWorktreeCreate`). Docker check deferred with `--docker` |
| `nfp up [--print]` | Implemented. Per stack: `portless run --name <app>` with `PORTLESS_PREFIX=<sanitized branch>` and the proxy on `--skip-trust`. Injects the API URL into fronts and `NODE_OPTIONS` (preload) into Node stacks. Prints the branch URLs, front first |
| `nfp e2e [--headed\|--ui] [-- args]` | Implemented: injects `BASE_URL` (or the wrapper config) and `NODE_OPTIONS=--use-system-ca` + preload |
| `nfp e2e --hidden` | Implemented (§7c, §9). Sets the app's env var when `nfp.json` names one, otherwise runs on a hidden Win32 desktop |
| `nfp e2e --docker` | Not implemented. Opt-in: derived image matching the installed Playwright, Windows bridge + in-container bridge, NSS import of the CA |
| `nfp url [app]` | Implemented: `portless get` with the same prefix |
| `nfp doctor [--json]` | portless doctor + CA in the user Root store + WSL gateway + image/version checks |

Config: none by default. An optional `nfp.json` overrides names, roles and the port variable per
app, adds env with `{url:<app>}` / `{branch}` templates, and picks the e2e config, the app's hidden
variable and extra e2e env (README).

## 9. A4: `setup`, `e2e`, `url` and front/back wiring (2026-11-20)

### Front and back in one workspace

`nfp up` now also:
- sets origin keys found in a back's `.env*` (`CORS_ORIGIN(S)`, `ALLOWED_ORIGIN(S)`, `ORIGIN`,
  `FRONTEND|FRONT|WEB|APP|CLIENT|SITE|UI|PUBLIC` + `_URL|_ORIGIN`) to the first front's URL;
- detects a server entry that reads `<NAME>_PORT` instead of `PORT`, picks a free port in
  4000–4999, passes it with `portless run --app-port` and sets that variable;
- applies `nfp.json` (`name`, `role`, `portEnv`, `env` templates) and prints stack warnings;
- warns in `detect`/`up` when a dev script pins `--port N` for a framework that portless only
  moves through `PORT` (Next `--port 3100` in orbit-turbo). Not fixed automatically.

Not covered yet: Vite `server.proxy` / Next `rewrites` with a literal target, more than one back
per front (the first back wins unless `nfp.json` says otherwise), Compose services, non-JS stacks.

### `nfp e2e`

- Picks the first Playwright config (or `e2e.config`), else Cypress, and refuses to run when
  `portless list` has no route for this worktree's front.
- Playwright with `baseURL` from env and a conditional `webServer`: sets that variable.
  With a literal `baseURL` or a `webServer: {…}`/`[…]` literal: writes
  `.nfp-playwright.config.<ext>` next to the config (spreads it, drops `webServer`, sets
  `use.baseURL` and each project's), passes `--config`, deletes it afterwards.
- Cypress: `CYPRESS_BASE_URL`, `cypress run` or `open` with `--ui`.
- `NODE_OPTIONS` gets `--use-system-ca` and the DNS preload. `ELECTRON_OVERRIDE_DIST_PATH` and the
  rest of the environment pass through untouched.
- `--hidden`: `NFP_E2E_HIDDEN=1` plus `e2e.hiddenEnv=1` when declared; with no declared
  variable, or `--hidden=desktop`, `scripts/hidden-desktop.ps1` runs the command on desktop
  `nfp-e2e-<branch>`. Output is redirected to a temp log that nfp tails, and the exit code is the
  runner's.

### Evidence (fixture worktrees alpha and beta, plus a throwaway gamma)

| Check | Result |
| --- | --- |
| `nfp setup` with the proxy stopped and the CA already trusted | `proxy: running`, `CA: trusted`, 9.3 s (proxy cold start); 3.5 s when the proxy runs |
| `nfp up` in alpha and beta at once | 4 routes; first lines are the branch URLs |
| `nfp url`, `nfp url api` in alpha | `https://feat-alpha-search.lumen.localhost`, `…api.lumen.localhost` |
| `nfp e2e` in alpha and beta at once | 1 passed each. Cold runs took ~30 s; plain `npx playwright test` also took 38 s cold, so it is machine warm-up. Warm: 1.0–1.4 s test time, same as without nfp |
| `nfp e2e --hidden` (desktop) in alpha | 1 passed (869 ms), output streamed back, exit 0; with a wrong `EXPECT_BRANCH`, 1 failed and exit 1. No log or wrapper left behind |
| gamma: api reads `API_PORT`, `.env` has `CORS_ORIGIN=http://localhost:5173`, `nfp.json` sets `RELEASE_LABEL: "{branch}"` and e2e `EXPECT_BRANCH: "{branch}"` | API answered `{"branch":"feat/gamma-wire","port":4484,"origin":"https://feat-gamma-wire.lumen.localhost","release":"feat/gamma-wire"}`, with portless reporting `Using port 4484 (fixed)` |
| gamma: Playwright with literal `baseURL` and an unconditional `webServer` | Wrapper config used, 1 passed (1.8 s) |
| After stopping the three `nfp up` trees | No routes; no nfp listener on 4000–4999 |

Unit tests: `test/config.test.ts`, `test/e2e.test.ts`, new cases in `test/up.test.ts` and
`test/detect.test.ts`, fixture `test/fixtures/harbor-split`.

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

Electron fixture: delete `C:\Desarrollo\scratch-electron-hidden`.

Images:
`wsl -d Ubuntu-24.04 -- docker rmi nfp-playwright:1.56.1 nfp-electron-xvfb:45.2.3 mcr.microsoft.com/playwright:v1.56.1-noble`.
