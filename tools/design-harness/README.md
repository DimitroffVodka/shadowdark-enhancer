# Design harness

Renders a module template in a Foundry v14 window frame (core CSS, Shadowdark system CSS, this
module's stylesheets), with no world running. For checking how a window looks before it ships.

    node tools/design-harness/serve.mjs      # http://127.0.0.1:4177/

- Each file in `fixtures/` is one window: its template, a sample context, its title, classes and width.
  Use the busiest state a GM can reach, not the empty one.
- A fixture can be several screens: `initial`, `build(state)` and `actions` (a `data-action` click goes to
  a state, or toggles between two). Tabs, panels and wizard steps are clickable. Native controls
  (select, checkbox, details) work as they are. See `fixtures/party.mjs`.
- `/w/<fixture>` dark, `?theme=light`, `?w=420` to force a width. Edit a template or stylesheet and reload.
- The box bottom right counts visible buttons and primary buttons and lists layout problems
  (content sticking out sideways, text overflowing, tiny controls, sideways scroll).
- Paths: `FOUNDRY_APP` (default `~/FoundryV14/app`), `SDE_SYSTEM`, `PORT`.
- Not a Foundry: no module JS runs, helpers are stubs, and only the actions a fixture lists respond. A window built only from a template and CSS renders faithfully.

## From any agent (Claude, Hermes, anything with a shell)

Nothing here is tied to one tool. It is a plain node script (no install: it borrows Foundry's own Handlebars)
serving plain HTTP, and fixtures are plain `.mjs` data.

    node tools/design-harness/shot.mjs <fixture> [out.png] [--w=420] [--state=items] [--theme=light]

writes a PNG and prints the layout check, with no browser pane or MCP. It starts the server itself and needs
chromium or google-chrome on PATH (or `CHROME=/path`). An agent that can read images looks at the PNG; one that
cannot still gets the check lines. Or run `node tools/design-harness/serve.mjs` and open the gallery at
http://127.0.0.1:4177/ in any browser.

Windows built in JS (the crawl bar and strip) have no template. Capture their markup from a live world
(`document.querySelector(".shadowdark-enhancer-strip").outerHTML`) into a fixture with an `html` key; see
`fixtures/crawl-strip.mjs`.

The rules a window is held to are in `docs/design-contract.md`.
