# Troubleshooting

[← Wiki home](index.md)

Symptoms, causes, and fixes for common issues. Each feature page also has
its own troubleshooting section; this page covers issues spanning features.

---

## Start here

### The UI renders unstyled: plain blocks, no layout

Your browser is serving a **cached copy of the module stylesheet**. This is the
single most common cosmetic issue after an update.

**Fix:** Hard-reload with `Ctrl+Shift+R` (or `Cmd+Shift+R` on macOS).

A plain reload will **not** refetch module CSS, and neither will Foundry's
"Reload Application". The module loads a content-addressed stylesheet copy to
mitigate this, but a stale browser cache still needs the hard reload.

### Nothing from the module appears at all

1. Confirm **Shadowdark Enhancer** is enabled in **Manage Modules**.
2. Check your browser console (`F12`) for `shadowdark-enhancer | ready`. If it
   is missing, the module failed to initialize; the error above it will say why.
3. Confirm you are running Foundry **v13+** and Shadowdark system **v3.6.2+**.

### Mount and Boat aren't in Create Actor

Actor sub-types are declared in `module.json`. **Manifest changes require a
world relaunch, not just a browser reload**. Return to setup and relaunch.

### Duplicate party strips or conflicting initiative

`shadowdark-crawl-helper` is still active. Shadowdark Enhancer replaces it.
Disable Crawl Helper. You can silence the startup warning in module settings.

---

## Permissions

### "Only a GM can do that"

Every document-creating entry point is GM-only by design: imports, commits,
monster creation, XP awards, loot generation, and applying token art.

**Player exceptions:**

| Feature | Player access |
|---|---|
| [Character Builder](Character-Builder.md) | Full access (relayed to GM if player lacks create permission) |
| [Export to PDF](Export-to-PDF.md) | Allowed on owned characters |
| Spending Luck | Allowed on owned characters |
| Claiming loot / Merchant Shop | Allowed |
| Token movement rollback | Allowed on own tokens (relayed to GM) |

### A player action does nothing and no error appears

Most player actions are **processed by the active GM's client**: loot claims,
shop purchases, downtime rolls, item drops, and character creation.

**If no GM is online, nothing processes the request.** The player will see:

> No GM is connected, loot claims can't be processed until one is online.

**If the GM's tab is stale (opened before an update):**
The GM's tab may run older code that does not recognize new action packets.
The player will see:

> Your GM's Foundry tab needs a reload before downtime actions can land.

**Fix:** Have the GM reload their Foundry browser tab (`F5`).

**If actions are refused with no stale GM:**
Check the **Query User** permission for the Player role in Foundry's
*Configure Permissions*. It is enabled by default; player requests cannot reach
the GM without it. If missing, players see:

> Your user role can't send shop transactions to the GM, ask them to re-enable
> the "Query User" permission for your role.

### A player can't pick portrait art

