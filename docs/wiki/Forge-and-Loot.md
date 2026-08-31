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

## For developers — the adapter seam

<details>
<summary>The preview/commit contract future generators implement</summary>

A generator is an adapter object registered against the shared shell
(`scripts/forge-loot/forge-loot-core.mjs`): `plan(request)` produces the
preview from a seeded RNG (pure — no Foundry table rolls, no writes);
`readSourceSnapshot()` is rechecked at approval time; `commit(...)` is the sole
persistence boundary and receives no RNG. The preview object carries the
generator id, seed, complete rolled results, missing/exclusion/warning
diagnostics, and the source snapshot used for the drift check.

The shell also ships the pure class-idiom and legal-choice resolver layer
(`scripts/forge-loot/class-idiom.mjs`, G6a) that derives ability signals from
imported class/talent metadata and resolves supported character-creation
choices deterministically. It is internal foundation for the future readiness
(G3), advancement (G6b), and party-assembly (G7) work — it powers no
user-facing automation yet.

Both are documented as internal seams; the public surface is
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
