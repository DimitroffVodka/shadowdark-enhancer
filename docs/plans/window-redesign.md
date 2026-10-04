# Window redesign: plan to build the approved proposals into the module

Status: written 2026-10-04 after Patrick's review of the proposals. Nothing in this plan is built yet. Every
proposal lives only under `tools/design-harness/` (fixtures `*-proposed.mjs`, `proposed/templates`, `proposed/css`,
the kit `proposed/sde-ui.css`). The module's real templates, scripts and stylesheets are unchanged.

## 1. What was decided

Look: the Character Builder's look is the base (black page, white blackletter titles, silver frames, gold accents), with
a real light theme on warm paper. Both themes are first-class, so every window must be read in dark and in light.

Rules from Patrick, to be built into the kit and the design contract:
- No pill-shaped chips or buttons. Chips and tags are square (2px) outlines. Buttons are 28px, one primary per screen.
- Nothing neon: no translucent coloured fills, no pastel or salmon status colours.
- Green only for an on/off switch (Marching order) and the Bastion health bar.
- Red is the Party health bar's crimson (`#9d2a3a` fill, `#d0405a` as text on dark), never salmon.
- Status colours are rationed to silver, the book's gold, and that crimson.
- Actor sheets (Mount, Warband) keep the Shadowdark system's own parchment look; Shadowdark Extras restyles them.
  Their kit proposals were rejected and archived in `tools/design-harness/proposed/rejected/`.
- No tab-count limit. Prefer five or fewer, more is fine when all are used often.
- Party sheet: keep the current layout and take only the kit's colours and fonts, plus the changes in section 4.

Review state (`~/.cache/sde-design-harness/review.json`, shown at the gallery on port 4300): 44 approved, 2 rejected
(Mount, Warband, replaced by the V2 branch), 1 unreviewed (`loot-setup`).

## 2. Order of work

Waves. A wave's PRs can run in parallel (separate worktrees); a later wave waits for the earlier one to merge.

| Wave | PR | Size | Depends on |
|---|---|---|---|
| 0 | A. Housekeeping: commit the kit, fixtures, gallery and harness changes; rewrite `docs/design-contract.md` | S | nothing |
| 0 | B. Warband sheet V2 (branch `feat/warband-sheet-v2`, commit a7a44dc3) | built, awaiting live test | nothing |
| 1 | C. Foundation: the kit as real module CSS, harness checks, quick wins on the current UI | M | A |
| 2 | D1-D4. Party sheet series (section 4) | L | C |
| 2 | E. Camping and Carousing (UI plus rule changes) | M | C |
| 2 | F. Chat cards, dialogs, Token HUD | M | C |
| 3 | G. Play-loop windows: Downtime window, Session Recap, Quest Log, Training, Pit Fighting, Encounter Roller and creator | L | C |
| 3 | H. Importers: hub, class, item, monster, spell, tables, adventure placer, token art manager | L | C |
| 3 | I. Loot and shops: loot generator and setup, monster loot review, Forge Loot, Magic Forge, Merchant, Bastion shop, Party XP | L | C |
| 4 | J. Remaining tools: Hex Explorer, Hex Tagger, Hex Brush, Level Guidelines, Quick Adjust, Rules Data, settings group menus | M | C |
| 4 | K. Bastion sheet and panel, Boat sheet | M | C |
| 4 | L. Character builder structure (keep its look) | S-M | C |

That is about 16 PRs. Patrick's rule is one themed PR per feature area and open PRs in single digits, so run waves 2
to 4 as at most four or five open at a time, merging after his review before starting the next.

## 3. How every window PR is done

1. New worktree from master (never the shared checkout, which carries other sessions' uncommitted work). One session
   per PR; a PR that fails review gets its own fresh fix session, and a `pr-prereview` pass before it returns to Patrick.
2. Swap the window's template for its approved one (`tools/design-harness/proposed/templates/<name>.hbs` becomes the real
   template), move its window css into the module stylesheet, and make the JS changes listed for it below.
3. Delete that window's old CSS from `styles/shadowdark-enhancer.css` (12,000 lines today). Old hook classes the JS still
   selects must stay or the selectors must change.
