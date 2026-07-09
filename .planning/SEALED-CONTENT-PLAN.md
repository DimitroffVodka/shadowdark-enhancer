# Sealed vs Open — Importer Content Inventory & Sealing Plan

Status: DRAFT for review (2026-07-09). Goal: decide what importer content should
ship **sealed** (AES-GCM encrypted under `data/locked/`, unlocked by pasting the
matching sourcebook section) vs stay **open** (user-imported / system-pack).

Copyright contract (unchanged): no readable rules text ships in the repo. Sealed
blobs are ciphertext; unlock keys derive from the buyer's own book text. Module
is **distributed/public**, so redistribution is not an option — sealing or
system-pack reuse only.

---

## 0. Root cause — why spells/tables keep getting redone

Confirmed via git (2026-07-09):
- All 10 sealed blobs (`data/locked/*.json`) are **committed** → durable, ship
  with the module, never redone. (Classes/backgrounds.)
- **No spell or table content exists in the repo.** They've only ever lived in
  the *world* (`sde-items`, `sde-tables`), which isn't versioned or shipped —
  so every world reset/migration loses them and they're re-pasted from scratch.

**Rule going forward: content is "done" only when it's a sealed blob committed
to `data/locked/`.** The world is scratch. This is the whole fix.

### Durability pipeline (author-once)
1. Author/curate docs in a world pack (or reuse what's already there).
2. `captureUnitPayload` — snapshot from the world (do NOT re-paste material).
3. Owner supplies ~5 anchor phrases from the book section (the only paste).
4. `sealUnit` → write `data/locked/<id>.json` + `SEALED_UNITS` entry.
5. **Commit the blob + registry + ledger row.** Now permanent.
6. Update the ledger below.

To be repeatable and low-error, build a **one-command dev sealing tool**
(`dev/seal-unit.mjs` or an MCP-run helper): inputs = pack/folder + anchor
phrases + id/name/type/source; outputs = blob file + registry snippet.

### Unit ledger (single source of truth — keep committed)
Status: `todo` → `captured` → `sealed` → `committed`.

| Unit id | Type | Source | Content | Status | Blob committed? |
|---|---|---|---|---|---|
| wr-delver … wr-wyrdling (9) | Class | WR | class + talents + tables | committed | ✅ |
| wr-backgrounds | Background | WR | ~99 backgrounds | committed | ✅ |
| cs4-spells | Spell | CS4 | 16 spells | **committed** | ✅ |
| cs4-monsters | Actor | CS4 | 19 monsters | **committed** | ✅ |
| cs5-spells | Spell | CS5 | 16 spells (Chaotic Wizard/Sorcerer) | **committed** | ✅ |
| cs5-gear | Basic | CS5 | 12 gear | **committed** | ✅ |
| cs5-monsters | Actor | CS5 | 5 monsters | **committed** | ✅ |
| cs6-spells | Spell | CS6 | 16 spells (Lawful Wizard/Mage) | **committed** | ✅ |
| cs6-tables | RollTable | CS6 | 25 (Carousing, encounters, identifiers, rumors, NPCs…) | **committed** | ✅ |
| cs6-bard | Class | CS6 | — | NOT NEEDED — "Bard (Legacy)" in system pack IS the CS6 Bard (same opening/hit die/titles/abilities: Fascinate, Magical Dabbler, Bardic Arts); ships with Shadowdark | n/a |
| wr-spells | Spell | WR | 25 Necromancer spells (WR-original) | **committed** | ✅ |
| wr-priest-spells | Spell | WR | 29 Priest Lawful/Neutral/Chaotic (WR-original) | **committed** | ✅ |
| wr-gear | Basic/Weapon/Armor | WR | 27 (Mithral shields, boats, siege, weapons) | **committed** | ✅ |
| wr-half-elf | Ancestry | WR | Half-Elf (+Adaptable) | **committed** | ✅ |
| wr-ancestry-tables | Table | WR | 16 Name/Trinket tables | **committed** | ✅ |
| wr-spell-mishaps | Table | WR | 4 mishap + Faction Generator (Warbands) | **committed** | ✅ |
| wr-cs-spells (dual-source) | Spell | WR | 48 CS4/5/6 spells, WR-anchored | **committed** | ✅ |
| cs5-delver / cs5-wyrdling / cs6-duelist (dual-source) | Class | CS5/CS6 | class twins — CS books unlock them | **committed** | ✅ |
| wr-gear | Basic/Weapon/Armor | WR | 26 items | todo | ❌ |
| wr-half-elf | Ancestry | WR | 1 ancestry | todo | ❌ |
| wr-talents-orphan | Talent | WR | audit result | todo | ❌ |
| (phase 2) monsters / tables | Actor / RollTable | WR+CS | many | todo | ❌ |

---

## 1. How the pipeline works (recap)

- `SEALED_UNITS` (sealed-content.mjs) — metadata-only registry: `{id, name,
  type, source, pages, file, anchors:[{len,hash}], coversType?}`.
- `captureUnitPayload({roots, bundleSpellsForClass})` — DEV: snapshot live docs
  (Item + RollTable) into a payload; follows world-pack refs transitively,
  topo-sorts, tokenizes intra-unit refs as `@@LOCAL:n@@`, keeps folder paths.
- `sealUnit(payload, anchorPhrases)` — DEV: encrypt → `{encBase64, anchorsMeta}`;
  write `data/locked/<id>.json` + a `SEALED_UNITS` entry by hand.
- Unlock: importer seed → `sealedUnitFor(name,type)` → `tryUnseal(unit, paste)`;
  decrypts only when all anchor phrases are found in the paste.
- Authoring reference: `.planning/CLASS-AUTHORING-PLAYBOOK.md`,
  `.planning/CHAR-CONTENT-UNLOCK-SPEC.md`.

---

## 2. Inventory — what's sealed vs open

Sources tracked by the manifest: **WR** (Western Reaches), **CS4/CS5/CS6**
(Cursed Scrolls). Core content comes from the **system** packs.

| Importer type | Commit dest | Sealed today | Open / how obtained | Gap |
|---|---|---|---|---|
| **Classes** | sde-items | ✅ 9 WR classes (Delver, Duelist, Green Knight, Kyzian Archer, Monk of Yag-Kesh, Necromancer, Paladin, Roustabout, Wyrdling) | Core from system; CS classes none | CS classes (if any) |
| **Backgrounds** | sde-items | ✅ 1 WR set (`coversType:"Background"`, ~99 names) | Core from system | CS backgrounds (if any) |
| **Talents** | sde-items | ⚠️ Sealed **transitively** inside each class unit (fixed talents + talent tables captured by ref) | — | Standalone/cross-class talents not reachable from a captured class root |
| **Spells** | sde-items (`Spells/Class/Tier`) | ❌ none as a unit | System pack (156, classed); user import for the rest | **WR ~51 + CS4/5/6 48 ≈ 99 spells — all open.** This is the reported gap |
| **Ancestries** | sde-items | ❌ none | Core from system | WR Half-Elf |
| **Gear** (Basic/Weapon/Armor) | sde-items | ❌ none | Core from system; user import | WR gear: 18 Basic, 6 Weapon, 2 Armor |
| **Monsters** | sde-actors | ❌ none | User import; census have/gap tooling | All non-system monsters (stat text is copyrighted) |
| **RollTables** | sde-tables | ❌ none as a unit (captured inside class units only) | User import; `table-manifest-data.mjs` seeds/metadata | Encounter/hazard/loot tables, char sub-tables |
| **Generators** | sde-tables | ❌ none | User-authored | n/a (homebrew) |

Legend: ✅ sealed · ⚠️ partial (transitive) · ❌ open.

### Notes / findings
- **Talents are mostly covered via classes.** A class unit captures its fixed
  talents + talent tables (e.g. Wyrdling → Corruption talents + table). The
  manifest lists ~60 WR talents; most belong to a sealed class. Need a
  reachability audit to find any orphan talents.
- **Caster spell-bundling looks broken.** `captureUnitPayload`'s
  `bundleSpellsForClass` reads `game.packs.get("world.spells")`, but this world
  has **no `world.spells` pack** — spells live in `sde-items`
  (`world.shadowdark-enhancer--items`). So Necromancer/Green Knight class units
  likely did NOT bundle their spell lists. **Must fix the capture source before
  sealing any spells.**
- **The ~99 orphaned spells** in the current world (no class, blank source, OCR
  junk) ≈ the WR+CS spell manifest. They are not seal-ready as-is; they need
  clean re-authoring (correct class/tier, no artifacts) before capture.

---

## 3. Proposed sealing targets (to reach "everything baked in")

Ordered by value / tractability. Each unit needs (a) clean authored docs in a
world pack, (b) 5 stable anchor phrases from that book section.

1. **WR Spells** — one unit (or split Necromancer / Green-Knight-druid / general
   WR). Anchored to the WR spell section(s). Fixes the reported gap + wires
   caster classes to their spells.
2. **CS4 Spells**, **CS5 Spells**, **CS6 Spells** — one unit per Cursed Scroll,
   anchored to each book's spell chapter (16 spells each).
3. **WR Gear** — Basic/Weapon/Armor unit, anchored to the WR equipment section.
4. **WR Ancestry (Half-Elf)** — small unit, anchored to the WR ancestry section.
5. **Orphan talents** (if the reachability audit finds any) — fold into the
   owning class unit or a small WR-talents unit.
6. **(Scope decision) Monsters / Encounter tables** — largest sets, stat/tables
   text is copyrighted. Sealable the same way but many units; treat as a
   separate phase or leave to import + census.

### Cross-cutting prerequisites (do first)
- **P0 — fix `bundleSpellsForClass`** ✅ DONE (2026-07-09). Now reads
  `findSuitePack("sde-items")` filtered to `type:"Spell"` (fallback
  `world.spells`). Live-verified: bundling the Witch class pulled all 46
  class-linked Witch spells from sde-items (was 0 — hardcoded pack didn't exist).
- **P0 — spell-unlock UX** ✅ ALREADY WIRED (verified by reading, no change
  needed). `_onCharSeedPaste` seeds spell census entries with `type:"Spell"`;
  `_onHubParse` (charSeed branch) calls `sealedUnitFor(name, "Spell")`, which
  already falls back to any unit with `coversType === "Spell"`. So registering a
  spell unit with `coversType:"Spell"` unlocks with zero further wiring — same as
  the Background set. (Same is true for gear `coversType:"Basic|Weapon|Armor"`
  and `coversType:"Ancestry"`.)
- **P1 — clean-authoring pass** for the WR/CS spells (class + tier + text),
  since the current world copies are messy. STILL TODO before sealing spells.

### Decisions taken (2026-07-09)
- Scope: **everything, phased** — char-builder content first (spells, gear,
  ancestry, orphan talents), monsters + encounter tables as a later phase.
- Sequence: **P0 plumbing first** (done) → then first content unit.
- Next blocker: a first content unit needs the owner to paste the book section
  (for anchors) + a clean authoring pass.

---

## 4. Open decisions (need input)

1. **Scope of "everything":** just char-builder content (classes/ancestries/
   talents/backgrounds/spells/gear), or also **monsters + encounter tables**?
   The latter is a much larger, multi-unit effort.
2. **Spell unit granularity:** one WR-spells unit vs per-class (Necromancer,
   Green Knight) vs per-book. Per-book matches the anchor model best (anchors
   come from one book section).
3. **Anchor sourcing:** you (owner) provide each book section's text so anchors
   can be authored. Which book/section do we start with?
4. **Existing messy spells:** re-author clean before sealing, or seal a curated
   subset first?

## 5. Recommended first slice (proof)
CS-book spells are the cleanest unit to prove the spell path end-to-end (16
spells, one book section, one anchor set). Sequence:
1. P0 fixes (capture source + spell unlock path).
2. Author the 16 CS4 spells cleanly in a world pack.
3. `captureUnitPayload` → `sealUnit` with CS4 spell-section anchors →
   `data/locked/cs4-spells.json` + registry entry.
4. Lock the pack copies, test unlock end-to-end (paste CS4 section → decrypt →
   import → `Spells/Class/Tier`).
Then repeat for CS5, CS6, WR spells, WR gear, ancestry.
