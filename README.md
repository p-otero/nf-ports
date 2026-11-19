# worktree-ports

Bun CLI that gives each git worktree its own ports and `.localhost` name through
[portless](https://portless.sh), keeps e2e pointed at that worktree, and prints T3 Code project
scripts. Working name; see `docs/spike.md` for the design and alternatives.

```sh
bun install
bun src/cli.ts detect [dir] [--json]
bun run verify   # lint, typecheck, tests
```
