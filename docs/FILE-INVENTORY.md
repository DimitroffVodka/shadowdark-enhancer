# Shadowdark Enhancer — File Inventory

<!-- inventory:stats:start -->
834 tracked files · ~127,400 lines of code/markup across scripts+templates+styles+test.
`v0.15.1` in both `module.json` and `package.json`.
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
| `shadowdark-enhancer.mjs` | 803 | **Entry point** (module.json esmodules). Registers hooks, settings, sheets, actor sub-types, the public `game.shadowdarkEnhancer` API, and wires every sub-system. |
| `luck-reroll/luck-reroll.mjs` | 171 | Wraps the system's `_onReroll` to enforce nat-1 prevention and log Luck rerolls to the session recap. |
| `spell-mishap/spell-mishap.mjs` | 270 | Nat-1 spellcasting failures auto-roll the class's mishap table (wizard / witch / necromancer sets); divine casters are exempt. |
| `scavenger/scavenger-core.mjs` | 171 | Pure Delver Scavenger rules: the 5-6 success range and Master Scavenger's widening (floored at 3-6), what counts as expending a consumable's last use (a 1→0 decrement or a delete at quantity 1 — never a stack deleted whole), and which single client rolls. |
| `scavenger/scavenger.mjs` | 183 | Foundry wiring for Scavenger: pre-hooks snapshot the quantity and a restore copy, post-hooks roll the d6, post the card, and hand back one use — refuelling and unlighting a restored light source. |
| `parry/parry-core.mjs` | 112 | Pure Duelist Parry rules: what the system's clamped `applyDamage` actually removes (so a reversal gives back the clamped delta, not the printed damage), whether an attack is parryable, and which parts of a downed state this hit caused. |
| `parry/parry.mjs` | 441 | Parry button on an attack card that hit: spends the 1/day use, makes the attack miss, and reverses damage the GM already applied — HP, defeated flag and downed conditions. Player clicks go through the authenticated gm-relay. |
| `taunt/taunt-core.mjs` | 118 | Pure Duelist Taunt rules: round+turn as one ordinal, the "end of your NEXT turn" expiry comparison, advantage/disadvantage cancelling, and what arms the talent (a miss — including a parried hit). |
| `taunt/taunt.mjs` | 249 | Arms Taunt when an enemy misses its holder, sets `mainRoll.advantage` on attacks back at that enemy via `SD-Player-Attack` (with the reason printed on the roll card), and expires it when the holder's next turn ends. |

### 3.2 `scripts/shared/` — cross-feature infrastructure

