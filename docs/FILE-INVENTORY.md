# Shadowdark Enhancer — File Inventory

<!-- inventory:stats:start -->
711 tracked files · ~92,700 lines of code/markup across scripts+templates+styles+test.
`v0.13.1` in both `module.json` and `package.json`.
<!-- inventory:stats:end -->
**Layout reflects the 2026-07-21 feature-folder reorganization (v0.11.0 cycle).**

> The counts above and the §3 `scripts/` tables are **generated** — run
> `npm run inventory` after adding or renaming a script. Per-file descriptions
> and section prose live in `tools/inventory/data.json`; everything else on this
> page is hand-written.

---

## 1. Repo root (shipped)

| File | What it is |
|---|---|
| `module.json` | Foundry manifest. id `shadowdark-enhancer`, v0.13.1, core min 13 / verified 14.365, system shadowdark min 3.6.2 / verified 4.0.6, recommends `shadowdark-extras` 6.10.45. Declares the `mount` + `boat` Actor sub-types, one ESM entry, one stylesheet, `socket: true`. |
| `package.json` | Dev-only. `npm test` → `node --test test/*.test.mjs`; `npm run lint` → eslint over `scripts test`. |
| `eslint.config.mjs` | Flat ESLint config (browser + node globals, Foundry globals). |
| `README.md` | User-facing feature docs. |
| `CHANGELOG.md` | Running changelog. |
| `CREDITS.md` | Third-party asset attribution (Shikashi icon pack, game-icons.net, PD portraits). |
| `LICENSE` | MIT. |
| `.gitattributes`, `.gitignore` | Line-ending rules; ignore list (see §9). |
| `.github/workflows/ci.yml` | Lint + `node --test` on push/PR. |
| `.github/workflows/release.yml` | Tag → build module.zip (allowlist: module.json, README, LICENSE, CHANGELOG, CREDITS, docs/API.md, assets, icons, languages, scripts, styles, templates) + attach manifest to the GitHub release. `test/` and the rest of `docs/` never ship. |

## 2. Repo root (NOT shipped — see §9)

**Tracked in git, excluded from the release zip:**
`verify.sh` (pre-commit grep wall + `node --check` + eslint, `--strict` tier).

**Not in git at all:**
`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.impeccable.md` (agent instructions) ·
`package-lock.json`, `node_modules/`.

---

<!-- inventory:scripts:start -->
## 3. `scripts/` — module code (feature-folder layout)

### 3.1 `scripts/` root

| File | Lines | Description |
|---|---:|---|
| `shadowdark-enhancer.mjs` | 693 | **Entry point** (module.json esmodules). Registers hooks, settings, sheets, actor sub-types, the public `game.shadowdarkEnhancer` API, and wires every sub-system. |
| `luck-reroll/luck-reroll.mjs` | 171 | Wraps the system's `_onReroll` to enforce nat-1 prevention and log Luck rerolls to the session recap. |
| `spell-mishap/spell-mishap.mjs` | 207 | Nat-1 spellcasting failures auto-roll the class's mishap table (wizard / witch / necromancer sets); divine casters are exempt. |

### 3.2 `scripts/shared/` — cross-feature infrastructure

| File | Lines | Description |
|---|---:|---|
| `module-id.mjs` | 8 | Single source of truth for the module ID (highest fan-in file: 58 importers). |
| `source-keys.mjs` | 71 | One canonical key per source book (core/cs1-6/wr) across every spelling. |
| `settings.mjs` | 378 | All `game.settings.register` calls + migration-safe defaults. |
| `icons.mjs` | 80 | Centralized icon registry — FontAwesome snippets and vendored SVG references. |
| `compendium-suite.mjs` | 350 | Find-or-create layer for the five managed packs (`sde-actors/items/tables/journal/scenes`); 38 importers. |
| `loading-dialog-guard.mjs` | 112 | Guards the system's leaked `LoadingSD` spinner when `ItemSheetSD.getData` throws. |
| `art-utils.mjs` | 164 | Portrait/token image resolution across world + compendium sources. |
| `coins.mjs` | 105 | Pure Shadowdark currency math (10cp=1sp, 10sp=1gp). |
| `esc.mjs` | 16 | HTML-escape helper for safe `innerHTML` interpolation. |
| `gm-relay.mjs` | 317 | The one authenticated relay channel, both directions. Rides Foundry's user-query transport, where the SERVER stamps the sender from the authenticated socket, so an identity check can no longer be defeated by a payload naming a GM. Owns the shared ownership gate (`authorizeActorFor` / `authorizeActorRequest`), the GM-side entry guard (`refuseQuery`), the player-side `queryActiveGM` / `relayToGM`, and `notifyPlayers` for a GM→players push that the receiver can verify. A query the GM's build cannot answer is itself the stale-tab signal, so the old forgeable ping/pong handshake is gone while its wording (`evaluateHandshake` / `handshakeWarning`) is kept. |

