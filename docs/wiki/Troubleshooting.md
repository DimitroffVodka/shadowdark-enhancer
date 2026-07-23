# Troubleshooting

[← Wiki home](Home.md)

Symptoms, causes, and fixes. Each feature page also has its own troubleshooting
section — this page covers what spans features.

---

## Start here

### The UI renders unstyled — plain blocks, no layout

Your browser is serving a **cached copy of the module stylesheet**. This is the
single most common cosmetic problem after an update.

**Fix:** hard-reload with `Ctrl+Shift+R`.

A plain reload — and Foundry's own "Reload Application" — will **not** refetch
module CSS. The module layers a content-addressed stylesheet copy over the
cached one to mitigate this, but a genuinely stale cache still needs the hard
reload.

### Nothing from the module appears at all

1. Confirm **Shadowdark Enhancer** is enabled in **Manage Modules**.
2. Check the console (`F12`) for `shadowdark-enhancer | ready`. If it isn't
   there, the module failed to load — the error above it will say why.
3. Confirm you are on Foundry **v13+** and the Shadowdark system **v3.6.2+**.

### Mount and Boat aren't in Create Actor

Actor sub-types are declared in `module.json`, and **manifest changes need a
world relaunch, not a browser reload**. Return to setup and relaunch the world.

### Duplicate party strips / conflicting initiative

`shadowdark-crawl-helper` is still enabled. Shadowdark Enhancer replaces it.
Disable Crawl Helper. The load-time warning can be suppressed with the
**Warn when shadowdark-crawl-helper is enabled** setting once you've dealt with it.

---

## Permissions

### "Only a GM can do that"

Every document-creating entry point is GM-only by design: imports, commits,
monster creation, XP awards, loot generation, art application.

**The exceptions players can use:**

| Feature | Player access |
|---|---|
| [Character Builder](Character-Builder.md) | Full — relayed to the GM if they lack create permission |
| [Export to PDF](Export-to-PDF.md) | On characters they own |
| Spending Luck | On characters they own |
| Claiming loot / buying from a merchant | Yes |
| Rolling back their own token's movement | Yes — relayed to the GM |

### A player action does nothing and no error appears

Most player actions are **relayed to the active GM over the socket**: loot
claims, merchant transactions, movement rollback, character creation without
create permission.

**If no GM is connected, nothing processes the request.** Check that a GM is
online.

### A player can't pick portrait art

They used the file-browser route, which needs `FILES_BROWSE`. Three other routes
need no permission at all — **Use Suggested Art**, **From URL…**, and the
curated gallery (which browses on the GM's client). See
[Character Builder](Character-Builder.md).

---

## Multi-GM worlds

Several sweeps and handlers are deliberately restricted to the **single active
GM** (`game.users.activeGM`), so two GMs online don't both write:

- loot claims and merchant transactions
- session recap recording
- the monster backfill and the spell↔class relink sweep
- movement rollback relays

If you see duplicated entries or double-processed transactions in a multi-GM
world, that is a bug worth
[reporting](https://github.com/DimitroffVodka/shadowdark-enhancer/issues) —
it is not expected behaviour.

---

## Content and imports

### An import shows as a gap in the Manage tree even though I imported it

The census matches on **name and source folder**. Committing without a source
label files content under *Custom*, and the book's node stays at zero.

Watch for a duplicate all-caps folder (`CURSED SCROLL 1` beside `CS1`) — that is
the signature of a source label that didn't fold to the expected short code. See
[Compendium Packs](Compendium-Packs.md).

### Re-importing created duplicates

Check what you chose in the conflict dialog. The default — **rename the
newcomer** — creates a second copy on purpose. Choose **skip** to leave the
existing document untouched, or **replace** to update it while keeping the same
UUID (and therefore all existing links).

### Links broke after moving content to another world

The Character Options packs derive their collection ids from their **labels**.
A renamed pack becomes a different `world.<slug>`, which breaks every `@UUID`
pointing at it. Import bundles without renaming packs.

### Half my PDF paste ended up in "Skipped"

PDF copy artifacts — headers, footers, interleaved columns. If you have
registered a source PDF, use the hub's **Grab text** instead of copying from
your PDF reader; it is column-aware and produces reading order.

### A table parsed into nonsense

It needs a parsing recipe, or has the wrong one. See
[Table Import & Shapes](Table-Import-and-Shapes.md).

---

## Combat and movement

### Initiative order looks wrong at the start of round 1

Foundry re-sorts `combat.turns` as initiative arrives but leaves the turn pointer
where it was. The module watches for this and snaps the pointer back to the top
once every round-1 combatant has an initiative. It corrects itself.

### Movement isn't being tracked

- Is the crawl actually running? The bar shows **End** when it is.
- In crawl mode, is the actor in the roster? Select the token and click
  **Add Tokens** — only `Player`-type actors are added.
- In combat, all owned combatant tokens are tracked automatically.

### "No turn-start position recorded for this token"

The token's turn never began while the crawl was running — dropped mid-turn, or
the crawl started after combat. There is nothing to roll back to yet; it will
have a position from the next turn.

### Remaining movement shows a negative number

Intentional, when enforcement is off. `-20/90 ft` tells you exactly how far past
the cap a token went. A floor at zero would hide it.

---

## After updating the module

Two things run automatically once, on the next world load, for the single active
GM:

1. **Monster backfill** — brings already-imported monsters up to current import
   fidelity (icons, casing, spell items, art). Deferred 5 seconds, idempotent,
   silent unless it actually changed something. The version stamp only advances
   on success, so a failed sweep retries next load.
2. **Spell↔class relink** — runs every load, not just after updates.

Neither deletes anything. To force the backfill again, clear the
`backfillVersion` setting.

---

## Known system-side issue

### The "Searching Distant Lands…" spinner is stuck

The Shadowdark system leaks its loading dialog when an item sheet's data
preparation throws — most often right after importing a class, and its `close()`
can hang unbounded. The module installs a guard that closes the orphaned dialog
and logs the underlying error to the console.

If you hit it, the console entry is worth including in a bug report — the
underlying throw is intermittent and not yet root-caused.

---

## Reporting a bug

[Open an issue](https://github.com/DimitroffVodka/shadowdark-enhancer/issues)
with:

- Foundry version and Shadowdark system version (**Game Settings → Support**)
- Shadowdark Enhancer version
- Other active modules, especially other Shadowdark modules
- The console output (`F12`) around the failure
- What you did, what you expected, what happened

---

**Related:** [Installation & Setup](Installation-and-Setup.md) · [Settings Reference](Settings-Reference.md)
