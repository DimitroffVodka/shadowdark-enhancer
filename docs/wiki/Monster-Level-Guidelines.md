# Monster Level Guidelines & Quick Adjust

[← Wiki home](Home.md)

What *should* a level-8 Shadowdark monster look like? This page covers the
answer the module ships, the editor where you change it, and the token button
that re-levels a creature in two clicks.

<!-- TODO screenshot: images/quick-adjust.png — The Quick Adjust panel on an Ogre token
     How: select an NPC token -> token HUD -> the scales icon in the right column.
     Set the target level two above the creature's own so the preview shows deltas. -->

---

## Quick Adjust (token HUD)

Select an NPC token and click the **scales** icon in the HUD's right column —
tooltip **Adjust monster level**. GM-only; it does not appear on player-character
tokens.

The panel shows the creature, its current level, and a **Target level** box with
**−** / **+** buttons. Everything below is a preview of what *would* change:

| Column | Meaning |
|---|---|
| **Stat** | AC, HP, Abilities, Attacks |
| **Now** | what the creature has today |
| **Guideline** | what the target level expects |
| **Δ** | the difference |

Rows that already match are dimmed, so your eye lands on what would actually
move. **Each row has a checkbox** — uncheck one and that stat is left alone.
Nothing is written until you press **Apply**.

### The buttons

Along the bottom, left to right:

| Button | What it does |
|---|---|
| **Apply** | Writes the checked rows to the creature. Disabled when nothing would change. |
| **Create Copy** | Builds a **new** actor at the target level and leaves the original untouched. |
| **Open in Creator** | Hands the creature to the full [Monster Creator](Monster-Creator.md) for detailed work. |
| **Revert** | Restores the stats saved before your *first* adjustment. Disabled until an adjustment exists. |

### How each stat is decided

- **AC** comes straight from the guidelines table.
- **HP** is a formula, not a lookup: **`level × 4.5 + CON`, rounded up**. Shadowdark
  monsters use a d8 hit die under the hood and 4.5 is its average roll. This is why
  the HP you get can differ from the table's HP column — that column assumes no
  Constitution modifier.
- **Ability modifiers** shift **uniformly** by the difference between the two
  levels, then clamp into the target level's observed range. This preserves the
  creature's *shape*: an ogre stays STR-heavy instead of flattening into six
  identical numbers. A creature whose six modifiers are all the same has no shape
  to preserve, so it adopts the level's typical modifier instead.
- **Attacks** rewrites every **NPC Attack** item's attack count, attack bonus, and
  damage die to the guideline. Special attacks and features are never touched.

> **Ticking Abilities changes the HP row.** HP is derived from Constitution, so
> unchecking Abilities re-plans HP against the creature's *current* CON. The
> preview updates as you toggle.

### What Apply also does

The printed stat block in the creature's Description tab — `AC 9, HP 30, ATK 2
greatclub +6 (2d6), … LV 6` — is **rewritten to match**. Shadowdark stores that
line as text, so without the rebuild the sheet would contradict its own data.

### Spells and effective level

If the creature carries Spell items, the panel notes that spells raise its
*effective* level and by how much. It is advice, not an action — the target level
is still whatever you set.

---

## The guidelines table

**Configure Settings → Shadowdark Enhancer → Monster level guidelines →
Edit Guidelines Table.** GM-only.

<!-- TODO screenshot: images/level-guidelines.png — The Monster Level Guidelines editor
     How: Configure Settings -> Shadowdark Enhancer -> Edit Guidelines Table. -->

One editable row per level, 0–19 plus 30 (levels 20–29 are interpolated on
demand):

| Column | Meaning |
|---|---|
| **LV** | Monster level |
| **AC** | Expected armour class |
| **HP** | Typical hit points at that level, assuming no CON modifier |
| **Attack — # / Bonus / Damage** | Attacks per round, attack bonus, damage die |
| **Ability Modifier — Typical / Lowest / Highest** | The band ability modifiers are clamped into |
| **Talent DC** | Suggested DC for a monster's special ability |

Every value is editable. Buttons:

| Button | What it does |
|---|---|
| **Recalculate** | Rebuilds the whole table from every NPC installed in this world — all Actor compendiums plus world actors. Needs at least 10 monsters. Fills the form; you still press **Save**. |
| **Reset** | Discards your edits and restores the shipped table. Asks first. |
| **Export** | Saves the table as JSON. |
| **Import** | Loads an exported JSON file. It is validated before anything is replaced. |
| **Save** | Commits your edits. |

Your edits are stored as a **sparse diff** over the shipped defaults, so editing
one row still leaves you inheriting improvements to every other row in future
module updates.

> **Talent DC is advisory.** Unlike the other columns it is never written to a
> creature — it exists to help you pick a DC while authoring. It is also the
> softest number in the table, since it was derived from DC mentions in feature
> prose rather than a structured field.

### Where the shipped numbers come from

They were **computed, not copied**. The module scans the monsters that ship with
the Shadowdark system, takes the median AC, HP, attack count, attack bonus and
damage die at each level plus the 10th–90th percentile band of ability modifiers,
and smooths the result so that a level represented by a single monster cannot
distort the guideline and no level ends up weaker than the one below it.

That is the same routine the **Recalculate** button runs — the difference is only
which monsters it reads. If you play with a heavily homebrewed bestiary,
recalculating will give you a table that matches *your* game.

---

## Level Baseline in the Creator

The same guidelines drive a **Level Baseline** section inside the
[Monster Creator](Monster-Creator.md), which applies them to a draft rather than
to a live actor. See that page for the walkthrough.

---

## Troubleshooting

**The scales button isn't on the token HUD.**
It is GM-only and only appears for NPC tokens. Check the token's actor is type
NPC, not a player character.

**Apply is greyed out.**
Nothing would change at that target level. Move the target, or check a row that
is currently unticked.

**Revert is greyed out.**
There is no saved restore point — either you have not applied an adjustment to
this creature, or the restore point was cleared (see below).

**Revert vanished after I edited the creature in the Creator.**
Deliberate. The restore point describes the stats from before the quick
adjustment and references attack items by identity; once the Creator has rewritten
those items, restoring it would put back a half-truth. The Creator tells you when
it clears the point.

**HP came out different from the table's HP column.**
Expected. HP applies `level × 4.5 + CON`; the column assumes CON 0. A creature
with a positive Constitution modifier gets more.

**A dump stat crept upward.**
Ability modifiers shift as a group to keep the creature's shape, and are clamped
into the level's band. If you want one ability left exactly as it was, untick
**Abilities** and set it by hand in the Creator.

**Recalculate says there are too few monsters.**
It needs at least 10 NPCs across your world and Actor compendiums. Install a
monster compendium, or edit the rows by hand.

**I recalculated and the table looks wrong.**
Nothing is committed until you press **Save**. Close the window without saving, or
press **Reset** to return to the shipped table.

---

**Related:** [Monster Creator](Monster-Creator.md) · [Random Encounters](Random-Encounters.md) · [Settings Reference](Settings-Reference.md)