### 3.3 `scripts/crawl-strip/` — the top strip + movement + combat sync

| File | Lines | Description |
|---|---:|---|
| `crawl-strip.mjs` | 1103 | The core feature: the top strip. Plain DOM (`#shadowdark-enhancer-strip`), not ApplicationV2. |
| `crawl-state.mjs` | 379 | Foundry-coupled state singleton — persistence, sockets, hook emission. |
| `crawl-state-core.mjs` | 138 | Pure reducer/normalizer behind crawl-state. Node-testable. |
| `crawl-lights-core.mjs` | 93 | Pure light-source logic for the strip's flame badges. |
| `initiative-manager.mjs` | 128 | Combat/initiative state machine glue for the strip. |
| `hidden-sync.mjs` | 66 | Bidirectional `token.hidden` ↔ `combatant.hidden` sync, GM-only. |
| `movement-tracker.mjs` | 713 | Crawl-mode movement budget enforcement + turn-start rollback (`displace` waypoints). |
| `movement-calc.mjs` | 88 | Pure per-segment feet-moved math. |
| `npc-action-menu.mjs` | 509 | Per-combatant hover action HUD. |

### 3.4 `scripts/crawl-bar/`

| File | Lines | Description |
|---|---:|---|
| `crawl-bar.mjs` | 617 | GM-only persistent bottom bar above the macro bar (mode toggles, tools, launchers). |

### 3.5 `scripts/encounter/` — the Encounter Roller

| File | Lines | Description |
|---|---:|---|
| `encounter-roller-app.mjs` | 1431 | The Encounter Roller shell + tabs (Roll Tables / Build / Browse / Creator). |
| `encounter-check.mjs` | 80 | The d6 random-encounter check + chat post. |
| `encounter-result.mjs` | 41 | Distance / Activity / Reaction RAW lookups. |
| `encounter-build.mjs` | 286 | Build-a-table data layer (slots, die formats, save to RollTable). |
| `encounter-browse.mjs` | 217 | Browse-NPCs data layer (sources, loading, cache, filter/sort). |
| `npc-index.mjs` | 260 | NPC actors → compact browse row model. |
| `encounter-sources.mjs` | 56 | Pure, node-testable core for the Encounter Roller's source list (which tables/monsters feed a roll). |

### 3.6 `scripts/monster-creator/`

