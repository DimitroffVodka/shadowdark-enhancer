# Stage phase 2: town and tavern places (plan v2, 2026-10-17, after the Opus review)

Status now: 2b (hosting) built on `feat/stage-town-hosting`; 2a (tavern tiles) is a separate PR

STATUS: REVIEWED (Opus-High review 2026-10-17: FIX, all findings folded in below). May be built.

Part of the Stage (player-facing "Backdrop"), see `PLAN.md` v2 and `PHASE-1B.md` in this folder. Phase 1a (camp picture) is merged. Phase 1b (custom places: `stagePlaces`, the Places window, upload) is being built (piece A, `places-core.mjs`, was committed as `adc0e75b` in `/home/patricks/git/.worktrees/stage`). This phase puts the Town landing page and a tavern page ON a backdrop. Patrick: "times when players are in Town, Taverns, or Camping"; he wants the landing page on a backdrop from any scene; town and tavern artwork he is sourcing (nothing is shipped).

## Split into two PRs (review finding: the stack problem)

- **2a Tavern tiles** (needs nothing from 1b): PR `feat/stage-tavern-tiles`, branch from `origin/feat/town-landing` (head `cf348029` on 2026-10-17, MERGEABLE, contains master `fa0152a5`), PR base `feat/town-landing`. A prepared clone exists: `/home/patricks/git/.worktrees/stage-p2-base` (branch `stage-p2-base`, lint 0 warnings, 5976 tests, inventory clean; `P2-BASE-REPORT.md`). Re-fetch first; if 524's head moved, rebase. Do not push to 524's own branch.
- **2b Hosting** (needs PR 524 AND 1b merged): build it on a LOCAL integration branch (master + 524 + 1b merged) so it can be lane-tested now; open the PR only when 524 and 1b have merged, with base `master`, and tell Patrick exactly which two merges unblock it. Never open a PR whose diff is two features.
- Do not depend on PR 525 (Quest Log) or 526 (Weather).

## What exists today (read in the 524 branch, verified by the review)

- A page is the flag `landing` on a SCENE: `landingOf(scene)` (`scripts/town/town-core.mjs:89`); `shown` is the GM's switch; `places` are the tile ids (quests, journals, party, downtime); `games`. Scene flags reach every client for every scene. Writes: `switchTown` (`town-live.mjs:15-17`), the editor's Save (`town-editor-app.mjs:126`), Restock (`town-app.mjs:140`), all through `replaceModuleFlag`. (There is NO `updateLanding` function: an earlier note said so wrongly.)
- `TownApp` is a SINGLETON (`id: "sde-town"`, `town-app.mjs:26`); `TownApp.open(scene)` (`:49-53`) re-points the one window at the scene it is given and reads `landingOf(this.scene)` (`:57,61`). Its hide icon (GM-only, `templates/town/town-landing.hbs:2,7`) calls `switchTown(this.scene, false)` (`:126`). `TownShopApp.open(scene, merchantId)`, `TownGamesApp`, `TownLogApp.open(scene)`, `TownEditorApp.open(scene)` all carry their own scene (`town-shop-app.mjs:55,181`, `town-games-app.mjs:120`, `town-log-app.mjs:39`, `town-editor-app.mjs:54`).
- Only `scripts/town/town-entry-points.mjs` assumes the canvas scene hosts the page: `canvasDraw` calls `closeTown()` when the new scene has no page (`:82`) and OPENS the new scene's page through `arrive()` (`:85`, which takes over the singleton); the `updateScene` follow (`:65-75`, also closes the page when `landing` is removed); `toggleTown` (`:27-33`; a player's Alt+T closes whatever `sde-town` shows, `:32`); `ready` (`:87`). `closeTown` lists `["sde-town", "sde-town-shop"]` (`:18`): `sde-town-games` is NOT in it.
- `placeTiles()` (`town-view.mjs:98`; the downtime tile is disabled for players until downtime is open, `:103`). `PLACE_IDS` in `town-core.mjs` is BOTH the allowed list and the default list (a page with no list gets all of them, `:79`; `switchTown` makes a new page from `{}`, `town-live.mjs:16`); `test/town-core.test.mjs:31` pins it.
- Carousing: `carousingOpen()` (`scripts/carousing/carousing.mjs:37`) ignores whether the user can see the party; a player can only open a party they can OBSERVE (`party.mjs:12,29`); the way in is `PartyApp.open(party, "carousing")` (`scripts/shadowdark-enhancer.mjs:~815`); player actions are relayed to a GM (`carousing.mjs:200`), so carousing needs a GM online (shopping does not).
- Rumors: `askAndGive` and `Rumors` are GM-only (`rumors.mjs:236,237,347,354`). A player can read the "Rumors Heard" journal (OBSERVER default ownership, `rumors.mjs:119-122`; `ledger()` at `:106` is not exported). There is no player window.
- NAME COLLISION: the Town code's `landing.places` means TILES on a page; the Stage's `stagePlaces` are backdrops. Different keys on different objects; do not rename either; write strings and docs so a player never sees "places" for tiles.
- Stage side (merged 1a): `campTransition` drops only `place === "camp"` (`stage-core.mjs:59`) but its setup branch RAISES a camp over whatever is up (`:51-54`).

