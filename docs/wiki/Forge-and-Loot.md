# Forge & Loot

[← Wiki home](index.md)

The shared, preview-first shell for the future NPC and Rival Crawler
generators. Today it hosts the shell and the adapter contract; the generator
rules themselves arrive in later releases.

<!-- TODO screenshot: images/forge-and-loot.png — The Forge & Loot shell
     How: open a world as GM, Crawl Bar → Forge & Loot → Forge & Loot -->

---

## Opening it

| Route | How |
|---|---|
| **Crawl Bar** | Click **Forge & Loot**, then the **Forge & Loot** entry at the top of the menu |
| **API** | `game.shadowdarkEnhancer.forgeLoot.open()` |

GM only. Selecting a generator seeds the preview planner; everything below
happens before anything is written.

---

## What's here now

The shell is the preview-first boundary the NPC and Rival Crawler generators
will plug into. **The two registered generators — Ordinary NPC and Rival
Crawlers — are disabled placeholders today.** They report that they are not
available in this shell yet; the shell does not generate NPCs or loot and does
not write world documents in this release. The actual rules and world-document
commit adapters ship in later generator work (G5/G7).

What does work now:

- **Generate Preview** plans a deterministic, seeded proposal supplied by the
  selected generator's adapter. The preview is immutable — nothing you do in
  the window can change it.
- **Reroll** deliberately changes the seed and plans a new preview.
- **Cancel** closes the proposal. Preview, reroll, and cancel write nothing.
- **Approve & Create** becomes available on a ready preview. Before committing
  it rechecks that you are still the active GM and that the preview's source
  snapshot hasn't drifted; it consumes the exact preview once and refuses a
  rapid second submit while the first is in flight. Commit errors are shown and
  leave the preview intact.

---

## For developers — internal foundation and generator seams

<details>
<summary>The preview/commit contract and internal foundation seams</summary>

### The generator adapter contract

A generator is an adapter object registered against the shared shell
(`scripts/forge-loot/forge-loot-core.mjs`): `plan(request)` produces the
preview from a seeded RNG (pure — no Foundry table rolls, no writes);
`readSourceSnapshot()` is rechecked at approval time; `commit(...)` is the sole
persistence boundary and receives no RNG. The preview object carries the
generator id, seed, complete rolled results, missing/exclusion/warning
diagnostics, and the source snapshot used for the drift check.

### Internal foundation seams

The Forge & Loot subsystem relies on several pure, deterministic, and read-only
foundation layers under `scripts/forge-loot/` (these do not expose separate
public API namespaces and write no Actor documents):

- **Class idiom and choice resolver (`class-idiom.mjs`, G6a):** Derives ability
  signals from imported class and talent metadata, resolving legal character
  creation and advancement choices deterministically without heuristic guessing.
- **Class readiness audit (`class-readiness.mjs`, G3):** An internal, read-only
  audit evaluating Core and imported Class documents for character-generation
  and Rival readiness. Evaluates talent tables, hit dice, spellcasting metadata,
  and modal choices into stable blocker and warning diagnostics with a bounded
  defect queue. It performs no document repairs or Actor writes. Empty
  schema-default spell grids (where all nested cells are null or blank) are
  recognized as non-caster defaults, while meaningful leaves (including numeric
  zero), non-empty casting ability, or explicit caster flags serve as caster
  evidence.
- **Managed Rival Classes table (`rival-class-table.mjs`, G2):** Derives and
  maintains a single flag-identified RollTable in the managed `sde-tables` pack
  (`flags["shadowdark-enhancer"].forgeLoot.rivalClassTable`) from the G3
  readiness report. On same-name collisions between Core and imported classes,
  Core precedence is evaluated before eligibility checks; Level-0 entries and
  ineligible classes are excluded. If no eligible classes exist, a stable
  zero-row `1d1` table is maintained. Regeneration is deterministic, preserves
  compendium document identity, and reclaims manual row/range edits with a
  visible warning.
- **Supporting-table registry (`supporting-tables.mjs`, G8):** An internal,
  exact manifest-stamped registry for NPC and Rival table inputs, including the
  three Signature Tactics alignment children (`core-signature-tactics:lawful`,
  `core-signature-tactics:neutral`, `core-signature-tactics:chaotic`). Tables
  are imported through Table Hub and resolve by stamped manifest identity,
  allowing GM renames to survive intact. Resolution fails closed on missing,
  foreign (unstamped), duplicate, or loose-name-only candidates; only Ancestry
  and Alignment permit exact Core system UUID fallbacks.
- **Pure Player advancement planning (`advancement-engine.mjs`, G6b):** A
  Foundry-free, pure deterministic engine that advances complete level-1 Player
  plans through levels 2–6 using injected RNG, deterministic progression rules,
  G6a choice resolution, bounded duplicate and recursion handling, and
  replacement-effect materialization. Tagged failures return no committable
  Actor data; the engine writes no Foundry documents and serves strictly as an
  input seam for future G7 party assembly.

The only public entry point for this subsystem is
`game.shadowdarkEnhancer.forgeLoot.open()`.
</details>

---

## Troubleshooting

**I pick Ordinary NPC or Rival Crawlers and it says the generator isn't
available.**
Expected in this release. The registered adapters are disabled placeholders;
the rules arrive in later generator work.

**Approve & Create is greyed out.**
A preview must be ready and not blocked: generate one, and check that no
missing-input or source-drift error is shown.

---

**Related:** [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) · [Loot & Treasure](Loot-and-Treasure.md) · [Magic Item Forge](Magic-Item-Forge.md)
