# Contributing to Shadowdark Enhancer

Thanks for looking. This is a Foundry VTT module for the Shadowdark RPG system,
so most contributions are Foundry work rather than generic frontend work — the
notes below are the things that actually catch people out.

## Getting set up

The module lives in your Foundry data directory, so the simplest setup is to
clone it straight into place:

```bash
git clone https://github.com/DimitroffVodka/shadowdark-enhancer.git \
  ~/FoundryVTT/Data/modules/shadowdark-enhancer
cd ~/FoundryVTT/Data/modules/shadowdark-enhancer
npm install
```

Enable the module in a test world and you're running your working copy.

> Editing `module.json` — including the actor sub-types — needs a **world
> relaunch**, not a browser reload. Editing scripts, templates or CSS only needs
> a reload (`Ctrl+Shift+R`, because a plain reload will not refetch module CSS).

## The gates

Two commands, both of which must pass before a pull request:

```bash
npm test          # node:test — unit tests plus the contract tests
npm run lint      # eslint, --max-warnings 0
```

For anything touching the combat / crawl / initiative state machine, also run
the in-client **Quench** batches (`test/quench/`). Install the
[Quench](https://foundryvtt.com/packages/quench) module and run
`shadowdark-enhancer.combat-state` from its dialog. It guards real regressions —
notably the combat-start flow that once enrolled every player token twice.

## Compatibility priorities

In rough order of how often they bite:

- **Foundry v13+ / v14 API.** Use the namespaced APIs
  (`foundry.applications.*`, `foundry.utils.*`); the globals still work but
  emit deprecation warnings.
- **Hook names.** `renderChatMessageHTML`, not the legacy `renderChatMessage`.
- **Shadowdark 4.x data model.** Read values through the system's own getters
  rather than reaching into `system.*` where a getter exists.
- **ApplicationV2 render lifecycle.** Most windows here are ApplicationV2 with
  Handlebars parts.
- **Multi-GM safety.** Anything that writes world state from a hook should be
  gated to the single active GM (`game.users.activeGM`), or several connected
  GMs will each perform it. The loot, merchant, session-recap and content-sweep
  code all follow this pattern — copy it.

## The content contract

Non-negotiable, because users trust it with their worlds:

- Every document-creating entry point is **GM-only**.
- **Nothing is overwritten silently, and nothing is ever deleted.** The module
  does not call `deleteCompendium`. Conflicts prompt; re-importing is idempotent.
- **No sourcebook prose ships in this repo.** The importers carry structure —
  names, page citations, dice formulas, table layout — and users paste the text
  from books they own. Do not add rules text, stat blocks, or table contents.
- **No third-party artwork is redistributed.** Token art is referenced from what
  the user already has installed, by path.

## Documentation is part of the change

`docs/wiki/` is the user-facing manual — one page per feature — and `README.md`
is its landing page. **They are part of the feature, not a follow-up.** A change
that alters what a GM sees or does is not finished until the matching page is.

`npm test` enforces the *inventory* half of this via
`test/docs-contract.test.mjs`. It fails when:

- a `config: true` setting is missing from `docs/wiki/Settings-Reference.md`;
- a `game.shadowdarkEnhancer` namespace is missing from `docs/API.md`;
- a documentation link or image points at a file that doesn't exist;
- a `#anchor` points at a heading that isn't there;
- an image in `docs/wiki/images/` is unreferenced, or a wiki page is unlinked;
- `languages/en.json` carries `SDE.settings.*` strings with no registered setting.

The contract cannot check prose. **When you change any of these, update the page
in the same commit:**

| You changed | Update |
|---|---|
| A setting's default, label, or behaviour | `Settings-Reference.md` **and** the feature page that explains it |
| A window's buttons, tabs, or fields | That feature's page — button labels are quoted verbatim in the docs |
| The public API surface | `docs/API.md` |
| A pack id, folder convention, or link-resolution rule | `Compendium-Packs.md` |
| Anything a user could plausibly hit as a bug | That page's **Troubleshooting** section |

**Quote real UI labels.** Read them from the source or from the running window,
not from memory. A documentation audit found the README describing a setting
that had never existed, a wrong default, a UI dropdown that wasn't there, and
four wrong button labels — every one of them written from recollection.

### Screenshots

Screenshots live in `docs/wiki/images/`. If your change makes one wrong, either
re-shoot it or replace it with a marker so the gap is visible:

```html
<!-- TODO screenshot: images/thing.png — caption
     How: <the steps to reproduce this view> -->
```

Do not leave a stale image in place. Two gotchas if you script the capture:
`html2canvas` fails on Foundry v14's `color()` CSS — use `html2canvas-pro` — and
it renders the children of a **closed** `<details>` element, so set
`display: none` on collapsed section bodies first or their content bleeds
through the headers.

## Evidence, not adjectives

Please don't describe something as verified, fixed, or tested without saying how
you know. Paste the test output, the command result, or the `file:line` that
proves it. Static analysis is fine — just label it as such ("verified by grep").
If something can't be verified, say so and say what would prove it.

Where practical, exercise the change in a live Foundry world and note the
Foundry and Shadowdark versions you saw it work on.

## Localization

The module is **English-only by design**. `languages/en.json` exists and some
templates use `localize`, but full string extraction is deliberately deferred:
much of the UI renders GM-imported book content verbatim, so translated chrome
around untranslated content buys little.

Please don't add translation keys for their own sake — plain English strings in
templates and controllers are the house style until a real localization pass is
scheduled. Settings are the exception: they conventionally use
`SDE.settings.<key>.name` / `.hint`, though a few use literal strings and that's
accepted.

## Pull requests

- Branch off `master`.
- Keep changes focused; a PR that fixes one thing is far easier to review.
- Note in the description how you verified it, and on which Foundry / Shadowdark
  versions.
- Update `CHANGELOG.md` for anything user-visible.

## Licence

By contributing you agree that your contributions are licensed under the
project's [MIT licence](LICENSE).