## Phase 2a: tavern tiles (PR off feat/town-landing)

1. Split `town-core.mjs`'s `PLACE_IDS` into the ALLOWED list (adds `carouse`, `rumors`) and the DEFAULT list for a new page (the four town tiles). A new page must not get tavern tiles; fix `test/town-core.test.mjs:31`.
2. `placeTiles` rules and `openPlace` handlers (+ `PLACE_ICONS`, label and sub keys; strings written out in full, no key a prefix of another):
   - `carouse`: GM opens or starts the Carousing window; a player is enabled only when a party in `Party.list()` (the ones they can observe) has an open night, and it opens `PartyApp.open(party, "carousing")`.
   - `rumors`: GM runs `askAndGive`; a player opens the Rumors Heard journal (export a small opener from `rumors.mjs`), disabled with a hint until the journal exists.
3. The editor already lists every allowed tile (`town-editor-app.mjs:70`); a tavern is simply a page where the GM ticks Carouse and Rumors. No presets, no "Make a page" (cut).
4. Add `sde-town-games` to `closeTown`'s window list.
5. Harness fixture (dark and "still readable": the Town page forces `color-scheme: dark`, `styles/shadowdark-enhancer.css:5707`, so there is no themed light variant), tests, strings, docs, `CHANGELOG.md` Unreleased entry, inventory.

## Phase 2b: hosting the page on a Stage place (local integration branch, PR after 524 and 1b merge)