| File | Lines | Description |
|---|---:|---|
| `module-id.mjs` | 8 | Single source of truth for the module ID (highest fan-in file: 58 importers). |
| `source-keys.mjs` | 71 | One canonical key per source book (core/cs1-6/wr) across every spelling. |
| `curated-icons.mjs` | 477 | The one curated-icon resolver (A4), pure and Foundry-free. Six issue paths want a reviewed Foundry-native icon for an item this module imported or generated; rather than each growing its own name matching (as `core-monster-spell-icons.mjs` did for Monster Spells), they share this. TWO KEY SPACES, and the split is structural rather than stylistic: weapons, armor and basic gear key on `normalize(name)` alone, because `defaultItemImg` — the module's single automatic art-choice channel — cannot know which book a draft came from (source is a commit-time batch option threaded through `createItems`, reaching the document only afterwards as a flag), so a source-qualified gear key would be unresolvable at the one place gear art is chosen; treasure keys are `<sourceId>:<normalize(name)>` via `sourceKey`, because its names are book prose two Cursed Scrolls could both print. Map keys are DERIVED from display names, never hand-written beside them — the reviewed source spec drifted exactly that way — and map construction is TOTAL: a duplicate key, blank name or path that is not a native `icons/**.webp` drops that row into `problems` and leaves the item on its fallback, because throwing at load would take the module down over an icon. `auditCuratedIconRegistry` aggregates those for the test gate. Registration is BY IMPORT (`registerCuratedIconMap`) so the tickets owning the rows never edit one shared list. `isCuratedApplyTarget` is a `world.` allowlist, not a denylist: `LootLinker` resolves rows system-pack-first by design, so a plunder row's uuid routinely points into `shadowdark.gear`, and a materializer applying art to whatever it just resolved would edit the base system compendium. Unmatched returns null — never a guess, because a wrong curated icon looks deliberate. |
| `curated-icon-maps/index.mjs` | 71 | Discovery point for the curated-icon maps (A4). Each reviewed map lives beside this file as its own module, publishes itself with `registerCuratedIconMap` at import time, and becomes reachable when this index side-effect-imports it. Loaded once from the module entry point so every consumer sees the same registry regardless of load order. A ticket adding a map creates ONE file and appends ONE import line, so two tickets never collide on a shared array literal. Carries the worked example and the four invariants the audit enforces: native `icons/**.webp` paths, keys derived from display names, bare-space names globally distinct across the weapon/armor/gear maps, and treasure rows qualified by book. The D1 weapon, D2 armor, and D3 Basic Gear maps are the active production registrations; an uncovered category remains on null lookup and its prior fallback/provenance behaviour. |
| `curated-icon-maps/armor-icons.mjs` | 26 | The reviewed N3 armor map (D2): nine canonical armor names plus four deliberate mithral source-spelling aliases, registered through A4's bare normalized-name key space. Each alias shares its canonical armor's Foundry-native icon; category tests audit all 13 accepted rows against the real public/icons inventory and exercise A3 upgrade/preservation provenance. |
| `curated-icon-maps/gear-icons.mjs` | 57 | The N3/D3 Basic Gear curated icon map: 44 source-agnostic bare-name rows covering Core/Western Reaches gear, including explicit quantity and spelling aliases. Each path is a reviewed native Foundry `icons/**.webp` asset; registration occurs at import time through the A4 discovery seam. |
| `curated-icon-maps/weapon-icons.mjs` | 47 | N3's 37 reviewed Foundry-native weapon icons, keyed by source-agnostic normalized final Item name and registered through the A4 discovery seam. |
| `attack-card.mjs` | 107 | Reading a Shadowdark attack card — was it an attack at all (a targeted spell is not), did it land, who was it aimed at, who swung. Shared by Parry and Taunt so the two can never disagree about the target (they once did, silently). |
| `settings.mjs` | 455 | All `game.settings.register` calls + migration-safe defaults. |
| `icons.mjs` | 84 | Centralized icon registry — FontAwesome snippets and vendored SVG references. |
| `compendium-suite.mjs` | 403 | Find-or-create layer for managed world packs, ownership, sidebar folders, and source folders. |
| `loading-dialog-guard.mjs` | 112 | Guards the system's leaked `LoadingSD` spinner when `ItemSheetSD.getData` throws. |
| `art-utils.mjs` | 164 | Portrait/token image resolution across world + compendium sources. |
| `coins.mjs` | 105 | Pure Shadowdark currency math (10cp=1sp, 10sp=1gp). |
| `esc.mjs` | 16 | HTML-escape helper for safe `innerHTML` interpolation. |
| `gm-relay.mjs` | 317 | The one authenticated relay channel, both directions. Rides Foundry's user-query transport, where the SERVER stamps the sender from the authenticated socket, so an identity check can no longer be defeated by a payload naming a GM. Owns the shared ownership gate (`authorizeActorFor` / `authorizeActorRequest`), the GM-side entry guard (`refuseQuery`), the player-side `queryActiveGM` / `relayToGM`, and `notifyPlayers` for a GM→players push that the receiver can verify. A query the GM's build cannot answer is itself the stale-tab signal, so the old forgeable ping/pong handshake is gone while its wording (`evaluateHandshake` / `handshakeWarning`) is kept. |
| `token-placement.mjs` | 236 | Click-to-place token placement over a QUEUE of different creatures — a pit-fight row can name two creatures with their own counts, so the loop walks a queue and the notification names what the next click will drop. `worldActorFor` imports a compendium actor once and reuses it by name+type (with a one-shot art repair on copies imported before a community-tokens mapping loaded), `tokenSourceFor` picks the best non-placeholder texture, and `placeTokensByClick` runs the cancellable capture-phase `pointerdown` loop, snapping to the grid. Every actor and texture is resolved BEFORE the first click, so no await sits between a click and its token. |
| `art-provenance.mjs` | 262 | Explicit art provenance for imported Items (pure), replacing the old `img.startsWith("icons/")` guess. Every image the module writes is stamped `flags[MODULE_ID].art = {state, img}`, so the next import compares the stored image against the path it actually wrote: still equal means the recorded state stands (`default` / `imported` / `curated`, all upgradeable), and any divergence is `custom` — the GM's, and never overwritten. The guess it replaces was wrong in both directions: this module's own bundled Shikashi defaults live under `modules/shadowdark-enhancer/assets/` and so failed the `icons/` test and erased hand-picked art, while a deliberate curated `icons/...` pick looked like a default and could never be upgraded. Legacy unmarked documents are classified deterministically and conservatively — an image byte-identical to the module's default pick for that name and type today (or no image at all) is `default`, everything else is `custom` — and the first re-import stamps the verdict so it never drifts. Also carries the structural generated-artifact boundary (`isGeneratedManagedItem`): the explicit `flags[MODULE_ID].generated` marker PLUS membership of the managed Items pack, the one case that stays replace-always, art included (A7/D6). Exactly ONE marker, deliberately — "generated" is not a single policy here. The Monster Spell library also generates documents but preserves hand-edited ones as curated conflicts, and since A1 they share this pack, so recognising its `monsterSpell.generated` bookkeeping would let an ordinary name collision overwrite a spell the GM had curated. Foundry-free, node-tested. |
| `clipboard.mjs` | 46 | `copyText()` — clipboard write that survives insecure origins, where `navigator.clipboard` is undefined; falls back to a hidden textarea + `execCommand`, restores focus, and never throws. |
| `contextual-enricher.mjs` | 193 | The one contextual check/request/roll enricher (A5), pure and Foundry-free. #56 wants an Arctic Sea row's "DC 15 DEX or 2d4 damage" to become a clickable check; #61 wants the identical prose in a monster's stat block to become a GM-side REQUEST instead. Same characters, different button — so the syntax CANNOT be inferred from the text, and this module refuses to try: the caller states a context (`table`/`environment`/`monster`) and an unknown or missing one throws rather than defaulting, because the failure this seam exists to prevent is one syntax silently serving every context. `table` and `environment` share a command today and stay separate names so a later divergence is a one-line change here rather than a caller-side edit. Emitted forms are dictated by the system's own enricher (`systems/shadowdark/src/enrichers.mjs`, `\[\[(check\|request)\s(\d+)\s(\w{3})\]\]`): exactly one space between tokens and a THREE-letter ability key, so "DC 15 Dexterity" must emit `dex` and any spacing variation is dead markup that renders as literal text. Enrichment is a FIXED POINT, and that is why it is a character mask rather than a chain of `String.replace` calls: `[[…]]` macros, `@UUID[…]{…}` labels and HTML tags are masked off before any rule runs, so a second pass returns the same bytes and no rule can rewrite the inside of another's markup — the mask also makes the rules mutually exclusive, so rule ORDER is a policy statement (checks are the more specific reading and win) instead of an accident of replacement order. Conservative by design: only a fully determined expression converts, so a bare "DC 15" or "DC 15 damage" stays prose; nothing is ever deleted or reordered, only wrapped. `enrichDice` is the dice half alone, and `monster-linker.convertDice` delegates to it rather than keeping a second copy — the local rule it replaces guarded only the exact `[[/r ` prefix, so it double-wrapped the second term of `[[/r 2d4+1d6]]` and rewrote dice inside an existing link label. |
| `generated-items.mjs` | 643 | Stable identity and replace-always reconciliation for generated managed Items (A7/#57-#59) — the PRODUCER half of the boundary `art-provenance.mjs` defined and left unowned. The invariant is structural and both halves are required: a document is replace-always iff it lives in `world.shadowdark-enhancer--items` AND carries `flags[MODULE_ID].generated === true`. Neither is inferred — not from an image path, a name, a folder, or another pipeline's bookkeeping — and `planGeneratedItems` refuses outright for any other pack rather than reconciling something it has no authority over, which is what stands between an authoritative rerun and editing the system gear compendium. Identity is `flags[MODULE_ID].generatedItem = {id, source, key, fingerprint}` where `id` is FNV-1a/32 over `<canonical source>:<normalized name>`: derived from the definition, so it is identical on every machine and stable across a rerun that changes art, price or prose, and deliberately NOT the world-local document id, the image path (the thing A3 was written to stop reading) or a fuzzy name (the thing #58 was about). Reconciliation indexes on `id` but writes only when the stored canonical `key` also matches; a hash/key mismatch is an `identity-collision` refusal, not a wrong-target update. `name` appears only in the REFUSAL path, where a name already held by a document we do not own — since A1 that can be a generated Monster Spell, whose `monsterSpell.generated` marker means PRESERVE, the opposite thing — is reported, never taken over. Replace-always but not write-always: a rerun is `unchanged` only when the definition has not moved since we last wrote it AND no declared field has been edited since, so hand edits including art are replaced while an idle rerun writes nothing. The two-witness test is what makes a hand edit visible, and the stored document is PROJECTED onto the declared shape recursively — including non-empty ActiveEffects — before comparison so Foundry's own DataModel defaults and embedded ids are not read as an edit. `folder` is excluded — placement is the GM's. Updates carry forward undeclared top-level third-party flag namespaces through both replacement branches. Pure above the divider; the applier below reports create/update/missing-target failures, while a failed recreate deletion remains a visible duplicate requiring GM cleanup (retryable, not transactional). |
| `module-flags.mjs` | 126 | What this module owns on a document's flags, and what survives a wholesale replacement (pure). `replaceDocument` updates with `recursive: false`, which is right for `system` and wrong for `flags`: a creation payload knows only the bookkeeping ITS pipeline stamps, so replacing the object outright deletes every other pipeline's — including `monsterSpell.libraryId`, the only handle the Monster Spell planner has on a generated spell, whose loss makes the next refresh create a duplicate (A8/#93). `preservedModuleFlags` re-merges this module's namespace only: keys the payload declares win, keys it never mentions survive, and other packages' namespaces are left exactly as the payload states them. `replacementFlags` then answers the two replace branches SEPARATELY, because they are not symmetric — an update keeps the document, so a payload declaring no flags correctly omits the key and the stored object is never touched, while a recreate DELETES the original and must therefore carry those blocks itself or lose them (the defect that quietly recreated a Monster Spell without its `libraryId` on any forced fallback or type mismatch). Also carries `isGeneratedMonsterSpell`, read from the library's own `monsterSpell.generated` marker and never from the A7/D6 `flags[MODULE_ID].generated` replace-always marker — the two contracts share the managed Items pack and mean opposite things. Foundry-free, node-tested. |
| `property-note.mjs` | 194 | Stamps and preserves the "no core Shadowdark property" note on imported gear (pure). Also owns which description survives a REPLACE: the GM's own text beats importer output, and importer output is the empty placeholder, the note alone, or — since A8 — a description that merely echoes the document's name, which is exactly what `buildItemData`'s Spell path writes when a paste brings no prose. |

### 3.3 `scripts/crawl-strip/` — the top strip + movement + combat sync

| File | Lines | Description |
|---|---:|---|
| `crawl-strip.mjs` | 1617 | The core feature: the top strip. Plain DOM (`#shadowdark-enhancer-strip`), not ApplicationV2. |
| `crawl-state.mjs` | 443 | Foundry-coupled state singleton — persistence, sockets, hook emission. |
| `crawl-state-core.mjs` | 321 | Pure reducer/normalizer behind crawl-state. Node-testable. |
| `crawl-lights-core.mjs` | 93 | Pure light-source logic for the strip's flame badges. |
| `crawl-tracker.mjs` | 340 | The out-of-combat tracker as a real sidebar tab (`AbstractSidebarTab`), registered into `Sidebar.TABS` + `CONFIG.ui` beside Combat. Hidden unless a crawl is running; carries the roll-all / advance / reset controls. |
| `crawl-tracker-core.mjs` | 138 | Pure view model for the tracker tab: `buildTrackerRows()` (rolled first, unrolled last, holder flagged), `showOocReset()`, and `parseInitiativeInput()` — which treats a blanked box as "no change" rather than the initiative of 0 that `Number("")` yields. Node-testable. |
| `initiative-manager.mjs` | 133 | Combat/initiative state machine glue for the strip. |
| `hidden-sync.mjs` | 66 | Bidirectional `token.hidden` ↔ `combatant.hidden` sync, GM-only. |
| `turn-skip.mjs` | 77 | Auto-advances past combatants the strip renders no card for (dead enemies). Active-GM gated. |
| `turn-skip-core.mjs` | 106 | Pure strip-visibility test shared by the strip and the auto-skip, so the two can't drift. |
| `movement-tracker.mjs` | 806 | Crawl-mode movement budget enforcement + turn-start rollback (`displace` waypoints). |
| `movement-calc.mjs` | 88 | Pure per-segment feet-moved math. |
| `npc-action-menu.mjs` | 630 | Per-combatant hover action HUD. |
| `crawl-turn-core.mjs` | 121 | Pure turn-advance authorization for the crawl strip: `canAdvanceTurn()` (a GM always may; a player only when they own the current combatant and the advance would not roll the round) and `nextTurnWouldRollRound()`, mirroring `Combat#nextTurn`'s real wrap rules. |
| `movement-lock-core.mjs` | 78 | Pure `shouldBlockMovement()` gate for the out-of-turn movement lock — blocks only a non-current combatant of a started combat, matched by (sceneId, tokenId). GMs, non-combatants, non-positional updates, and everything out of combat pass through. |

### 3.4 `scripts/crawl-bar/`

| File | Lines | Description |
|---|---:|---|
| `crawl-bar.mjs` | 621 | GM-only persistent bottom bar above the macro bar (mode toggles, tools, launchers). |

### 3.5 `scripts/encounter/` — the Encounter Roller

| File | Lines | Description |
|---|---:|---|
| `encounter-roller-app.mjs` | 1431 | The Encounter Roller shell + tabs (Roll Tables / Build / Browse / Creator). |
| `encounter-check.mjs` | 80 | The d6 random-encounter check + chat post. |
| `encounter-result.mjs` | 41 | Distance / Activity / Reaction RAW lookups. |
| `encounter-build.mjs` | 285 | Build-a-table data layer (slots, die formats, save to RollTable). |
| `encounter-browse.mjs` | 217 | Browse-NPCs data layer (sources, loading, cache, filter/sort). |
| `npc-index.mjs` | 260 | NPC actors → compact browse row model. |
| `encounter-sources.mjs` | 56 | Pure, node-testable core for the Encounter Roller's source list (which tables/monsters feed a roll). |

### 3.6 `scripts/monster-creator/`

| File | Lines | Description |
|---|---:|---|
| `encounter-creator.mjs` | 1912 | Monster Creator — multi-section NPC authoring tool mounted in the roller. |
| `action-templates.mjs` | 126 | Quick-pick NPC attack/action catalog (FA6 Free glyphs only). |
| `feature-templates.mjs` | 83 | Quick-pick NPC feature catalog. |
| `monster-effect-runtime.mjs` | 540 | Provenance-backed effect overlay engine for the Creator draft. |
| `monster-mechanical-adapters.mjs` | 330 | Sole authority for what mechanics a generator result actually applies. |
| `monster-mutator.mjs` | 139 | Clone an existing NPC and apply imported matrix results. |
| `monster-table-runtime.mjs` | 578 | Reads the GM's own imported Core matrix tables to drive the Generator/Mutator. |
| `core-monster-spell-icons.mjs` | 107 | Curated Foundry-native icon mapping for generated Core and Cursed Scroll monster spells. |
| `monster-spell-library-core.mjs` | 496 | Pure extraction, validation, identity, materialization, and refresh reconciliation for embedded monster spells. |
| `monster-spell-library.mjs` | 499 | Foundry adapter for GM-controlled Monster Spell Library preview, build, and refresh. |
| `monster-spell-pack-migration.mjs` | 460 | One-way consolidation of the retired world.shadowdark-enhancer--monster-spells pack into the managed Items pack, verified before the legacy pack is emptied. |
| `monster-spell-update-gate.mjs` | 255 | The automatic Monster Spell startup worker: legacy consolidation every activation, Core + managed Enhancer Actors refresh once per module version, active GM checked at fire time, version stamp advanced only after a complete successful refresh, and the refresh deferred with a warning while a failed consolidation leaves content in the retired pack. |
| `spell-index.mjs` | 249 | Lightweight Spell index (compendium indices, not documents). |
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
| `loot-catalog.mjs` | 114 | Rewrites loot tables so entries become DOCUMENT results. |
| `loot-linker.mjs` | 118 | Loot row text → confident compendium item link. |
| `loot-pack.mjs` | 163 | Classify/fabricate treasure entries + world "Loot" pack ops. |
| `subroll.mjs` | 95 | Resolve "Meteorite 1d4: 1. lute…" table rows to the object rolled. |
| `treasure-data.mjs` | 15 | Level → tier band boundaries. |
| `item-drops.mjs` | 690 | Drag items to canvas as pickup tokens; TokenHUD pickup; light sources burn. |
| `loot-resolution.mjs` | 243 | Precise loot-row → Item resolution (pure), replacing the containment regex that lived in `loot-linker.mjs`. That matcher asked whether a row CONTAINED any known item name as a word (`\b<name>s?\b`, longest candidate first), which made every generic container, material and body part in the system gear pack a landmine: "Unopened bottle of exceptionally potent Murgazi wine (25 gp)" resolved to the plain system `Bottle` and the GM's 25 gp vintage became a 1 gp empty bottle (#58) — with "A flask of oil" → `Flask` and "Bolt of fine silk" → `Bolt` behind it. The replacement resolves the row AS A NAME in two tiers: `exact` (the priced row, stripped, IS the item's name modulo case and spacing) and `alias` (that name modulo a leading article or count, a trailing parenthetical, and the plural of its FINAL word). Every fold is anchored, so none of them can shorten a phrase to one of its interior words — the containment bug is structurally unreachable, not merely tuned away. A row landing on two distinct items at the same tier is `ambiguous` and resolves to nothing, because picking one by index order is the same bug with extra steps; ambiguity is reachable because the alias fold is looser than `buildItemIndex`'s lowercased-name dedupe. Recall is traded for precision DELIBERATELY (D4/D5 accept "an explicit unresolved case" and put loose generic fallback out of scope): an unresolved row keeps its text and can be fabricated, while a false positive silently hands the player the wrong object and looks like it worked. Also owns `stripPrice`, moved verbatim from `loot-pack.mjs` (which re-exports it) because its output is a fabricated Item's NAME and must not acquire any of the matching folds. Foundry-free, node-tested. |

### 3.8 `scripts/magic-forge/`

| File | Lines | Description |
|---|---:|---|
| `magic-forge-app.mjs` | 724 | Magic Item Forge window (weapons/armor with working +N, benefit/curse riders). |
| `magic-forge.mjs` | 279 | Core engine building items that actually function in the system. |
| `magic-table-runtime.mjs` | 708 | Drives forge recipes off the GM's own imported magic-item tables. |

### 3.9 `scripts/merchant/`

| File | Lines | Description |
|---|---:|---|
| `merchant-shop.mjs` | 2692 | Two-mode shop system (compendium global or actor NPC inventory); GM opens for all players. |
| `merchant-defaults.mjs` | 183 | The two shipped merchant configs (Base, Western Reaches). |

### 3.10 `scripts/party-xp/`

| File | Lines | Description |
|---|---:|---|
| `party-xp.mjs` | 306 | Award XP to the whole party in one click (ApplicationV2 GM tool). |
| `party-xp-core.mjs` | 52 | Pure XP math + item-XP resolution. |

### 3.11 `scripts/session-recap/`

| File | Lines | Description |
|---|---:|---|
| `session-recap.mjs` | 746 | Session event tracker singleton (loot, sales, XP, combats, per-PC stats). |
| `session-recap-core.mjs` | 402 | Pure data shape, currency math, duration format, Discord-markdown export. |
| `session-recap-app.mjs` | 338 | Recap window: Overview / Combat / Loot / XP / History. |
| `carousing-feed.mjs` | 141 | Mirrors Shadowdark Extras' carousing into the session log. SDX emits no carousing hook and exposes none of it on `module.api`, but it keeps the whole live carouse in one journal flag on the hidden `__sdx_carousing_sync__` entry — so this watches that document rather than calling anything. Each carouse is COPIED into our own `carousing` array keyed on SDX's `logId`, because SDX's overlay holds only one live carouse and resetting it for the next round erases the last. Self-gates on SDX being active with carousing enabled, on an active session, and on the primary GM. |
| `carousing-feed-core.mjs` | 207 | Pure normalizer for both SDX carousing result shapes — original (d8 outcome + one benefit, GM applies) and expanded (d8 → XP + d100 benefit/mishap arrays, self-applying) — detected off the payload, not off SDX's mode setting, so a carouse rolled before the GM flipped it still reads. Also the shared `recapRow`, `carousingSubtotal` and `tierLine` wording the recap window and the Discord export both use. Foundry-free, node-tested. |

### 3.12 `scripts/importer/` — hub + cross-type infrastructure

| File | Lines | Description |
|---|---:|---|
| `importer-hub-app.mjs` | 893 | **The single front door (shell).** ApplicationV2 lifecycle, singleton, instance fields/caches, `_prepareContext`; installs the three method packs below onto the class (split 2026-07-22). |
| `importer-hub-paste.mjs` | 1526 | Paste box, type selector, parse dispatch, per-type preview field/row wiring. |
| `importer-hub-commit.mjs` | 861 | Conflict dialogs, quality gates, magic-bundle plan, all per-type commit flows. |
| `importer-hub-manage.mjs` | 998 | Manage strip: censuses + caches, manage tree, gap/seed/cull, source-PDF grab/extract. |
| `importer-hub-batch.mjs` | 668 | Batch “Import everything” runner: seeds, grabs, parses and commits each planned entry unattended. |
| `importer-hub-shared.mjs` | 92 | Hub-shared constants/helpers + `installMethods` (the split's descriptor copier). |
| `importer-hub-maintenance.mjs` | 242 | Tools-menu bodies (bundle export/import, source-PDF library). |
| `dump-segmenter.mjs` | 307 | Routes a mixed dump through the recognizer registry: hexcrawl → spell → monster → item → table. |
| `bundle-io.mjs` | 406 | Whole-suite export/import as one JSON; validates, skips existing, never overwrites. |
| `manage-tree.mjs` | 606 | Composes the folder/sub-folder unlock-review tree the Manage strip renders. |
| `batch-import.mjs` | 262 | Pure batch planner: locked tree rows → deduped import jobs, routes, and the run report. |
| `pdf-text-extract.mjs` | 704 | Clean reading-ordered PDF text via Foundry's bundled PDF.js; column-aware gutter detection. |
| `pdf-text-utils.mjs` | 140 | Shared PDF-text helpers + the HTML-safety contract. |
| `source-pdf-registry.mjs` | 273 | Content source → the user's own uploaded PDF, for page deep-links. |
| `source-pdf-viewer.mjs` | 66 | Singleton ApplicationV2 embedding Foundry's PDF.js viewer at a given page. |
| `char-content/char-content-manifest.mjs` | 1481 | Metadata-only manifest of CS4–6 + WR char-builder content (names/types/sources, no rules text) + `parseCharContent` + census. |
| `char-content/class-parser.mjs` | 1093 | Class section → structured unit (writeup, talents, tables, spellcasting). Pure. |
| `char-content/class-importer-app.mjs` | 758 | Purpose-built single-view class workspace. |
| `char-content/class-unit-importer.mjs` | 1409 | Class unit → real documents in dependency order. |
| `char-content/class-overlays.mjs` | 264 | SDE-original automation not derivable from book text (ActiveEffects, invented names). |
| `char-content/class-quality-gate.mjs` | 113 | The one place computing blocking class-import issues + override dialog. |
| `char-content/class-index.mjs` | 85 | Class name → system Class item UUID. |
| `char-content/language-resolver.mjs` | 16 | Language names → system UUIDs. |
| `spells/spell-parser.mjs` | 284 | Spell blocks → Spell drafts. Pure. |
| `spells/spell-importer-app.mjs` | 460 | Spell workspace organized by class / tier / alignment. |
| `tables/table-importer.mjs` | 3330 | Roll-table text → structure. The big one; includes `repairSharedStartRanges`. |
| `tables/table-shapes.mjs` | 549 | Per-unlock deterministic table SHAPE recipes (prayer/grid/lookup/reflow kinds). |
| `tables/table-hub.mjs` | 297 | Reconciles the shipped manifest against the live world (system / imported / missing). |
| `tables/table-hub-app.mjs` | 528 | "Set up ALL tables" window — dashboard + import view. |
| `tables/table-registry.mjs` | 206 | Parses live tables into `{source, page, displayName, subCategory}` and groups them. |
| `tables/table-seed-map.mjs` | 240 | Generated table-name → group-id seed map. |
| `tables/table-structure-seeds.mjs` | 2106 | Structure-only seeds (formulas, folders, flags, chain links). |
| `tables/table-folders.mjs` | 179 | Single source of truth for where a table files in `sde-tables` — **owns the Gameplay vs Roll Tables split**. |
| `tables/table-categories.mjs` | 65 | Table-type taxonomy + classifier. |
| `tables/table-enrich.mjs` | 164 | Brings imported tables to "Ruin Encounters" standard; owns the debounced auto-relink sweep. |
| `tables/core-table-groups.mjs` | 251 | Core Rulebook table groups (`section: "gameplay"` vs roll tables) for the Manage tree. |
| `tables/compound-table.mjs` | 93 | Mad-libs generator roll behaviour. |
| `tables/hex-parser.mjs` | 340 | Hex-key dumps → per-hex draft journal pages. Pure. |
| `monsters/statblock-parser.mjs` | 516 | Monster statblock dump → draft objects. Pure. |
| `monsters/monster-importer.mjs` | 232 | Drafts → NPC actors in `sde-actors`. |
| `monsters/monster-importer-app.mjs` | 378 | Paste dump → per-monster preview/edit grid → create. |
| `monsters/monster-census.mjs` | 154 | Pure have/gap/duplicate helpers. |
| `monsters/monster-census-live.mjs` | 462 | Foundry-bound adapter reading `sde-actors`/`sde-tables`. |
| `monsters/monster-backfill.mjs` | 359 | Idempotent upgrade of pre-fidelity-fix imports; auto-runs once per module version. |
| `monsters/managed-actor-backfill.mjs` | 305 | Reusable active-GM, version-gated backfill lifecycle over the managed Actors pack; consumers supply the missing-only transform. |
| `monsters/actor-migration.mjs` | 380 | World-side imported actors → the managed `sde-actors` pack. |
| `monsters/monster-linker.mjs` | 131 | Table encounter text → clickable `@UUID` monster links. |
| `monsters/monster-pack.mjs` | 48 | Shared pack-identity leaf so importer and linker agree. |
| `items/item-parser.mjs` | 493 | Generic item recognizer (name/cost/slots). Pure. |
| `items/gear-parser.mjs` | 547 | Real Weapon/Armor stat parser (WR letter codes, treasure flags). Pure. |
| `items/gear-join.mjs` | 257 | Joins split cost-table + description layouts into one item. Pure. |
| `items/item-importer.mjs` | 1008 | Drafts → Items in `sde-items`, foldered by source. |
| `items/item-builder-app.mjs` | 396 | Guided multi-stage equipment-section workspace. |
| `items/item-builder-gear.mjs` | 133 | Pure stage-①/③ logic for the Item Builder. |
| `items/item-census-live.mjs` | 200 | Items census adapter (same shape as monsters). |
| `items/shikashi-icons.mjs` | 235 | Item name → bundled Shikashi icon matcher (284 icons). |
| `tables/table-manifest.mjs` | 235 | Table manifest logic — the registry of catalogued tables (id, name, source, page) that drives the Manage-tree census. |
| `tables/table-manifest-data.mjs` | 335 | The `TABLE_MANIFEST` data array — every catalogued table's metadata (names/sources/pages; no rules text). |
| `boats/mount-parser.mjs` | 55 | Names-only WR mount manifest + selection of the requested mount from parsed statblock drafts. |
| `boats/mount-importer.mjs` | 149 | Mount drafts → `shadowdark-enhancer.mount` actors in `sde-actors`, reusing the monster import pipeline. |
| `boats/boat-parser.mjs` | 155 | Parses the WR p118 boats table → boat actor drafts (pure); names-only manifest. |
| `boats/boat-importer.mjs` | 49 | Boat drafts → `shadowdark-enhancer.boat` actors in `sde-actors`. |
| `boats/siege-parser.mjs` | 438 | Parses the WR p119 siege-weapons table → Weapon drafts + ammunition (pure). |
| `boats/siege-importer.mjs` | 151 | Materializes Blast/Exploding Property items for the siege weapons in `sde-items`. |
| `items/record-boundary.mjs` | 210 | Where one pasted description record ends and the next begins. Pure. |

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
| `art-gallery.mjs` | 170 | GM-curated portrait gallery (avoids granting players `FILES_BROWSE`). |
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
| `monster-token-art.mjs` | 726 | Applies licensed art to monsters **by path reference**, never bundled. |
| `token-art-catalog.mjs` | 640 | Name→art matching catalog. |
| `token-art-manager-app.mjs` | 427 | GM window to review/apply matches. |

### 3.16 `scripts/pdf-export/`

| File | Lines | Description |
|---|---:|---|
| `pdf-sheet-export.mjs` | 422 | "Export to PDF" header button; fills the bundled form-fillable sheet from SD data-model getters. |

### 3.17 `scripts/character-sheet/` — Shadowdark sheet injections

| File | Lines | Description |
|---|---:|---|
| `prayer-roll.mjs` | 174 | Prayer icon beside the sheet's Deity header; rolls that deity's `<Deity> Prayers` table (world first, then compendiums). |

### 3.18 `scripts/downtime/` — between-crawls downtime activities

| File | Lines | Description |
|---|---:|---|
| `downtime-skeleton.mjs` | 196 | Shipped downtime metadata: 25 slots across four activities with names, compressed labels, DCs, paid flags, keyword matchers and renown/XP deltas. Carries no rules text. |
| `downtime-parser.mjs` | 367 | Parses a pasted downtime page into per-slot outcome text; segment-scoped DC + keyword matching with a rescue pass for column-interleaved PDF copies. Unmatched lines are reported back, never guessed at. |
| `downtime-core.mjs` | 208 | Pure downtime rules math: the DC step-down ladder, per-attempt cost by source, the martial-training hit-die tier and caster-list gates, and the stored unlock record shape. |
| `downtime-effects-core.mjs` | 262 | Pure decision layer for downtime outcomes: the slot-to-plan table (auto / choice / narrative), the per-weapon martial-training limit counters and damage-die ladder, the one-shot extortion math, and the XP level-up threshold. Ships item names only, no rules text. |
| `downtime-effects.mjs` | 788 | Applies a successful downtime outcome for real — renown, XP, weapon-training Active Effects, damage-die steps, fabricated scrolls/wands/potions, spell trades, advantage reminders and the merchant extortion flag. Enumerates the concrete choices first; GM-side execution only. |
| `downtime-log-core.mjs` | 199 | Pure downtime-log formatting: the recap headline row, the escaped journal `<li>`, and the newest-first grouping that splices a row under its `data-sde-day` heading. Shared by the recap window, the Discord export and the journal so all three phrase an attempt identically. |
| `downtime-log.mjs` | 183 | `recordDowntime(entry)` — one call, two sinks: the Session Recap's Downtime section and a persistent flagged "Downtime Log" world JournalEntry appended under a heading per real-world day. Queued read-modify-write; never throws outward. GM-side only. |
| `downtime-warnings.mjs` | 144 | Shared prose for the downtime parser's warning codes; splits info notes (a two-column paste always emits them) from real problems, so every unlock surface reports a parse identically. |
| `downtime-app.mjs` | 1374 | The `sde-downtime` ApplicationV2 in three modes: GM solo (pay-before-roll attempts, renown / XP apply buttons), the GM session control panel (picks overview, lock/release, roll-for), and the player view (own actors only, choose then roll). Locked books render as a title-only card; unlocking happens in the Importer Hub. |
| `downtime-session.mjs` | 1068 | Table-wide downtime session: world-setting state model, the authenticated downtime query protocol (the raw socket carries only the payload-free re-read nudge), and the GM-authoritative handlers that recompute DC, cost and gating from the skeleton, derive the requester from the server-supplied sender, and spend a per-attempt roll token so a roll settles once. Players pick and roll; the GM settles. |

Ships the skeleton only (activity names, slot labels, DCs, paid flags, renown/XP deltas). Every outcome sentence is pasted by the GM from their own book and stored in the `downtimeContent` world setting, never in the repo.

### 3.19 `scripts/renown/` — the renown fame track

| File | Lines | Description |
|---|---:|---|
| `renown-core.mjs` | 326 | Pure band ladder and phrasing: `renownBand`/`renownBonus` (≤3 / 4–7 / 8–11 / 12+ → +0/+1/+2/+3), `startingRenown` (the CHA modifier), the shared `recapRow`/`renownChangeLine` wording, the short trigger labels, `isDoubleOnes` — a raw 2d6 total of 2 can only be 1+1 — and `authorizeRenownAward`, the GM-only rule both the direct call and the query handler check. Also the two rules the automatic writes turn on: `shouldSeedStartingRenown` (a character is owed its one starting seed only while the flag is unspent, renown is 0 AND the ledger is empty) and the ledger helpers `appendRenownHistory` (capped, non-mutating), `historyRow` and `groupHistoryByPlayer`. Foundry-free, node-tested. |
| `renown.mjs` | 737 | The single write path for `system.renown`. `Renown.award` updates the actor, logs to the Session Recap and posts a chat card; downtime and the level-up watcher both route through it. Because the write is read-add-write, it is also the single WRITER: an award made on a GM client that is not `game.users.activeGM` is forwarded there over the `sde.renown` query (the delta travels, never a computed total), and on that client awards run one at a time through `_txQueue`, each re-reading the actor inside its turn — two GMs, or two overlapping awards on one, would otherwise lose one of them. Also the party readers the Encounter Roller uses, and the two automatic triggers, each settings-gated and active-GM-gated: the `renownOnLevelUp` `updateActor` watcher, and `renownOnCreate`'s `maybeSeedFromCha`, attempted on `createActor` and again on the first CHA change (an actor made through Create Actor starts on the model's default 10s, so a +0 seed does not spend the flag). Every award also writes a permanent per-character ledger to the `renownLog` flag IN THE SAME `actor.update` as the number, because `SessionRecap.logRenown` returns early with no session running; `history`/`historyByPlayer` read it back. An `updateActor` watcher also logs any renown change this module did NOT make (the Shadowdark sheet input, a macro, shadowdark-extras carousing calling `applyRenownDelta`) as `source: "external"`, told apart from our own writes by the ledger flag riding in the same update. GM-side only. |
| `renown-award-dialog.mjs` | 238 | The GM's award / dock DialogV2. Party roster (renown, band, meaning, bonus) on top, then character + change + reason with the book's triggers as suggestions, then the collapsed per-player **Renown log** (native `<details>`, since DialogV2 does not re-render its content), plus a "Start at CHA mod" seed that forces past both the setting and the once-only rule. GM-only; every write goes through `Renown.award`. |

The number itself is the SYSTEM's field (`system.renown` on PlayerSD). This folder adds the band ladder, the single logged write path every renown change goes through, and the GM's award dialog. Band thresholds and bonus numbers are mechanics; the one-line band meanings are the module's own wording, not the book's.

### 3.20 `scripts/pit-fighting/` — Cursed Scroll 2 pit fighting bouts

| File | Lines | Description |
|---|---:|---|
| `pit-fighting-core.mjs` | 290 | Pure bout set-up: the stakes ladder (APL + 1d6 → 2-5 / 6-10 / 11-13 / 14+), `averagePartyLevel` (rounds half up, ignores unreadable levels rather than counting them as level 0), the 2d6 venue rows, the 2d6 twist bands as machine-readable effects (`extra-danger` and its 1d4 sub-roll, `none`, `stakes-up-1`, `boon`), the three danger levels, `encounterTableName` (High and Epic share one encounter tier, so four stakes tiers map to three table tiers) and `buildBout`. `suggestedDanger` derives from the stakes only — the book hands the GM the venue too and then says the GM decides, and no venue risk rating exists to read. Rolls no dice and holds no text. Foundry-free, node-tested. |
| `foe-resolver-core.mjs` | 180 | Pure reader for a drawn CS2 encounter row (`"2 hero* \| 2 lion \| 30' deep pits"`). `parseFoeCell` strips a leading count (kept as a STRING because one cell is `2d4`), the pg. 39 footnote star, a trailing parenthetical that is a stage direction rather than part of the name (`Wyvern (chained)`), and the book's `Gt.` abbreviation; it singularises only when a count made the plural. `nameCandidates` adds the system's inverted `Family, Variant` form, which is what resolves `Gt. centipede` to *Centipede, Giant* without a lookup table. `parseFoeRow` reads creatures by COLUMN POSITION so the complication is never mistaken for a monster. Shared with the monster census, so the census and the Place button agree on what a row names. Foundry-free, node-tested. |
| `arena-maps.mjs` | 260 | The arena map library: the twelve bundled 2-Minute Tabletop battle maps (CC BY-NC 4.0; see CREDITS), ordered by the CS2 Venue row each stands in for. Every entry carries its id, the 2MT product `label`, the `venueLabel` the GM actually reads, the `venueRows` it suits, an image path, pixel width/height and a per-map grid aligned to the printed squares (72px / 70px / 44px) at 5 ft a square. Grids must be INTEGERS: Foundry's `grid.size` is a NumberField with `integer: true`, so a fractional cell is rounded on write with no error — Greybanner Coliseum shipped as 43.75, silently became 44 and drifted a quarter-square off its own art, and is now re-encoded to 1936x1408 for a whole 44px cell. `getArenaMap(id)` looks one up, `mapsForVenueRow(row)` splits the library into the rolled venue's maps and the rest (it reorders, never filters), and `DEFAULT_ARENA_MAP_ID` names the fallback. Plain data, no Foundry dependency. |
| `arena-scene.mjs` | 210 | Builds any of the module's arena maps as a playable scene: the map on a grid sized to its own printed squares, night darkness, and — unlike the old drawn arena — no synthetic torch lights, because these maps bring their own painted lighting. Per-map idempotent: a scene is matched on the `arenaMap` flag with its map id first so a rename survives, so pressing the same map again returns the one the GM already dressed. VIEWED, never activated: activating would drag every connected player onto the map. **v14 note:** the background lives on the new `Level` embedded document (`scene.levels[].background.src`); `Scene#background` is a read-only v13 shim, and writing the old shape is discarded silently by schema cleaning, leaving a grey scene and no error. |
| `pit-fighting-app.mjs` | 1053 | The bout roller: the `sde-pit-fighting` ApplicationV2 plus the `PitFighting` logic object. Picks the fighters (their count decides solo vs group, their average level sets the stakes), rolls venue / stakes / twist, offers the danger level as an override that redraws the foe from the newly selected encounter table, holds the twist back until Reveal, draws the prize, and awards the fame through `Renown.award`. `findBoutTable` resolves tables by book name and tolerates the suite's `Source - Name` prefix; a table that is missing is NAMED in the window with a link to the importer, never substituted with text of its own. Reads TableResult `name \|\| description` — never `text`, which still fires the v13 deprecation getter. GM-only. |

Structure and thresholds only. Venue descriptions, twist details, what each stakes tier is fought for and the foes themselves all live in the RollTables you import from your own book — this folder holds dice ranges and mechanics, the same class of bare numbers as the reaction bands. The book leaves the danger level and the foe to the GM, so the module suggests and never decides.
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
