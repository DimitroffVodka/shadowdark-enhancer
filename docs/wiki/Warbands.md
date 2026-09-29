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
and recruiting as a downtime activity (#205).

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
- Its attack bonus goes up by 1 for each level gained, and so does a
  caster's spell bonus. The book says only "in proportion", so change them on
  the sheet if you read it otherwise.
- Its damage dice are tripled: 1d6 becomes 3d6.
- Its talents stay, and don't count as upgrades.

A level 2 goblin with a +1 attack for 1d6 becomes a level 4 warband with
32 HP plus its CON modifier and a +3 attack for 3d6.

---

## The Warband tab

| Part | What it does |
|---|---|
| **Commander** | Drop a player character here. The warband is theirs. A player can only name a character they own; a GM can name any, since the upkeep is paid from the commander's coins. Upkeep and Pay Arrears only take gold from a commander that one of the warband's player owners also owns, so a GM who names another player's character for a player's warband should give that player ownership of it. |
| **Allowance** | By the commander's hit die: a d4 commands 2 warbands with 2 upgrades between them, a d6 4 and 3, a d8 or larger 6 and 4. It counts all of that commander's warbands, and a commander over it is refused with a message. |
| **Upgrades** | The 18 upgrades, each once per warband. One over the commander's allowance is refused. A warband without a commander (or with one whose hit die can't be read) can have up to 4. |
| **Morale** | Shows the commander's CHA modifier, which the warband's morale checks use. |

A warband is one unit: its tokens are linked to the actor, and its HP is
fixed at 8 per level plus CON (the HP dice on its sheet sets that rather
than rolling). A copy of a warband (Duplicate, or one imported from a
compendium) starts without a commander, so taking it goes through the
commander's allowance, and without the original's arrears, desertion or
upkeep record (its upgrades stay).

Up to 20 similar combatants act as one creature, on its commander's turn.
Player characters and creatures of level 6 or more always act as
individuals.

---

## Upkeep and healing

They run off the world clock, whatever moves it: travel, camp, downtime, or
you setting the date.

- **Upkeep.** At each month start, every warband with a commander costs 10 gp
  a level, taken from the commander's coins, in one chat card (and the
  Session Recap's purchases). **Charge a Month** on the Warband tab (GM)
  charges every warband now.
- **Arrears.** A commander who can't pay leaves the warband in arrears. At
  each week start after, it checks morale: d20 plus the commander's CHA
  against DC 15 (9 if Loyal). On a failure it **deserts**: it's marked
  deserted, with a chat card, and nothing is deleted. **Pay Arrears** (GM)
  pays what's owed from the commander; **Return to Service** brings a
  deserted warband back.
- **Healing.** Every day it heals 1d4 HP (2d6 if Hardy), downtime days
  included. The GMs get one card listing who healed.
- **Retraining.** Changing a commanded warband's upgrades takes a week; the tab
  says until when, and it can't fight until then.
- A clock set back and moved on again never charges a month twice, and one
  move settles at most its last year of days, and at most 8 weeks of arrears
  checks.

A bastion's Granary (10 gp less upkeep) and Barracks (+1d6 healing) come with
bastions.

---

## Mass combat

- **Its commander's turn.** A warband whose commander is in the fight takes
  the commander's initiative, so nothing rolls for it (Chaos Mode's rerolls
  included), and it has no turn of its own: its card sits right after the
  commander's on the Crawl Strip, and the turn passes it by. It acts on the
  commander's turn, in any order. Without its commander in the fight, or
  with the commander dead (or skipped by Skip Defeated), it rolls and takes
  its own turn. Stepping back with Previous Turn passes it by the same way.
- **Morale, by itself.** When damage takes a warband to half its HP, and each
  time it's hit while below half, it checks morale: d20 plus its commander's
  CHA against DC 15 (9 if Loyal). **Its commander is leading it**, on the
  Warband tab, gives that check advantage (the commander moves with it but
  acts on their own); changing the commander turns it off. A failure rolls to rout: 3-in-6 (1-in-6 with
  Withdraw). A routed warband is destroyed: marked defeated, with a chat
  card. It stays in the combat tracker, so the recap still counts it, but it
  no longer pays upkeep, heals, or counts against its commander's allowance.
  A warband in no one's service checks no morale: one just made or imported,
  a copy, or one whose Commander box you emptied. A warband whose commander
  died still has one.
  **Return to Service** undoes a rout: it clears the routed mark, takes the
  defeated mark off its combatants in every combat, and removes the dead
  status from its token. A warband at 0 HP is dead, not just routed, and
  stays defeated.
- **Area attacks.** A warband's attack card notes that it fills a near-sized
  area around its target and can split its damage dice among what it hits
  there. The splitting is yours to do.
- **Retraining.** A warband retraining its upgrades can't fight until the
  week is up: its attack is stopped, with a warning.
