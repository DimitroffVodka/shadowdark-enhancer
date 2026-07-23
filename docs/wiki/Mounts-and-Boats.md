# Mounts & Boats

[← Wiki home](Home.md)

Two Actor sub-types with dedicated sheets, for the *Western Reaches* mounts,
warband units, boats, and siege vehicles.

![The Boat sheet](images/boat-sheet.png)

---

## Creating one

**Actors sidebar → Create Actor**, then pick **Mount** or **Boat** from the type
list. They register at world load alongside the system's own types.

> **A `module.json` change needs a world relaunch, not a browser reload.** If the
> types don't appear after updating the module, relaunch the world.

---

## Mount

The Mount type **reuses the Shadowdark system's own NPC data model and sheet**,
which is the important design decision here: a mount is a creature, so its
Abilities, Description, and Effects tabs are **pixel-identical to a native NPC**,
and NPC Attacks, Features, and Spells plug straight in.

On top of that it adds three tabs:

| Tab | Contents |
|---|---|
| **Riders** | Party-style occupants — drop actors onto it |
| **Inventory** | Physical items only; attacks, features and spells stay on their own tabs |
| **Mount** | The mount-rule fields |

Occupants and the mount-rule fields live in the actor's **flags**, so the shared
occupant machinery works without changing the system's data model.

## Boat

A party-like container with four tabs:

| Tab | Contents |
|---|---|
| **Overview** | Vessel stats (HP / AC / Movement / Cost / Passengers down the left rail), the **Command** roster, properties, and the sinking countdown |
| **Passengers & Crew** | Occupants — drop actors onto it; each row has a **role** selector (Passenger / Captain / Gunner / Crew) |
| **Cargo** | Inventory, tracked against cargo slots |
| **Weapons** | Mounted siege weapons — drag them from a compendium (up to 2); each has **Attack** / **Damage** roll buttons |
| **Description** | Free text |

### Crew roles

Give each occupant a role on the **Passengers & Crew** tab — the choice shows as a
badge (⚓ Captain, 🎯 Gunner) and drives the boat's actions:

- **Captain** — controls the ship. The Overview's **Command** box shows the captain
  and a **Right the ship (CS3)** button. Note this is an *optional* **Cursed Scroll
  3** rule, not Western Reaches — WR boats *sink* (1d4 rounds at 0 HP) rather than
  capsizing, and have no righting check. Kept as a labelled CS3 tool: righting a
  capsized vessel is a **DC 20 STR** check rolled with the captain's STR, and a Sea
  Wolf captain (the **Seafarer** feature — advantage on navigating/crewing checks)
  rolls it with advantage automatically.
- **Gunner** — controls the siege weapons. When you fire a weapon on the Weapons
  tab, the assigned gunner is pre-selected as the operator. A boat can employ **up
  to two** siege weapons (trebuchets on galleons only), so up to two gunners.
- **Crew** — a trained hand working the vessel.

**Crew count.** WR's *Crew (C)* property means a boat *can't move without 4+
trained crew aboard*. The **Crew aboard** total on the Overview counts every
occupant assigned a working role — **Captain, Gunner, and Crew all count** (only
plain Passengers don't) — plus the **Hired crew** number for abstract NPC hands you
don't add as passengers. A boat below its crew requirement shows a "not enough crew"
warning.

### Boat types

Canoe · Galleon · Junk · Longboat · Raft · Rowboat · Sailboat · Sloop · Custom

### Siege weapons

Up to **two** siege weapons (trebuchets on galleons only), mounted on the **Weapons**
tab — drag them from a compendium; see the siege-weapon import section below.

### The sinking countdown

Overview carries helpers for a vessel taking on water: **begin sinking**,
**advance the countdown**, **stop sinking**, and a **sink chance** roll.

### Capacity

Passengers are limited by the vessel's **HP-derived capacity**, not by cargo
slots — the sheet reports the remaining headroom separately from cargo slot use.

---

## Importing the Western Reaches boats

The eight boats from the *Western Reaches* Player's Guide (p118 — Canoe, Galleon,
Junk, Longboat, Raft, Rowboat, Sailboat, Sloop) can be imported as ready-made
Boat actors instead of typing each one in.

