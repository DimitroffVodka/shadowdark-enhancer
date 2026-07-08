---
date: 2026-07-05
tags: [shadowdark-enhancer, foundry-vtt, promo-video, dev-log]
source: Claude Code session
---

# Shadowdark Enhancer — Promo Video Plan & Character Builder Docs

Session summary from working on the `shadowdark-enhancer` repo (v0.8.2, Foundry v14.364 / Shadowdark 4.0.6).

## What got done

- Built a full **promo video shot list** covering every module feature (below).
- Discovered the **Character Builder** (`scripts/char-builder/`) was fully shipped but **undocumented** — wrote it up.
- Docs committed & pushed to branch `claude/module-promo-video-checklist-4zxijc` (commit `928335c`):
	- README: new "🧙 Character Builder" feature section, 5 settings-table rows, `charBuilder` in the API namespace list, `char-builder/` in the project layout.
	- docs/API.md: new `charBuilder` section (`api.charBuilder.open()` singleton, GM socket handoff note).
- ⚠️ Noted: `open({ level0 })` exists in the API but commit hardcodes level 1 — level-0 funnel mode is unfinished. Don't mention it in the video until done.

## Promo video prep

- World with 4–5 PCs + tokens on a dungeon scene, some NPCs, **Dice So Nice** enabled.
- Second browser logged in as a player — loot claims, merchant, coin pickup are player-facing; film both screens side by side.
- A Cursed Scroll PDF page ready to copy for the importer demo.

## Shot list

### Scene 1 — Crawl Strip (opening hook)
1. Clean canvas → **Start Crawl** → strip appears with party cards.
2. Players roll marching order; cards reorder; turn counter ticks on *Next Turn*.
3. Close-up of a card: live HP, movement used vs budget, Luck pips, AC, effect icons.
4. Click a Luck pip to spend it.
5. Drag a token past the 90 ft budget → move refused / bounced back.
6. Drop a PC to 0 HP → HP cell turns red.

### Scene 2 — Combat
7. **Begin Encounter / Start Combat** → strip flips to initiative order, synced with the tracker (Clockwise Initiative supported).
8. Combat HUD dropdown on active card: HP ±1/±5, Spend Luck, Open Sheet.
9. Move the active token → **Rollback to turn-start** snaps it back.
10. Hidden NPC absent from strip (GM vs player screen).

### Scene 3 — Random Encounters
11. Encounter check: 1d6 vs threshold, DSN roll, HIT chat card, auto-pause, roller opens + auto-rolls the active table.
12. Encounter Roller: browse/filter NPC sources; drag NPCs onto numbered die slots to build a table.
13. Result card: appearing count, distance, activity, 2d6+CHA reaction → **Place** grid-snapped tokens.

### Scene 4 — Monster Creator
14. Load a bestiary monster into the draft, rename, tweak stats.
15. Quick-pick attack catalog (Bite, Breath Weapon, Poison…) + feature catalog.
16. Attach a spell via compendium search chips; set portrait art.
17. Apply a **mutation** → instant variant.
18. Save → open the real world Actor sheet.

### Scene 5 — Importer
19. Paste PDF text → auto-detect segments into monsters / items / spells / tables with editable previews.
20. Commit → content lands in the managed compendium suite.
21. Imported table with auto-enriched @UUID monster links — click through to the actor.

### Scene 6 — Loot, Forge & Merchant (player screen!)
22. Loot Generator hoard → claimable chat card → player clicks **Claim**, coins land, card locks.
23. Loot drop on kill.
24. Drag item onto canvas → other character picks up via Token HUD; stackables auto-stack; drop a coin pile.
25. Magic Item Forge: roll a random item (bonuses, curse, personality, name), forge a **+2 weapon**, attack and show +2 applying in the system roll — the "it really works" moment.
26. Merchant Shop: opens on every player's screen at once; buy/sell, coins move, transaction log → Discord export.

### Scene 7 — Party XP & Session Recap
27. Party XP: drag a treasure item, XP auto-fills, award to party → old→new chat card, level-up flag.
28. Session Recap at the end: it silently captured combat, loot, XP, per-PC roll stats, merchant activity, encounter checks → **Copy for Discord**. Save as the video's payoff.

### Scene 8 — Character Builder (was undocumented!)
29. Launch from the **Player sheet header button** (not the sidebar) and walk the wizard: Abilities → Ancestry → Origins → Class → HP & Gold → Gear → Preview → create. Time-lapse "full character in under a minute".

### Scene 9 — Mounts & Boats (outro)
30. Boat actor sheet (Occupants / Inventory / Description); Mount on the system NPC sheet.

### Stingers
- Settings panel scroll-through; `game.shadowdarkEnhancer` console flash.

**Short-cut edit (6 unmissable shots):** strip appearing on Start Crawl · movement refusal · rollback-to-turn-start · encounter auto-roll → Place tokens · player claiming loot on their own screen · Discord recap paste.

## Character Builder — key facts (as documented)

- Guided replacement for the system's random `CharacterGeneratorSD`; builds a **complete level-1 character** (no level-up re-prompt).
- Launch: Player actor sheet header button (GM or owner), or `game.shadowdarkEnhancer.charBuilder.open()`. Singleton window.
- 7 tabs: Abilities / Ancestry / Origins (Background+Alignment+Deity) / Class / HP & Gold / Gear / Preview. Per-step Random + full random.
- Stat method is **GM-dictated** (world setting): 3d6 down, 3d6 reroll-under-14 (default), 3d6 assign, 4d6kh3 down/assign. All rolls post audit chat cards; DSN optional (off by default).
- Class tab: 2d6 talent-table roll, inline REPLACEME effect choices (Weapon Mastery etc.), bonus rolls (Human Ambitious, Black Lotus, patron boons), per-tier spell picker, languages.
- GM settings: stat method, dice animation, max level-1 HP, fixed starting gold, and a **table-sources menu** (Name / Trinket / Background / Deity roll tables).
- Players without actor-create permission → creation handed to GM via system socket.