**Shape.** `pageSceneId` lives on the PLACE (the GM edits it in 1b's Places window as a "Page scene" select that lists only scenes that already have a page: pages are made with the existing toolbar and edited with the pencil). `normalizePlaces` and `updatePlace` (`places-core.mjs:22,35`) currently keep only `{id, kind, name, image}` and would silently drop it: both must keep `pageSceneId`. `showPlace` COPIES `pageSceneId` into the `stage` value at show time (as `image` already is, `places.mjs:37`) and `normalizeStage` is its only reader, so the `stage` setting's `onChange` is the only trigger, a camp raise or hide clears it with no extra code, and an edit to the list while a place is up cannot leave a stale page. No new setting or flag key. A town or tavern place with no picture defaults to its page scene's own background, filled in when the place is added (`normalizePlaces` refuses a place without a picture, and Patrick has no town art yet).

**Hosted-page rules (the hard part).**
- A pure `pageHost(stage, canvasSceneId, canvasPageShown)` returns the scene whose page should be open: the hosted one if the Stage shows a place with a `pageSceneId` whose scene still has a page, else the canvas scene's page if its `shown` is on, else none. Decide "hosted" from the `stage` setting, NEVER from window state: that makes the `ready` race between `stage.mjs:96` and `town-entry-points.mjs:87` safe in either order and covers reload and late join.
- Every canvas path checks `pageHost` first: `arrive`, the `updateScene` follow (including when the hosted scene IS the canvas scene, or the GM's Alt+T through `switchTown` closes the hosted page), `closeTown` on `canvasDraw`, `toggleTown` (a player's Alt+T toggles their copy of the hosted page). Because `sde-town` is a singleton, two pages cannot coexist: the hosted one wins, and when the hosted page ends `pageHost` runs again so a shown canvas page comes back.
- The hosted page's hide icon drops the Stage (`hideStage()`), with its own `SDE.stage.*` string written in full (it must not reuse `SDE.town.hide`). The page closes when the Stage drops or changes place. Removing the page or deleting its scene closes the hosted page (today it would render an empty `normalizeLanding({})`, `town-app.mjs:61`). Escape never closes it (frameless windows, `client-keybindings.mjs:756`).
- **Camp guard (applies from 1b on, tell the orchestrator):** `campTransition`'s setup branch returns null while the Stage is shown and its place is a `town` or `tavern` kind: a camp beginning never drops or replaces a town place. This changes 1b's "a camp that begins raises over whatever is up" for these two kinds only; the GM's "Show camp picture" button still switches by hand. Nothing re-raises later (a raise only happens on the `campBegin` write, `stage.mjs:77`).
- z-order is fine: the Town page is z 25 over the Stage at 0 and under Foundry's UI at 30.
- Shopping keeps working with no GM connected (the shop writes only the buyer's own character): lane-check it over the backdrop. Carousing needs a GM online.

## Pieces

**2a (PR `feat/stage-tavern-tiles`, base `feat/town-landing`):** (1) core split + tile rules + tests; (2) handlers, openers, strings, `closeTown` list, fixture; (3) docs, changelog, inventory.
**2b (local integration branch, PR when 524 and 1b are merged, base `master`):** (1) `pageSceneId` through `places-core.mjs` and `showPlace`, `normalizeStage`, `pageHost` + tests; (2) the guards in `town-entry-points.mjs`, the hosted open/close from the Stage draw and `onChange`, the hide icon string, the camp guard in `campTransition` + stubbed-Foundry tests (a scene change keeps the hosted page; the hide icon drops the Stage; the hosted page wins and the canvas page returns; the hosted page closes when its scene or page is removed); (3) the "Page scene" select in the Places window, harness fixture, docs (`Backdrop.md`, `Town-Landing-Page.md`), `CHANGELOG.md`, inventory, `docs/plans/stage-town-tavern.md` (a copy of this file).

## Lane checks (throwaway lane, never port 30000; GM plus a real Player user, the GM tab closed for the player steps where noted)

1. Raise a town place: both clients show the backdrop and the page; the player buys a ware with the GM tab closed.
2. GM switches the canvas scene: the backdrop and the hosted page stay; a page on the new canvas scene does not replace it; when the Stage drops, a shown canvas page comes back.
3. Reload (GM and player) and a late joiner: the same backdrop and page.
4. The page's hide icon drops the Stage and closes the page on both; Alt+T as a player toggles their own copy.
5. 2a: the Carouse tile is disabled for the player until the GM opens a night, then opens the Party sheet's carousing tab; Rumors opens the Rumors Heard journal once it exists; the games table closes with the page.
6. A camp beginning while a town place is up neither drops nor replaces it; the Show camp picture button switches by hand.
7. Deleting the page scene or its `landing` flag while it is hosted closes the page.
8. Extras present and absent.

## Not doing

Moving landing data onto places, a second page editor, "Make a page" and tavern presets, shipped town or tavern art, zone combat (phase 3), anything needing PR 525 or 526.

## Decided without asking Patrick

The hosted page wins over a canvas page and the canvas page returns when the Stage drops; a camp beginning keeps a town or tavern place up (the button switches by hand); a town place with no picture uses its page scene's own background; the Rumors tile opens the Rumors Heard journal for players; deleting the page or its scene closes the hosted page; Escape never closes it.
