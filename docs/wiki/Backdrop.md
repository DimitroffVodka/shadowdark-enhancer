# Backdrop

[← Wiki home](index.md) · [Camping](Camping.md)

The Backdrop is one full-screen picture that every connected player sees behind
Foundry's windows and toolbar. It is the same on every scene, so it covers the
map without you having to move the table anywhere. It is kept in a world setting,
so it survives a reload and a player who joins late sees it too.

This release has one place: the party's camp. Custom pictures, town and tavern
places and zone combat are not here yet.

---

## The toolbar tool

A GM gets a **Backdrop** tool in the Tokens group of the left toolbar. It is lit
while the picture is up. Click it to hide the picture; click it again to bring the
camp picture back. Players have no tool and cannot hide it.

While the picture is up, selected tokens are released for the GM and for the
players, so the arrow keys do not move tokens on the map underneath.

## How a camp raises and drops it

- **It rises once, when a camp begins** (Begin in the [Camping](Camping.md)
  window, or Overland making camp for the night), and only when there is no
  party token: the party actor's own token on the hex map the active GM is
  viewing (the characters' tokens do not count). A camp that begins with the
  party token on the hex map does not cover the map, so its fire light and the
  night time-lapse stay visible; an Overland camp has the party token there, so
  it normally will not raise. Raise it by hand then (below). A camp in a dungeon
  or town with only the characters' tokens on the map is covered by the picture,
  and the GM hides it from the Backdrop tool.
- Water terrain does not raise it by itself: the boat is the camp.
- Camps run by Shadowdark Extras do not raise it.
- **After a GM hides it, it stays down for that camp.** Task picks, token moves, a
  reload and a second GM do not bring it back. The next night's camp raises it
  again.
- **It drops by itself when that camp ends or is cancelled**, but only while it is
  still showing that party's camp. A picture you raised by hand during a running
  camp drops with it; one raised after the camp ended stays until you hide it.

## Show camp picture

The Camping window has a **Show camp picture** button for the GM, in the
standalone window and in the Travel tab of the Party sheet. It raises the Backdrop
by hand, which is how you get it when the party token is on the map.

## Bring the table

[Bring the table](Encounter-Battle-Maps.md#bring-the-table) on a battle map hides
the Backdrop first, also when the battle scene is already the active scene.
Return to travel does not bring it back.

## How it chooses the picture

The picture is the camp version of the battle map for the party's terrain. These
are the camp pictures that ship with the module for
[Encounter Battle Maps](Encounter-Battle-Maps.md).

| Party's terrain | Camp picture |
|---|---|
| Forest | Forest woods (camp) |
| Path | Forest road (camp) |
| Grassland | Open grassland (camp) |
| Jungle | Dense jungle (camp) |
| Swamp | Swamp bog (camp) |
| Desert | Desert dunes (camp) |
| Salt flat | Salt flat (camp) |
| Any other terrain (canyon, mountain, coast, volcano, lava, deep tunnels), or none known | Forest woods (camp) |

River, lake, ocean and arctic sea never raise it by themselves; a hand raise
there shows Forest woods (camp).

## What it does not do yet

- No custom pictures and no picture of your own choosing.
- No town or tavern places, and no zone combat.
- It is not in the Settings list; the value sits in a hidden world setting.
