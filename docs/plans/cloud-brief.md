# Brief for cloud sessions

This clone has no CLAUDE.md and no memory, so these rules apply to any cloud session working on this module.

## Rules
- Every user-facing string comes from `languages/en.json` (templates, notifications, dialog buttons).
- No AI attribution anywhere: no `Co-Authored-By` trailer, no "Generated with Claude Code" in commits, branches or PR text.
  Before committing run `git config user.name Dimitroffvodka && git config user.email dimitroffvodka@gmail.com`.
- Do not bump the version in `module.json` (`npm run inventory` changes its build stamp; that is fine).
  Add one plain `CHANGELOG.md` `[Unreleased]` line per commit.
- Never rename the package id, the `game.shadowdarkEnhancer` namespace, settings or flag keys, or pack names.
  Flag writes go through `replaceModuleFlag` in `scripts/shared/module-flags.mjs`, never a raw
  `update({"flags.<mod>.<key>": v}, {recursive: false})`.
- Foundry v14 only; no new dependencies; no wiki tools.
- Never touch a live world. You cannot run Foundry, a browser or the design harness: never claim you saw a window.
- Player-facing controls on an ActorSheetV2 must be anchors, not buttons (the sheet disables buttons for viewers who cannot edit).

## How a window is changed
1. `npm install` (no lockfile). Branch from `origin/master` as named in the task.
2. Read `docs/design-contract.md` and `docs/plans/window-redesign.md` (sections 3 and 5).
   The shared kit is `styles/sde-ui.css` (tokens `--ui-*`, parts `ui-*`); window roots carry the class `sde-ui`.
3. The approved design for each window is in `tools/design-harness/`: `proposed/templates/<name>.hbs`,
   `proposed/css/<name>.css`, and `fixtures/*-proposed.mjs` (markup, classes and context shape; reference only).
   Swap the real template to it, keeping hook classes and `data-action` names the JS uses; change the JS where the
   proposal's context differs. Move the window's CSS into the module stylesheet and delete the old rules nothing uses.
   `STYLESHEET_REV` in `scripts/shadowdark-enhancer.mjs` is the first 12 hex chars of the sha256 of
   `styles/shadowdark-enhancer.css`; a test fails after any CSS change until it is updated.
4. Tests for logic you add or change.
5. Before each commit: `npm run lint` (zero warnings), `npm test`, `npm run inventory`, `npm run inventory:check`.
6. One commit per piece, conventional message, no attribution; push the named `claude/...` branch after each commit.
   Never open a pull request, never merge, never push master.
7. If a piece is blocked, skip it and say why.

## Final message
Per piece: commit hash, files changed, tests added, exact lint / test / inventory:check counts, anything skipped or unsure.
