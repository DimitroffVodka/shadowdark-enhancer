# Sealing a content unit — repeatable checklist

The ONLY way content becomes permanent. If a unit isn't a committed blob in
`data/locked/`, it will be lost on the next world reset (that's the redo trap).
See `.planning/SEALED-CONTENT-PLAN.md` for the inventory + ledger.

Per unit, every time:

1. **Curate** the docs in the world (correct class/tier/text; links resolved).
   Identify them as explicit uuids or a folder path (e.g. `sde-items` →
   `Spells/Wizard`). This is the only authoring step; capture reuses it.

2. **Anchors** — get ≥5 short, verbatim, *distinctive* phrases from that book
   section (the owner pastes them). Normalization is lowercase-alphanumeric, so
   punctuation/case don't matter; pick phrases unlikely to collide.

3. **Build + write the blob** (MCP `evaluate` in the dev world). Pass
   `writeToDisk:true` so the tool writes the blob byte-exact via
   `FilePicker.upload` (the module dir is under Foundry's Data path → the repo).
   **Never hand-copy `encBase64`** — a 28KB paste corrupts silently (same
   length, wrong bytes, decrypt fails; learned on cs4-spells 2026-07-09).
   ```js
   const { buildSealedUnit } = await import(
     '/modules/shadowdark-enhancer/dev/seal-unit.mjs?v='+Date.now());
   const r = await buildSealedUnit({
     id, name, type, source, pages, coversType,      // coversType:"Spell" etc.
     folders: [{ pack: "sde-items", path: ["CURSED SCROLL 4"], type: "Spell" }],
     rootsOnly: true,          // spells: capture just the spells, not their classes
     anchorPhrases: [ /* the ≥5 phrases */ ],
     writeToDisk: true,
   });
   return { docCount:r.docCount, verified:r.verified, written:r.written,
            anchors:r.registryEntry.anchors };
   ```
   Require `verified === true` and a non-null `written` path before shipping.

4. **Write the remaining repo artifacts** (Claude, native tools):
   - Add `r.registryEntry` to `SEALED_UNITS` in `scripts/encounter/sealed-content.mjs`
     (match existing formatting — anchors are deterministic, so this is stable
     even if you re-seal).
   - Update the ledger row in `.planning/SEALED-CONTENT-PLAN.md` → `committed`.
   - `node --check scripts/encounter/sealed-content.mjs`.

5. **Commit** (scoped, sealed content only):
   `git add data/locked/<id>.json scripts/encounter/sealed-content.mjs .planning/SEALED-CONTENT-PLAN.md`
   → `feat(sealed): <id> unit`. (Auto-commit approved 2026-07-09 for sealed
   artifacts only.)

6. **Test unlock end-to-end**: reload; in the importer, seed the census entry,
   paste the book section, confirm it unseals (`found N/total`), Create, and the
   docs land in the right folders. If `found < total`, the anchors aren't in the
   paste — fix phrases and re-seal.

Notes:
- Capture follows world refs transitively and preserves folder paths; intra-unit
  refs become `@@LOCAL:n@@` and remap on unlock.
- For a caster class unit, pass `bundleSpellsForClass: <classUuid>` to pull its
  spell list from `sde-items` (P0a fix, 2026-07-09).
- Never paste rules text into the repo, ledger, or commit messages — blobs are
  ciphertext; anchors are hashes only.
