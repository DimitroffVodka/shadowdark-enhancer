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
status, and they are marked defeated in any combat they are in.

## Applying it by hand

Enhancer adds no control of its own. Shadowdark Extras' Effects library is
getting one-point *STR damage* through *CHA damage* entries
([shadowdark-extras#148](https://github.com/DimitroffVodka/shadowdark-extras/issues/148)):
drag one onto a character. Two drops make 2 points. Rests heal them like any
other stat damage.

For macros and other modules, see `statDamage` in the
[API reference](https://github.com/DimitroffVodka/shadowdark-enhancer/blob/master/docs/API.md).
