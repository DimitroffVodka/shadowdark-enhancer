# Stat Damage

Some rules lower an ability score rather than hit points: a monster's draining
touch, missed rations, a hard season underground. Shadowdark Enhancer tracks
that damage so the score and its modifier drop, and a rest gives it back.

There is nothing to set up and nothing to click. A character who has never
taken stat damage shows no trace of the feature.

## What you see

Each damaged ability is **one line in the character sheet's Effects tab**, such
as *2 STR damage*. The STR score reads 2 lower, and so does its modifier, and
everything that uses them (attacks, checks, gear slots) follows. More damage
to the same ability updates that line rather than adding another.

When the damage is healed, the line disappears.

## Monster attacks

When a monster's attack hits a character and the attack's text carries a
stat-damage rider, the character takes it automatically. The rider can be in
the attack itself (*1d6 + 1 STR damage*), in the monster feature the attack
names (*1d6 + drain*, with a *Drain* feature that says *1 STR damage*), or,
for an attack that names nothing, in the feature with the attack's own name
(the bestiary Wight's *Life Drain* attack and *Life Drain* feature).

- **A plain rider** such as *1 STR damage* or *1d4 CON damage* applies on the
  hit. The amount is rolled in chat.
- **A rider behind a save** such as *DC 12 CON or 1d4 STR damage* asks the
  character's player to roll the save first, and the damage applies only if it
  fails. If no player is connected, or the player closes the roll dialog or
  does not answer within two minutes, the GM's client rolls the save.
- **A miss applies nothing.** Only monster attacks count, and only against
  characters; this needs the system's targeting setting, so the attack card
  knows who was hit.

This reads the attack text the Importer Hub and Monster Creator write, so it
works without Shadowdark Extras.

The rider lands as soon as the hit card appears, so a Duelist who then
**Parries** that hit keeps the stat damage: edit or delete the line in the Effects
tab by hand. The same goes for rerolling a hit that stays a hit: the reroll is
a new card, and its rider applies again.

> **Don't double up.** If you also put a Shadowdark Extras Effects-library
> stat-damage entry into the same attack's on-hit slot, the damage applies
> twice.

## Healing

Shadowdark Extras' camping rest heals stat damage when Enhancer is installed,
from the Extras release that adds it
([shadowdark-extras#149](https://github.com/DimitroffVodka/shadowdark-extras/issues/149)):

- **A normal rest** heals all of it.
- **Grinder Mode** heals 1 point of each damaged ability per rest.

Without Shadowdark Extras nothing heals it automatically; delete the line from
the Effects tab to heal it by hand.

## Death at CON 0

A character whose CON reaches 0 from stat damage dies: they get the dead
status, they are marked defeated in any combat they are in, and any dying state
ends. A character with the *no death at 0 CON* dying modifier (the
Necromancer's River of Death, or the Ancient Ritual training's *Survive 0 CON*)
survives it. See [Dying and Death Timers](Dying-and-Death-Timers.md#modifiers).

## Applying it by hand

Enhancer adds no control of its own. Shadowdark Extras' Effects library is
getting one-point *STR damage* through *CHA damage* entries
([shadowdark-extras#148](https://github.com/DimitroffVodka/shadowdark-extras/issues/148)):
drag one onto a character. Two drops make 2 points. Rests heal them like any
other stat damage.

For macros and other modules, see `statDamage` in the
[API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md).
