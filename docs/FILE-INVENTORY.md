# Shadowdark Enhancer — File Inventory (release review, 2026-07-21)

598 tracked files · ~72,300 lines of code/markup across scripts+templates+styles+test.
`v0.11.1` in both `module.json` and `package.json`.
**Layout reflects the 2026-07-21 feature-folder reorganization (v0.11.0 cycle).**

---

## 1. Repo root (shipped)

| File | What it is |
|---|---|
| `module.json` | Foundry manifest. id `shadowdark-enhancer`, v0.10.0, core min 13 / verified 14.364, system shadowdark min 3.6.2 / verified 4.0.6, recommends `shadowdark-extras` 6.10.45. Declares the `mount` + `boat` Actor sub-types, one ESM entry, one stylesheet, `socket: true`. |
| `package.json` | Dev-only. `npm test` → `node --test test/*.test.mjs`; `npm run lint` → eslint over `scripts test`. |
| `eslint.config.mjs` | Flat ESLint config (browser + node globals, Foundry globals). |
| `README.md` | 23 KB user-facing feature docs. |
| `CHANGELOG.md` | 150 KB running changelog. |
| `CREDITS.md` | Third-party asset attribution (Shikashi icon pack, game-icons.net, PD portraits). |
| `LICENSE` | MIT. |
| `.gitattributes`, `.gitignore` | Line-ending rules; ignore list (see §9). |
| `.github/workflows/ci.yml` | Lint + `node --test` on push/PR. |
| `.github/workflows/release.yml` | Tag → build module.zip (allowlist: module.json, README, LICENSE, CHANGELOG, CREDITS, docs/API.md, assets, icons, languages, scripts, styles, templates) + attach manifest to the GitHub release. `test/` and the rest of `docs/` never ship. |

## 2. Repo root (local-only, NOT shipped — see §9)

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.impeccable.md` (agent instructions) ·
`verify.sh` (pre-commit grep wall + `node --check`, `--strict` tier) ·
`package-lock.json`, `node_modules/`.

---

## 3. `scripts/` — module code (feature-folder layout)

### 3.1 `scripts/` root

| File | Lines | Description |
|---|---:|---|
| `shadowdark-enhancer.mjs` | 581 | **Entry point** (module.json esmodules). Registers hooks, settings, sheets, actor sub-types, the public `game.shadowdarkEnhancer` API, and wires every sub-system. |

### 3.2 `scripts/shared/` — cross-feature infrastructure

| File | Lines | Description |
|---|---:|---|
| `module-id.mjs` | 8 | Single source of truth for the module ID (highest fan-in file: 58 importers). |
| `settings.mjs` | 281 | All `game.settings.register` calls + migration-safe defaults. |
| `icons.mjs` | 78 | Centralized icon registry — FontAwesome snippets and vendored SVG references. |
| `compendium-suite.mjs` | 350 | Find-or-create layer for the five managed packs (`sde-actors/items/tables/journal/scenes`); 38 importers. |
| `loading-dialog-guard.mjs` | 112 | Guards the system's leaked `LoadingSD` spinner when `ItemSheetSD.getData` throws. |
| `art-utils.mjs` | 164 | Portrait/token image resolution across world + compendium sources. |
| `coins.mjs` | 105 | Pure Shadowdark currency math (10cp=1sp, 10sp=1gp). |
| `esc.mjs` | 16 | HTML-escape helper for safe `innerHTML` interpolation. |

### 3.3 `scripts/crawl-strip/` — the top strip + movement + combat sync

| File | Lines | Description |
|---|---:|---|
| `crawl-strip.mjs` | 856 | The core feature: the top strip. Plain DOM (`#shadowdark-enhancer-strip`), not ApplicationV2. |
| `crawl-state.mjs` | 365 | Foundry-coupled state singleton — persistence, sockets, hook emission. |
| `crawl-state-core.mjs` | 138 | Pure reducer/normalizer behind crawl-state. Node-testable. |
| `crawl-lights-core.mjs` | 93 | Pure light-source logic for the strip's flame badges. |
| `initiative-manager.mjs` | 129 | Combat/initiative state machine glue for the strip. |
| `hidden-sync.mjs` | 66 | Bidirectional `token.hidden` ↔ `combatant.hidden` sync, GM-only. |
| `movement-tracker.mjs` | 684 | Crawl-mode movement budget enforcement + turn-start rollback (`displace` waypoints). |
| `movement-calc.mjs` | 88 | Pure per-segment feet-moved math. |
| `npc-action-menu.mjs` | 509 | Per-combatant hover action HUD. |

