# Design harness (Shadowdark Enhancer)

The engine (`shot.mjs`, `serve.mjs`, the fixture format, the layout check) lives in
foundry-mcp-live, `tools/design-harness/`; its README documents everything generic. This folder keeps
what is the module's own: `fixtures/`, the proposals kit, and the review gallery.

`serve.mjs` and `shot.mjs` here are thin wrappers that run that engine against this module, so
`npm run design`, `node tools/design-harness/shot.mjs <fixture>` and the other commands in
`CONTRIBUTING.md` work as before. They find the engine through `FOUNDRY_DESIGN_HARNESS` (the engine
folder), else `~/FoundryVTT-Projects/foundry-mcp-live` or `~/git/foundry-mcp-live`. The MCP tools
`render_fixture` and `preview_fixture` run the same engine (pass `module` = this checkout).

Windows built in JS (the crawl bar and strip) have no template. Capture their markup from a live world
(`document.querySelector(".shadowdark-enhancer-strip").outerHTML`) into a fixture with an `html` key; see
`fixtures/crawl-strip.mjs`. `fixtures/party.mjs` builds the real Party sheet's context with the sheet's own
helpers. The rules a window is held to are in `docs/design-contract.md`.

## Proposals and the review gallery

A fixture named `<window>-proposed.mjs` is the redesigned version of `<window>.mjs`. It is built with
`fixtures/_proposed.mjs`, which reuses the current fixture's context and states, swaps in a template from
`proposed/templates/`, and loads the shared kit `proposed/sde-ui.css` plus an optional `proposed/css/<name>.css` (tokens
only). `fixtures/kit-proposed.mjs` renders every kit part once. Proposals use the same context shape and `data-action`
names as the real templates so a swap needs no JS change except where a report says so. The helper also shows
`data-tooltip` on hover, which Foundry does and the harness does not.

    PORT=4300 node tools/design-harness/gallery-serve.mjs      # http://127.0.0.1:4300/

shows every window now and improved, dark and light, four panes each, with an Approve / Needs changes / Reject control and
a comment box per window. Reviews are saved to `~/.cache/sde-design-harness/review.json`. The gallery runs the harness
inside itself, so there is one address. Rejected proposals are archived in `proposed/rejected/`.

The harness caches the helper modules it imports; restart it after editing a fixture helper.
