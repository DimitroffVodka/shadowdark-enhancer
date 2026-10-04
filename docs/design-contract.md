# Window design contract

Status: rewritten 2026-10-04 from Patrick's review of the redesign proposals. It replaces the 2026-10-02 draft, which was
measured off the old Party sheet. The reference is now the Character Builder's look, built as a shared kit:
`tools/design-harness/proposed/sde-ui.css` (tokens `--ui-*`, parts `ui-*`). The plan to build it into the module is
`docs/plans/window-redesign.md`.

## Before you call a window done

1. Run the harness (`node tools/design-harness/serve.mjs`, or `PORT=4300 node tools/design-harness/gallery-serve.mjs`
   for the before and after gallery with review controls). See `tools/design-harness/README.md`.
2. Add or update a fixture for the window in the busiest state a user can reach (a very long name, every section shown).
3. Look at it in dark AND light, at its real width and at 420px. Read the screenshots; the harness box alone is not
   enough (it has no overlap check and counts only some primary buttons).
4. Nothing clipped, nothing overlapping, nothing scrolling sideways, text readable in both themes.

A window that has not been looked at, in both themes, is not finished.

## The look

Dark is the Character Builder's printed-rulebook palette: black page, white blackletter titles, silver frames, gold. Light is
the same book on warm paper. Both themes are first-class. Put the class `sde-ui` on the window root and use only the kit's
tokens; never a hard-coded colour in a window's own CSS and never a theme-specific selector (the tokens already switch).

Type, three roles: titles and tabs in the blackletter display face (digits come from the system's Montserrat), body in
Montserrat Medium 13px, labels in Montserrat SemiBold 10.5px uppercase muted. A value is bold, a label names it.

## Colour rules (Patrick's)

- Status colour is rationed to three: silver (neutral), the book's gold, and the Party health bar's dark crimson
  (`--ui-danger` `#9d2a3a` as a fill or border, `--ui-danger-text` for crimson text). Never salmon, pastel or neon.
- Green exists only for an on/off switch (`ui-switch`, for example Marching order) and the Bastion health bar (`ui-bar ok`).
  A character's health bar is crimson (`ui-bar hp`).
- No translucent coloured fills and no glows.
- Gold marks a selection or a warning, sparingly.

## Shape

- No pill-shaped chips or buttons. Chips and tags are square (2px) outlines. Buttons are 28px, radius 4px.
- Icon buttons are 24px. Nothing clickable is smaller than 22px in either direction.
- One primary button per screen (`ui-btn primary`, solid inverse), never a destructive action. Secondary actions are plain.
- Destructive confirms default to the safe choice and name the action with a verb, not Yes and No.

## Structure

Header band (name, image, three or four headline numbers), then tabs if there are several, then one scrolling body, then a
footer for the screen's actions. Header, tabs and footer never scroll. Content sits in cards, rows or under a heading;
no loose text on the page ground. Empty states are an icon and one sentence saying what to do. Tabs: prefer five or fewer;
more is fine when they are all used often and the row fits at 750px (it fills its width) and wraps cleanly narrower.

## Text and layout

- Every user-facing string comes from `languages/en.json`.
- A long name must never be cut by another label (the class sits under the name), and never push the controls out of line:
  names wrap or end in an ellipsis with the full text in a `data-tooltip`; control columns have fixed widths.
- Use container queries, not viewport media queries; a window is resized, the screen is not.
- A number that needs a unit or meaning gets its icon or label next to it; an icon alone means nothing.
- `data-tooltip` is Foundry's; the design harness shows it only through a shim (`fixtures/_proposed.mjs`).

## Exceptions

- Actor sheets (Mount, Warband, and the Shadowdark system's own) keep the system's parchment look; Shadowdark Extras
  restyles them. They are not built from the kit.
- HUD overlays (the crawl bar and strip, the Token HUD buttons) follow their host's own markup and are only checked for
  readability in both themes.
