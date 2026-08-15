# Shadowdark Enhancer — agent contract

A Foundry VTT module for the Shadowdark system: `shadowdark-enhancer`,
currently **v0.13.1**, Foundry compatibility `minimum: 13`, `verified: 14.365`.
Default branch is **`master`**, not `main` — fetching `main` returns nothing and
makes the repo look empty.

## Layout

| Path | What it is |
|---|---|
| `scripts/` | the module |
| `test/` | `node --test` suites |
| `tools/inventory/` | the inventory generator and its check mode |
| `templates/`, `styles/`, `languages/`, `assets/`, `icons/` | the usual Foundry parts |
| `docs/` | user documentation |

## Commands

```bash
npm run lint            # eslint scripts test --max-warnings 0  (zero-warning gate)
npm run lint:fix        # the same, with fixes applied
npm test                # node --test test/*.test.mjs
npm run inventory       # regenerate the inventory
npm run inventory:check # fail if the committed inventory is out of date
```

`inventory:check` is the one that catches a stale commit — run it before
calling anything done, not just the tests.

## Standing on its own

This module has **no hard dependency** on `shadowdark-extras`; it recommends it
at a verified version for imported-spell automation. That independence is a
design decision, not an accident: **the enhancer must remain useful when
`shadowdark-extras` is absent.** Anything that only works when SDX is installed
belongs behind a feature check.

The coupling that does exist is deliberate and narrow, and both sides are a
contract:

- SDX delegates renown awards to `game.shadowdarkEnhancer.renown.award` when it
  is available.
- This module reads SDX's `carousingSession` and `carousingDrops` flags, uses
  its alignment flags, and integrates on the Medkit paths.

Changing either side without the other is how a working install breaks.

## What must not change without a migration

The package id, the `game.shadowdarkEnhancer` namespace, settings and flag keys,
and the names of the world packs this module creates at runtime
(`shadowdark-enhancer--actors`, `--items`, `--roll-tables`, `--journals`,
`--scenes`). Existing worlds hold persisted references to all of them.

## Knowledge base — read before you change anything

The reasoning behind this module lives outside the repo, in Patrick's knowledge
base at `~/wiki`, exposed to any LLM by the `wiki` MCP server.

- **Before changing anything**, call `project_brief(project: "shadowdark-enhancer")`. One call
  returns what currently ships, the architecture, the Key Decisions and Gotchas,
  the recent work journal, and whether this tree is dirty right now.
- **After finishing a piece of work**, call
  `append_worklog(project: "shadowdark-enhancer", ...)`. `why` is required. `tried` is the
  valuable field: a dead end never reaches a commit, so the worklog is the only
  place it can survive for the next model.
- Browse it at <http://localhost:8080/wiki/projects/shadowdark-enhancer/>.

Without the MCP server, read `~/wiki/wiki/projects/shadowdark-enhancer/index.md` and its
`worklog.md` directly, and follow the contract in `~/wiki/CLAUDE.md`.

<!--
  CLAUDE.md in this repo is a symlink to this file. Keep it that way.
  Hermes loads exactly ONE project context file per session, first match wins:
  .hermes.md -> AGENTS.md -> CLAUDE.md -> .cursorrules. If the two ever hold
  different content, Hermes reads this one and silently never opens the other.
  See ~/wiki/wiki/research/good-agent-instruction-files.md.
-->
