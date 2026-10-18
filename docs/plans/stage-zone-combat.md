# Stage phase 3: zone combat on the Backdrop (plan v2, 2026-10-17, after the Opus review)

Status now: built on `feat/stage-zone-combat`; lane-checked 2026-10-18 with a real Player login: see the PR for what was and was not run live

STATUS: REVIEWED (Opus-High review 2026-10-17: FIX, all findings folded in below). May be built after phase 1b.

Part of the Stage (player-facing "Backdrop"), see `PLAN.md` v2 in this folder. Phase 1a (camp picture) is merged (master `fa0152a5`). This is the "some kind of combat" Patrick asked for: "a lot of people use ToM combat as well", and his complaint about Extras' ToM was fake tokens with no real combat.

## What it is

A fight with no battle map: a board shows three bands, **Close / Near / Far**, over the backdrop and the real combatants stand in them. Everything else is real Foundry: real actors, real HP, real status effects, one real Combat in the sidebar tracker with real initiative and turns.

## Fixed constraints (do not re-decide)

- Nothing copied from Extras' ToM. No fake tokens, no video overlays, no grid. Standalone: nothing here may need Extras.
- REAL actors on ONE global Combat: `Combat.create({ scene: null, active: true, flags: ... })` (v14 shows a `scene: null` combat on every scene: `client/documents/collections/combat-encounters.mjs:44-57`). Proven in a throwaway lane on 2026-10-17: with actor-only combatants initiative, turns, rounds, Clockwise Initiative and the Enhancer's dying rule work, no console errors.
- Each foe is its own CLONED actor (two combatants of one actor share HP). Clones are deleted by exact id AND only where `actor.flags["shadowdark-enhancer"].zoneClone === fight.id` (a check on a recorded id, never a search or a sweep).
- Flags are written through `replaceModuleFlag()`; never a dotted key. The flag keys `zoneFight`, `zone`, `zoneClone`, `zoneFoes` are permanent once shipped.
- State lives in the world (Combat, Combatant, Actor, Folder documents), so reload, late joiners and a table with no GM work wherever core allows.
- The sidebar Combat tracker stays core and so do initiative and turn buttons (the tracker and the Crawl Bar already roll and advance): the board is not a second tracker.

## The model

- **Zones** `close`, `near`, `far`, relative to the party's front line. PCs start `close`. A foe's starting zone comes from `distanceBand(roll)` in `scripts/encounter/battle-maps/encounter-battle-core.mjs:36-41` (1 close, 2-4 near, 5-6 far; no roll means near) or from the band the GM dropped it on.
- **Movement is a step** (closer or farther by ONE band), advisory, never blocked: a visual ledger.
- **Visibility**: respect core's `combatant.visible` (a GM can hide a foe). Players see a hostile foe's HP as a coloured bar only, no numbers, AC or movement (the Crawl Strip's rule, #163, `scripts/crawl-strip/crawl-strip.mjs:752-756`); a foe is only a clone of this fight (`zoneClone` flag), never read from disposition (Player prototypes default hostile).
- **Defeat**: damage applied through the board's popover calls `actor.applyDamage(n)`, and the system marks a foe at 0 HP defeated (`ActorSD#applyDamage` calls `_setDefeated`, `ActorSD.mjs:124-137,221-260`, which sets `combatant.defeated = true` on every combat's combatant for that `actorId`, tokenless included, skipping only the status icon) and turn-skip already skips a 0-HP NPC's turn (`turn-skip-core.mjs:119-124`). The GM's defeated toggle is only for foes that flee or surrender. (The lane's "no defeat at 0 HP" came from a raw HP write, which is why damage must never be a raw write.)

## Data

- Combat create data: `flags["shadowdark-enhancer"] = { noAutoEnroll: true, zoneFight: { id, at, clones: [actorId...], source } }`. `noAutoEnroll` is a COMBAT flag and must be in the create data: the Crawl Strip's only reader is `scripts/crawl-strip/crawl-state.mjs:450`; the writers are `crawl-bar.mjs:782-785` and `encounter-battle.mjs:688`.
- Combatant flag `zone = "close"|"near"|"far"` (missing reads `close`).
- Clone recipe: resolve the source with `worldActorFor(await fromUuid(uuid))` (`token-placement.mjs:51`, as battle maps do at `encounter-battle.mjs:61`: reuses the world copy, its art repair and the GM's loot flags; a null `fromUuid` result shows a notice). Then `Actor.create({ ...world.toObject() without _id, name: "Goblin 1" (numbering skips taken names), folder, ownership: { default: 0 } (toObject copies the source's ownership, which can be Observer for players), flags.zoneClone: fight.id })`; `_stats.compendiumSource` is kept so art lookup still works. Clone ids go on `zoneFight.clones`.
- The actor folder "Zone fight foes" is found by a flag on the Folder (`flags["shadowdark-enhancer"].zoneFoes === true`), never by name (a language change must not duplicate it).
- No new world setting; no Stage setting is written by a fight.

## The board (its own layer, NOT inside `#sde-stage`)