### 3.4 `scripts/crawl-bar/`

| File | Lines | Description |
|---|---:|---|
| `crawl-bar.mjs` | 607 | GM-only persistent bottom bar above the macro bar (mode toggles, tools, launchers). |

### 3.5 `scripts/encounter/` — the Encounter Roller

| File | Lines | Description |
|---|---:|---|
| `encounter-roller-app.mjs` | 1362 | The Encounter Roller shell + tabs (Roll Tables / Build / Browse / Creator). |
| `encounter-check.mjs` | 80 | The d6 random-encounter check + chat post. |
| `encounter-result.mjs` | 32 | Distance / Activity / Reaction RAW lookups. |
| `encounter-build.mjs` | 286 | Build-a-table data layer (slots, die formats, save to RollTable). |
| `encounter-browse.mjs` | 218 | Browse-NPCs data layer (sources, loading, cache, filter/sort). |
| `npc-index.mjs` | 260 | NPC actors → compact browse row model. |

### 3.6 `scripts/monster-creator/`

| File | Lines | Description |
|---|---:|---|
| `encounter-creator.mjs` | 1531 | Monster Creator — multi-section NPC authoring tool mounted in the roller. |
| `action-templates.mjs` | 126 | Quick-pick NPC attack/action catalog (FA6 Free glyphs only). |
| `feature-templates.mjs` | 83 | Quick-pick NPC feature catalog. |
| `monster-effect-runtime.mjs` | 540 | Provenance-backed effect overlay engine for the Creator draft. |
| `monster-mechanical-adapters.mjs` | 330 | Sole authority for what mechanics a generator result actually applies. |
| `monster-mutator.mjs` | 139 | Clone an existing NPC and apply imported matrix results. |
| `monster-table-runtime.mjs` | 578 | Reads the GM's own imported Core matrix tables to drive the Generator/Mutator. |
| `spell-index.mjs` | 190 | Lightweight Spell index (compendium indices, not documents). |
| `npc-moves.mjs` | 16 | Canonical NPC movement keys with a pre-config fallback. |
| `npc-statblock.mjs` | 125 | Builds the formatted `system.notes` statblock HTML. |

### 3.7 `scripts/loot/`

| File | Lines | Description |
|---|---:|---|
| `loot-generator-app.mjs` | 227 | Roll a loot table, work a running batch, whisper claimable cards. |
| `loot-generator.mjs` | 209 | RollTable → structured loot batch (documents, coins, flavor). |
| `loot-delivery.mjs` | 413 | Shared claimable chat card; first-claim-wins, GM-authoritative over socket. |
| `loot-drops.mjs` | 39 | Auto-drop loot on NPC defeat at combat end. |
| `loot-setup-app.mjs` | 237 | Browsable Loot & Treasure library; rows unlock from the GM's own PDF. |
| `loot-value.mjs` | 68 | gp value → Shadowdark XP quality tiers. |
| `loot-table-catalog.mjs` | 312 | Loot/treasure table catalog + classifier across Core, CS1–6, WR (metadata only). |
| `loot-table-tag.mjs` | 80 | Sidebar context-menu "Mark as Loot Table" toggle. |
| `loot-catalog.mjs` | 114 | Rewrites loot tables so entries become DOCUMENT results. |
| `loot-linker.mjs` | 115 | Loot row text → confident compendium item link. |
| `loot-pack.mjs` | 162 | Classify/fabricate treasure entries + world "Loot" pack ops. |
| `treasure-data.mjs` | 15 | Level → tier band boundaries. |
| `item-drops.mjs` | 553 | Drag items to canvas as pickup tokens; TokenHUD pickup; light sources burn. |

### 3.8 `scripts/magic-forge/`

| File | Lines | Description |
|---|---:|---|
| `magic-forge-app.mjs` | 725 | Magic Item Forge window (weapons/armor with working +N, benefit/curse riders). |
| `magic-forge.mjs` | 260 | Core engine building items that actually function in the system. |
| `magic-table-runtime.mjs` | 708 | Drives forge recipes off the GM's own imported magic-item tables. |

### 3.9 `scripts/merchant/`

| File | Lines | Description |
|---|---:|---|
| `merchant-shop.mjs` | 2405 | Two-mode shop system (compendium global or actor NPC inventory); GM opens for all players. |
| `merchant-defaults.mjs` | 178 | The two shipped merchant configs (Base, Western Reaches). |

### 3.10 `scripts/party-xp/`

| File | Lines | Description |
|---|---:|---|
| `party-xp.mjs` | 306 | Award XP to the whole party in one click (ApplicationV2 GM tool). |
| `party-xp-core.mjs` | 52 | Pure XP math + item-XP resolution. |

