# worktree-ports

Bun CLI that gives each git worktree its own ports and `.localhost` name through
[portless](https://portless.sh), keeps e2e pointed at that worktree, and writes T3 Code project
scripts into `t3.json`. `preload/localhost-dns.mjs` lets Node resolve `*.localhost` without admin.
Working name; see `docs/spike.md` for the design and alternatives.

```sh
bun install
bun src/cli.ts detect [dir] [--json]
bun src/cli.ts t3 scripts [dir] [--dry-run] [--bin <cmd>]
bun run verify   # lint, typecheck, tests
```
