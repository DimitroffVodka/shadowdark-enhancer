# Window design contract

Status: draft 2026-10-02, taken from the Party sheet (`templates/party/party.hbs`,
`styles/party-sheet.css`), which Patrick named as the reference window. Numbers below
were measured off it in the design harness, not guessed. They were measured off the
sheet as it was on 2026-10-02; the Party sheet was redesigned on 2026-10-03 (one
compact header, two-column member cards, a status bar) and keeps these colours, type
roles and card rules, with its own `sdp-` classes. Anything under "Proposed" is
not in the Party sheet and needs Patrick's yes.

## Before you call a window done

1. `node tools/design-harness/serve.mjs` (see `tools/design-harness/README.md`).
2. Add or update a fixture for the window, in the busiest state a user can reach.
3. Screenshot it at its real width and at `?w=420`. Look at it.
4. The box bottom right must say `no layout problems found` and show the button count you meant.

A window that has not been looked at is not finished.

## What the Party sheet does

**Structure.** Three bands: a header that says what this is (name, image, 3-4 headline numbers),
a tab row of 5 or fewer, and one scrolling body. The header and tabs never scroll.

**Surface.** One near-black ground `#0a0a0a`. Raised things sit on it as bordered cards, never as
a second ground colour. Cards: `1px solid #333`, radius 6px, padding 12px, gap 15px between parts.
Body padding 15px. Small chips (stats, abilities): `#1a1a1a` or `rgba(0,0,0,.3)`, radius 4px, padding 4px 8px.

**Type: three roles, no more.**

| Role | Face | Size | Used for |
|---|---|---|---|
| Display | Old Newspaper Font | 28 title, 18 tabs, 13 section rules, 11 buttons | the window's own name, tabs, button labels |
| Body | Signika | 14 (16 bold for a card's name) | what the user reads |
| Label | Signika | 11, uppercase, `#888` | the name of a value, never the value |

Value `#e0e0e0` bold 14, directly beside or under its label. Secondary text `#888`, italic for a
category (the class under a name). Gold `#e6d19b` is for section rules only, a line under a heading.

**Grouping.** One card is one thing (one member). Inside it: name line, a row of label/value pairs,
a row of chips. A heading (`#888`, 14, bold) sits above a group of cards, with no box of its own.

**Controls.** Buttons are 24px tall, `#1a1a1a`, `1px solid #333`, radius 4px. They come in pairs at most
per row, and each row is something you do to the whole body (Camp, Carouse), not to one card.
Per-card actions are small icon links that appear on the card.

**Empty states.** A big muted icon and one sentence saying what to do.

## Rules

- No text sitting loose on the window ground: every piece of text is inside a card, chip or heading.
- One primary action on a screen. Everything else is secondary.
- Nothing is wider than the window; nothing scrolls sideways; the harness checks both.
- A control is at least 22px in both directions.
- 5 or fewer tabs. 8 or fewer buttons visible at once. If you need more, the window is two windows
  or a wizard.
- Every user-facing string comes from `languages/en.json`.

## Proposed (not in the Party sheet)

- **Wizard screen.** One sentence of what happens, one big button (the only primary), a quiet
  "Skip" or "Back" link, a row of dots showing the step. Nothing else on screen. Built from the
  card and type rules above; the button is the one exception to the 24px height (40px, Display 16).
- **Tokens.** The Party sheet keeps its colours as `--party-*` on `.sde-party`. Hoist them to
  `--sde-*` on `.application.shadowdark` so every window shares one set. Not done yet.
- **Window title.** Shadowdark's `.shadowdark h1` renders every window title at 40px. The harness
  shows it; a one-rule reset under `.application.shadowdark .window-title` would fix all windows
  (see the worklog entry of 2026-10-03).