### 3.11 `scripts/session-recap/`

| File | Lines | Description |
|---|---:|---|
| `session-recap.mjs` | 595 | Session event tracker singleton (loot, sales, XP, combats, per-PC stats). |
| `session-recap-core.mjs` | 310 | Pure data shape, currency math, duration format, Discord-markdown export. |
| `session-recap-app.mjs` | 267 | Recap window: Overview / Combat / Loot / XP / History. |

### 3.12 `scripts/importer/` — hub + cross-type infrastructure

| File | Lines | Description |
|---|---:|---|
| `importer-hub-app.mjs` | 668 | **The single front door (shell).** ApplicationV2 lifecycle, singleton, instance fields/caches, `_prepareContext`; installs the three method packs below onto the class (split 2026-07-22). |
| `importer-hub-paste.mjs` | 1275 | Paste box, type selector, parse dispatch, per-type preview field/row wiring. |
| `importer-hub-commit.mjs` | 708 | Conflict dialogs, quality gates, magic-bundle plan, all per-type commit flows. |
| `importer-hub-manage.mjs` | 732 | Manage strip: censuses + caches, manage tree, gap/seed/cull, source-PDF grab/extract. |
| `importer-hub-shared.mjs` | 91 | Hub-shared constants/helpers + `installMethods` (the split's descriptor copier). |
| `importer-hub-maintenance.mjs` | 192 | Tools-menu bodies (bundle export/import, source-PDF library). |
| `dump-segmenter.mjs` | 307 | Routes a mixed dump through the recognizer registry: hexcrawl → spell → monster → item → table. |
| `bundle-io.mjs` | 351 | Whole-suite export/import as one JSON; validates, skips existing, never overwrites. |
| `manage-tree.mjs` | 396 | Composes the folder/sub-folder unlock-review tree the Manage strip renders. |
| `pdf-text-extract.mjs` | 308 | Clean reading-ordered PDF text via Foundry's bundled PDF.js; column-aware gutter detection. |
| `pdf-text-utils.mjs` | 140 | Shared PDF-text helpers + the HTML-safety contract. |
| `source-pdf-registry.mjs` | 215 | Content source → the user's own uploaded PDF, for page deep-links. |
| `source-pdf-viewer.mjs` | 66 | Singleton ApplicationV2 embedding Foundry's PDF.js viewer at a given page. |

#### 3.12.1 `importer/char-content/`

| File | Lines | Description |
|---|---:|---|
| `char-content-manifest.mjs` | 1303 | Metadata-only manifest of CS4–6 + WR char-builder content (names/types/sources, no rules text) + `parseCharContent` + census. |
| `class-parser.mjs` | 1002 | Class section → structured unit (writeup, talents, tables, spellcasting). Pure. |
| `class-importer-app.mjs` | 733 | Purpose-built single-view class workspace. |
| `class-unit-importer.mjs` | 1064 | Class unit → real documents in dependency order. |
| `class-overlays.mjs` | 220 | SDE-original automation not derivable from book text (ActiveEffects, invented names). |
| `class-quality-gate.mjs` | 113 | The one place computing blocking class-import issues + override dialog. |
| `class-index.mjs` | 85 | Class name → system Class item UUID. |
| `language-resolver.mjs` | 16 | Language names → system UUIDs. |

#### 3.12.2 `importer/spells/`

| File | Lines | Description |
|---|---:|---|
| `spell-parser.mjs` | 284 | Spell blocks → Spell drafts. Pure. |
| `spell-importer-app.mjs` | 454 | Spell workspace organized by class / tier / alignment. |

#### 3.12.3 `importer/tables/` (incl. the Gameplay content taxonomy)

| File | Lines | Description |
|---|---:|---|
| `table-importer.mjs` | 2639 | Roll-table text → structure. The big one; includes `repairSharedStartRanges`. |
| `table-shapes.mjs` | 400 | Per-unlock deterministic table SHAPE recipes (prayer/grid/lookup/reflow kinds). |
| `table-manifest.mjs` / `table-manifest-data.mjs` | 166 / 335 | Canonical table catalog (data half generated by `dev/gen-table-manifest.py`). |
| `table-hub.mjs` | 288 | Reconciles the shipped manifest against the live world (system / imported / missing). |
| `table-hub-app.mjs` | 499 | "Set up ALL tables" window — dashboard + import view. |
| `table-registry.mjs` | 206 | Parses live tables into `{source, page, displayName, subCategory}` and groups them. |
| `table-seed-map.mjs` | 240 | Generated table-name → group-id seed map. |
| `table-structure-seeds.mjs` | 2106 | Structure-only seeds (formulas, folders, flags, chain links). |
| `table-folders.mjs` | 131 | Single source of truth for where a table files in `sde-tables` — **owns the Gameplay vs Roll Tables split**. |
| `table-categories.mjs` | 65 | Table-type taxonomy + classifier. |
| `table-enrich.mjs` | 164 | Brings imported tables to "Ruin Encounters" standard; owns the debounced auto-relink sweep. |
| `core-table-groups.mjs` | 246 | Core Rulebook table groups (`section: "gameplay"` vs roll tables) for the Manage tree. |
| `compound-table.mjs` | 93 | Mad-libs generator roll behaviour. |
| `hex-parser.mjs` | 340 | Hex-key dumps → per-hex draft journal pages. Pure. |

#### 3.12.4 `importer/monsters/`

| File | Lines | Description |
|---|---:|---|
| `statblock-parser.mjs` | 516 | Monster statblock dump → draft objects. Pure. |
| `monster-importer.mjs` | 226 | Drafts → NPC actors in `sde-actors`. |
| `monster-importer-app.mjs` | 378 | Paste dump → per-monster preview/edit grid → create. |
| `monster-census.mjs` | 154 | Pure have/gap/duplicate helpers. |
| `monster-census-live.mjs` | 378 | Foundry-bound adapter reading `sde-actors`/`sde-tables`. |
| `monster-backfill.mjs` | 359 | Idempotent upgrade of pre-fidelity-fix imports; auto-runs once per module version. |
| `actor-migration.mjs` | 380 | World-side imported actors → the managed `sde-actors` pack. |
| `monster-linker.mjs` | 124 | Table encounter text → clickable `@UUID` monster links. |
| `monster-pack.mjs` | 42 | Shared pack-identity leaf so importer and linker agree. |

#### 3.12.5 `importer/items/`

| File | Lines | Description |
|---|---:|---|
| `item-parser.mjs` | 450 | Generic item recognizer (name/cost/slots). Pure. |
| `gear-parser.mjs` | 535 | Real Weapon/Armor stat parser (WR letter codes, treasure flags). Pure. |
| `gear-join.mjs` | 244 | Joins split cost-table + description layouts into one item. Pure. |
| `item-importer.mjs` | 704 | Drafts → Items in `sde-items`, foldered by source. |
| `item-builder-app.mjs` | 394 | Guided multi-stage equipment-section workspace. |
| `item-builder-gear.mjs` | 121 | Pure stage-①/③ logic for the Item Builder. |
| `item-census-live.mjs` | 200 | Items census adapter (same shape as monsters). |
| `shikashi-icons.mjs` | 235 | Item name → bundled Shikashi icon matcher (284 icons). |

### 3.13 `scripts/actors/` — Mount & Boat sub-types

| File | Lines | Description |
|---|---:|---|
| `register-actors.mjs` | 74 | Registers `shadowdark-enhancer.mount` / `.boat` (models + sheets, in `i18nInit`). |
| `boat-data-model.mjs` | 77 | Boat data model — WR vessel rules. |
| `boat-sheet.mjs` | 104 | Boat sheet: Overview / Passengers & Crew / Cargo / Description. |
| `mount-npc-sheet.mjs` | 329 | Mount sheet — subclass of the system's `NpcSheetSD`. |
| `vehicle-sheet.mjs` | 256 | Shared party-like container base (ApplicationV2). |
| `vehicle-rolls.mjs` | 37 | Shared helper-roll button handlers. |

### 3.14 `scripts/char-builder/` — guided character creation

| File | Lines | Description |
|---|---:|---|
| `char-builder-app.mjs` | 276 | `ShadowdarkCharBuilder` ApplicationV2 shell; drives the step lifecycle. |
| `state.mjs` | 63 | `CharBuilderState` — the in-progress character. |
| `constants.mjs` | 137 | Shared constants; hands off to the system's `CharacterGeneratorSD`. |
| `data.mjs` | 256 | Thin wrappers over the system's compendium loaders. |
| `commit.mjs` | 286 | `commitCharacter` — final actor creation + `coinsAfterGear`. |
| `art.mjs` | 77 | Ancestry/class NAME → local portrait manifest. |
| `art-gallery.mjs` | 162 | GM-curated portrait gallery (avoids granting players `FILES_BROWSE`). |
| `class-ability-uses.mjs` | 112 | Per-day/roll uses for Class Ability items. |
| `gear-editor-app.mjs` | 152 | `ExtraGearEditor` sub-window. |
| `steps/` (15 files) | ~2,600 | base-step + list-step bases, then stats, ancestry, class (824 — largest), origins, background, alignment, deity, languages, hp, hp-gold, gold, gear, preview. |

### 3.15 `scripts/monster-art/`

| File | Lines | Description |
|---|---:|---|
| `monster-token-art.mjs` | 657 | Applies licensed art to monsters **by path reference**, never bundled. |
| `token-art-catalog.mjs` | 621 | Name→art matching catalog. |
| `token-art-manager-app.mjs` | 418 | GM window to review/apply matches. |

### 3.16 `scripts/pdf-export/`

| File | Lines | Description |
|---|---:|---|
| `pdf-sheet-export.mjs` | 385 | "Export to PDF" header button; fills the bundled form-fillable sheet from SD data-model getters. |
| `lib/pdf-lib.esm.min.js` | — | Vendored pdf-lib v1.17.1 (MIT; license + provenance note beside it). |

---

## 4. `templates/` — 38 Handlebars templates

`importer-hub.hbs` (806) · `encounter-creator.hbs` (730) · `merchant-shop.hbs` (471) ·
`encounter-roller.hbs` (457) · `class-importer.hbs` (235) · `table-hub.hbs` (232) ·
`magic-forge.hbs` (187) · `session-recap.hbs` (185) · `monster-importer.hbs` (146) ·
`token-art-manager.hbs` (107) · `loot-setup.hbs` (97) · `item-builder.hbs` (82) ·
`spell-importer.hbs` (81) · `party-xp.hbs` (71) · `loot-generator.hbs` (51)

- `templates/char-builder/` — shell, gear-editor, `partials/list.hbs`, 11 step bodies.
- `templates/actors/` — `boat-sheet.hbs`, `mount-npc.hbs`.
- `templates/chat/` — encounter-check, encounter-flavor, encounter-result, loot-card.
- `templates/partials/` — `census.hbs`, `tree-node.hbs`, `vehicle-tabs.hbs`.

## 5. `styles/`

`shadowdark-enhancer.css` — **8,651 lines**, the single stylesheet. (Foundry does not refetch module CSS on reload; hard refresh needed.)

## 6. `languages/`

`en.json` — the only localization file.

## 7. `test/` — 44 node `--test` suites (~7,700 lines, flat by design)

Parsers: `statblock-parser`, `gear-parser`, `ancestry-parser`, `hex-parser`, `class-parser-talent-layout`, `table-shapes`, `pdf-text-normalize`, `pdf-extract-crop`, `parser-review-regressions`.
Class pipeline: `class-quality-gate`, `class-reimport-diff`, `class-borrowed-spell-list`, `class-ability-uses`, `spell-relink`, `spell-relink-persist`.
Monsters: `monster-effect-runtime`, `monster-mechanical-adapters`, `monster-mutator-apply`, `monster-table-runtime`, `monster-table-seed`, `monster-matrix-import`, `monster-generator-integration`, `monster-generator-layout`.
Magic/loot: `magic-forge`, `magic-table-runtime`, `magic-bundle-import`, `magic-bundle-persist`, `magic-loot-handoff`.
Crawl/movement: `crawl-state-core`, `crawl-state-integration`, `crawl-lights-core`, `movement-calc`.
Other: `content-registry`, `coins`, `party-xp-core`, `session-recap-core`, `pdf-export`, `source-pdf-registry`, `tokenart-catalog`, `item-builder-gear`, `html-safety`, `loading-dialog-guard`.

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
`test/`, `package.json`, `eslint.config.mjs`, `.github/`, and all of `docs/`
except `API.md` (internal audits, review reports, superpowers plans/specs).

**Gitignored / local-only** (never published):
- `data/` — `monster-art-mapping.json` (install-specific), `bestiary-reference.json` (third-party scrape; deliberately kept out).
- `dev/` — probes, fixtures, `dev/tests/` content-contract suite, generators, e2e drivers + dumps, `real-pastes/`, `pdf-sheet/` sandbox, page renders, backups, `reorg-2026-07/` (the folder-reorg migration scripts).
- `.planning/` — STATUS, ROADMAP, REQUIREMENTS, playbooks, phases, seeds, sessions, wr-scrape.
- `.claude/`, `.gemini/`, `.superpowers/`, `.hermes/`, `.playwright-mcp/`, `node_modules/`, `package-lock.json`, agent docs, `verify.sh`.
- `training-android/`, `training-app/` — untracked and NOT gitignored; unrelated to the module. Decide: ignore, remove, or move out.