| File | Lines | Description |
|---|---:|---|
| `encounter-creator.mjs` | 1878 | Monster Creator — multi-section NPC authoring tool mounted in the roller. |
| `action-templates.mjs` | 126 | Quick-pick NPC attack/action catalog (FA6 Free glyphs only). |
| `feature-templates.mjs` | 83 | Quick-pick NPC feature catalog. |
| `monster-effect-runtime.mjs` | 540 | Provenance-backed effect overlay engine for the Creator draft. |
| `monster-mechanical-adapters.mjs` | 330 | Sole authority for what mechanics a generator result actually applies. |
| `monster-mutator.mjs` | 139 | Clone an existing NPC and apply imported matrix results. |
| `monster-table-runtime.mjs` | 578 | Reads the GM's own imported Core matrix tables to drive the Generator/Mutator. |
| `spell-index.mjs` | 190 | Lightweight Spell index (compendium indices, not documents). |
| `npc-moves.mjs` | 16 | Canonical NPC movement keys with a pre-config fallback. |
| `npc-statblock.mjs` | 125 | Builds the formatted `system.notes` statblock HTML. |
| `level-guidelines-app.mjs` | 220 | GM-facing editor for the per-level monster guidelines — what a level-N monster's stats should look like. |
| `level-guidelines.mjs` | 502 | Pure, node-testable monster level-guideline math (isotonic-smoothed medians over the system's 244 monsters). |
| `quick-adjust-app.mjs` | 463 | Quick stat-adjust dialog — lightweight AC/HP/level/attack swaps on an existing monster (not a generated effect). |

### 3.7 `scripts/loot/`

| File | Lines | Description |
|---|---:|---|
| `loot-generator-app.mjs` | 265 | Roll a loot table, work a running batch, whisper claimable cards. |
| `loot-generator.mjs` | 234 | RollTable → structured loot batch (documents, coins, flavor). |
| `loot-delivery.mjs` | 450 | Shared claimable chat card; first-claim-wins, GM-authoritative over an authenticated relay query. |
| `loot-drops.mjs` | 179 | Auto-drop loot on NPC defeat at combat end. |
| `loot-setup-app.mjs` | 237 | Browsable Loot & Treasure library; rows unlock from the GM's own PDF. |
| `loot-value.mjs` | 68 | gp value → Shadowdark XP quality tiers. |
| `loot-table-catalog.mjs` | 312 | Loot/treasure table catalog + classifier across Core, CS1–6, WR (metadata only). |
| `loot-table-tag.mjs` | 80 | Sidebar context-menu "Mark as Loot Table" toggle. |
| `loot-catalog.mjs` | 116 | Rewrites loot tables so entries become DOCUMENT results. |
| `loot-linker.mjs` | 115 | Loot row text → confident compendium item link. |
| `loot-pack.mjs` | 161 | Classify/fabricate treasure entries + world "Loot" pack ops. |
| `subroll.mjs` | 95 | Resolve "Meteorite 1d4: 1. lute…" table rows to the object rolled. |
| `treasure-data.mjs` | 15 | Level → tier band boundaries. |
| `item-drops.mjs` | 690 | Drag items to canvas as pickup tokens; TokenHUD pickup; light sources burn. |

### 3.8 `scripts/magic-forge/`

| File | Lines | Description |
|---|---:|---|
| `magic-forge-app.mjs` | 724 | Magic Item Forge window (weapons/armor with working +N, benefit/curse riders). |
| `magic-forge.mjs` | 279 | Core engine building items that actually function in the system. |
| `magic-table-runtime.mjs` | 708 | Drives forge recipes off the GM's own imported magic-item tables. |

### 3.9 `scripts/merchant/`

| File | Lines | Description |
|---|---:|---|
| `merchant-shop.mjs` | 2689 | Two-mode shop system (compendium global or actor NPC inventory); GM opens for all players. |
| `merchant-defaults.mjs` | 183 | The two shipped merchant configs (Base, Western Reaches). |

### 3.10 `scripts/party-xp/`

| File | Lines | Description |
|---|---:|---|
| `party-xp.mjs` | 306 | Award XP to the whole party in one click (ApplicationV2 GM tool). |
| `party-xp-core.mjs` | 52 | Pure XP math + item-XP resolution. |

### 3.11 `scripts/session-recap/`

| File | Lines | Description |
|---|---:|---|
| `session-recap.mjs` | 675 | Session event tracker singleton (loot, sales, XP, combats, per-PC stats). |
| `session-recap-core.mjs` | 374 | Pure data shape, currency math, duration format, Discord-markdown export. |
| `session-recap-app.mjs` | 309 | Recap window: Overview / Combat / Loot / XP / History. |

### 3.12 `scripts/importer/` — hub + cross-type infrastructure

| File | Lines | Description |
|---|---:|---|
| `importer-hub-app.mjs` | 855 | **The single front door (shell).** ApplicationV2 lifecycle, singleton, instance fields/caches, `_prepareContext`; installs the three method packs below onto the class (split 2026-07-22). |
| `importer-hub-paste.mjs` | 1384 | Paste box, type selector, parse dispatch, per-type preview field/row wiring. |
| `importer-hub-commit.mjs` | 832 | Conflict dialogs, quality gates, magic-bundle plan, all per-type commit flows. |
| `importer-hub-manage.mjs` | 949 | Manage strip: censuses + caches, manage tree, gap/seed/cull, source-PDF grab/extract. |
| `importer-hub-shared.mjs` | 92 | Hub-shared constants/helpers + `installMethods` (the split's descriptor copier). |
| `importer-hub-maintenance.mjs` | 242 | Tools-menu bodies (bundle export/import, source-PDF library). |
| `dump-segmenter.mjs` | 307 | Routes a mixed dump through the recognizer registry: hexcrawl → spell → monster → item → table. |
| `bundle-io.mjs` | 351 | Whole-suite export/import as one JSON; validates, skips existing, never overwrites. |
| `manage-tree.mjs` | 537 | Composes the folder/sub-folder unlock-review tree the Manage strip renders. |
| `pdf-text-extract.mjs` | 584 | Clean reading-ordered PDF text via Foundry's bundled PDF.js; column-aware gutter detection. |
| `pdf-text-utils.mjs` | 140 | Shared PDF-text helpers + the HTML-safety contract. |
| `source-pdf-registry.mjs` | 273 | Content source → the user's own uploaded PDF, for page deep-links. |
| `source-pdf-viewer.mjs` | 66 | Singleton ApplicationV2 embedding Foundry's PDF.js viewer at a given page. |
| `char-content/char-content-manifest.mjs` | 1394 | Metadata-only manifest of CS4–6 + WR char-builder content (names/types/sources, no rules text) + `parseCharContent` + census. |
| `char-content/class-parser.mjs` | 1002 | Class section → structured unit (writeup, talents, tables, spellcasting). Pure. |
| `char-content/class-importer-app.mjs` | 737 | Purpose-built single-view class workspace. |
| `char-content/class-unit-importer.mjs` | 1073 | Class unit → real documents in dependency order. |
| `char-content/class-overlays.mjs` | 220 | SDE-original automation not derivable from book text (ActiveEffects, invented names). |
| `char-content/class-quality-gate.mjs` | 113 | The one place computing blocking class-import issues + override dialog. |
| `char-content/class-index.mjs` | 85 | Class name → system Class item UUID. |
| `char-content/language-resolver.mjs` | 16 | Language names → system UUIDs. |
| `spells/spell-parser.mjs` | 284 | Spell blocks → Spell drafts. Pure. |
| `spells/spell-importer-app.mjs` | 460 | Spell workspace organized by class / tier / alignment. |
| `tables/table-importer.mjs` | 3087 | Roll-table text → structure. The big one; includes `repairSharedStartRanges`. |
| `tables/table-shapes.mjs` | 480 | Per-unlock deterministic table SHAPE recipes (prayer/grid/lookup/reflow kinds). |
| `tables/table-hub.mjs` | 297 | Reconciles the shipped manifest against the live world (system / imported / missing). |
| `tables/table-hub-app.mjs` | 528 | "Set up ALL tables" window — dashboard + import view. |
| `tables/table-registry.mjs` | 206 | Parses live tables into `{source, page, displayName, subCategory}` and groups them. |
| `tables/table-seed-map.mjs` | 240 | Generated table-name → group-id seed map. |
| `tables/table-structure-seeds.mjs` | 2106 | Structure-only seeds (formulas, folders, flags, chain links). |
| `tables/table-folders.mjs` | 139 | Single source of truth for where a table files in `sde-tables` — **owns the Gameplay vs Roll Tables split**. |
| `tables/table-categories.mjs` | 65 | Table-type taxonomy + classifier. |
| `tables/table-enrich.mjs` | 164 | Brings imported tables to "Ruin Encounters" standard; owns the debounced auto-relink sweep. |
| `tables/core-table-groups.mjs` | 251 | Core Rulebook table groups (`section: "gameplay"` vs roll tables) for the Manage tree. |
| `tables/compound-table.mjs` | 93 | Mad-libs generator roll behaviour. |
| `tables/hex-parser.mjs` | 340 | Hex-key dumps → per-hex draft journal pages. Pure. |
| `monsters/statblock-parser.mjs` | 516 | Monster statblock dump → draft objects. Pure. |
| `monsters/monster-importer.mjs` | 226 | Drafts → NPC actors in `sde-actors`. |
| `monsters/monster-importer-app.mjs` | 378 | Paste dump → per-monster preview/edit grid → create. |
| `monsters/monster-census.mjs` | 154 | Pure have/gap/duplicate helpers. |
| `monsters/monster-census-live.mjs` | 378 | Foundry-bound adapter reading `sde-actors`/`sde-tables`. |
| `monsters/monster-backfill.mjs` | 359 | Idempotent upgrade of pre-fidelity-fix imports; auto-runs once per module version. |
| `monsters/actor-migration.mjs` | 380 | World-side imported actors → the managed `sde-actors` pack. |
| `monsters/monster-linker.mjs` | 124 | Table encounter text → clickable `@UUID` monster links. |
| `monsters/monster-pack.mjs` | 42 | Shared pack-identity leaf so importer and linker agree. |
| `items/item-parser.mjs` | 450 | Generic item recognizer (name/cost/slots). Pure. |
| `items/gear-parser.mjs` | 535 | Real Weapon/Armor stat parser (WR letter codes, treasure flags). Pure. |
| `items/gear-join.mjs` | 244 | Joins split cost-table + description layouts into one item. Pure. |
| `items/item-importer.mjs` | 805 | Drafts → Items in `sde-items`, foldered by source. |
| `items/item-builder-app.mjs` | 395 | Guided multi-stage equipment-section workspace. |
| `items/item-builder-gear.mjs` | 121 | Pure stage-①/③ logic for the Item Builder. |
| `items/item-census-live.mjs` | 200 | Items census adapter (same shape as monsters). |
| `items/shikashi-icons.mjs` | 235 | Item name → bundled Shikashi icon matcher (284 icons). |
| `tables/table-manifest.mjs` | 210 | Table manifest logic — the registry of catalogued tables (id, name, source, page) that drives the Manage-tree census. |
| `tables/table-manifest-data.mjs` | 335 | The `TABLE_MANIFEST` data array — every catalogued table's metadata (names/sources/pages; no rules text). |
| `boats/mount-parser.mjs` | 32 | Names-only WR mount manifest + selection of the requested mount from parsed statblock drafts. |
| `boats/mount-importer.mjs` | 79 | Mount drafts → `shadowdark-enhancer.mount` actors in `sde-actors`, reusing the monster import pipeline. |
| `boats/boat-parser.mjs` | 155 | Parses the WR p118 boats table → boat actor drafts (pure); names-only manifest. |
| `boats/boat-importer.mjs` | 49 | Boat drafts → `shadowdark-enhancer.boat` actors in `sde-actors`. |
| `boats/siege-parser.mjs` | 158 | Parses the WR p119 siege-weapons table → Weapon drafts + ammunition (pure). |
| `boats/siege-importer.mjs` | 61 | Materializes Blast/Exploding Property items for the siege weapons in `sde-items`. |

### 3.13 `scripts/actors/` — Mount & Boat sub-types

| File | Lines | Description |
|---|---:|---|
| `register-actors.mjs` | 74 | Registers `shadowdark-enhancer.mount` / `.boat` (models + sheets, in `i18nInit`). |
| `boat-data-model.mjs` | 115 | Boat data model — WR vessel rules. |
| `boat-sheet.mjs` | 174 | Boat sheet: Overview / Passengers & Crew / Cargo / Description. |
| `mount-npc-sheet.mjs` | 329 | Mount sheet — subclass of the system's `NpcSheetSD`. |
| `vehicle-sheet.mjs` | 411 | Shared party-like container base (ApplicationV2). |
| `vehicle-rolls.mjs` | 78 | Shared helper-roll button handlers. |

### 3.14 `scripts/char-builder/` — guided character creation

| File | Lines | Description |
|---|---:|---|
| `char-builder-app.mjs` | 276 | `ShadowdarkCharBuilder` ApplicationV2 shell; drives the step lifecycle. |
| `state.mjs` | 63 | `CharBuilderState` — the in-progress character. |
| `constants.mjs` | 137 | Shared constants; hands off to the system's `CharacterGeneratorSD`. |
| `data.mjs` | 255 | Thin wrappers over the system's compendium loaders. |
| `commit.mjs` | 286 | `commitCharacter` — final actor creation + `coinsAfterGear`. |
| `art.mjs` | 77 | Ancestry/class NAME → local portrait manifest. |
| `art-gallery.mjs` | 162 | GM-curated portrait gallery (avoids granting players `FILES_BROWSE`). |
| `class-ability-uses.mjs` | 112 | Per-day/roll uses for Class Ability items. |
| `gear-editor-app.mjs` | 152 | `ExtraGearEditor` sub-window. |
| `steps/base-step.mjs` | 54 | Base class for character-builder wizard steps (shared lifecycle, render and validation). |
| `steps/list-step.mjs` | 197 | Base class for the list/detail/aside steps (Ancestry, Class, Background, Deity). |
| `steps/alignment-step.mjs` | 68 | Step — Alignment. Three choice cards (Lawful / Neutral / Chaotic). |
| `steps/ancestry-step.mjs` | 233 | Step — Ancestry. List/detail pick contributing ancestry talents and languages. |
| `steps/background-step.mjs` | 40 | Step — Background. A simple list/detail pick. |
| `steps/class-step.mjs` | 824 | Step — Class. List/detail pick; parses the class writeup, talent table and spellcasting. |
| `steps/deity-step.mjs` | 77 | Step — Deity. Optional list/detail pick showing the deity's detail. |
| `steps/gear-step.mjs` | 321 | Step — Gear. A shop: browse purchasable equipment and buy against starting gold. |
| `steps/gold-step.mjs` | 77 | Step — Gold. Roll 2d6×5 gp, or use the GM's fixed starting-gold setting. |
| `steps/hp-gold-step.mjs` | 52 | Step — Hit Points & Gold on one tab (both are single dice rolls). |
| `steps/hp-step.mjs` | 123 | Step — Hit Points. Level-1 HP = class hit die + CON modifier (minimum 1). |
| `steps/languages-step.mjs` | 131 | Step — Languages (runs after Class, so ancestry and class both contribute). |
| `steps/origins-step.mjs` | 63 | Step — Origins: Background + Alignment + Deity on one tab. |
| `steps/preview-step.mjs` | 270 | Step — Preview. Final character-sheet preview before creation. |
| `steps/stats-step.mjs` | 271 | Step — Abilities. Roll or assign the six ability scores. |

### 3.15 `scripts/monster-art/`

| File | Lines | Description |
|---|---:|---|
| `monster-token-art.mjs` | 657 | Applies licensed art to monsters **by path reference**, never bundled. |
| `token-art-catalog.mjs` | 621 | Name→art matching catalog. |
| `token-art-manager-app.mjs` | 418 | GM window to review/apply matches. |

### 3.16 `scripts/pdf-export/`

| File | Lines | Description |
|---|---:|---|
| `pdf-sheet-export.mjs` | 403 | "Export to PDF" header button; fills the bundled form-fillable sheet from SD data-model getters. |

### 3.17 `scripts/character-sheet/` — Shadowdark sheet injections

| File | Lines | Description |
|---|---:|---|
| `prayer-roll.mjs` | 131 | Prayer icon beside the sheet's Deity header; rolls that deity's `<Deity> Prayers` table (world first, then compendiums). |

### 3.18 `scripts/downtime/` — between-crawls downtime activities

| File | Lines | Description |
|---|---:|---|
| `downtime-skeleton.mjs` | 196 | Shipped downtime metadata: 25 slots across four activities with names, compressed labels, DCs, paid flags, keyword matchers and renown/XP deltas. Carries no rules text. |
| `downtime-parser.mjs` | 291 | Parses a pasted downtime page into per-slot outcome text; segment-scoped DC + keyword matching with a rescue pass for column-interleaved PDF copies. Unmatched lines are reported back, never guessed at. |
| `downtime-core.mjs` | 208 | Pure downtime rules math: the DC step-down ladder, per-attempt cost by source, the martial-training hit-die tier and caster-list gates, and the stored unlock record shape. |
| `downtime-effects-core.mjs` | 262 | Pure decision layer for downtime outcomes: the slot-to-plan table (auto / choice / narrative), the per-weapon martial-training limit counters and damage-die ladder, the one-shot extortion math, and the XP level-up threshold. Ships item names only, no rules text. |
| `downtime-effects.mjs` | 788 | Applies a successful downtime outcome for real — renown, XP, weapon-training Active Effects, damage-die steps, fabricated scrolls/wands/potions, spell trades, advantage reminders and the merchant extortion flag. Enumerates the concrete choices first; GM-side execution only. |
| `downtime-log-core.mjs` | 199 | Pure downtime-log formatting: the recap headline row, the escaped journal `<li>`, and the newest-first grouping that splices a row under its `data-sde-day` heading. Shared by the recap window, the Discord export and the journal so all three phrase an attempt identically. |
| `downtime-log.mjs` | 183 | `recordDowntime(entry)` — one call, two sinks: the Session Recap's Downtime section and a persistent flagged "Downtime Log" world JournalEntry appended under a heading per real-world day. Queued read-modify-write; never throws outward. GM-side only. |
| `downtime-warnings.mjs` | 87 | Shared prose for the downtime parser's warning codes; splits info notes (a two-column paste always emits them) from real problems, so every unlock surface reports a parse identically. |
| `downtime-app.mjs` | 1395 | The `sde-downtime` ApplicationV2 in three modes: GM solo (pay-before-roll attempts, renown / XP apply buttons), the GM session control panel (picks overview, lock/release, roll-for), and the player view (own actors only, choose then roll). Locked books render as a title-only card; unlocking happens in the Importer Hub. |
| `downtime-session.mjs` | 984 | Table-wide downtime session: world-setting state model, the authenticated downtime query protocol (the raw socket carries only the payload-free re-read nudge), and the GM-authoritative handlers that recompute DC, cost and gating from the skeleton, derive the requester from the server-supplied sender, and spend a per-attempt roll token so a roll settles once. Players pick and roll; the GM settles. |

Ships the skeleton only (activity names, slot labels, DCs, paid flags, renown/XP deltas). Every outcome sentence is pasted by the GM from their own book and stored in the `downtimeContent` world setting, never in the repo.

### 3.19 `scripts/renown/` — the renown fame track

| File | Lines | Description |
|---|---:|---|
| `renown-core.mjs` | 144 | Pure band ladder and phrasing: `renownBand`/`renownBonus` (≤3 / 4–7 / 8–11 / 12+ → +0/+1/+2/+3), `startingRenown` (the CHA modifier), the shared `recapRow`/`renownChangeLine` wording, the short trigger labels, and `isDoubleOnes` — a raw 2d6 total of 2 can only be 1+1. Foundry-free, node-tested. |
| `renown.mjs` | 306 | The single write path for `system.renown`. `Renown.award` updates the actor, logs to the Session Recap and posts a chat card; downtime and the level-up watcher both route through it. Also the party readers the Encounter Roller uses, and the `renownOnLevelUp` setting plus its active-GM-gated `updateActor` watcher. GM-side only. |
| `renown-award-dialog.mjs` | 161 | The GM's award / dock DialogV2. Party roster (renown, band, meaning, bonus) on top, then character + change + reason with the book's triggers as suggestions, plus a "Start at CHA mod" seed. GM-only; every write goes through `Renown.award`. |

The number itself is the SYSTEM's field (`system.renown` on PlayerSD). This folder adds the band ladder, the single logged write path every renown change goes through, and the GM's award dialog. Band thresholds and bonus numbers are mechanics; the one-line band meanings are the module's own wording, not the book's.
<!-- inventory:scripts:end -->
---

## 4. `templates/` — 41 Handlebars templates

`importer-hub.hbs` (939) · `encounter-creator.hbs` (856) · `merchant-shop.hbs` (476) ·
`encounter-roller.hbs` (457) · `downtime.hbs` (422) · `class-importer.hbs` (235) ·
`table-hub.hbs` (232) · `session-recap.hbs` (205) · `magic-forge.hbs` (187) ·
`quick-adjust.hbs` (180) · `monster-importer.hbs` (146) · `level-guidelines.hbs` (109) ·
`token-art-manager.hbs` (107) · `loot-setup.hbs` (97) · `item-builder.hbs` (82) ·
`spell-importer.hbs` (81) · `party-xp.hbs` (71) · `loot-generator.hbs` (52)

- `templates/char-builder/` — shell, gear-editor, `partials/list.hbs`, 11 step bodies.
- `templates/actors/` — `boat-sheet.hbs`, `mount-npc.hbs`.
- `templates/chat/` — encounter-check, encounter-flavor, encounter-result, loot-card.
- `templates/partials/` — `census.hbs`, `tree-node.hbs`, `vehicle-tabs.hbs`.

## 5. `styles/`

`shadowdark-enhancer.css` — **9,456 lines**, the single stylesheet. (Foundry does not refetch module CSS on reload; hard refresh needed.)

## 6. `languages/`

`en.json` — the only localization file.

## 7. `test/` — 67 node `--test` suites (~11,500 lines, flat by design)

Parsers: `statblock-parser`, `gear-parser`, `ancestry-parser`, `hex-parser`, `background-parser`, `boat-parser`, `siege-parser`, `class-parser-talent-layout`, `pdf-text-normalize`, `pdf-extract-crop`, `pdf-extract-gutter`, `pdf-grab-warnings`, `parser-review-regressions`.
Tables: `table-shapes`, `table-name-source-match`, `table-shared-names`, `table-warning-summary`, `carousing-event-shape`, `carousing-outcome-shape`, `traps-hazards-shape`, `core-generator-shapes`, `subroll`.
Class pipeline: `class-quality-gate`, `class-reimport-diff`, `class-borrowed-spell-list`, `class-ability-uses`, `spell-relink`, `spell-relink-persist`.
Monsters: `monster-effect-runtime`, `monster-mechanical-adapters`, `monster-mutator-apply`, `monster-table-runtime`, `monster-table-seed`, `monster-matrix-import`, `monster-generator-integration`, `monster-generator-layout`, `level-guidelines`, `manage-tree-monsters`.
Magic/loot: `magic-forge`, `magic-table-runtime`, `magic-bundle-import`, `magic-bundle-persist`, `magic-loot-handoff`.
Crawl/movement: `crawl-state-core`, `crawl-state-integration`, `crawl-lights-core`, `movement-calc`.
Downtime: `downtime-core`, `downtime-parser`, `downtime-effects`, `downtime-log`, `downtime-affordability`.
Contracts: `docs-contract`, `inventory-contract`.
Multi-client: `gm-relay-handshake`.
Other: `content-registry`, `coins`, `party-xp-core`, `session-recap-core`, `pdf-export`, `source-pdf-registry`, `tokenart-catalog`, `item-builder-gear`, `html-safety`, `loading-dialog-guard`, `encounter-sources`, `importer-hub-cache-invalidation`.

## 8. `assets/` + `icons/` (shipped art)

| Path | Contents |
|---|---|
| `assets/icons/shikashi/` | 284 `.webp` item icons + `manifest.json`. Credited in CREDITS.md. |
| `assets/ancestries/` | 7 ancestry portraits (WebP, ≤1024 px). |
| `assets/pdf/` | Form-fillable character sheet + field map JSON. |
| `assets/portraits/README.md` | Gallery folder usage note. |
| `icons/game-icons/classes/` | 25 recolored game-icons.net class emblems (fill baked in). |
| `icons/game-icons/` | 8 shared SVGs. |
| `icons/` root | `dragon-head.svg`, `light-sabers.svg`, `shamrock.svg`. |

## 9. Tracked-but-not-shipped, and local-only

**Tracked in git but excluded from module.zip** (release.yml allowlist):
`test/`, `package.json`, `eslint.config.mjs`, `.github/`, `tools/` (the
`npm run inventory` generator that maintains this page), `docs/wiki/` (the
manual) and this `docs/FILE-INVENTORY.md`. Of `docs/`, only `API.md` ships.

**Gitignored / local-only** (never published):
- `data/` — `monster-art-mapping.json` (install-specific), `bestiary-reference.json` (third-party scrape; deliberately kept out).
- `dev/` — probes, fixtures, `dev/tests/` content-contract suite, generators, e2e drivers + dumps, `real-pastes/`, `pdf-sheet/` sandbox, page renders, backups, `reorg-2026-07/` (the folder-reorg migration scripts).
- `docs/` except `wiki/`, `API.md`, `FILE-INVENTORY.md` — internal audits, review reports, sweep dumps, the promo plan and `superpowers/` plans/specs; kept on disk, out of git.
- `.planning/` — STATUS, ROADMAP, REQUIREMENTS, playbooks, phases, seeds, sessions, wr-scrape.
- `.claude/`, `.gemini/`, `.superpowers/`, `.hermes/`, `.playwright-mcp/`, `node_modules/`, `package-lock.json`, agent docs. (`verify.sh` is tracked but stays out of the release zip, which is allowlist-based.)
- `training-android/`, `training-app/` — untracked and NOT gitignored; unrelated to the module. Decide: ignore, remove, or move out.
