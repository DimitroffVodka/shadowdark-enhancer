# Forge & Loot

[← Wiki home](index.md)

An internal preview shell for planned NPC and Rival Crawler generators.
**The tool is currently shelved and hidden from the UI.** It is accessible only
via the developer console API; generator rules and document generation will
arrive in future releases.

---

## Opening it (Console only)

The tool is hidden from the Crawl Bar menu because its generators are not yet
functional. You can open the development window from the browser console (`F12`):

```js
game.shadowdarkEnhancer.forgeLoot.open();
```

Requires active GM permissions.

---

## Current status

The shell provides the UI foundation and preview contracts that future generator
modules will plug into. **The registered generators (Ordinary NPC and Rival
Crawlers) are disabled placeholders.**

The shell does not generate NPCs or loot and does not write world documents.

Working features in the preview shell:

- **Generate Preview:** Computes a seeded, deterministic proposal from an
  adapter. Previews are immutable.
- **Reroll:** Changes the seed and requests a new preview calculation.
- **Cancel:** Discards the proposal without modifying world state.
- **Approve & Create:** Rechecks active GM status and source drift before
  submitting. Displays commit diagnostics if errors occur.

---

## For developers — internal foundation and generator seams

<details>
<summary>Preview/commit contracts and internal foundation layers</summary>

### The generator adapter contract

Generators register as adapters with the shared shell
(`scripts/forge-loot/forge-loot-core.mjs`):
- `plan(request)`: Produces a deterministic preview from a seeded RNG.
- `readSourceSnapshot()`: Snapshot re-evaluated during approval to detect drift.
- `commit(preview)`: Persistence boundary that creates world documents.

### Internal foundation layers

The subsystem under `scripts/forge-loot/` includes several pure, read-only
foundation layers:

- **Class idiom resolver (`class-idiom.mjs`):** Derives ability signals from
  imported class and talent metadata to resolve character creation choices.
- **Class readiness audit (`class-readiness.mjs`):** Internal audit evaluating
  Core and imported classes for generation readiness, hit dice, and spellcasting.
- **Managed Rival Classes table (`rival-class-table.mjs`):** Derives a RollTable
  in `sde-tables` (`flags["shadowdark-enhancer"].forgeLoot.rivalClassTable`)
  from class readiness data.
- **Supporting-table registry (`supporting-tables.mjs`):** Manifest-stamped
  registry for NPC and Rival table inputs, including Alignment Signature Tactics.
- **Player advancement planning (`advancement-engine.mjs`):** Pure deterministic
  engine modeling level progression (levels 2–6) without writing Actor documents.

The public console entry point is `game.shadowdarkEnhancer.forgeLoot.open()`.

</details>

---

## Troubleshooting

**The Forge & Loot option is missing from the Crawl Bar.**
This is intentional. The tool is shelved from the UI until working generators
ship. Access it via `game.shadowdarkEnhancer.forgeLoot.open()` in the console.

**Selecting a generator shows "Not available".**
Expected behavior. Registered generators are disabled placeholders.

**Approve & Create is disabled.**
Requires a valid, non-blocked preview without source drift errors.

---

**Related:** [Crawl Strip & Crawl Bar](Crawl-Strip-and-Crawl-Bar.md) · [Loot & Treasure](Loot-and-Treasure.md) · [Magic Item Forge](Magic-Item-Forge.md)