They import through the **same paste → preview → commit flow as monsters and
items**, and — like every other unlock in this suite — **no stats are bundled**.
The importer reads the boats table from *your own* Western Reaches PDF (falling
back to a paste box if the page can't be read), parses all eight, previews them,
and on commit files them as Boat actors into the **`sde-actors` compendium**
(skipping any you already have). Nothing copyrighted ships in the module.

**Three ways to start it — all open the same importer preview:**

- **Importer Hub → Manage → Vehicles → Boats.** Each boat you don't yet own
  shows an **Import** button (cited to *WR pg 118*); it grabs the page and drops
  the whole table into the paste box, ready to commit.
- **`game.shadowdarkEnhancer.actors.importBoats()`** — the macro-friendly entry.
- **Manually** — set the type selector to **Boats**, paste the p118 table
  yourself, and hit **Create boats**.

Each imported boat carries its full stat line — HP, AC, speed, cargo slots, crew
requirement, the Crew/Fast/Row-Galley/Unseaworthy/Weapons properties, and its
**purchase cost** (shown in the **Cost** box on the Overview left rail).

A boat's **Weapons** property means it *can employ up to two siege weapons*
(trebuchets on galleons only) — you mount them yourself on the Weapons tab; nothing
comes pre-armed.

### Siege weapons

The four *Western Reaches* siege weapons (Ballista, Catapult, Crossbow (heavy),
Trebuchet — p119) import the same way, as Shadowdark **Weapon** items in the
`sde-items` compendium: **Importer Hub → Manage → Vehicles → Siege Weapons**, cited
to *WR pg 119*. Each carries its damage, range, cost, and 30-gear-slot bulk, plus
the **Blast** / **Exploding** weapon properties — created as real Property items
(with the rule text read off the page) so they list on the weapon like any other
property. The import also creates a **Siege Weapon Ammunition** item (1 gp per
piece, 2 gear slots).

To arm a boat, open its **Weapons** tab and **drag a siege weapon from the
compendium** onto it. Only siege weapons live on that tab — ordinary weapons carried
aboard stay in **Cargo**; dropping any weapon onto the Weapons tab mounts it as a
siege weapon (so home-brew works too), while non-weapons are turned away. WR's mount
limits — up to **two** siege weapons, **trebuchets on galleons only**, and a
**Weapons** property to mount — are enforced softly: you'll get a heads-up warning
but the GM has the final say, so nothing is hard-blocked. A **crew member operates**
each weapon, so add the actor to the **Passengers & Crew** tab first. Each mounted
weapon then has an **Attack** button and a **Damage** button:

- **Attack** opens a small dialog: pick the operating crew member (skipped when
  only one is aboard) and a roll mode — **Normal / Advantage / Disadvantage
  (untrained)**. It rolls `1d20 +` that actor's Shadowdark ranged attack bonus
  (their DEX modifier, plus any attack bonuses they carry), spoken as the crew
  member. This follows the designer's ruling that *the operator uses their ranged
  attack bonus*; the untrained **Disadvantage** option is Kelsey's own house rule
  for anyone not proficient in all weapons (a Fighter fires normally; a sneaking
  Thief's advantage would cancel the disadvantage into a flat roll).
- **Damage** rolls the weapon's own die, including multi-die formulas like a
  trebuchet's `5d6`.

So the boat fights with its weapons the way any actor does.

---

## Troubleshooting

**Mount and Boat aren't in the Create Actor list.**
Relaunch the world. Actor sub-types are declared in `module.json`, and manifest
changes need a server-side relaunch — a browser reload isn't enough.

**A dropped actor didn't become an occupant.**
Drop it onto the **Riders** (mount) or **Passengers & Crew** (boat) tab
specifically, not the Overview tab.

**The mount sheet looks like a plain NPC sheet.**
That's intentional for the shared tabs. The extra Riders / Inventory / Mount tabs
should be alongside them — if they're missing, the system's NPC sheet class
wasn't available when the module registered, which points at a load-order
problem worth reporting.

**Cargo slots and passenger capacity disagree.**
They are separate limits by design — passengers use HP-derived capacity, cargo
uses gear slots.

---

**The boats Import button says "No boats found — paste the table".**
The importer couldn't read your Western Reaches PDF (not uploaded, or the page
text didn't extract cleanly). Paste the p118 **BOATS** table into the box it
offers — the parser handles the book's split-column layout — or upload your WR
PDF via the Importer Hub's source-PDF library first.

**An imported boat wasn't created.**
A boat whose name already exists is skipped (the suite never overwrites). Delete
or rename the existing one first if you want a fresh import.

---

**Related:** [Compendium Packs](Compendium-Packs.md) · [Importer Hub](Importer-Hub.md)