4. Every user-facing string comes from `languages/en.json`. Proposal strings in the fixtures' `strings` are copied in.
5. Keep the proposal's context shape and `data-action` names; where the JS must change, change it in the same PR.
6. Gate: `npm run lint` (zero warnings), `npm test`, `npm run inventory` then `npm run inventory:check`, plus the
   harness shots in dark, light and 420px, and the contrast and overlap checks added in PR C.
7. Live check in a disposable world copy on its own port (never the live world, no usable backups, never repoint the
   module symlink). Drive it through a cloned GM user, never the live Bridge.
8. `CHANGELOG.md` [Unreleased] entry and the wiki page under `docs/wiki/`. No `module.json` bump: no release until all
   Western Reaches work is done.
9. Commit without any AI attribution. Open the PR only after the live check, and merge only after Patrick's review.
10. `append_worklog` with a real `tried` list.

## 4. The Party sheet series (biggest piece)

Template `templates/party/party.hbs`, `scripts/party/party-app.mjs`, `party-sheet-core.mjs`, `styles/party-sheet.css`.
Proposal: fixture `party-proposed`.

- D1. Restyle: header, cards, tab row, status strip. Emblem 90% of the header height, icon about 71% of its box, custom
  colour for box and icon (the flag must accept any 6-digit hex; `emblemOf` and `pickEmblem` reject non-presets today;
  add an `iconColor` field). Controls column left of the 3x3 grid: Marching order switch, the "leads" line, Place / Recall,
  same width, equal vertical spacing; the grid is the right-most thing. Leader is chosen by clicking a formation slot (no
  dropdown). Remove the member active-effects loop. Tab row fills its width (8 tabs; a 4x2 grid at 560px and below). Each
  card: name never cut by the class (class on its own line), six ability scores always on one line (cards go to one
  column below 700px), Luck (green) and Light always visible under the portrait, Torches in the status strip
  (`statusBar()` has no torches entry today).