`#sde-stage` is `aria-hidden` (`stage.mjs:29`) and `drawStage` removes it whenever the Stage hides (`stage.mjs:22`), so focusable controls cannot live in it. The board is its own body-level layer `#sde-zone-board`, appended after `#sde-stage`, z-index 0 (under Foundry's UI at z 30 and the Crawl Strip at z 50), not `aria-hidden`. It shows whenever a zone-fight Combat exists, with an opaque dark backing when no Stage picture is up (the merged Stage draws nothing unless a place and a picture are set, `stage.mjs:21`, and `normalizeStage` accepts only the place `camp`, `stage-core.mjs:11,27`: do not rely on a "dark Stage"). Camp raises only change the picture behind it, so `onPartyCamp` needs no guard. Keep bands clear of the sidebar, the top strip and the hotbar; check at 1280x800 (Steam Deck). Render from Combat and Combatant data only (reload-safe).

## Flows

1. **Start** (GM; refused with a notice if a zone fight already exists, e.g. two GMs): (a) from the held encounter: `encounterCard(overlandState().encounter)` (`encounter-panel.mjs:163`, as `overland-bar.mjs:422` does): `count` clones of the creature in `distanceBand(distanceRoll)`. The button sits next to Battle map (`encounter-panel.mjs:212`, click handled near `overland-bar.mjs:947`) but must be shown when `canBattle(c)` is true (`battle-actions-core.mjs:24`), not only when battle maps are on. NOTE the battle RECORD (`newBattleRecord`) exists only after Battle map is pressed: it is the wrong source. (b) A GM toolbar tool beside `sdeStage` starts an EMPTY fight, and dropping an Actor (world or compendium) on a band adds one clone to it. PCs: the party members, else the active users' Player characters, all at `close`, as combatants of the same Combat.
2. **Move zone**: each chip has closer and farther buttons (keyboard-operable). GM moves anyone; a player moves only a combatant whose actor they OWN (core: an actor owner may update `flags` on their own combatant, `common/documents/combatant.mjs:76-92`; read from source, NOT yet tried with a player login: prove it in the lane with a real Player user). A refused write shows a notice and the chip snaps back. No drag in v1.
3. **HP and conditions**: chips show the actor's real status icons; HP per the visibility rule. A damage/heal popover (GM for anyone, an owner for their own PC) calls `actor.applyDamage(n)` and `applyDamage(-n)` to heal, never a raw `system.attributes.hp.value` write (the temp-HP pool wraps `applyDamage`, `temp-hp.mjs:57-58`; auto-defeat, dying, the recap HP stamp and turn-skip all come with it; `parry.mjs:438` and `party-roll.mjs:54` already call it). The system's own apply-damage buttons need a token or target and do nothing here, and Parry and Taunt need `targetUuid` (`parry.mjs:217`, `taunt.mjs:105`): they will not trigger in a zone fight; document it, do not fix it in v1.
4. **Initiative and turns**: the tracker and the Crawl Bar. No roll or next-turn buttons on the board.
5. **End**: ending means deleting the Combat. A `deleteCombat` handler on the active GM then waits for `LootDrops` to settle THAT combat (store its promise per combat id in `LootDrops._onCombatEnd`, `loot-drops.mjs`: `NpcInventory.dropCarried` writes to the clone after an await, `npc-inventory.mjs:47-50`, and hooks are not awaited) and only then deletes `zoneFight.clones` by exact id with the `zoneClone` check. Delete the Combat FIRST: every `deleteCombat` reader needs `c.actor` alive at that moment (Hunter `hunter.mjs:62`, loot `loot-drops.mjs:37`, recap `session-recap.mjs:411`, taunt `taunt.mjs:239`). This one path also covers ending from the sidebar tracker, the Crawl Bar's End Encounter and Delete Encounter (`crawl-bar.mjs:536`). If the active GM reloads between the Combat delete and the clone deletes, leftovers stay in the "Zone fight foes" folder: document "delete leftovers by hand", never sweep.
6. **Reload or a second GM mid-fight**: the board redraws from documents; clone ids are on the Combat.

## Who may do what (core permissions; the review checked each)

| Action | Rule | Who |
|---|---|---|
| Create or delete a Combat, create an Actor | ASSISTANT / `ACTOR_CREATE` (`document.mjs:137-139`, `constants.mjs:1285`) | GM or Assistant only |
| Update a Combat | only `round`, `turn`, `combatants` (`combat.mjs:76-84`) | players can end turns |
| Update own combatant's flags or initiative | actor owner | players, for their own PC |
| Update a clone's HP, move a foe, hide, defeat a foe | OWNER | GM only |

All `deleteCombat` consumers are gated on `isActiveGM`. Start, add foe, end and everything on foes stay GM-only.

## Integrations fixed in this phase (all in piece 2)

- **Session recap** misreads a tokenless combat: friend or foe comes from `c.token?.disposition` (`session-recap.mjs:413-414`) so the party would be listed as enemies, and `:427` skips combatants without a token when listing participants. Fix: with no token fall back to `c.actor.prototypeToken.disposition`, and count a participant as a Player-type actor with a player owner. This also fixes the Return-to-travel case described at `encounter-battle.mjs:742-745`. (An earlier draft said "XP, loot and recap read tokenless combatants": WRONG for the recap; Hunter `hunter.mjs:68` and loot `loot-drops.mjs:37-41` already work.)
- **Crawl Bar Start Combat** (`crawl-bar.mjs:767-800`) reuses `game.combat` (the viewed combat, which would be the zone fight) and adds every PC token on the scene, doubling each PC: refuse with a notice while a zone fight exists.
- **Bring the table**: put the refusal inside `bringBattleTable` itself (`encounter-battle.mjs:650`, the Crawl Bar also routes there, `overland-bar.mjs:410`), with a notice, while a zone fight exists. Do NOT block the Battle map button (setting up a map does not conflict).
- **hidden-sync** (`scripts/crawl-strip/hidden-sync.mjs:42-45`) finds a combatant only by `speaker.token`: a hidden tokenless foe's initiative leaks a "GM privately rolled" message. Add a lookup by `speaker.actor`.
- Warband combat keys on `actorId` (fine); the movement tracker resets scene budgets each turn (harmless); core's "Toggle Combat State" adds to the viewed combat but is only reachable with the board down (leave it); dying's "near" checks use tokens and return nothing here; Hunter's list will read "Goblin 1, Goblin 2" (it groups by name).
- Chaos mode with tokenless foes was NOT measured: lane-check it.

## Pieces (serial, one themed PR `feat/stage-zone-combat` off master after phase 1b)

1. **Pure core** `scripts/stage/zone-core.mjs` + `test/stage-zone-core.test.mjs`: `ZONES`, `normalizeZone`, `stepZone(zone, dir)`, `foeZoneFor(distanceRoll)` (via `distanceBand`), `cloneNames(name, count, taken)`, `cloneActorData(world, { name, folder, fightId })` (pure strip of `_id`, ownership and a copied `zoneClone`), `canMoveZone({ isGM, ownsActor })`, `layoutBands(combatants)`, `hpBand(hp, max)` for the player-facing bar. No Foundry in it.
2. **Lifecycle and integrations** `scripts/stage/zone-fight.mjs`: start (refuse if one exists), add foe, move, damage via `applyDamage`, defeat toggle, the `deleteCombat` handler that waits for loot, plus the recap fix, the Crawl Bar and `bringBattleTable` refusals and the hidden-sync lookup. Stubbed-Foundry tests in the style of `test/camping-fire.test.mjs`: End deletes only clones whose `zoneClone` matches, loot is awaited before deletes, a player cannot move a foe, a start with a fight running is refused, a tokenless combat is classified correctly by the recap, reload keeps clone ids.
3. **The board** `scripts/stage/zone-board.mjs` + `templates/stage/zone-board.hbs` + `styles/stage-zone.css` (own file, registered in `module.json`) + strings `SDE.stage.zone.*` written in full (no key a prefix of another) + harness fixture (dark, light, 420 px and 1280x800): bands, chips (portrait, name, HP bar, real status icons, turn highlight, closer/farther, defeated mark, damage popover), drop-an-Actor-on-a-band, the GM toolbar tool beside `sdeStage`, and the Encounter panel button. Buttons at least 22 px, keyboard operable, `prefers-reduced-motion` respected, kit tokens so both themes work.
4. **Bookkeeping**: docs/wiki page, `CHANGELOG.md` Unreleased entry, inventory section, `docs/plans/stage-zone-combat.md` (a copy of this file).

Cut from v1: dragging between bands, a search picker for foes (later, for keyboard users), roll-initiative and next-turn buttons on the board, any Stage coupling beyond the picture behind the board.

## Lane checks (throwaway lane, never port 30000; GM plus a REAL Player user)

1. Start from a rolled encounter: PCs at close, N clones in the rolled band, named 1..N, in the "Zone fight foes" folder, ownership default none; the Player sees the board with foe HP as a bar only.
2. Player moves their own PC (proves the combatant-flag write for a real player); tries a foe (refused); GM moves everyone.
3. Roll initiative in the tracker, advance across a round; the turn highlight follows; the Player ends their own turn.
4. Damage popover: a clone to 0 HP is marked defeated and its turn skipped; a PC to 0 HP shows dying; temp HP absorbs first.
5. Player reloads mid-fight and a late joiner arrives: same board.
6. End: the Combat is deleted, loot drops and the recap lists the foes as enemies and the party as participants, the clones are gone by exact id and nothing else was deleted; ending from the sidebar tracker and from the Crawl Bar does the same.
7. Bring the table and Crawl Bar Start Combat are refused with a notice while a zone fight exists; the Battle map button still works.
8. A hidden foe's initiative does not leak a chat line; a camp starting changes only the picture behind the board.
9. Chaos mode on; 1280x800 layout; Extras present and absent.

## Not doing

Arena grid styles, a free-form map, a second tracker, targeting by token, automatic range or reach rules, a monster compendium browser, shipped art, dragging, phase 1b and 2 work.

## Decided without asking Patrick

Three bands; one-band steps are advisory; PCs start Close; foes from an encounter land in the rolled band; players see foe HP as a coloured bar only; slain foes' copies are deleted when the fight ends (after loot and XP); the GM can start a fight from a toolbar tool as well as from a rolled encounter; a start is refused while a fight is running; the board stays up for the whole fight; leftovers after a crash are deleted by hand.