They clicked the file browser button, which requires Foundry's `FILES_BROWSE`
permission. Direct them to **Use Suggested Art**, **From URL…**, or the curated
gallery (which browses safely on the GM's client with no permissions needed).
See [Character Builder](Character-Builder.md).

---

## Multi-GM worlds

Automated background sweeps run strictly on the **single active GM** client
(`game.users.activeGM`) so multiple connected GMs do not write duplicate data:

- Session recap recording
- Monster backfills (legacy, text enricher, taxonomy) and spell re-link sweeps
- Hook handlers that write world state

Player actions route to the active GM directly. If you ever observe duplicated
records in a multi-GM session, please [report it on GitHub](https://github.com/DimitroffVodka/shadowdark-enhancer/issues).

---

## Content and imports

### An import shows as a gap in the Manage tree even though I imported it

The catalog census matches on **name and source folder**. Committing content
without selecting a source label files it under *Custom*, leaving the source
book counter at zero.

If you see an all-caps duplicate folder (such as `CURSED SCROLL 1` beside `CS1`),
the source label did not match the book's short code. See [Compendium Packs](Compendium-Packs.md).

### Re-importing created duplicate documents

Check your choice in the conflict dialog. **Rename newcomer** creates a second
copy intentionally. Select **skip** to keep existing documents untouched, or
**replace** to update data while preserving the existing document UUID and links.

### Links broke after moving content to another world

Character Options packs derive collection IDs from their **labels**. Renaming
a pack changes its `world.<slug>`, breaking existing `@UUID` references.
Always import compendium packs without renaming them.

### Half my PDF paste ended up in "Skipped"

This is caused by PDF copy artifacts: headers, footers, or split columns.
If you registered a source PDF in the hub, click **Grab text** instead of
copying from an external reader. The grab tool handles column reading order.

### I received a "Column check" warning when grabbing text from a PDF

Column check notices are advisories, not errors. They mean the detected
two-column boundary was close to text boxes, and some lines might have
crossed column boundaries.

The extractor handles full-width lower tables automatically. If a warning
appears on a dense page, review the preview text before committing.

### An imported weapon is missing one of its properties

Western Reaches includes custom property codes (*Charge*, *Devastating*,
*Mounted*, *Obsidian*, *Sniper*, *Mount*). Because the core system lacks
native items for these, the importer places them into the item's
**description** and notes them in the preview.

You can paste rule text into the description; re-imports preserve your edits.
See [Importer Hub](Importer-Hub.md#after-a-commit-automatically).

### A table parsed into nonsense

The table layout requires a parsing recipe, or used the wrong one. See
[Table Import & Shapes](Table-Import-and-Shapes.md).

### An imported table is attributed to "Game Master" instead of its book

Older imports of multi-column tables did not propagate source metadata to split
child tables, falling back to "Game Master" from the folder name.

New imports preserve book provenance across split tables.

**Existing tables are not rewritten automatically.** If you have a table in
`sde-tables` stored with `source: "Game Master"`, re-import it through the Table
Hub with **Replace existing** selected.

### A numeric page footer was pasted with a Basic Gear table

The Item Builder strips layout furniture (like bare page numbers or footers)
silently before parsing gear rows. Real items containing numbers (such as
`10-foot pole`) are parsed normally.

### A Basic Gear description remained unassigned after matching

Headers are matched to items via exact names, canonical prefixes, and aliases
(`Oil flask.` matches `Oil, flask`). If a header is ambiguous or collides with
multiple rows, the parser leaves it unassigned for GM review rather than guessing.

### The startup monster backfill reported incomplete or retried on world load

The startup sweep in `sde-actors` isolates errors per actor. If one actor fails
due to malformed data, the sweep logs the reason and continues with the rest.

When errors occur, `backfillVersion` is not advanced, allowing the sweep to
retry on the next world load. If an item replacement fails, the sweep restores
the original item snapshot.

---

## Combat and movement

### Initiative order looks wrong at the start of round 1

Foundry re-sorts combat turns as rolls arrive but leaves the turn pointer in
place. The module monitors round 1 and resets the pointer to the top once all
combatants have rolled.

### Movement isn't being tracked

- Check if the crawl is active. The Crawl Bar shows **End** when running.
- In crawl mode, make sure tokens are on the roster. Select tokens and click
  **Add Tokens** (only Player actors are tracked).
- In combat, all combatant tokens are tracked automatically.

### "No turn-start position recorded for this token"

The token began moving before its turn started, or joined mid-round. It will
track positions normally starting on its next turn.

### Remaining movement shows a negative number

This is intentional when movement enforcement is disabled. A reading like
`-20/90 ft` shows exactly how far a token exceeded its allowance.

---

## After updating the module

Three maintenance tasks run automatically on world load for the active GM:

1. **Monster backfill:** Updates imported monsters in `sde-actors` to current
   fidelity. Gated by `backfillVersion`.
2. **Monster Spell update gate:** Consolidates legacy monster spells and
   refreshes the Monster Spell Library. Gated by `monsterSpellSyncVersion`.
3. **Spell ↔ class relink:** Scans and connects imported spells to caster classes.

None of these sweeps overwrite custom data. To re-run a sweep, clear its
version stamp in settings.

---

## Known system-side issue

### The "Searching Distant Lands…" spinner is stuck

The Shadowdark system can leak its loading overlay if item sheet data preparation
throws an error. The module automatically detects and dismisses stuck dialogs
while logging the underlying cause to the console.

---

## Reporting a bug

[Open an issue on GitHub](https://github.com/DimitroffVodka/shadowdark-enhancer/issues) with:

- Foundry version and Shadowdark system version (**Game Settings → Support**)
- Shadowdark Enhancer version
- Other active modules
- Console output (`F12`) around the error
- Steps to reproduce

---

**Related:** [Installation & Setup](Installation-and-Setup.md) · [Settings Reference](Settings-Reference.md)