- D2. Items tab in the SDX layout: slots used/max, item rows with +/- count and a Give-to action, Treasury with GP, SP,
  CP, and GM buttons Add coins, Give coins, Divide coins; one Add item menu (From compendium, or Forge a magic item).
  Needs handlers `addCoins`, `giveCoins` (pool to the PCs' own purses, refused if the pool is short), `divideCoins`
  (all three coin types, PCs only, whole coins, remainder stays in the pool), `giveItem`, `addItemForge`
  (`MagicForgeApp.open({seed, onCreate})` adding the item to the party actor), and `addItemCompendium` (no compendium
  picker exists; needs one). Gems box sits under Treasury. Reference: SDX `scripts/party/partyinventory.mjs`
  (`_onAddCoins` line 518, `_onDivideCoins` line 167).
- D3. Members GM bar: one always-visible line, Who (popover list of PCs with an All toggle), stat, DC (default 12, blank
  for none), Request roll, then XP and Award XP. Spells row under casters: real icons grouped T1, T2, ... with lost
  spells struck (`system.tier`, `system.lost`). Request roll is a new feature: posts one chat card with a Roll button per
  selected character, the owner clicks it and the system's own ability check runs, result posted with pass or fail if
  there was a DC. (SDX's roller uses a socket overlay; this uses a chat card on purpose.)
- D4. Downtime tab (session status, one row per PC, GM controls, "Open Downtime window") and Warbands tab (rows grouped
  by commander with upkeep Paid or Owes N gp, open sheet, Run month, Pay arrears, Return to service). Add both to
  `partyTabs()`.

## 5. Per-window JS and rule changes (from the proposal reports)

- Camping (E): `participate` stops being a control (always true in `camping.mjs` and `camping-core.mjs`); meals take the
  character's own rations first, then the party's, with no consent box (`mealPlan` in `camping-core.mjs`, around lines
  85-98); Ready button uses the existing `confirmChoice` action; ration counter is a number plus the grilled ham hock
  icon with a "Ration count" tooltip (`meal.own` already exists). Dead afterwards: `p.partyRations`, the `[data-food]`
  listener, `foodEditable`, string `SDE.camping.usePartyRations`.
- Carousing (E): the tier moves from `participants[].tierId` to one party value `current.tierId`, set by a new
  party-level action that resets confirmations; the cost is shared, split in whole coins with any remainder charged one
  coin at a time to the first characters so the total is exact; the mask and paper-lantern boxes and `garb` fields go
  (the GM needs another way to adjust the bonus).
- Encounter Roller (G): tab, slot and browse-row selectors change to `.ui-tabs [data-tab]`, `tr[data-slot-idx]`,
  `tr[data-uuid][draggable]`. Session Recap: History moves to a footer button using `changeTab`. Quest Log: its
  `scrollable` selectors change; the payout markup built in JS needs styling.
- Importer hub (H): a `tab` context field and a `hubTab` action; selector `.sde-class-preview [data-cu-field]` becomes
  `[data-char-idx] [data-cu-field]`; drop the tools-popover wiring; remember `details` open state across renders. Token
  Art Manager: a `tab` field and `tamTab` action. Scope this PR's old CSS (`sde-thub-*`, `sde-tam-*`, `sde-mtree-*`).
- Loot and shops (I): Merchant needs an `unlimited` flag (its stock tooltip compared against a string with a newline);
  Magic Forge keeps one icon per spell row. Merchant Manage keeps one long scroll.
- Tools (J): Hex Tagger and Rules Data must remember their chosen tab across re-renders; Monster Creator should open one
  section at a time through `sectionOpen`. Old module CSS leaks into new templates: a rule like
  `[data-tab="browse"] { container-type: inline-size }` collapsed a proposed tab button, so such rules must be scoped to
  their own window or deleted as part of the swap.
- Chat cards, dialogs, HUD (F): only four chat cards have templates; the other sixteen are markup in the proposal report
  and must replace the `content` strings in their JS. Dialogs take `classes`, per-button `class` and `icon`; the progress
  dialog needs the call site to keep a reference and update `progress.value`. Fix the thirteen confirms whose default
  button is the destructive one (list in the dialogs report). Token HUD: `div.control-icon` becomes
  `button.control-icon` with `aria-label` in `movement-tracker`, `item-drops` and `quick-adjust`. The prayer-roll icon
  hooks the AppV1 name `renderActorSheet` and needs a V2 hook when the system moves.
- Character builder (L): a `summary` field; move `ABILITY_LABELS` and `ABILITY_INFO` and the literals in `gold.hbs` and
  `hp.hbs` into `en.json`. Keep its look.
- Bastion, Boat (K): keep the system parchment family; the proposals reduce visible buttons and fix the empty Plan card.

## 6. Foundation PR (C) details

- New `styles/sde-ui.css` from the kit, added to `module.json`, with tokens `--ui-*` and a real light set. Hoist the
  Party sheet's `--party-*` into the shared tokens. The hand-hashed `STYLESHEET_REV` in `scripts/shadowdark-enhancer.mjs`
  must be reset after any CSS edit.
- Harness: add a contrast check (ignore text over a background image), an overlap check, a real primary-button count,
  and make `--w=420` honour windows with their own `min-width`.
- Quick wins on the current UI, before any redesign: the dark-mode primary button (cream on gold, 1.89:1), the encounter
  result chat card (black on black in dark), the Monster Creator and Magic Forge light-mode text.

## 7. Outside this plan, or decisions still open

- The spell list cleanup (duplicates, icons that do not match the Compendium artwork) needs the live world and is a
  separate job.
- Party "Give coins" takes coins from the pool into the PCs' purses (agent's choice, accepted). If Patrick wants GM-handed
  new coins instead, it is a small change.
- The compendium picker for Add item is a new feature and needs a short design.
- `loot-setup` has not been reviewed.
- The Warband PR waits for the live test of the V2 sheet.
- SDX overlap: the Request roll duplicates a feature SDX's roller has. The Party sheet is moving into the Enhancer, so it
  is built here; any SDX change goes through a complete issue on that repo, not iteration through Patrick.

## 8. Done means

All approved windows built, both themes read and contrast-checked, old CSS removed, every string in `en.json`, the
design contract rewritten, the harness checks in CI-equivalent form, and Patrick has reviewed each PR.
