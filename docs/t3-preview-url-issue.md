# Feature request: per-thread variables in a script's `previewUrl`

Status: posted 2026-11-19 by p-otero as discussion [pingdotgg/t3code#38888](https://github.com/pingdotgg/t3code/discussions/38888) (Ideas). Related closed PR: [#21222](https://github.com/pingdotgg/t3code/pull/21222), per-worktree preview ports, closed pending agreement on scope.

## Summary

Let a project script's `previewUrl` (in `t3.json` and in project settings) contain variables
that T3 expands per thread before it opens the preview. Examples: `{branch}`, `{worktree}` and
`${env:VAR}`.

Today `previewUrl` is one literal string per project. Every worktree thread therefore opens the
same URL, even though each thread runs its own dev server under its own name.

## Use case

Several worktree threads of one repository run their dev stacks at the same time. A local
reverse proxy such as [portless](https://portless.sh) gives each worktree a stable name derived
from its branch:

| Thread branch | Front-end URL |
| --- | --- |
| `main` | `https://acme.localhost` |
| `feat/search` | `https://feat-search.acme.localhost` |
| `fix/sync` | `https://fix-sync.acme.localhost` |

The names matter more than the ports:
- Cookies, OAuth redirect URIs and CORS origins stay stable across restarts.
- The port changes on every run.
- End-to-end tests and agents use the same URL as the human.

The project wants one shared script in `t3.json`:

```json
{
  "name": "Dev",
  "command": "acme-dev up",
  "icon": "play",
  "runOnWorktreeCreate": false,
  "previewUrl": "https://{branch}.acme.localhost",
  "autoOpenPreview": true
}
```

When it runs in the `feat/search` thread, T3 should open
`https://feat-search.acme.localhost` in the preview.

## Current behaviour (desktop build, nightly)

- When a script with `autoOpenPreview` runs, the client opens the preview at the script's
  `previewUrl` after normalizing it: it adds a scheme, validates the protocol and maps loopback
  hosts for remote environments. The value is never expanded.
- The script's terminal already knows the context: cwd is the worktree, and
  `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` are set. Only `previewUrl` cannot use it.
- Workarounds today, each with a cost:
  - Print the URL from the script and click it in the terminal. With the link target set to
    the in-app browser this opens the preview, but it needs a click every time.
  - The "Local servers" list in an empty preview shows the thread's own listeners. It
    identifies the right server, but as `http://localhost:<port>`, so the name, cookies and
    OAuth callbacks are lost.
  - Leave `previewUrl` empty, or point it at the main checkout's URL. Worktree threads then
    open the wrong app.

## Proposal

Expand variables in `previewUrl` when the script runs, before normalization, using the thread
that runs it.

| Variable | Value | `main` thread / no worktree |
| --- | --- | --- |
| `{branch}` | Current branch as a DNS label: lowercase, any character outside `[a-z0-9-]` becomes `-`, repeated `-` collapse, leading/trailing `-` trimmed, longer than 63 characters truncated with a short hash | empty |
| `{branch:raw}` | Branch name, URL-encoded | branch name |
| `{worktree}` | Basename of the worktree directory, as a DNS label | empty |
| `${env:NAME}` | Value of `NAME` from the script's environment. Limited to `T3CODE_*` plus names the project lists, so secrets cannot leak into URLs | — |

Rules:
- An empty `{branch}` or `{worktree}` also removes one adjacent `.`, so
  `https://{branch}.acme.localhost` becomes `https://acme.localhost` on `main`. This matches how
  per-branch proxies name the default branch.
- `{{` and `}}` stand for literal braces. Unknown variables leave the URL unchanged and show a
  warning in the script editor.
- Expansion happens per run. The stored value keeps the variables, so importing the script from
  `t3.json` and editing it in project settings both keep working.
- The schema description of `previewUrl` documents the variables. `t3.json` validation accepts
  them.

## Acceptance criteria

1. In a worktree thread on `feat/search`, `previewUrl: "https://{branch}.acme.localhost"` with
   `autoOpenPreview: true` opens `https://feat-search.acme.localhost`.
2. In the local checkout on `main`, the same script opens `https://acme.localhost`.
3. Two worktree threads running the script at the same time each open their own URL.
4. A `previewUrl` without variables behaves exactly as today.
5. `${env:T3CODE_WORKTREE_PATH}` expands; `${env:SOME_SECRET}` does not unless the project
   allows it.

## Alternatives considered

- A script output hook ("open the first URL this script prints") would also solve it and
  follows whatever the dev server reports. It is less predictable when a script prints several
  URLs.
- Let the "Local servers" entry carry a display URL reported by the server or a proxy. That is
  more general, but needs a protocol for the server side.
