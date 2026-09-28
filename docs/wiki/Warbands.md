# Warbands

[← Wiki home](index.md)

The Player's Guide to the Western Reaches' warbands (pp.248–251): small
armies a player character commands. A **warband unit** is its own actor
type, built like the [Mount](Mounts-and-Boats.md): a real Shadowdark NPC, so
its attacks, AC, HP and damage roll as any NPC's, with a **Warband** tab.

> With Shadowdark Extras active, a warband's (and a mount's) attacks need
> Extras' fix for its attack wrapper (DimitroffVodka/shadowdark-extras#184);
> without it the attack card doesn't post.

Still to come: the book's stock warbands and the upgrades' effects (#201),
mass combat with automatic morale and rout (#203), upkeep and healing on the
world clock (#204), and recruiting as a downtime activity (#205).

---

## Making a warband

**Actors sidebar → Create Actor → Warband** makes an empty one to fill in by
hand.

Or turn a creature into one (GM): on a **level 1 to 5** NPC's sheet,
**Make a Warband** in the title bar shows the creature before and after, then
makes a new warband from a copy. The creature itself stays as it is.

- Its level doubles.
- Its HP is 8 per level plus its CON modifier.
- It makes one attack a round: it keeps every attack but uses one.
- Its attack bonus goes up by 1 for each level gained. The book says only
  "in proportion", so change it on the sheet if you read it otherwise.
- Its damage dice are tripled: 1d6 becomes 3d6.
- Its talents stay, and don't count as upgrades.

A level 2 goblin with a +1 attack for 1d6 becomes a level 4 warband with
32 HP plus its CON modifier and a +3 attack for 3d6.

---

## The Warband tab

| Part | What it does |
|---|---|
| **Commander** | Drop a player character here. The warband is theirs. |
| **Allowance** | By the commander's hit die: a d4 commands 2 warbands with 2 upgrades between them, a d6 4 and 3, a d8 or larger 6 and 4. It counts all of that commander's warbands, and a commander over it is refused with a message. |
| **Upgrades** | The 18 upgrades, each once per warband. One over the commander's allowance is refused. A warband without a commander can have up to 4. |
| **Morale** | Shows the commander's CHA modifier, which the warband's morale checks use. |

Up to 20 similar combatants act as one creature, on its commander's turn.
Player characters and creatures of level 6 or more always act as
individuals.
